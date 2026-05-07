import crypto from 'node:crypto';
import { Router } from 'express';
import { dbGet, dbInsert, dbList, dbUpdate } from '../services/supabaseService.js';
import { applyPaidEntitlement, refreshUserEntitlement } from '../services/billingEntitlementService.js';

const router = Router();
const BASIC_MAX_ACCOUNTS = 2;

const addMonths = (date, months) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

export const appBaseUrl = () => (process.env.CLIENT_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5173').split(',')[0].trim();
export const tossClientKey = () => process.env.TOSS_CLIENT_KEY || 'test_ck_dev_placeholder';
export const tossSecretKey = () => process.env.TOSS_SECRET_KEY || '';
const tossBillingSecretKey = () => process.env.TOSS_BILLING_SECRET_KEY || tossSecretKey();
export const makeOrderId = (prefix = 'CUJASA') => `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
export const customerKeyFor = (userId) => `cujasa-${userId}`;

function isProductionRuntime() {
  return process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
}

function tossMockAllowed() {
  return process.env.TOSS_ALLOW_MOCK === 'true' || !isProductionRuntime();
}

export function assertTossConfigured({ billing = false } = {}) {
  const clientKey = tossClientKey();
  const secretKey = billing ? tossBillingSecretKey() : tossSecretKey();
  if (clientKey !== 'test_ck_dev_placeholder' && secretKey) return;
  if (tossMockAllowed()) return;
  const error = new Error('Toss 라이브 키가 설정되지 않았습니다. API 개별 연동 키의 Client Key와 Secret Key를 Render 환경변수에 등록해주세요.');
  error.status = 503;
  error.code = 'TOSS_LIVE_KEYS_MISSING';
  throw error;
}

function requireCustomer(req, res) {
  if (req.user?.type !== 'user') {
    res.status(403).json({ error: 'Customer only' });
    return null;
  }
  return req.user;
}

function tossAuth(secret = tossSecretKey()) {
  return `Basic ${Buffer.from(`${secret}:`).toString('base64')}`;
}

export async function tossPost(path, body, secret = tossSecretKey()) {
  if (!secret) {
    if (!tossMockAllowed()) {
      const error = new Error('Toss 라이브 Secret Key가 설정되지 않았습니다.');
      error.status = 503;
      error.code = 'TOSS_LIVE_KEYS_MISSING';
      throw error;
    }
    if (path === '/v1/payments/confirm') {
      return {
        ...body,
        status: 'WAITING_FOR_DEPOSIT',
        secret: `dev_secret_${body.orderId}`,
        virtualAccount: {
          accountNumber: '12345678901234',
          bankCode: '088',
          customerName: 'CUJASA',
          dueDate: addMonths(new Date(), 1).toISOString()
        }
      };
    }
    if (path === '/v1/billing/authorizations/issue') {
      return { billingKey: `dev_billing_${body.customerKey}`, customerKey: body.customerKey };
    }
    if (path.startsWith('/v1/billing/')) {
      return { ...body, paymentKey: `dev_payment_${body.orderId}`, status: 'DONE', method: 'CARD' };
    }
  }

  const response = await fetch(`https://api.tosspayments.com${path}`, {
    method: 'POST',
    headers: {
      Authorization: tossAuth(secret),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || 'Toss 요청에 실패했습니다.');
  return payload;
}

async function activeProducts() {
  return dbList('billing_products', { active: true }, { order: 'amount', ascending: false });
}

export async function getProduct(productId) {
  const product = await dbGet('billing_products', { id: productId });
  if (!product?.active) {
    const error = new Error('유효한 결제 상품을 선택해주세요.');
    error.status = 400;
    throw error;
  }
  return product;
}

export function mapPayment(row) {
  if (!row) return null;
  let virtualAccount = row.virtual_account_json;
  if (typeof virtualAccount === 'string') {
    try {
      virtualAccount = JSON.parse(virtualAccount);
    } catch {
      virtualAccount = null;
    }
  }
  return {
    id: row.id,
    productId: row.product_id,
    appProductId: row.app_product_id || 'cujasa',
    subscriptionId: row.subscription_id,
    orderId: row.order_id,
    provider: row.provider,
    method: row.method,
    amount: row.amount,
    status: row.status,
    hasPaymentKey: Boolean(row.payment_key),
    maskedPaymentKey: row.payment_key ? `••••••${String(row.payment_key).slice(-4)}` : '',
    virtualAccount: virtualAccount || null,
    failedReason: row.failed_reason,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSubscription(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id,
    status: row.status,
    currentPeriodEnd: row.current_period_end,
    nextBillingAt: row.next_billing_at,
    lastPaymentId: row.last_payment_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function activateUser({ userId, plan, billingStatus, paidUntil, maxAccounts = BASIC_MAX_ACCOUNTS }) {
  const user = await dbGet('users', { id: userId });
  const nextMaxAccounts = Math.max(Number(user?.max_accounts || 0), maxAccounts);
  const [updated] = await dbUpdate('users', { id: userId }, {
    plan,
    billing_status: billingStatus,
    paid_until: paidUntil,
    max_accounts: nextMaxAccounts
  });
  return updated;
}

export async function markPaymentPaid(payment, approved, paidAt = new Date().toISOString()) {
  if (payment.status === 'paid') return payment;
  const [updated] = await dbUpdate('billing_payments', { id: payment.id }, {
    status: 'paid',
    payment_key: approved.paymentKey || payment.payment_key,
    secret: approved.secret || payment.secret || null,
    virtual_account_json: approved.virtualAccount || payment.virtual_account_json || null,
    raw_data: approved,
    paid_at: paidAt
  });
  return updated;
}

router.get('/products', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    res.json({ products: await activeProducts() });
  } catch (e) { next(e); }
});

router.get('/status', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    const entitlement = await refreshUserEntitlement(user.userId);
    const [dbUser, payments, subscriptions] = await Promise.all([
      dbGet('users', { id: user.userId }),
      dbList('billing_payments', { user_id: user.userId }, { order: 'created_at', ascending: false, limit: 10 }),
      dbList('billing_subscriptions', { user_id: user.userId }, { order: 'created_at', ascending: false, limit: 5 })
    ]);
    res.json({
      billing: {
        plan: dbUser?.plan || null,
        status: entitlement.billing.status || dbUser?.billing_status || 'none',
        paidUntil: dbUser?.paid_until || null,
        maxAccounts: dbUser?.max_accounts ?? BASIC_MAX_ACCOUNTS
      },
      payments: payments.map(mapPayment),
      subscriptions: subscriptions.map(mapSubscription)
    });
  } catch (e) { next(e); }
});

router.post('/checkout/virtual-account', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    const product = await getProduct(req.body.productId || 'onetime_590000');
    if (product.billing_cycle !== 'once') return res.status(400).json({ error: '일시불 상품만 가상계좌 결제가 가능합니다.' });
    assertTossConfigured();

    const appProductId = product.app_product_id || 'cujasa';
    const orderId = makeOrderId(appProductId === 'dexor' ? 'DEXOR-CREDIT' : 'CUJASA-ONETIME');
    const payment = await dbInsert('billing_payments', {
      user_id: user.userId,
      app_product_id: appProductId,
      product_id: product.id,
      order_id: orderId,
      provider: 'toss',
      method: 'VIRTUAL_ACCOUNT',
      amount: product.amount,
      status: 'created'
    });

    res.status(201).json({
      payment: mapPayment(payment),
      toss: {
        clientKey: tossClientKey(),
        customerKey: customerKeyFor(user.userId),
        method: 'VIRTUAL_ACCOUNT',
        orderId,
        orderName: product.name,
        amount: product.amount,
        successUrl: `${appBaseUrl()}/billing/success`,
        failUrl: `${appBaseUrl()}/billing/fail`
      }
    });
  } catch (e) { next(e); }
});

router.post('/toss/success', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    const { paymentKey, orderId, amount } = req.body;
    const payment = await dbGet('billing_payments', { order_id: orderId });
    if (!payment || payment.user_id !== user.userId) return res.status(404).json({ error: '결제 주문을 찾을 수 없습니다.' });
    if (Number(amount) !== Number(payment.amount)) return res.status(400).json({ error: '결제 금액이 일치하지 않습니다.' });
    if (payment.status === 'paid') return res.json({ payment: mapPayment(payment), duplicated: true });
    if (payment.status === 'waiting_for_deposit' && payment.payment_key) {
      return res.json({ payment: mapPayment(payment), duplicated: true });
    }

    const product = await getProduct(payment.product_id);
    const approved = await tossPost('/v1/payments/confirm', { paymentKey, orderId, amount: Number(amount) });
    const nextStatus = approved.status === 'DONE' ? 'paid' : 'waiting_for_deposit';
    const [updated] = await dbUpdate('billing_payments', { id: payment.id }, {
      status: nextStatus,
      payment_key: approved.paymentKey || paymentKey,
      secret: approved.secret || null,
      virtual_account_json: approved.virtualAccount || null,
      raw_data: approved,
      paid_at: nextStatus === 'paid' ? new Date().toISOString() : null
    });

    if (nextStatus === 'paid') {
      await applyPaidEntitlement({ userId: user.userId, product, payment: updated, paidAt: new Date(), source: 'toss' });
    } else if ((product.app_product_id || 'cujasa') === 'cujasa') {
      await dbUpdate('users', { id: user.userId }, { billing_status: 'pending' });
    }

    res.json({ payment: mapPayment(updated) });
  } catch (e) { next(e); }
});

router.post('/billing-auth', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    const product = await getProduct(req.body.productId || 'monthly_59000');
    if (product.billing_cycle !== 'monthly') return res.status(400).json({ error: '월정액 상품만 자동결제 등록이 가능합니다.' });
    assertTossConfigured({ billing: true });
    const customerKey = req.body.customerKey || customerKeyFor(user.userId);

    if (!req.body.authKey) {
      const subscription = await dbInsert('billing_subscriptions', {
        user_id: user.userId,
        app_product_id: product.app_product_id || 'cujasa',
        product_id: product.id,
        customer_key: customerKey,
        status: 'pending'
      });
      return res.status(201).json({
        subscription: mapSubscription(subscription),
        toss: {
          clientKey: tossClientKey(),
          customerKey,
          method: 'CARD',
          orderId: makeOrderId('CUJASA-MONTHLY-AUTH'),
          orderName: product.name,
          amount: product.amount,
          successUrl: `${appBaseUrl()}/billing/success`,
          failUrl: `${appBaseUrl()}/billing/fail`
        }
      });
    }

    const subscription = await dbGet('billing_subscriptions', { id: req.body.subscriptionId });
    if (!subscription || subscription.user_id !== user.userId) return res.status(404).json({ error: '구독 요청을 찾을 수 없습니다.' });

    const issued = await tossPost('/v1/billing/authorizations/issue', { authKey: req.body.authKey, customerKey }, tossBillingSecretKey());
    const orderId = makeOrderId('CUJASA-MONTHLY');
    const charged = await tossPost(`/v1/billing/${issued.billingKey}`, {
      customerKey,
      amount: Number(product.amount),
      orderId,
      orderName: product.name,
      customerEmail: user.email
    }, tossBillingSecretKey());

    const now = new Date();
    const nextBillingAt = addMonths(now, 1).toISOString();
    const payment = await dbInsert('billing_payments', {
      user_id: user.userId,
      app_product_id: product.app_product_id || 'cujasa',
      product_id: product.id,
      subscription_id: subscription.id,
      order_id: orderId,
      provider: 'toss',
      method: 'BILLING_CARD',
      amount: product.amount,
      status: charged.status === 'DONE' ? 'paid' : 'failed',
      payment_key: charged.paymentKey || null,
      raw_data: charged,
      failed_reason: charged.status === 'DONE' ? null : '자동결제 승인 실패',
      paid_at: charged.status === 'DONE' ? now.toISOString() : null
    });

    const nextSubscriptionStatus = charged.status === 'DONE' ? 'active' : 'past_due';
    const [updatedSubscription] = await dbUpdate('billing_subscriptions', { id: subscription.id }, {
      billing_key: issued.billingKey,
      status: nextSubscriptionStatus,
      current_period_end: charged.status === 'DONE' ? nextBillingAt : null,
      next_billing_at: charged.status === 'DONE' ? nextBillingAt : null,
      last_payment_id: payment.id
    });

    if (charged.status === 'DONE') {
      await applyPaidEntitlement({ userId: user.userId, product, payment, paidAt: now, source: 'toss_billing' });
    } else {
      await dbUpdate('users', { id: user.userId }, { billing_status: 'past_due' });
    }

    res.json({ subscription: mapSubscription(updatedSubscription), payment: mapPayment(payment) });
  } catch (e) { next(e); }
});

router.post('/subscriptions/:id/charge', async (req, res, next) => {
  try {
    const user = requireCustomer(req, res);
    if (!user) return;
    const subscription = await dbGet('billing_subscriptions', { id: req.params.id });
    if (!subscription || subscription.user_id !== user.userId) return res.status(404).json({ error: '구독을 찾을 수 없습니다.' });
    if (!subscription.billing_key) return res.status(409).json({ error: '등록된 빌링키가 없습니다.' });
    assertTossConfigured({ billing: true });
    const product = await getProduct(subscription.product_id);
    const orderId = makeOrderId('CUJASA-MONTHLY');
    const charged = await tossPost(`/v1/billing/${subscription.billing_key}`, {
      customerKey: subscription.customer_key,
      amount: Number(product.amount),
      orderId,
      orderName: product.name,
      customerEmail: user.email
    }, tossBillingSecretKey());
    const now = new Date();
    const nextBillingAt = addMonths(now, 1).toISOString();
    const payment = await dbInsert('billing_payments', {
      user_id: user.userId,
      app_product_id: product.app_product_id || 'cujasa',
      product_id: product.id,
      subscription_id: subscription.id,
      order_id: orderId,
      provider: 'toss',
      method: 'BILLING_CARD',
      amount: product.amount,
      status: charged.status === 'DONE' ? 'paid' : 'failed',
      payment_key: charged.paymentKey || null,
      raw_data: charged,
      failed_reason: charged.status === 'DONE' ? null : '자동결제 승인 실패',
      paid_at: charged.status === 'DONE' ? now.toISOString() : null
    });
    await dbUpdate('billing_subscriptions', { id: subscription.id }, {
      status: charged.status === 'DONE' ? 'active' : 'past_due',
      current_period_end: charged.status === 'DONE' ? nextBillingAt : subscription.current_period_end,
      next_billing_at: charged.status === 'DONE' ? nextBillingAt : subscription.next_billing_at,
      last_payment_id: payment.id
    });
    if (charged.status === 'DONE') {
      await applyPaidEntitlement({ userId: user.userId, product, payment, paidAt: now, source: 'toss_billing' });
    } else {
      await dbUpdate('users', { id: user.userId }, { billing_status: 'past_due' });
    }
    res.json({ payment: mapPayment(payment) });
  } catch (e) { next(e); }
});

export async function tossWebhook(req, res, next) {
  try {
    const data = req.body?.data || req.body || {};
    const orderId = data.orderId || req.body?.orderId;
    const status = data.status || req.body?.status;
    const secret = data.secret || req.body?.secret;
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });
    const payment = await dbGet('billing_payments', { order_id: orderId });
    if (!payment) return res.status(404).json({ error: '결제를 찾을 수 없습니다.' });
    if (['DONE', 'WAITING_FOR_DEPOSIT'].includes(status) && (!payment.secret || !secret || payment.secret !== secret)) {
      return res.status(403).json({ error: '웹훅 secret이 일치하지 않습니다.' });
    }

    if (status === 'DONE' && payment.status !== 'paid') {
      const product = await getProduct(payment.product_id);
      const updated = await markPaymentPaid(payment, data);
      await applyPaidEntitlement({ userId: payment.user_id, product, payment: updated, paidAt: new Date(), source: 'toss_webhook' });
      return res.json({ ok: true, payment: mapPayment(updated) });
    }

    if (status === 'WAITING_FOR_DEPOSIT' && payment.status !== 'paid') {
      await dbUpdate('billing_payments', { id: payment.id }, { status: 'waiting_for_deposit', raw_data: data });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
}

export default router;
