import { createCoupangAuthorization } from '../utils/coupangSignature.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';

const host = 'https://api-gateway.coupang.com';

function createSearchPath(keyword, limit = 10) {
  const params = new URLSearchParams({
    keyword,
    limit: String(limit)
  });
  if (process.env.COUPANG_TRACKING_CODE) {
    params.set('subId', process.env.COUPANG_TRACKING_CODE);
  }
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

export async function searchKeyword(keyword, limit = 10) {
  if (!process.env.COUPANG_ACCESS_KEY || !process.env.COUPANG_SECRET_KEY) {
    return [fallbackProduct(keyword)];
  }
  const path = createSearchPath(keyword, limit);
  try {
    const response = await fetch(`${host}${path}`, {
      headers: { Authorization: createCoupangAuthorization('GET', path), 'Content-Type': 'application/json' }
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
        payload: { keyword, hasSubId: Boolean(process.env.COUPANG_TRACKING_CODE) }
      });
    } catch (logError) {
      console.warn('[coupang_fallback_log_failed]', logError.message);
    }
    return [fallbackProduct(keyword)];
  }
}

export async function searchProductsForTopic(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const keywords = topic.search_keywords?.length ? topic.search_keywords : [topic.title];
  const seen = new Set();
  const saved = [];
  for (const keyword of keywords) {
    const products = await searchKeyword(keyword, 10);
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
