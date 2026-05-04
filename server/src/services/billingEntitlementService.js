import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { grantUserProduct } from './authService.js';
import { ensureSetupTaskForPayment } from './setupTaskService.js';

const CUJASA_PRODUCT_ID = 'cujasa';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const BASIC_MAX_ACCOUNTS = 2;

export function addEntitlementDays(date = new Date(), days = 30) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

export async function applyPaidEntitlement({ userId, product, payment, paidAt = new Date(), source = 'payment' }) {
  if (!userId || !product) return null;
  const paidDate = new Date(paidAt);
  const user = await dbGet('users', { id: userId });
  const isMonthly = product.billing_cycle === 'monthly' || product.plan === 'monthly';
  let paidUntil = null;
  let billingStatus = 'paid';

  if (isMonthly) {
    const currentUntil = user?.paid_until ? new Date(user.paid_until) : null;
    const base = currentUntil && currentUntil.getTime() > paidDate.getTime() ? currentUntil : paidDate;
    paidUntil = new Date(base.getTime() + MONTH_MS).toISOString();
    billingStatus = 'active';
  }

  const [updatedUser] = await dbUpdate('users', { id: userId }, {
    plan: product.plan,
    billing_status: billingStatus,
    paid_until: paidUntil,
    max_accounts: Math.max(Number(user?.max_accounts || 0), Number(product.max_accounts || BASIC_MAX_ACCOUNTS))
  });

  await grantUserProduct(userId, CUJASA_PRODUCT_ID, { status: 'active', role: 'customer' });
  if (payment?.id) await ensureSetupTaskForPayment(payment, { source });
  return updatedUser;
}

export async function createManualPayment({ userId, productId, amount, paidAt, memo = '', buyerName = '', phone = '' }) {
  const [user, product] = await Promise.all([
    dbGet('users', { id: userId }),
    dbGet('billing_products', { id: productId })
  ]);
  if (!user) {
    const error = new Error('고객을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  if (!product?.active) {
    const error = new Error('결제 상품을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  const paidDate = paidAt ? new Date(paidAt) : new Date();
  const payment = await dbInsert('billing_payments', {
    user_id: userId,
    app_product_id: product.app_product_id || CUJASA_PRODUCT_ID,
    product_id: product.id,
    order_id: `MANUAL-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    provider: 'manual',
    method: 'BANK_TRANSFER',
    amount: Number(amount || product.amount),
    status: 'paid',
    raw_data: { memo, buyerName, phone, source: 'admin_manual' },
    paid_at: paidDate.toISOString()
  });
  await applyPaidEntitlement({ userId, product, payment, paidAt: paidDate, source: 'manual' });
  return payment;
}

export async function expireDueEntitlements({ now = new Date() } = {}) {
  const users = await dbList('users');
  const expired = [];
  for (const user of users) {
    if (user.plan !== 'monthly') continue;
    if (!['active', 'past_due'].includes(user.billing_status)) continue;
    if (!user.paid_until || new Date(user.paid_until).getTime() >= now.getTime()) continue;
    const [updated] = await dbUpdate('users', { id: user.id }, { billing_status: 'past_due' });
    const grants = await dbList('user_products', { user_id: user.id, product_id: CUJASA_PRODUCT_ID });
    for (const grant of grants) await dbUpdate('user_products', { id: grant.id }, { status: 'expired' });
    expired.push(updated || user);
  }
  return expired;
}

export async function refreshUserEntitlement(userId) {
  await expireDueEntitlements();
  const user = await dbGet('users', { id: userId });
  const products = await dbList('user_products', { user_id: userId, product_id: CUJASA_PRODUCT_ID });
  const product = products[0] || null;
  const isExpired = user?.plan === 'monthly'
    && user?.paid_until
    && new Date(user.paid_until).getTime() < Date.now();
  return {
    user,
    product,
    hasAccess: Boolean(product && product.status !== 'suspended' && product.status !== 'expired' && !isExpired),
    isExpired,
    billing: {
      plan: user?.plan || null,
      status: isExpired ? 'past_due' : (user?.billing_status || 'none'),
      paidUntil: user?.paid_until || null
    }
  };
}

export async function assertUserCanOperate(userId) {
  const entitlement = await refreshUserEntitlement(userId);
  if (!entitlement.hasAccess) {
    const error = new Error(entitlement.isExpired ? '이용 기간이 만료되었습니다. 재결제 또는 연장이 필요합니다.' : 'CUJASA 이용 권한이 없습니다.');
    error.status = 402;
    error.code = entitlement.isExpired ? 'BILLING_EXPIRED' : 'BILLING_REQUIRED';
    error.entitlement = entitlement.billing;
    throw error;
  }
  return entitlement;
}

export async function assertAccountOwnerCanOperate(accountId) {
  const owners = await dbList('user_accounts', { account_id: accountId });
  if (owners.length === 0) return null;
  for (const owner of owners) {
    await assertUserCanOperate(owner.user_id);
  }
  return true;
}
