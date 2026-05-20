import assert from 'node:assert/strict';
import test from 'node:test';
import { createUser } from './authService.js';
import { dbGet } from './supabaseService.js';
import { applyPaidEntitlement } from './billingEntitlementService.js';

test('applyPaidEntitlement adds INFLUDEX credits', async () => {
  const user = await createUser(`infludex-credit-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, 'password123', 2, '인플루덱스');
  const product = await dbGet('billing_products', { id: 'infludex_credit_10000' });

  await applyPaidEntitlement({ userId: user.id, product, payment: { id: 'payment-infludex' }, paidAt: new Date('2026-05-10T00:00:00.000Z'), source: 'test' });

  const grant = await dbGet('user_products', { user_id: user.id, product_id: 'infludex' });
  assert.equal(grant.status, 'active');
  assert.equal(grant.settings.usage.infludex.limit, 105);
  assert.equal(grant.settings.usage.infludex.used, 0);
});

test('applyPaidEntitlement grants SPREAD monthly campaign usage', async () => {
  const user = await createUser(`spread-plan-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, 'password123', 2, '스프레드');
  const product = await dbGet('billing_products', { id: 'spread_basic_monthly_149000' });

  await applyPaidEntitlement({ userId: user.id, product, payment: { id: 'payment-spread' }, paidAt: new Date('2026-05-10T00:00:00.000Z'), source: 'test' });

  const grant = await dbGet('user_products', { user_id: user.id, product_id: 'spread' });
  assert.equal(grant.status, 'active');
  assert.equal(grant.settings.usage.spread.limit, 10);
  assert.equal(grant.settings.usage.spread.used, 0);
  assert.equal(grant.settings.lastPlanPayment.productId, 'spread_basic_monthly_149000');
});

test('applyPaidEntitlement grants POLIBOT lifetime access', async () => {
  const user = await createUser(`polibot-lifetime-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`, 'password123', 2, '폴리봇');
  const product = await dbGet('billing_products', { id: 'polibot_lifetime_590000' });

  await applyPaidEntitlement({ userId: user.id, product, payment: { id: 'payment-polibot' }, paidAt: new Date('2026-05-10T00:00:00.000Z'), source: 'test' });

  const grant = await dbGet('user_products', { user_id: user.id, product_id: 'polibot' });
  assert.equal(grant.status, 'active');
  assert.equal(grant.settings.unlimitedUsage, true);
  assert.equal(grant.settings.lastPlanPayment.productId, 'polibot_lifetime_590000');
});
