const SECRET_KEYS = new Set([
  'threads_access_token',
  'coupang_access_key',
  'coupang_secret_key',
  'coupang_partner_id',
  'coupang_tracking_code',
  'payment_key',
  'paymentKey',
  'secret',
  'billing_key',
  'billingKey',
  'customer_key',
  'customerKey'
]);

function maskValue(value, visible = 4) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= visible) return '•'.repeat(text.length);
  return `${'•'.repeat(Math.min(10, Math.max(6, text.length - visible)))}${text.slice(-visible)}`;
}

export function redactAccount(account) {
  if (!account) return account;
  const next = { ...account };
  for (const key of ['threads_access_token', 'coupang_access_key', 'coupang_secret_key', 'coupang_partner_id', 'coupang_tracking_code']) {
    const value = next[key];
    const flag = `has_${key}`;
    const masked = `masked_${key}`;
    next[flag] = Boolean(value);
    next[masked] = value ? maskValue(value) : '';
    delete next[key];
  }
  return next;
}

export function redactAccounts(accounts = []) {
  return accounts.map(redactAccount);
}

export function redactPayment(payment) {
  if (!payment) return payment;
  const next = { ...payment };
  for (const key of SECRET_KEYS) {
    if (next[key]) {
      next[`has_${key}`] = true;
      next[`masked_${key}`] = maskValue(next[key]);
      delete next[key];
    }
  }
  if (next.raw_data) next.raw_data = '[redacted]';
  if (next.rawData) next.rawData = '[redacted]';
  if (next.virtualAccount) next.virtualAccount = { ...next.virtualAccount };
  return next;
}

export function redactBillingSettings(settings = {}) {
  return {
    hasCoupangAccessKey: Boolean(settings.coupangAccessKey),
    maskedCoupangAccessKey: maskValue(settings.coupangAccessKey),
    hasCoupangSecretKey: Boolean(settings.coupangSecretKey),
    hasCoupangPartnerId: Boolean(settings.coupangPartnerId),
    maskedCoupangPartnerId: maskValue(settings.coupangPartnerId),
    hasDefaultTrackingCode: Boolean(settings.defaultTrackingCode),
    maskedDefaultTrackingCode: maskValue(settings.defaultTrackingCode)
  };
}

export function stripBlankSensitiveAccountFields(payload = {}) {
  const next = { ...payload };
  for (const key of ['threads_access_token', 'coupang_access_key', 'coupang_secret_key', 'coupang_partner_id', 'coupang_tracking_code']) {
    if (Object.prototype.hasOwnProperty.call(next, key) && !String(next[key] ?? '').trim()) delete next[key];
  }
  for (const key of Object.keys(next)) {
    if (key.startsWith('has_') || key.startsWith('masked_')) delete next[key];
  }
  return next;
}
