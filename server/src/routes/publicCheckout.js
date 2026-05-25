import { Router } from 'express';
import { createUser } from '../services/authService.js';
import { dbGet, dbInsert, dbUpdate } from '../services/supabaseService.js';
import {
  customerKeyFor,
  getProduct,
  makeOrderId,
  mapPayment,
  assertTossConfigured,
  tossClientKey,
  tossPost
} from './billing.js';
import { applyPaidEntitlement } from '../services/billingEntitlementService.js';
import { createRateLimit } from '../middleware/rateLimit.js';
import { sendOpsAlert } from '../services/notificationService.js';
import { sendSetupSms } from '../services/smsService.js';
import { ensureSetupTaskForPayment } from '../services/setupTaskService.js';

const router = Router();
const checkoutRateLimit = createRateLimit({
  scope: 'public_checkout',
  windowMs: Number(process.env.PUBLIC_CHECKOUT_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  maxRequests: Number(process.env.PUBLIC_CHECKOUT_RATE_LIMIT_MAX || 10)
});

const storeBaseUrl = () => String(process.env.STORE_URL || process.env.LANDING_URL || 'https://store.jasain.kr')
  .replace(/^LANDING_URL\s*=\s*/i, '')
  .replace(/^STORE_URL\s*=\s*/i, '')
  .trim()
  .replace(/\/$/, '');
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const storePathFor = (product) => `/store/${String(product?.app_product_id || 'cujasa').trim() || 'cujasa'}`;
const formatWon = (value) => `${Number(value || 0).toLocaleString('ko-KR')}원`;

async function notifyPublicCheckout(stage, { product, payment, user, buyerName, phone, email, virtualAccount = null } = {}) {
  const stageLabel = stage === 'paid' ? '결제 완료' : stage === 'waiting_for_deposit' ? '입금 대기' : '구매 시도';
  const cleanName = buyerName || user?.buyer_name || user?.username || '고객';
  const cleanPhone = phone || user?.phone || '-';
  const cleanEmail = email || user?.email || '-';
  const productName = product?.name || payment?.product_id || '-';
  const amount = formatWon(payment?.amount || product?.amount);
  const accountText = virtualAccount?.accountNumber
    ? `가상계좌: ${virtualAccount.bankCode || virtualAccount.bank || ''} ${virtualAccount.accountNumber}`.trim()
    : null;
  const message = [
    `[JASAIN Store ${stageLabel}]`,
    `${productName} / ${amount}`,
    `${cleanName} / ${cleanPhone}`,
    cleanEmail,
    payment?.order_id ? `주문 ${payment.order_id}` : null,
    accountText
  ].filter(Boolean).join('\n');
  await Promise.allSettled([
    sendSetupSms(message),
    sendOpsAlert(`public_checkout_${stage}`, {
      title: `Store ${stageLabel}`,
      message: `${productName} ${amount} / ${cleanName} / ${cleanPhone}`,
      payload: {
        userId: user?.id,
        paymentId: payment?.id,
        productId: product?.id || payment?.product_id,
        appProductId: product?.app_product_id || payment?.app_product_id,
        orderId: payment?.order_id,
        email: cleanEmail,
        phone: cleanPhone,
        stage
      }
    })
  ]);
}

async function upsertBuyer({ email, password, buyerName, phone }) {
  const normalizedEmail = normalizeEmail(email);
  let user = await dbGet('users', { email: normalizedEmail });
  if (!user) {
    user = await createUser(normalizedEmail, password, 2, buyerName, { grantDefault: false });
  }
  const [updated] = await dbUpdate('users', { id: user.id }, {
    buyer_name: String(buyerName || '').trim() || user.buyer_name || null,
    phone: String(phone || '').trim() || user.phone || null,
    billing_status: user.billing_status === 'paid' || user.billing_status === 'active' ? user.billing_status : 'pending'
  });
  return updated || user;
}

router.post('/virtual-account', checkoutRateLimit, async (req, res, next) => {
  try {
    const { buyerName, name, phone, email, password, productId = 'onetime_590000' } = req.body || {};
    const cleanEmail = normalizeEmail(email);
    const cleanPassword = String(password || '');
    const cleanName = String(buyerName || name || '').trim();
    const cleanPhone = String(phone || '').trim();
    if (!cleanName || !cleanPhone || !cleanEmail || cleanPassword.length < 6) {
      return res.status(400).json({ error: '이름, 전화번호, 이메일, 6자 이상 비밀번호를 입력해주세요.' });
    }

    const product = await getProduct(productId);
    assertTossConfigured();

    const user = await upsertBuyer({ email: cleanEmail, password: cleanPassword, buyerName: cleanName, phone: cleanPhone });
    const orderPrefix = `${String(product.app_product_id || 'jasain').toUpperCase()}-PUBLIC-${product.billing_cycle === 'monthly' ? 'MONTHLY' : 'ONETIME'}`;
    const orderId = makeOrderId(orderPrefix);
    const payment = await dbInsert('billing_payments', {
      user_id: user.id,
      app_product_id: product.app_product_id || 'cujasa',
      product_id: product.id,
      order_id: orderId,
      provider: 'toss',
      method: 'VIRTUAL_ACCOUNT',
      amount: product.amount,
      status: 'created',
      raw_data: { source: 'public_landing', buyerName: cleanName, phone: cleanPhone, email: cleanEmail }
    });
    await notifyPublicCheckout('created', { product, payment, user, buyerName: cleanName, phone: cleanPhone, email: cleanEmail });

    res.status(201).json({
      payment: mapPayment(payment),
      toss: {
        clientKey: tossClientKey(),
        customerKey: customerKeyFor(user.id),
        method: 'VIRTUAL_ACCOUNT',
        orderId,
        orderName: product.name,
        amount: product.amount,
        successUrl: `${storeBaseUrl()}${storePathFor(product)}?payment=success`,
        failUrl: `${storeBaseUrl()}${storePathFor(product)}?payment=fail`
      }
    });
  } catch (e) { next(e); }
});

router.post('/toss/success', checkoutRateLimit, async (req, res, next) => {
  try {
    const { paymentKey, orderId, amount } = req.body || {};
    const payment = await dbGet('billing_payments', { order_id: orderId });
    if (!payment) return res.status(404).json({ error: '결제 주문을 찾을 수 없습니다.' });
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
      await applyPaidEntitlement({ userId: payment.user_id, product, payment: updated, paidAt: new Date(), source: 'public_toss' });
      await ensureSetupTaskForPayment(updated, { source: 'public_toss' });
      const user = await dbGet('users', { id: payment.user_id });
      await notifyPublicCheckout('paid', { product, payment: updated, user, virtualAccount: approved.virtualAccount || null });
    } else {
      await dbUpdate('users', { id: payment.user_id }, { billing_status: 'pending' });
      const user = await dbGet('users', { id: payment.user_id });
      await notifyPublicCheckout('waiting_for_deposit', { product, payment: updated, user, virtualAccount: approved.virtualAccount || null });
    }

    res.json({ payment: mapPayment(updated) });
  } catch (e) { next(e); }
});

export default router;
