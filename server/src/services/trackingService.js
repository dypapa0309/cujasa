import { dbGet, dbInsert, logActivity } from './supabaseService.js';
import { shortCode } from '../utils/slug.js';
import { hashIp } from '../utils/hash.js';

const ALLOWED_REDIRECT_HOSTS = [
  'coupang.com',
  'www.coupang.com',
  'link.coupang.com',
  'coupa.ng',
];

function isSafeUrl(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return ALLOWED_REDIRECT_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export async function createTrackingLink({ project_id, account_id, topic_id, post_id, product_id, destination_url, link_type = 'coupang' }) {
  if (!isSafeUrl(destination_url)) {
    const error = new Error(`허용되지 않은 리다이렉트 URL: ${destination_url}`);
    error.status = 400;
    throw error;
  }
  return dbInsert('tracking_links', {
    code: shortCode(),
    project_id,
    account_id,
    topic_id,
    post_id,
    product_id,
    destination_url,
    link_type
  });
}

export async function recordClick(code, req) {
  const link = await dbGet('tracking_links', { code });
  if (!link) {
    await logInvalidTrackingCode(code, req);
    return null;
  }
  await dbInsert('click_events', {
    tracking_link_id: link.id,
    project_id: link.project_id,
    account_id: link.account_id,
    topic_id: link.topic_id,
    post_id: link.post_id,
    product_id: link.product_id,
    ip_hash: hashIp(req.ip || req.headers['x-forwarded-for'] || ''),
    user_agent: req.headers['user-agent'] || '',
    referrer: req.headers.referer || ''
  });
  return link;
}

export async function logInvalidTrackingCode(code, req) {
  return logActivity({
    action: 'tracking_code_not_found',
    level: 'warn',
    message: `Invalid tracking code: ${code}`,
    payload: {
      code,
      ip_hash: hashIp(req.ip || req.headers['x-forwarded-for'] || ''),
      user_agent: req.headers['user-agent'] || '',
      referrer: req.headers.referer || ''
    }
  });
}
