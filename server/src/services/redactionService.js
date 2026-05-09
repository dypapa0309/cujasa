const SECRET_KEYS = new Set([
  'threads_access_token',
  'threadsAccessToken',
  'access_token',
  'accessToken',
  'coupang_access_key',
  'coupangAccessKey',
  'coupang_secret_key',
  'coupangSecretKey',
  'coupang_partner_id',
  'coupangPartnerId',
  'coupang_tracking_code',
  'defaultTrackingCode',
  'payment_key',
  'paymentKey',
  'secret',
  'client_secret',
  'clientSecret',
  'billing_key',
  'billingKey',
  'customer_key',
  'customerKey',
  'authorization',
  'Authorization',
  'api_key',
  'apiKey',
  'raw_data',
  'rawData'
]);

const SECRET_KEY_PATTERN = /(token|secret|password|authorization|api[_-]?key|access[_-]?key|billing[_-]?key|payment[_-]?key|customer[_-]?key|coupang|threads|toss)/i;

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

export function redactSensitiveValue(value) {
  return maskValue(value);
}

export function redactSensitivePayload(value, depth = 0) {
  if (value == null) return value;
  if (depth > 8) return '[redacted-depth]';
  if (Array.isArray(value)) return value.map((item) => redactSensitivePayload(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    if (SECRET_KEYS.has(key) || SECRET_KEY_PATTERN.test(key)) {
      if (item == null || item === '') return [key, item];
      return [key, typeof item === 'boolean' ? item : maskValue(item)];
    }
    return [key, redactSensitivePayload(item, depth + 1)];
  }));
}

export function redactBillingSettings(settings = {}) {
  const usage = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const usageSummary = Object.fromEntries(Object.entries(usage).map(([productId, value]) => {
    const raw = value && typeof value === 'object' ? value : {};
    const limit = Number.isFinite(Number(raw.limit)) ? Math.max(0, Number(raw.limit)) : 5;
    const used = Number.isFinite(Number(raw.used)) ? Math.max(0, Number(raw.used)) : 0;
    return [productId, { limit, used, remaining: Math.max(0, limit - used) }];
  }));
  return {
    hasCoupangAccessKey: Boolean(settings.coupangAccessKey),
    maskedCoupangAccessKey: maskValue(settings.coupangAccessKey),
    hasCoupangSecretKey: Boolean(settings.coupangSecretKey),
    hasCoupangPartnerId: Boolean(settings.coupangPartnerId),
    maskedCoupangPartnerId: maskValue(settings.coupangPartnerId),
    hasDefaultTrackingCode: Boolean(settings.defaultTrackingCode),
    maskedDefaultTrackingCode: maskValue(settings.defaultTrackingCode),
    usage: usageSummary,
    billing: settings.billing && typeof settings.billing === 'object' ? {
      plan: settings.billing.plan || 'free',
      status: settings.billing.status || 'none',
      paidUntil: settings.billing.paidUntil || null,
      updatedAt: settings.billing.updatedAt || null
    } : { plan: 'free', status: 'none', paidUntil: null, updatedAt: null },
    workspaceSummary: {
      candidateCount: Array.isArray(workspace.candidates) ? workspace.candidates.length : 0,
      analysisCount: Array.isArray(workspace.analysisResults) ? workspace.analysisResults.length : 0,
      infludexAnalysisCount: Array.isArray(workspace.infludexResults) ? workspace.infludexResults.length : 0,
      campaignCount: Array.isArray(workspace.campaigns) ? workspace.campaigns.length : (workspace.campaignDraft ? 1 : 0),
      applicantCount: Array.isArray(workspace.campaigns)
        ? workspace.campaigns.reduce((sum, campaign) => sum + (Array.isArray(campaign.applicants) ? campaign.applicants.length : 0), 0)
        : Array.isArray(workspace.applicants) ? workspace.applicants.length : 0,
      customerCount: Array.isArray(workspace.customers) ? workspace.customers.length : 0,
      hasCampaignDraft: Boolean(workspace.campaignDraft) || (Array.isArray(workspace.campaigns) && workspace.campaigns.length > 0),
      hasSubmissionReview: Boolean(workspace.submissionReview) || (Array.isArray(workspace.campaigns) && workspace.campaigns.some((campaign) => campaign.submissionReview)),
      hasPolibotUpload: Boolean(workspace.upload),
      hasPolibotRecommendations: Array.isArray(workspace.recommendations) && workspace.recommendations.length > 0,
      updatedAt: workspace.updatedAt || null
    }
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
