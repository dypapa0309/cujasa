import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { sendEmailNotification } from './notificationService.js';
import { sendSlackMessage } from './slackService.js';
import { sendSetupSms } from './smsService.js';

const SETUP_STATUSES = new Set(['pending', 'in_progress', 'completed', 'canceled']);
const EDITABLE_FIELDS = new Set(['buyer_name', 'email', 'phone', 'product_id', 'amount', 'paid_at']);

function normalizeEditablePatch(patch = {}) {
  const next = {};
  for (const field of EDITABLE_FIELDS) {
    if (patch[field] === undefined) continue;
    if (field === 'amount') {
      const value = Number(patch[field] || 0);
      next[field] = Number.isFinite(value) && value > 0 ? value : null;
      continue;
    }
    if (field === 'paid_at') {
      next[field] = patch[field] ? new Date(patch[field]).toISOString() : null;
      continue;
    }
    next[field] = String(patch[field] || '').trim() || null;
  }
  if (patch.buyerName !== undefined) next.buyer_name = String(patch.buyerName || '').trim() || null;
  return next;
}

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function setupManagerEmails() {
  return unique([
    ...(process.env.SETUP_MANAGER_EMAILS || '').split(','),
    ...(process.env.OPS_EMAIL_TO || '').split(','),
    process.env.ADMIN_EMAIL
  ]);
}

async function sendSetupEmails(type, subject, text, payload = {}) {
  const recipients = setupManagerEmails();
  if (recipients.length === 0) {
    return { configured: false, recipients: [] };
  }
  const results = [];
  for (const email of recipients) {
    try {
      const row = await sendEmailNotification(type, email, subject, text, payload);
      results.push({
        email,
        ok: row.status === 'sent',
        status: row.status,
        error: row.payload?.delivery?.email?.error || null
      });
    } catch (error) {
      results.push({ email, ok: false, error: error.message });
    }
  }
  return {
    configured: true,
    recipients: results,
    ok: results.some((row) => row.ok),
    failed: results.filter((row) => !row.ok).length
  };
}

export async function listSetupTasks() {
  return dbList('setup_tasks', {}, { order: 'created_at', ascending: false });
}

export async function updateSetupTask(id, patch = {}) {
  const next = normalizeEditablePatch(patch);
  if (patch.status !== undefined) {
    if (!SETUP_STATUSES.has(patch.status)) {
      const error = new Error('유효하지 않은 셋업 상태입니다.');
      error.status = 400;
      throw error;
    }
    next.status = patch.status;
    if (patch.status === 'in_progress') next.started_at = new Date().toISOString();
    if (patch.status === 'completed') next.completed_at = new Date().toISOString();
  }
  if (patch.notes !== undefined) next.notes = String(patch.notes || '').trim() || null;
  next.updated_at = new Date().toISOString();
  const [updated] = await dbUpdate('setup_tasks', { id }, next);
  if (!updated) {
    const error = new Error('셋업 작업을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  return updated;
}

export async function requestSetupTaskForUser(userId, { accountId = null, message = '' } = {}) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const [user, mappings, accounts, existingTasks] = await Promise.all([
    dbGet('users', { id: userId }),
    dbList('user_accounts', { user_id: userId }),
    dbList('accounts'),
    dbList('setup_tasks', { user_id: userId })
  ]);
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  const activeExisting = existingTasks
    .filter((task) => ['pending', 'in_progress'].includes(task.status))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
  if (activeExisting) {
    return { task: activeExisting, alreadyExists: true, notified: false };
  }

  const ownedAccountIds = new Set(mappings.map((row) => row.account_id));
  const ownedAccounts = accounts.filter((account) => ownedAccountIds.has(account.id) && account.status !== 'archived');
  const selectedAccount = ownedAccounts.find((account) => account.id === accountId) || ownedAccounts[0] || null;
  const missing = selectedAccount ? [
    !selectedAccount.threads_access_token ? 'Threads 연결 필요' : '',
    !(selectedAccount.coupang_access_key && selectedAccount.coupang_secret_key && selectedAccount.coupang_partner_id) ? '쿠팡 API 설정 필요' : '',
    !(String(selectedAccount.target_audience || '').trim() && String(selectedAccount.content_scope || '').trim()) ? '콘텐츠 설정 필요' : ''
  ].filter(Boolean) : ['계정 생성 필요'];
  const cleanMessage = String(message || '').trim();
  const notes = [
    '고객이 관리자 셋업 요청 버튼을 눌렀습니다.',
    selectedAccount ? `계정: ${selectedAccount.name || selectedAccount.id}${selectedAccount.account_handle ? ` (${selectedAccount.account_handle})` : ''}` : '',
    missing.length ? `부족 항목: ${missing.join(', ')}` : '',
    cleanMessage ? `고객 메모: ${cleanMessage}` : ''
  ].filter(Boolean).join('\n');

  const task = await dbInsert('setup_tasks', {
    user_id: userId,
    payment_id: null,
    product_id: 'setup_request',
    app_product_id: 'cujasa',
    buyer_name: user.buyer_name || user.username || null,
    email: user.email || null,
    phone: user.phone || null,
    amount: null,
    paid_at: null,
    status: 'pending',
    source: 'customer_request',
    notes
  });

  const notification = await notifySetupRequest(task, { user, account: selectedAccount, missing });
  if (notification.sent) {
    await dbUpdate('setup_tasks', { id: task.id }, { notified_at: new Date().toISOString() });
  }
  return { task, alreadyExists: false, notified: notification.sent, notification };
}

export async function ensureSetupTaskForPayment(payment, { notify = true, source = 'payment' } = {}) {
  if (!payment?.id || payment.status !== 'paid') return null;
  const existing = await dbGet('setup_tasks', { payment_id: payment.id });
  if (existing) return existing;

  const [user, product] = await Promise.all([
    dbGet('users', { id: payment.user_id }),
    dbGet('billing_products', { id: payment.product_id })
  ]);

  const task = await dbInsert('setup_tasks', {
    user_id: payment.user_id,
    payment_id: payment.id,
    product_id: payment.product_id,
    app_product_id: payment.app_product_id || product?.app_product_id || 'cujasa',
    buyer_name: user?.buyer_name || null,
    email: user?.email || null,
    phone: user?.phone || null,
    amount: payment.amount,
    paid_at: payment.paid_at || new Date().toISOString(),
    status: 'pending',
    source,
    notes: '결제 완료 후 자동 생성'
  });

  if (notify) {
    const notification = await notifySetupTask(task, payment, product);
    if (notification.sent) {
      await dbUpdate('setup_tasks', { id: task.id }, { notified_at: new Date().toISOString() });
    }
  }
  return task;
}

async function notifySetupRequest(task, { user, account, missing = [] } = {}) {
  const name = task.buyer_name || user?.buyer_name || user?.username || '고객';
  const text = [
    ':wrench: CUJASA 관리자 셋업 요청',
    `고객: ${name} (${task.email || '-'})`,
    `전화번호: ${task.phone || '-'}`,
    `계정: ${account?.name || '-'} ${account?.account_handle || ''}`.trim(),
    `부족 항목: ${missing.length ? missing.join(', ') : '확인 필요'}`,
    `작업 ID: ${task.id}`
  ].join('\n');
  const smsText = [
    '[CUJASA 셋업 요청]',
    `${name} / ${task.phone || '전화번호 없음'}`,
    `${task.email || '-'}`,
    account ? `${account.name || '계정'} ${account.account_handle || ''}`.trim() : '계정 없음',
    missing.length ? missing.join(', ') : '확인 필요'
  ].join('\n');

  const emailSubject = `[CUJASA] 셋업 요청 - ${name}`;
  const [sms, slack, email] = await Promise.allSettled([
    sendSetupSms(smsText),
    sendSlackMessage(text),
    sendSetupEmails('setup_request_created', emailSubject, text, {
      setupTaskId: task.id,
      userId: task.user_id,
      accountId: account?.id || null,
      source: task.source,
      missing
    })
  ]);
  const smsResult = sms.status === 'fulfilled' ? sms.value : { ok: false, error: sms.reason?.message || 'SMS failed' };
  const slackResult = slack.status === 'fulfilled' ? slack.value : { ok: false, error: slack.reason?.message || 'Slack failed' };
  const emailResult = email.status === 'fulfilled' ? email.value : { ok: false, error: email.reason?.message || 'Email failed' };
  return {
    sms: smsResult,
    slack: slackResult,
    email: emailResult,
    sent: Boolean(smsResult?.ok || slackResult?.ok || emailResult?.ok)
  };
}

async function notifySetupTask(task, payment, product) {
  const amount = Number(payment.amount || 0).toLocaleString('ko-KR');
  const text = [
    ':money_with_wings: CUJASA 결제 완료 / 셋업 필요',
    `구매자: ${task.buyer_name || '-'} (${task.email || '-'})`,
    `전화번호: ${task.phone || '-'}`,
    `상품: ${product?.name || payment.product_id}`,
    `금액: ${amount}원`,
    `주문번호: ${payment.order_id}`
  ].join('\n');
  const smsText = [
    '[CUJASA 셋업 필요]',
    `${task.buyer_name || '구매자'} / ${task.phone || '전화번호 없음'}`,
    `${task.email || '-'}`,
    `${product?.name || payment.product_id} ${amount}원`,
    `주문 ${payment.order_id || payment.id}`
  ].join('\n');

  const emailSubject = `[CUJASA] 결제 완료 / 셋업 필요 - ${task.buyer_name || '구매자'}`;
  const [sms, slack, email] = await Promise.allSettled([
    sendSetupSms(smsText),
    sendSlackMessage(text),
    sendSetupEmails('setup_task_created_from_payment', emailSubject, text, {
      setupTaskId: task.id,
      userId: task.user_id,
      paymentId: payment.id,
      productId: payment.product_id
    })
  ]);
  const smsResult = sms.status === 'fulfilled' ? sms.value : { ok: false, error: sms.reason?.message || 'SMS failed' };
  const slackResult = slack.status === 'fulfilled' ? slack.value : { ok: false, error: slack.reason?.message || 'Slack failed' };
  const emailResult = email.status === 'fulfilled' ? email.value : { ok: false, error: email.reason?.message || 'Email failed' };
  return {
    sms: smsResult,
    slack: slackResult,
    email: emailResult,
    sent: Boolean(smsResult?.ok || slackResult?.ok || emailResult?.ok)
  };
}
