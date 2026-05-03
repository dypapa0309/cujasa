import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { sendSlackMessage } from './slackService.js';

const SETUP_STATUSES = new Set(['pending', 'in_progress', 'completed', 'canceled']);

export async function listSetupTasks() {
  return dbList('setup_tasks', {}, { order: 'created_at', ascending: false });
}

export async function updateSetupTask(id, patch = {}) {
  const next = {};
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
    await notifySetupTask(task, payment, product);
    await dbUpdate('setup_tasks', { id: task.id }, { notified_at: new Date().toISOString() });
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
  return sendSlackMessage(text);
}
