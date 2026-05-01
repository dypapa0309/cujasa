import { createCoupangAuthorization } from '../utils/coupangSignature.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';

const host = 'https://api-gateway.coupang.com';

function createSearchPath(keyword, limit = 10, trackingCode) {
  const params = new URLSearchParams({
    keyword,
    limit: String(limit)
  });
  const subId = trackingCode || process.env.COUPANG_TRACKING_CODE;
  if (subId) params.set('subId', subId);
  return `/v2/providers/affiliate_open_api/apis/openapi/products/search?${params.toString()}`;
}

function fallbackProduct(keyword, index = 0) {
  const q = encodeURIComponent(keyword);
  return {
    product_id: `fallback-${keyword}-${index}`,
    product_name: `${keyword} 추천 상품`,
    product_price: null,
    product_image: '',
    product_url: `https://www.coupang.com/np/search?q=${q}`,
    partner_url: `https://www.coupang.com/np/search?q=${q}`,
    category_name: 'fallback',
    is_fallback: true,
    raw_data: { keyword }
  };
}

export async function searchKeyword(keyword, limit = 10, creds = {}) {
  const accessKey = creds.accessKey || process.env.COUPANG_ACCESS_KEY;
  const secretKey = creds.secretKey || process.env.COUPANG_SECRET_KEY;
  if (!accessKey || !secretKey) return [fallbackProduct(keyword)];

  const path = createSearchPath(keyword, limit, creds.trackingCode);
  try {
    const response = await fetch(`${host}${path}`, {
      headers: { Authorization: createCoupangAuthorization('GET', path, accessKey, secretKey), 'Content-Type': 'application/json' }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Coupang API ${response.status}: ${body.slice(0, 300)}`);
    }
    const json = await response.json();
    return (json.data?.productData || []).map((item) => ({
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
        payload: { keyword }
      });
    } catch (logError) {
      console.warn('[coupang_fallback_log_failed]', logError.message);
    }
    return [fallbackProduct(keyword)];
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

export async function searchProductsForTopic(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await dbGet('accounts', { id: topic.account_id });
  const creds = await resolveCoupangCredentialsForAccount(account);
  const keywords = topic.search_keywords?.length ? topic.search_keywords : [topic.title];

  const existing = await dbList('coupang_products', { topic_id: topic.id });
  const seen = new Set(existing.map((p) => p.product_id));

  const saved = [];
  for (const keyword of keywords) {
    const products = await searchKeyword(keyword, 15, creds);
    for (const product of products) {
      if (seen.has(product.product_id)) continue;
      seen.add(product.product_id);
      saved.push(await dbInsert('coupang_products', {
        account_id: topic.account_id,
        topic_id: topic.id,
        keyword,
        ...product
      }));
    }
  }
  return saved;
}

export const listProducts = (topicId) => dbList('coupang_products', { topic_id: topicId }, { order: 'created_at', ascending: true });
