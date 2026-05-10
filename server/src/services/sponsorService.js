import { dbGet, dbList, dbUpdate } from './supabaseService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';

export const SPONSORED_PRODUCT_ID = 'sponsored_monthly_19000';
export const DEFAULT_SPONSOR_COMMENT = '[광고] Threads 자동화 수익 플랫폼 JASAIN · https://jasain.kr';

const SENSITIVE_PATTERN = /(의약품|질병|치료|예방|다이어트|체중|보험|대출|투자|주식|코인|정치|종교|성인|도박|술|담배)/i;

function isActiveMonthlyUser(user = {}) {
  if (!user) return false;
  if (user.plan !== 'monthly') return false;
  if (!['active', 'paid'].includes(user.billing_status || '')) return false;
  if (!user.paid_until) return true;
  return new Date(user.paid_until).getTime() >= Date.now();
}

async function latestPaidCujasaProductId(userId) {
  const payments = (await dbList('billing_payments', { user_id: userId }, { order: 'created_at', ascending: false }))
    .filter((payment) => payment.status === 'paid' && (payment.app_product_id || 'cujasa') === 'cujasa');
  return payments[0]?.product_id || '';
}

async function activeSubscriptionProductId(userId) {
  const subscriptions = (await dbList('billing_subscriptions', { user_id: userId }, { order: 'created_at', ascending: false }))
    .filter((row) => row.status === 'active' && (row.app_product_id || 'cujasa') === 'cujasa');
  return subscriptions[0]?.product_id || '';
}

export async function isSponsoredAccount(accountId) {
  const links = await dbList('user_accounts', { account_id: accountId });
  for (const link of links) {
    const user = await dbGet('users', { id: link.user_id });
    if (!isActiveMonthlyUser(user)) continue;
    const productId = await activeSubscriptionProductId(user.id) || await latestPaidCujasaProductId(user.id);
    if (productId === SPONSORED_PRODUCT_ID) return true;
  }
  return false;
}

function qualityPassed(post = {}) {
  const qualityGate = post.metadata?.qualityGate;
  if (!qualityGate) return true;
  return qualityGate.passed !== false;
}

export async function canUseSponsoredComment({ account, post }) {
  if (!account?.id || !post?.id) return { ok: false, reason: 'missing_account_or_post' };
  if (!(await isSponsoredAccount(account.id))) return { ok: false, reason: 'not_sponsored_plan' };
  if (!qualityPassed(post)) return { ok: false, reason: 'quality_gate_failed' };
  const topic = post.topic_id ? await dbGet('topics', { id: post.topic_id }) : null;
  const text = [post.body, topic?.title, topic?.angle, account.content_scope].filter(Boolean).join(' ');
  if (SENSITIVE_PATTERN.test(text)) return { ok: false, reason: 'sensitive_category' };
  const guardrail = validatePostCandidate(post.body, account, topic);
  if (!guardrail.allowed) return { ok: false, reason: 'guardrail_blocked', guardrail };
  return { ok: true, reason: 'eligible' };
}

export async function sponsoredCommentAlreadyQueuedToday(accountId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const queues = await dbList('post_queue', { account_id: accountId });
  return queues.some((queue) => {
    if ((queue.post_mode || '') !== 'sponsored_comment') return false;
    if (!['scheduled', 'posting', 'posted', 'retry'].includes(queue.status)) return false;
    const when = new Date(queue.posted_at || queue.scheduled_at || queue.created_at || 0).getTime();
    return when >= start.getTime();
  });
}

export async function getSponsorCommentText({ account, post }) {
  const eligible = await canUseSponsoredComment({ account, post });
  if (!eligible.ok) return { ...eligible, commentText: '' };
  const now = Date.now();
  const campaigns = (await dbList('sponsor_campaigns', { active: true }))
    .filter((campaign) => {
      const starts = campaign.starts_at ? new Date(campaign.starts_at).getTime() : 0;
      const ends = campaign.ends_at ? new Date(campaign.ends_at).getTime() : Number.POSITIVE_INFINITY;
      return starts <= now && now <= ends;
    });
  const campaign = campaigns[0] || null;
  return {
    ok: true,
    reason: 'eligible',
    campaign,
    commentText: campaign?.comment_text || DEFAULT_SPONSOR_COMMENT
  };
}

export async function rememberCujasaPlanPayment({ userId, product, payment, paidAt, source }) {
  const grant = await dbGet('user_products', { user_id: userId, product_id: 'cujasa' });
  if (!grant) return null;
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: 'cujasa' }, {
    settings: {
      ...settings,
      lastPlanPayment: {
        productId: product.id,
        paymentId: payment?.id || null,
        paidAt: new Date(paidAt).toISOString(),
        source
      },
      adSupported: product.id === SPONSORED_PRODUCT_ID
    }
  });
  return updated;
}
