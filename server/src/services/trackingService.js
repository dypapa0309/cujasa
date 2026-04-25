import { dbGet, dbInsert, logActivity } from './supabaseService.js';
import { shortCode } from '../utils/slug.js';
import { hashIp } from '../utils/hash.js';

export async function createTrackingLink({ project_id, account_id, topic_id, post_id, product_id, destination_url, link_type = 'coupang' }) {
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
