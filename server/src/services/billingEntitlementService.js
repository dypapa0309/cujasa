import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { grantUserProduct } from './authService.js';
import { ensureSetupTaskForPayment } from './setupTaskService.js';
import { rememberCujasaPlanPayment } from './sponsorService.js';

const CUJASA_PRODUCT_ID = 'cujasa';
const DEXOR_PRODUCT_ID = 'dexor';
const INFLUDEX_PRODUCT_ID = 'infludex';
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const BASIC_MAX_ACCOUNTS = 2;
export const DEXOR_CREDIT_PRODUCTS = {
  dexor_credit_5000: 10,
  dexor_credit_10000: 25,
  dexor_credit_50000: 150,
  dexor_credit_100000: 350
};
export const INFLUDEX_CREDIT_PRODUCTS = {
  infludex_credit_19000: 30,
  infludex_credit_49000: 100,
  infludex_credit_99000: 250
};
export const MONTHLY_USAGE_PRODUCTS = {
  spread_starter_monthly_49000: { productId: 'spread', limit: 3 },
  spread_basic_monthly_149000: { productId: 'spread', limit: 10 },
  spread_pro_monthly_390000: { productId: 'spread', limit: 30 },
  polibot_starter_monthly_39000: { productId: 'polibot', limit: 100 },
  polibot_basic_monthly_99000: { productId: 'polibot', limit: 500 },
  polibot_pro_monthly_290000: { productId: 'polibot', limit: 2000 }
};

async function addUsageCredits({ userId, productId, product, payment, credits, paidAt, source }) {
  await grantUserProduct(userId, productId, { status: 'active', role: 'customer' });
  if (credits <= 0) return dbGet('users', { id: userId });
  const grant = await dbGet('user_products', { user_id: userId, product_id: productId });
  const current = grant?.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const currentUsage = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(currentUsage.limit)) ? Math.max(0, Number(currentUsage.limit)) : 5;
  const used = Number.isFinite(Number(currentUsage.used)) ? Math.max(0, Number(currentUsage.used)) : 0;
  await dbUpdate('user_products', { user_id: userId, product_id: productId }, {
    settings: {
      ...current,
      usage: {
        ...usageRoot,
        [productId]: {
          limit: limit + credits,
          used
        }
      },
      lastCreditPayment: {
        productId: product.id,
        paymentId: payment?.id || null,
        credits,
        paidAt: new Date(paidAt).toISOString(),
        source
      }
    }
  });
  return dbGet('users', { id: userId });
}

async function applyMonthlyUsageGrant({ userId, product, payment, paidAt, source, productId, limit }) {
  await grantUserProduct(userId, productId, { status: 'active', role: 'customer' });
  const grant = await dbGet('user_products', { user_id: userId, product_id: productId });
  const current = grant?.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  await dbUpdate('user_products', { user_id: userId, product_id: productId }, {
    settings: {
      ...current,
      usage: {
        ...usageRoot,
        [productId]: {
          limit,
          used: 0,
          periodStartedAt: new Date(paidAt).toISOString(),
          periodEndsAt: new Date(new Date(paidAt).getTime() + MONTH_MS).toISOString()
        }
      },
      lastPlanPayment: {
        productId: product.id,
        paymentId: payment?.id || null,
        paidAt: new Date(paidAt).toISOString(),
        source
      }
    }
  });
  return dbGet('users', { id: userId });
}

export function addEntitlementDays(date = new Date(), days = 30) {
  return new Date(new Date(date).getTime() + days * 24 * 60 * 60 * 1000);
}

export async function applyPaidEntitlement({ userId, product, payment, paidAt = new Date(), source = 'payment' }) {
  if (!userId || !product) return null;
  const appProductId = product.app_product_id || CUJASA_PRODUCT_ID;
  if (appProductId === DEXOR_PRODUCT_ID) {
    return addUsageCredits({ userId, productId: DEXOR_PRODUCT_ID, product, payment, credits: DEXOR_CREDIT_PRODUCTS[product.id] || 0, paidAt, source });
  }
  if (appProductId === INFLUDEX_PRODUCT_ID) {
    return addUsageCredits({ userId, productId: INFLUDEX_PRODUCT_ID, product, payment, credits: INFLUDEX_CREDIT_PRODUCTS[product.id] || 0, paidAt, source });
  }
  const monthlyUsage = MONTHLY_USAGE_PRODUCTS[product.id];
  if (monthlyUsage) {
    return applyMonthlyUsageGrant({ userId, product, payment, paidAt, source, ...monthlyUsage });
  }
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
  await rememberCujasaPlanPayment({ userId, product, payment, paidAt, source }).catch(() => null);
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
  const users = await dbList('users', { plan: 'monthly' }, {
    select: 'id,plan,billing_status,paid_until',
    in: { billing_status: ['active', 'past_due'] },
    lt: { paid_until: now.toISOString() },
    limit: Math.max(100, Number(process.env.BILLING_EXPIRE_BATCH_LIMIT || 1000))
  });
  const expired = [];
  for (const user of users) {
    const updated = await expireUserEntitlement(user, { now });
    if (updated) expired.push(updated);
  }
  return expired;
}

async function expireUserEntitlement(userOrId, { now = new Date() } = {}) {
  const user = typeof userOrId === 'string' ? await dbGet('users', { id: userOrId }) : userOrId;
  if (!user) return null;
  if (user.plan !== 'monthly') return null;
  if (!['active', 'past_due'].includes(user.billing_status)) return null;
  if (!user.paid_until || new Date(user.paid_until).getTime() >= now.getTime()) return null;
  const [updated] = await dbUpdate('users', { id: user.id }, { billing_status: 'past_due' });
  const grants = await dbList('user_products', { user_id: user.id, product_id: CUJASA_PRODUCT_ID });
  for (const grant of grants) await dbUpdate('user_products', { id: grant.id }, { status: 'expired' });
  return updated || { ...user, billing_status: 'past_due' };
}

export async function refreshUserEntitlement(userId) {
  const existingUser = await dbGet('users', { id: userId });
  const expiredUser = await expireUserEntitlement(existingUser);
  const user = expiredUser || existingUser;
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
