import { Router } from 'express';
import { createUser, grantUserProduct } from '../services/authService.js';
import { dbGet, dbInsert, dbUpdate } from '../services/supabaseService.js';
import {
  activateUser,
  customerKeyFor,
  getProduct,
  makeOrderId,
  mapPayment,
  tossClientKey,
  tossPost
} from './billing.js';
import { ensureSetupTaskForPayment } from '../services/setupTaskService.js';

const router = Router();

const landingBaseUrl = () => String(process.env.LANDING_URL || 'https://jasain.kr')
  .replace(/^LANDING_URL\s*=\s*/i, '')
  .trim()
  .replace(/\/$/, '');
const normalizeEmail = (value = '') => String(value).trim().toLowerCase();

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

router.post('/virtual-account', async (req, res, next) => {
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
    if (product.billing_cycle !== 'once') {
      return res.status(400).json({ error: '현재 공개 결제는 일시불 가상계좌만 지원합니다.' });
    }

    const user = await upsertBuyer({ email: cleanEmail, password: cleanPassword, buyerName: cleanName, phone: cleanPhone });
    const orderId = makeOrderId('CUJASA-PUBLIC-ONETIME');
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

    res.status(201).json({
      payment: mapPayment(payment),
      toss: {
        clientKey: tossClientKey(),
        customerKey: customerKeyFor(user.id),
        method: 'VIRTUAL_ACCOUNT',
        orderId,
        orderName: product.name,
        amount: product.amount,
        successUrl: `${landingBaseUrl()}/?payment=success#cj-form`,
        failUrl: `${landingBaseUrl()}/?payment=fail#cj-form`
      }
    });
  } catch (e) { next(e); }
});

router.post('/toss/success', async (req, res, next) => {
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
      await activateUser({
        userId: payment.user_id,
        plan: product.plan,
        billingStatus: 'paid',
        paidUntil: null,
        maxAccounts: product.max_accounts
      });
      await grantUserProduct(payment.user_id, 'cujasa', { status: 'active', role: 'customer' });
      await ensureSetupTaskForPayment(updated);
    } else {
      await dbUpdate('users', { id: payment.user_id }, { billing_status: 'pending' });
    }

    res.json({ payment: mapPayment(updated) });
  } catch (e) { next(e); }
});

export default router;
