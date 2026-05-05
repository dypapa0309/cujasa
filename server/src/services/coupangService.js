import { createCoupangAuthorization } from '../utils/coupangSignature.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { decorateProductQuality } from '../utils/productQuality.js';

const host = 'https://api-gateway.coupang.com';
const COUPANG_FETCH_TIMEOUT_MS = Number(process.env.COUPANG_FETCH_TIMEOUT_MS || 5000);
const SUCCESS_CODES = new Set(['0', 'SUCCESS']);

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
  const params = new URLSearchParams({
    keyword,
    limit: String(limit)
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
    return [fallbackProduct(keyword, 0, 'missing_credentials', 'COUPANG_CREDENTIALS_MISSING')];
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
      const isRateLimited = String(json.rCode) === '403' || /사용 횟수|초과|rate/i.test(message);
      const code = isRateLimited ? 'COUPANG_RATE_LIMIT' : 'COUPANG_API_REJECTED';
      await logActivity({
        ...logContext,
        action: isRateLimited ? 'coupang_rate_limited' : 'coupang_api_rejected',
        level: 'warn',
        message,
        payload: { keyword, rCode: json.rCode, code }
      }).catch(() => null);
      return [fallbackProduct(keyword, 0, isRateLimited ? 'rate_limited' : 'api_rejected', code, {
        rCode: json.rCode,
        rMessage: message,
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
    return productData.map((item) => ({
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
  } catch (error) {
    try {
      await logActivity({
        action: 'coupang_fallback',
        level: 'warn',
        message: error.message,
        payload: { keyword, code: 'COUPANG_API_ERROR' },
        ...logContext
      });
    } catch (logError) {
      console.warn('[coupang_fallback_log_failed]', logError.message);
    }
    return [fallbackProduct(keyword, 0, 'api_error', 'COUPANG_API_ERROR')];
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
  const keywords = options.keywords?.length ? options.keywords : (topic.search_keywords?.length ? topic.search_keywords : [topic.title]);
  const saveFallback = options.saveFallback !== false;
  const stopAfterRealCount = Number(options.stopAfterRealCount || 0);

  const existing = await dbList('coupang_products', { topic_id: topic.id });
  const seen = new Set(existing.map((p) => p.product_id));

  const saved = [];
  for (const keyword of keywords) {
    const products = await searchKeyword(keyword, 15, creds);
    for (const product of products) {
      if (product.is_fallback && !saveFallback) continue;
      if (seen.has(product.product_id)) continue;
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
  return dbInsert('coupang_products', {
    account_id: topic.account_id,
    topic_id: topic.id,
    keyword,
    ...fallbackProduct(keyword, 0, reason)
  });
}

export const listProducts = async (topicId) => (await dbList('coupang_products', { topic_id: topicId }, { order: 'created_at', ascending: true }))
  .map(decorateProductQuality);
