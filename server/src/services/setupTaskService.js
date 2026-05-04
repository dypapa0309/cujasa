import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
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

  const [sms, slack] = await Promise.allSettled([
    sendSetupSms(smsText),
    sendSlackMessage(text)
  ]);
  const smsResult = sms.status === 'fulfilled' ? sms.value : { ok: false, error: sms.reason?.message || 'SMS failed' };
  const slackResult = slack.status === 'fulfilled' ? slack.value : { ok: false, error: slack.reason?.message || 'Slack failed' };
  return {
    sms: smsResult,
    slack: slackResult,
    sent: Boolean(smsResult?.ok || slackResult?.ok)
  };
}
