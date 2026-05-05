import { createCoupangAuthorization } from '../utils/coupangSignature.js';
import { dbGet, dbInsert, dbList, dbUpdate, logActivity, supabase } from './supabaseService.js';
import { decorateProductQuality } from '../utils/productQuality.js';

const host = 'https://api-gateway.coupang.com';
const COUPANG_FETCH_TIMEOUT_MS = Number(process.env.COUPANG_FETCH_TIMEOUT_MS || 5000);
const COUPANG_KEYWORDS_PER_TOPIC = Math.max(1, Number(process.env.COUPANG_KEYWORDS_PER_TOPIC || 1));
const COUPANG_ACCOUNT_SEARCH_INTERVAL_MS = Math.max(0, Number(process.env.COUPANG_ACCOUNT_SEARCH_INTERVAL_MS || 90000));
const COUPANG_SEARCH_RESULT_LIMIT = Math.min(10, Math.max(1, Number(process.env.COUPANG_SEARCH_RESULT_LIMIT || 10)));
const SUCCESS_CODES = new Set(['0', 'SUCCESS']);
const accountSearchNextAllowedAt = new Map();
const COUPANG_STATUS = {
  OK: 'ok',
  RATE_LIMITED: 'rate_limited',
  CREDENTIALS_MISSING: 'credentials_missing',
  API_ERROR: 'api_error'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = COUPANG_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function createSearchPath(keyword, limit = 10, trackingCode) {
  const safeLimit = Math.min(10, Math.max(1, Number(limit || COUPANG_SEARCH_RESULT_LIMIT)));
  const params = new URLSearchParams({
    keyword,
    limit: String(safeLimit)
  });
  const subId = trackingCode || process.env.COUPANG_TRACKING_CODE;
  if (subId) params.set('subId', subId);
  return `/v2/providers/affiliate_open_api/apis/openapi/products/search?${params.toString()}`;
}

function fallbackProduct(keyword, index = 0, reason = 'fallback', code = 'NO_REAL_PRODUCTS', extra = {}) {
  const q = encodeURIComponent(keyword);
  return {
    product_id: `fallback-${keyword}-${index}`,
    product_name: `${keyword} 추천 상품`,
    product_price: 0,
    product_image: '',
    product_url: `https://www.coupang.com/np/search?q=${q}`,
    partner_url: `https://www.coupang.com/np/search?q=${q}`,
    category_name: 'fallback',
    is_fallback: true,
    raw_data: { keyword, reason, code, ...extra }
  };
}

function parseCoupangCooldownUntil(message = '') {
  const match = String(message || '').match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?/);
  if (!match) return new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const normalized = match[0].replace(/(\.\d{3})\d+$/, '$1');
  const parsed = new Date(`${normalized}+09:00`);
  return Number.isNaN(parsed.getTime()) ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : parsed.toISOString();
}

function isRateLimitMessage(message = '') {
  return /분당|50회|총\s*\d+회\s*초과|사용 횟수|초과|rate|too many/i.test(String(message || ''));
}

function createThrottleProduct(keyword, retryAfterMs) {
  return fallbackProduct(keyword, 0, 'account_throttled', 'COUPANG_SEARCH_THROTTLED', {
    retryAfterMs,
    retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    stopSearch: true
  });
}

export function isCoupangCooldownActive(account = {}) {
  if (account.coupang_search_status !== COUPANG_STATUS.RATE_LIMITED) return false;
  const until = new Date(account.coupang_search_cooldown_until || 0).getTime();
  return until > Date.now();
}

export function createCoupangCooldownError(account = {}) {
  const until = account.coupang_search_cooldown_until || null;
  const error = new Error(until
    ? `쿠팡 요청 제한 보호 중입니다. ${until} 이후 다시 시도해주세요.`
    : '쿠팡 요청 제한 보호 중입니다. 쿨다운 해제 후 다시 시도해주세요.');
  error.status = 429;
  error.code = 'COUPANG_RATE_LIMIT';
  error.cooldownUntil = until;
  return error;
}

async function updateCoupangSearchState(accountId, patch) {
  if (!accountId) return null;
  try {
    const [updated] = await dbUpdate('accounts', { id: accountId }, patch);
    return updated || null;
  } catch (error) {
    if (!/coupang_search_status|coupang_search_cooldown_until|schema cache|column/i.test(error.message || '')) throw error;
    return null;
  }
}

async function acquireCoupangSearchSlot({ accountId, keyword, logContext }) {
  if (!accountId || COUPANG_ACCOUNT_SEARCH_INTERVAL_MS <= 0) return { ok: true };
  const now = new Date();
  const nowIso = now.toISOString();
  const nextAllowedAt = new Date(now.getTime() + COUPANG_ACCOUNT_SEARCH_INTERVAL_MS).toISOString();

  if (supabase) {
    try {
      const { data: updated, error: updateError } = await supabase
        .from('coupang_search_locks')
        .update({
          next_allowed_at: nextAllowedAt,
          last_keyword: keyword,
          last_reason: 'search_started',
          updated_at: nowIso
        })
        .eq('account_id', accountId)
        .lte('next_allowed_at', nowIso)
        .select();
      if (updateError) throw updateError;
      if (updated?.length) return { ok: true };

      const { data: existing, error: getError } = await supabase
        .from('coupang_search_locks')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle();
      if (getError) throw getError;
      if (!existing) {
        const { error: insertError } = await supabase
          .from('coupang_search_locks')
          .insert({
            account_id: accountId,
            next_allowed_at: nextAllowedAt,
            last_keyword: keyword,
            last_reason: 'search_started'
          });
        if (!insertError) return { ok: true };
        if (!/duplicate key|23505/i.test(insertError.message || insertError.code || '')) throw insertError;
        const retry = await dbGet('coupang_search_locks', { account_id: accountId });
        const retryAfterMs = Math.max(0, new Date(retry?.next_allowed_at || nextAllowedAt).getTime() - Date.now());
        return { ok: false, retryAfterMs, nextAllowedAt: retry?.next_allowed_at || nextAllowedAt };
      }

      const retryAfterMs = Math.max(0, new Date(existing.next_allowed_at || nextAllowedAt).getTime() - Date.now());
      return { ok: false, retryAfterMs, nextAllowedAt: existing.next_allowed_at };
    } catch (error) {
      if (!/coupang_search_locks|schema cache|relation/i.test(error.message || '')) throw error;
      console.warn('[coupang_search_lock_unavailable]', error.message);
    }
  }

  const nextAt = accountSearchNextAllowedAt.get(accountId) || 0;
  if (nextAt > Date.now()) {
    return { ok: false, retryAfterMs: nextAt - Date.now(), nextAllowedAt: new Date(nextAt).toISOString() };
  }
  accountSearchNextAllowedAt.set(accountId, Date.now() + COUPANG_ACCOUNT_SEARCH_INTERVAL_MS);
  return { ok: true };
}

export async function searchKeyword(keyword, limit = 10, creds = {}) {
  const accessKey = creds.accessKey || process.env.COUPANG_ACCESS_KEY;
  const secretKey = creds.secretKey || process.env.COUPANG_SECRET_KEY;
  const logContext = {
    account_id: creds.accountId,
    project_id: creds.projectId,
    topic_id: creds.topicId
  };
  if (!accessKey || !secretKey) {
    await logActivity({
      ...logContext,
      action: 'coupang_credentials_missing',
      level: 'warn',
      message: '쿠팡 검색 키가 없어 fallback 상품을 생성합니다.',
      payload: { keyword, code: 'COUPANG_CREDENTIALS_MISSING' }
    }).catch(() => null);
    await updateCoupangSearchState(creds.accountId, {
      coupang_search_status: COUPANG_STATUS.CREDENTIALS_MISSING,
      coupang_search_cooldown_until: null
    });
    return [fallbackProduct(keyword, 0, 'missing_credentials', 'COUPANG_CREDENTIALS_MISSING')];
  }

  const slot = await acquireCoupangSearchSlot({ accountId: creds.accountId, keyword, logContext });
  if (!slot.ok) {
    const retryAfterMs = slot.retryAfterMs || COUPANG_ACCOUNT_SEARCH_INTERVAL_MS;
    await logActivity({
      ...logContext,
      action: 'coupang_search_throttled',
      level: 'warn',
      message: '계정 단위 쿠팡 검색 간격 보호로 추가 검색을 건너뜁니다.',
      payload: {
        keyword,
        code: 'COUPANG_SEARCH_THROTTLED',
        retryAfterMs,
        retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
        nextAllowedAt: slot.nextAllowedAt
      }
    }).catch(() => null);
    return [createThrottleProduct(keyword, retryAfterMs)];
  }

  const path = createSearchPath(keyword, limit, creds.trackingCode);
  try {
    const response = await fetchWithTimeout(`${host}${path}`, {
      headers: { Authorization: createCoupangAuthorization('GET', path, accessKey, secretKey), 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Coupang API ${response.status}: ${body.slice(0, 300)}`);
    }
    const json = await response.json();
    if (json.rCode && !SUCCESS_CODES.has(String(json.rCode).toUpperCase())) {
      const message = json.rMessage || `Coupang API rejected request with rCode ${json.rCode}`;
      const isRateLimited = String(json.rCode) === '403' || isRateLimitMessage(message);
      const code = isRateLimited ? 'COUPANG_RATE_LIMIT' : 'COUPANG_API_REJECTED';
      const cooldownUntil = isRateLimited ? parseCoupangCooldownUntil(message) : null;
      await logActivity({
        ...logContext,
        action: isRateLimited ? 'coupang_rate_limited' : 'coupang_api_rejected',
        level: 'warn',
        message,
        payload: { keyword, rCode: json.rCode, code, cooldownUntil }
      }).catch(() => null);
      await updateCoupangSearchState(creds.accountId, {
        coupang_search_status: isRateLimited ? COUPANG_STATUS.RATE_LIMITED : COUPANG_STATUS.API_ERROR,
        coupang_search_cooldown_until: cooldownUntil
      });
      return [fallbackProduct(keyword, 0, isRateLimited ? 'rate_limited' : 'api_rejected', code, {
        rCode: json.rCode,
        rMessage: message,
        cooldownUntil,
        stopSearch: isRateLimited
      })];
    }
    const productData = json.data?.productData || [];
    if (productData.length === 0) {
      await logActivity({
        ...logContext,
        action: 'coupang_empty_result',
        level: 'warn',
        message: '쿠팡 검색 결과가 없어 실상품 후보를 만들지 못했습니다.',
        payload: { keyword, code: 'NO_REAL_PRODUCTS' }
      });
      return [fallbackProduct(keyword, 0, 'empty_result')];
    }
    const mapped = productData.map((item) => ({
      product_id: String(item.productId),
      product_name: item.productName,
      product_price: item.productPrice,
      product_image: item.productImage,
      product_url: item.productUrl,
      partner_url: item.productUrl,
      category_name: item.categoryName,
      is_fallback: false,
      raw_data: item
    }));
    await updateCoupangSearchState(creds.accountId, {
      coupang_search_status: COUPANG_STATUS.OK,
      coupang_search_cooldown_until: null
    });
    return mapped;
  } catch (error) {
    const isRateLimited = isRateLimitMessage(error.message);
    const cooldownUntil = isRateLimited ? parseCoupangCooldownUntil(error.message) : null;
    const code = isRateLimited ? 'COUPANG_RATE_LIMIT' : 'COUPANG_API_ERROR';
    try {
      await logActivity({
        action: isRateLimited ? 'coupang_rate_limited' : 'coupang_fallback',
        level: 'warn',
        message: error.message,
        payload: { keyword, code, cooldownUntil },
        ...logContext
      });
    } catch (logError) {
      console.warn('[coupang_fallback_log_failed]', logError.message);
    }
    await updateCoupangSearchState(creds.accountId, {
      coupang_search_status: isRateLimited ? COUPANG_STATUS.RATE_LIMITED : COUPANG_STATUS.API_ERROR,
      coupang_search_cooldown_until: cooldownUntil
    });
    return [fallbackProduct(keyword, 0, isRateLimited ? 'rate_limited' : 'api_error', code, {
      cooldownUntil,
      stopSearch: isRateLimited
    })];
  }
}

export async function resolveCoupangCredentialsForAccount(account) {
  if (!account) {
    return {
      accessKey: process.env.COUPANG_ACCESS_KEY,
      secretKey: process.env.COUPANG_SECRET_KEY,
      partnerId: process.env.COUPANG_PARTNER_ID,
      trackingCode: process.env.COUPANG_TRACKING_CODE
    };
  }

  let productSettings = {};
  try {
    const links = await dbList('user_accounts', { account_id: account.id });
    const userIds = links.map((link) => link.user_id).filter(Boolean);
    for (const userId of userIds) {
      const grant = await dbGet('user_products', { user_id: userId, product_id: 'cujasa' });
      if (grant?.settings && typeof grant.settings === 'object') {
        productSettings = grant.settings;
        break;
      }
    }
  } catch (error) {
    console.warn('[coupang_settings_lookup_failed]', error.message);
  }

  return {
    accessKey: account.coupang_access_key || productSettings.coupangAccessKey || process.env.COUPANG_ACCESS_KEY,
    secretKey: account.coupang_secret_key || productSettings.coupangSecretKey || process.env.COUPANG_SECRET_KEY,
    partnerId: account.coupang_partner_id || productSettings.coupangPartnerId || process.env.COUPANG_PARTNER_ID,
    trackingCode: account.coupang_tracking_code || productSettings.defaultTrackingCode || process.env.COUPANG_TRACKING_CODE
  };
}

export async function searchProductsForTopic(topicId, options = {}) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await dbGet('accounts', { id: topic.account_id });
  const resolvedCreds = await resolveCoupangCredentialsForAccount(account);
  const creds = {
    ...resolvedCreds,
    accountId: account.id,
    projectId: account.project_id,
    topicId: topic.id
  };
  const rawKeywords = options.keywords?.length ? options.keywords : (topic.search_keywords?.length ? topic.search_keywords : [topic.title]);
  const keywordLimit = Math.max(1, Number(options.keywordLimit || COUPANG_KEYWORDS_PER_TOPIC));
  const keywords = rawKeywords.slice(0, keywordLimit);
  const stopAfterRealCount = Number(options.stopAfterRealCount || 0);

  const existing = await dbList('coupang_products', { topic_id: topic.id });
  const seen = new Set(existing.map((p) => p.product_id));
  const existingByProductId = new Map(existing.map((product) => [product.product_id, product]));

  const saved = [];
  if (isCoupangCooldownActive(account)) {
    const keyword = keywords[0] || topic.title || '상품 추천';
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      topic_id: topic.id,
      action: 'coupang_search_cooldown_active',
      level: 'warn',
      message: '쿠팡 검색 제한 중이라 추가 검색을 건너뜁니다.',
      payload: {
        keyword,
        code: 'COUPANG_RATE_LIMIT',
        cooldownUntil: account.coupang_search_cooldown_until
      }
    }).catch(() => null);
    const fallback = fallbackProduct(keyword, 0, 'rate_limited_cooldown', 'COUPANG_RATE_LIMIT', {
      cooldownUntil: account.coupang_search_cooldown_until,
      stopSearch: true
    });
    return [seen.has(fallback.product_id) ? (existingByProductId.get(fallback.product_id) || fallback) : fallback];
  }
  for (const keyword of keywords) {
    const products = await searchKeyword(keyword, COUPANG_SEARCH_RESULT_LIMIT, creds);
    for (const product of products) {
      if (product.raw_data?.code === 'COUPANG_RATE_LIMIT' || product.raw_data?.code === 'COUPANG_SEARCH_THROTTLED') {
        saved.push(product);
        continue;
      }
      if (product.is_fallback) {
        saved.push(product);
        continue;
      }
      if (seen.has(product.product_id)) {
        if (product.raw_data?.stopSearch) saved.push(existingByProductId.get(product.product_id) || product);
        continue;
      }
      seen.add(product.product_id);
      const row = await dbInsert('coupang_products', {
        account_id: topic.account_id,
        topic_id: topic.id,
        keyword,
        ...product
      });
      saved.push(row);
    }
    if (products.some((product) => product.raw_data?.stopSearch)) break;
    if (stopAfterRealCount > 0 && saved.filter((product) => !product.is_fallback).length >= stopAfterRealCount) break;
  }
  return saved;
}

export async function ensureFallbackProductForTopic(topicId, reason = 'repair_failed') {
  const topic = await dbGet('topics', { id: topicId });
  if (!topic) return null;
  const existing = await dbList('coupang_products', { topic_id: topic.id });
  const fallback = existing.find((product) => product.is_fallback);
  if (fallback) return fallback;
  const keyword = topic.search_keywords?.[0] || topic.title || '상품 추천';
  return {
    account_id: topic.account_id,
    topic_id: topic.id,
    keyword,
    ...fallbackProduct(keyword, 0, reason)
  };
}

export const listProducts = async (topicId) => (await dbList('coupang_products', { topic_id: topicId }, { order: 'created_at', ascending: true }))
  .map(decorateProductQuality);
