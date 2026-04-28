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

export async function searchProductsForTopic(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await dbGet('accounts', { id: topic.account_id });
  const creds = {
    accessKey: account.coupang_access_key,
    secretKey: account.coupang_secret_key,
    trackingCode: account.coupang_tracking_code
  };
  const keywords = topic.search_keywords?.length ? topic.search_keywords : [topic.title];

  const existing = await dbList('coupang_products', { topic_id: topic.id });
  const seen = new Set(existing.map((p) => p.product_id));

  const saved = [];
  for (const keyword of keywords) {
    const products = await searchKeyword(keyword, 10, creds);
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
