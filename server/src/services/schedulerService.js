import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { createDailySchedulePlan } from '../utils/randomSchedule.js';
import { buildReplyText, uploadPost as uploadThreads, uploadReplyOnly } from '../platformAdapters/threadsAdapter.js';
import { createMetricJobs } from './metricsJobService.js';
import { listCtas } from './ctaService.js';
import { createTrackingLink } from './trackingService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { assertPreflightCanPublish, preflightAccount } from './accountPreflightService.js';
import { classifyQueueError, normalizeQueueClassification } from './queueErrorService.js';
import { assertAccountOwnerCanOperate } from './billingEntitlementService.js';
import { assertAccountCanUpload, recordSuccessfulUpload } from './trialEntitlementService.js';
import { assertAutomationRunning, isAutomationRunning } from './accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';
import { createCoupangCooldownError, isCoupangCooldownActive, isCoupangSearchLockAvailable } from './coupangService.js';
import { sendOpsAlert } from './notificationService.js';
import { isReplyLinkModeEnabled } from '../utils/replyLinkMode.js';
import { maybeGenerateBlogPostForQueue } from './blogService.js';
import { canUseSponsoredComment, getSponsorCommentText, sponsoredCommentAlreadyQueuedToday } from './sponsorService.js';
import { evaluateProductTopicMatch } from '../utils/productMatching.js';
import { contentLengthBucket, resolveContentStrategyMetadata } from '../utils/contentFormatStrategy.js';
import { assessContentPatternQuality } from '../utils/contentPatternQuality.js';

const QUEUE_POSTING_STALE_MINUTES = Math.max(1, Number(process.env.QUEUE_POSTING_STALE_MINUTES || 15));
const QUEUE_POSTING_STALE_MS = QUEUE_POSTING_STALE_MINUTES * 60 * 1000;
const QUEUE_POSTING_ABANDONED_MINUTES = Math.max(
  QUEUE_POSTING_STALE_MINUTES,
  Number(process.env.QUEUE_POSTING_ABANDONED_MINUTES || 24 * 60)
);
const QUEUE_POSTING_ABANDONED_MS = QUEUE_POSTING_ABANDONED_MINUTES * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const REPLY_REPAIR_MAX_ATTEMPTS = 3;
const REPLY_LINK_FAILURE_BLOCK_WINDOW_MS = Math.max(60 * 1000, Number(process.env.REPLY_LINK_FAILURE_BLOCK_WINDOW_MS || 6 * 60 * 60 * 1000));
const REPLY_LINK_FAILURE_BLOCK_THRESHOLD = Math.max(0, Number(process.env.REPLY_LINK_FAILURE_BLOCK_THRESHOLD || 3));
const QUEUE_PROCESS_BATCH_LIMIT = Math.max(1, Number(process.env.QUEUE_PROCESS_BATCH_LIMIT || 30));
const QUEUE_PROCESS_MAX_RUN_MS = Math.max(10_000, Number(process.env.QUEUE_PROCESS_MAX_RUN_MS || 60_000));
const REPLY_REPAIR_BATCH_LIMIT = Math.max(1, Number(process.env.REPLY_REPAIR_BATCH_LIMIT || 20));
const REPLY_REPAIR_LOOKUP_LIMIT = Math.max(50, Number(process.env.REPLY_REPAIR_LOOKUP_LIMIT || 300));

function envNumber(key, fallback) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

const DEFAULT_RECENT_QUEUE_HISTORY_DAYS = Math.max(7, envNumber('RECENT_QUEUE_HISTORY_DAYS', 30));
const HISTORICAL_QUEUE_SIMILARITY_THRESHOLD = Math.min(0.95, Math.max(0.5, envNumber('HISTORICAL_QUEUE_SIMILARITY_THRESHOLD', 0.68)));

function kstDayRange(date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const start = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + ONE_DAY_MS);
  return { start, end };
}

function inRange(value, start, end) {
  const time = value ? new Date(value).getTime() : 0;
  return time >= start.getTime() && time < end.getTime();
}

function dailyPostLimit(account = {}) {
  const raw = Number(account.daily_post_max ?? 5);
  const fallback = Number.isFinite(raw) ? raw : 5;
  return Math.min(5, Math.max(0, fallback));
}

function isLinkableCoupangProduct(product = {}) {
  return isRealCoupangProduct(product);
}

function createQueueAlreadyClaimedError(queueId, status) {
  const error = new Error(`Queue item ${queueId} is already claimed or not uploadable: ${status || 'unknown'}`);
  error.status = 409;
  error.code = 'QUEUE_ALREADY_CLAIMED';
  return error;
}

function createNoRealCoupangLinksError(message = '수익화 가능한 실제 쿠팡 상품 링크가 없어 링크 큐를 만들 수 없습니다.') {
  const error = new Error(`NO_REAL_COUPANG_LINKS: ${message}`);
  error.status = 422;
  error.code = 'NO_REAL_COUPANG_LINKS';
  error.permanent = true;
  return error;
}

function createReplyLinkRequiredError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.status = 422;
  error.code = code;
  error.permanent = true;
  return error;
}

function calculateQueueModeCounts(total, account = {}, { allowLink = true } = {}) {
  if (total <= 0) return { linkCount: 0, noLinkCount: 0 };
  const rawLink = Number(account.link_post_ratio ?? 0.9);
  const rawNoLink = Number(account.no_link_post_ratio ?? 0.1);
  const linkRatio = Number.isFinite(rawLink) && rawLink > 0 ? rawLink : 0;
  const noLinkRatio = Number.isFinite(rawNoLink) && rawNoLink > 0 ? rawNoLink : 0;
  if (!allowLink) return { linkCount: 0, noLinkCount: total };
  const ratioTotal = linkRatio + noLinkRatio;
  if (ratioTotal <= 0) return { linkCount: total, noLinkCount: 0 };
  if (linkRatio <= 0) return { linkCount: 0, noLinkCount: total };
  let noLinkCount = noLinkRatio > 0 ? Math.floor((total * noLinkRatio) / ratioTotal) : 0;
  noLinkCount = Math.max(0, Math.min(total, noLinkCount));
  let linkCount = total - noLinkCount;
  if (linkRatio > 0 && linkCount === 0) linkCount = 1;
  linkCount = Math.max(0, Math.min(total, linkCount));
  return { linkCount, noLinkCount: total - linkCount };
}

function normalizeBodyForComparison(body = '') {
  return String(body || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase();
}

function bodySimilarity(a = '', b = '') {
  const left = new Set(normalizeBodyForComparison(a).split(/\s+/).filter(Boolean));
  const right = new Set(normalizeBodyForComparison(b).split(/\s+/).filter(Boolean));
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / Math.max(left.size, right.size);
}

function queueQualityIssue(post = {}) {
  const body = String(post.body || '').trim();
  if (body.length < 20) return '본문이 너무 짧습니다.';
  const blockedPatterns = [
    /먹거리은|먹거리을|먹거리이|먹거리와/i,
    /[가-힣]+ 등 정리 쉽게 하는 법/i,
    /링크|댓글 링크|최저가|특가|구매/i,
    /흐름이에요|흐름이야|도움이 됩니다|중요합니다|고려해야 합니다/i
  ];
  const matched = blockedPatterns.find((pattern) => pattern.test(body));
  if (matched) return '고객 노출 전 다듬어야 하는 표현이 포함되어 있습니다.';
  const patternQuality = assessContentPatternQuality(body);
  if (!patternQuality.allowed) return '반복 템플릿 문장 구조가 포함되어 있습니다.';
  return null;
}

function normalizeContentType(value = '') {
  const text = String(value || '').trim();
  if (/질문|논쟁|debate|question/i.test(text)) return '질문형';
  if (/체크|list|check/i.test(text)) return '체크리스트형';
  if (/문제|해결|solution/i.test(text)) return '문제 해결형';
  if (/일상|daily/i.test(text)) return '일상형';
  if (/공감|empathy/i.test(text)) return '공감형';
  if (/정보|팁|guide|info/i.test(text)) return '정보제공형';
  return text || '기타';
}

function postDiversityProfile(post = {}) {
  const body = String(post.body || '');
  const strategy = resolveContentStrategyMetadata(post.metadata || {}, body, post.content_type || '');
  return {
    contentType: normalizeContentType(post.content_type),
    contentFormat: strategy.contentFormat || 'unknown_format',
    contentGoal: strategy.contentGoal || 'unknown_goal',
    lengthBucket: post.metadata?.lengthBucket || contentLengthBucket(body),
    openingSignature: openingSignature(body)
  };
}

function openingSignature(body = '') {
  const first = String(body || '').split(/\n+/).map((line) => line.trim()).find(Boolean) || '';
  if (!first) return 'empty';
  const normalized = normalizeBodyForComparison(first)
    .replace(/\d+/g, '0')
    .split(/\s+/)
    .slice(0, 8)
    .join(' ');
  if (/[?？]/.test(first)) return `question:${normalized}`;
  if (/^\s*\d+[.)]/.test(first)) return 'numbered_list';
  if (/(솔직히|고백|나만|은근|처음엔|사고 나서|요즘|오늘)/.test(first)) {
    return normalized.split(/\s+/).slice(0, 4).join(' ');
  }
  return normalized;
}

function formatCountsFromHistory(history = []) {
  const counts = new Map();
  for (const item of history) {
    const type = postDiversityProfile(item.post || item.queue || {}).contentType;
    if (!type || type === '기타') continue;
    counts.set(type, (counts.get(type) || 0) + 1);
  }
  return counts;
}

function buildDiversityCounts(history = []) {
  const counts = {
    contentType: new Map(),
    contentFormat: new Map(),
    contentGoal: new Map(),
    lengthBucket: new Map(),
    openingSignature: new Map()
  };
  for (const item of history) {
    const profile = postDiversityProfile(item.post || item.queue || {});
    for (const key of Object.keys(counts)) {
      const value = profile[key];
      if (!value || value === '기타' || value.startsWith?.('unknown_')) continue;
      counts[key].set(value, (counts[key].get(value) || 0) + 1);
    }
  }
  return counts;
}

function incrementCount(map, key) {
  if (!key || key === '기타' || key.startsWith?.('unknown_')) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function mergedDiversityCounts(baseCounts = buildDiversityCounts(), selected = []) {
  const counts = {
    contentType: new Map(baseCounts.contentType || []),
    contentFormat: new Map(baseCounts.contentFormat || []),
    contentGoal: new Map(baseCounts.contentGoal || []),
    lengthBucket: new Map(baseCounts.lengthBucket || []),
    openingSignature: new Map(baseCounts.openingSignature || [])
  };
  for (const item of selected) {
    const profile = postDiversityProfile(item.post);
    for (const key of Object.keys(counts)) incrementCount(counts[key], profile[key]);
  }
  return counts;
}

function diversityIssue(post = {}, baseCounts = buildDiversityCounts(), selected = []) {
  const profile = postDiversityProfile(post);
  const counts = mergedDiversityCounts(baseCounts, selected);
  const selectedCounts = mergedDiversityCounts(buildDiversityCounts(), selected);
  const checks = [
    { key: 'openingSignature', reason: 'opening_pattern_overused', recentLimit: 1, totalLimit: 2 },
    { key: 'contentFormat', reason: 'content_format_overused', recentLimit: 1, totalLimit: 2 },
    { key: 'contentGoal', reason: 'content_goal_overused', recentLimit: profile.contentGoal === 'reply' ? 1 : 2, totalLimit: profile.contentGoal === 'reply' ? 2 : 3 },
    { key: 'lengthBucket', reason: 'length_bucket_overused', recentLimit: 3, totalLimit: 4 },
    { key: 'contentType', reason: 'format_overused', recentLimit: ['질문형', '공감형'].includes(profile.contentType) ? 2 : 3, totalLimit: ['질문형', '공감형'].includes(profile.contentType) ? 2 : 4 }
  ];
  for (const check of checks) {
    const value = profile[check.key];
    if (!value || value === '기타' || value.startsWith?.('unknown_')) continue;
    const recentCount = baseCounts[check.key].get(value) || 0;
    const selectedCount = selectedCounts[check.key].get(value) || 0;
    if (recentCount >= check.recentLimit) {
      return { ...profile, reason: check.reason, dimension: check.key, value, source: 'recent', recentCount, selectedCount };
    }
    if ((counts[check.key].get(value) || 0) >= check.totalLimit) {
      return { ...profile, reason: check.reason, dimension: check.key, value, source: 'selected', recentCount, selectedCount };
    }
  }
  return null;
}

function sortDraftsForFormatBalance(posts = [], counts = new Map(), diversityCounts = buildDiversityCounts()) {
  return [...posts].sort((a, b) => {
    const aCount = counts.get(normalizeContentType(a.content_type)) || 0;
    const bCount = counts.get(normalizeContentType(b.content_type)) || 0;
    if (aCount !== bCount) return aCount - bCount;
    const aProfile = postDiversityProfile(a);
    const bProfile = postDiversityProfile(b);
    const aFormatCount = diversityCounts.contentFormat.get(aProfile.contentFormat) || 0;
    const bFormatCount = diversityCounts.contentFormat.get(bProfile.contentFormat) || 0;
    if (aFormatCount !== bFormatCount) return aFormatCount - bFormatCount;
    const aGoalCount = diversityCounts.contentGoal.get(aProfile.contentGoal) || 0;
    const bGoalCount = diversityCounts.contentGoal.get(bProfile.contentGoal) || 0;
    if (aGoalCount !== bGoalCount) return aGoalCount - bGoalCount;
    const aLengthCount = diversityCounts.lengthBucket.get(aProfile.lengthBucket) || 0;
    const bLengthCount = diversityCounts.lengthBucket.get(bProfile.lengthBucket) || 0;
    if (aLengthCount !== bLengthCount) return aLengthCount - bLengthCount;
    const aQuestion = normalizeContentType(a.content_type) === '질문형' ? 1 : 0;
    const bQuestion = normalizeContentType(b.content_type) === '질문형' ? 1 : 0;
    if (aQuestion !== bQuestion) return aQuestion - bQuestion;
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });
}

function hasUsableDiversityAlternative(candidates = [], currentPost = {}, {
  topicProducts = new Map(),
  requireLink = false,
  diversityCounts = buildDiversityCounts(),
  selected = [],
  usedTopicIds = new Set(),
  usedProductIds = new Set(),
  strictDuplicates = true,
  similarityThreshold = 0.8
} = {}) {
  return candidates.some((candidate) => {
    if (candidate.id === currentPost.id) return false;
    if (requireLink && !topicProducts.has(candidate.topic_id)) return false;
    if (queueQualityIssue(candidate)) return false;
    if (strictDuplicates && usedTopicIds.has(candidate.topic_id)) return false;
    const product = topicProducts.get(candidate.topic_id) || null;
    if (strictDuplicates && product?.id && usedProductIds.has(product.id)) return false;
    if (diversityIssue(candidate, diversityCounts, selected)) return false;
    if (selected.some((item) => bodySimilarity(item.post.body, candidate.body) >= similarityThreshold)) return false;
    return true;
  });
}

function selectQueueDrafts({ posts = [], times = [], topicProducts = new Map(), requireLink = false, recentFormatCounts = new Map(), diversityCounts = buildDiversityCounts() } = {}) {
  const selected = [];
  const usedTopicIds = new Set();
  const usedProductIds = new Set();
  const rejected = [];
  const candidates = sortDraftsForFormatBalance(
    posts.filter((post) => !requireLink || topicProducts.has(post.topic_id)),
    recentFormatCounts,
    diversityCounts
  );

  for (const post of candidates) {
    if (selected.length >= times.length) break;
    const product = topicProducts.get(post.topic_id) || null;
    const issue = queueQualityIssue(post);
    if (issue) {
      rejected.push({ postId: post.id, topicId: post.topic_id, reason: 'quality_issue', message: issue });
      continue;
    }
    if (usedTopicIds.has(post.topic_id)) {
      rejected.push({ postId: post.id, topicId: post.topic_id, reason: 'duplicate_topic' });
      continue;
    }
    if (product?.id && usedProductIds.has(product.id)) {
      rejected.push({ postId: post.id, topicId: post.topic_id, productId: product.id, reason: 'duplicate_product' });
      continue;
    }
    const diversity = diversityIssue(post, diversityCounts, selected);
    if (diversity) {
      const alternativeAvailable = hasUsableDiversityAlternative(candidates, post, {
        topicProducts,
        requireLink,
        diversityCounts,
        selected,
        usedTopicIds,
        usedProductIds
      });
      if (alternativeAvailable) {
        rejected.push({ postId: post.id, topicId: post.topic_id, contentType: post.content_type, ...diversity });
        continue;
      }
    }
    const similar = selected.find((item) => bodySimilarity(item.post.body, post.body) >= 0.8);
    if (similar) {
      rejected.push({ postId: post.id, topicId: post.topic_id, reason: 'similar_body', similarPostId: similar.post.id });
      continue;
    }
    selected.push({ post, postMode: requireLink ? 'link' : 'no_link' });
    usedTopicIds.add(post.topic_id);
    if (product?.id) usedProductIds.add(product.id);
  }

  if (selected.length < times.length) {
    for (const post of candidates) {
      if (selected.length >= times.length) break;
      if (selected.some((item) => item.post.id === post.id)) continue;
      const issue = queueQualityIssue(post);
      if (issue) continue;
      const diversity = diversityIssue(post, diversityCounts, selected);
      if (diversity?.source === 'recent') {
        const alternativeAvailable = hasUsableDiversityAlternative(candidates, post, {
          topicProducts,
          requireLink,
          diversityCounts,
          selected,
          strictDuplicates: false,
          similarityThreshold: 0.95
        });
        if (alternativeAvailable) {
          rejected.push({ postId: post.id, topicId: post.topic_id, contentType: post.content_type, ...diversity });
          continue;
        }
      }
      const similar = selected.find((item) => bodySimilarity(item.post.body, post.body) >= 0.95);
      if (similar) continue;
      selected.push({ post, postMode: requireLink ? 'link' : 'no_link' });
    }
  }

  return { selected, rejected };
}

async function recentAccountQueueHistory(accountId, { days = 7, limit = 300 } = {}) {
  const cutoff = Date.now() - Math.max(1, days) * ONE_DAY_MS;
  const queue = (await dbList('post_queue', { account_id: accountId }, {
    order: 'updated_at',
    ascending: false,
    limit
  })).filter((row) => {
    if (row.customer_hidden_at) return false;
    if (!['scheduled', 'posting', 'posted', 'retry'].includes(row.status)) return false;
    const time = new Date(row.posted_at || row.scheduled_at || row.updated_at || row.created_at || 0).getTime();
    return time && time >= cutoff;
  });
  const postIds = [...new Set(queue.map((row) => row.post_id).filter(Boolean))];
  const posts = new Map();
  for (const postId of postIds) {
    const post = await dbGet('posts', { id: postId }).catch(() => null);
    if (post) posts.set(postId, post);
  }
  return queue.map((row) => ({
    queue: row,
    post: posts.get(row.post_id) || null
  }));
}

function historicalQueueIssue(post = {}, history = []) {
  if (!post?.id) return null;
  const body = String(post.body || '').trim();
  for (const item of history) {
    if (item.queue?.post_id === post.id) {
      return { reason: 'post_already_queued_recently', queueId: item.queue.id };
    }
    if (post.topic_id && item.queue?.topic_id === post.topic_id) {
      return { reason: 'topic_already_queued_recently', queueId: item.queue.id };
    }
    const historicalBody = item.post?.body || '';
    if (body && historicalBody && normalizeBodyForComparison(body) === normalizeBodyForComparison(historicalBody)) {
      return { reason: 'body_already_queued_recently', queueId: item.queue.id };
    }
    if (body && historicalBody && bodySimilarity(body, historicalBody) >= HISTORICAL_QUEUE_SIMILARITY_THRESHOLD) {
      return { reason: 'body_too_similar_to_recent_queue', queueId: item.queue.id };
    }
  }
  return null;
}

function isReplyLinkModeRequiredQueue(row = {}) {
  const value = `${row.error_category || ''} ${row.error_message || ''}`;
  return /REPLY_LINK_MODE_REQUIRED/i.test(value);
}

function isReplyFailureQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  const classified = normalizeQueueClassification(row);
  const replyCategories = new Set([
    'reply_warning',
    'reply_permission_required',
    'threads_reply_target_invalid',
    'reply_repair_blocked'
  ]);
  if (!replyCategories.has(classified.category)) return false;
  if (row.status === 'posted') return Boolean(row.error_message || row.error_category);
  return ['failed', 'retry', 'manual_required'].includes(row.status);
}

function queueFailureTime(row = {}) {
  return new Date(row.updated_at || row.posted_at || row.created_at || 0).getTime() || 0;
}

function accountReconnectTime(account = {}) {
  return new Date(account.threads_connected_at || account.last_threads_refresh_at || 0).getTime() || 0;
}

function isPastReplyIssueSuperseded(row = {}, account = {}) {
  if (row.customer_hidden_at) return true;
  const category = normalizeQueueClassification(row).category;
  if (!['reply_warning', 'reply_permission_required', 'retry_available', 'recheck_required'].includes(category)) return false;
  if (!account?.threads_access_token || account?.threads_token_status === 'refresh_failed') return false;
  const failedAt = queueFailureTime(row);
  if (!failedAt) return false;
  const reconnectAt = accountReconnectTime(account);
  return Boolean(reconnectAt && reconnectAt > failedAt) || Date.now() - failedAt > ONE_DAY_MS;
}

function replyPermissionSupersededByReconnect(row = {}, account = {}) {
  const classified = normalizeQueueClassification(row);
  if (classified.category !== 'reply_permission_required') return false;
  if (!account?.threads_access_token || account?.threads_token_status === 'refresh_failed') return false;
  const reconnectAt = accountReconnectTime(account);
  const failedAt = queueFailureTime(row);
  return Boolean(reconnectAt && failedAt && reconnectAt > failedAt);
}

function isRepairableReplyWarningQueue(row = {}) {
  if (row.customer_hidden_at) return false;
  if (!['failed', 'retry', 'manual_required', 'posted'].includes(row.status)) return false;
  const category = normalizeQueueClassification(row).category;
  if (category === 'retry_available') return Boolean(row.post_url);
  if (row.status === 'posted') {
    return ['reply_warning', 'reply_permission_required'].includes(category);
  }
  return isReplyFailureQueue(row);
}

function canRepairReplyFailureQueue(row = {}, account = null) {
  const classified = normalizeQueueClassification(row);
  const repairableCategory = classified.category === 'reply_warning'
    || classified.category === 'retry_available'
    || (account && replyPermissionSupersededByReconnect(row, account));
  return repairableCategory
    && isRepairableReplyWarningQueue(row)
    && ((row.post_mode || 'auto') === 'link' || Boolean(row.tracking_link_id))
    && Boolean(row.post_url)
    && Number(row.retry_count || 0) < REPLY_REPAIR_MAX_ATTEMPTS;
}

function replyBlockReason(blocked = []) {
  const categories = blocked.map((row) => normalizeQueueClassification(row).category);
  if (categories.includes('reply_permission_required')) {
    return {
      code: 'REPLY_PERMISSION_REQUIRED',
      message: 'Threads 댓글 권한 재연결 필요: 권한 확인 전까지 링크 글 예약을 막습니다.'
    };
  }
  if (categories.includes('threads_reply_target_invalid')) {
    return {
      code: 'THREADS_REPLY_TARGET_INVALID',
      message: '댓글 복구 불가 / 게시글 ID 문제: 기존 실패 큐를 수동 정리해야 링크 글 예약을 재개할 수 있습니다.'
    };
  }
  if (categories.includes('reply_repair_blocked')) {
    return {
      code: 'REPLY_REPAIR_BLOCKED',
      message: '댓글 링크 복구 불가 항목이 있습니다. 수동 확인 후 다시 실행해주세요.'
    };
  }
  return {
    code: 'REPLY_LINK_FAILURE_UNRESOLVED',
    message: '댓글 링크 실패 항목이 복구 불가 상태입니다. 수동 확인 후 다시 실행해주세요.'
  };
}

function isActiveReplyPermissionBlocker(row = {}, account = {}) {
  return normalizeQueueClassification(row).category === 'reply_permission_required'
    && !replyPermissionSupersededByReconnect(row, account);
}

function isRecentReplyFailureSpikeCandidate(row = {}) {
  const category = normalizeQueueClassification(row).category;
  if (!['reply_warning', 'reply_repair_blocked', 'threads_reply_target_invalid'].includes(category)) return false;
  const failedAt = queueFailureTime(row);
  return Boolean(failedAt && Date.now() - failedAt <= REPLY_LINK_FAILURE_BLOCK_WINDOW_MS);
}

async function markReplyRepairBlocked(queue, reason, detail = '') {
  const message = `REPLY_REPAIR_BLOCKED: 댓글 링크 복구 불가 - ${reason}${detail ? ` (${detail})` : ''}`;
  const patch = {
    status: queue.status === 'posted' ? 'posted' : 'manual_required',
    error_message: message,
    error_category: 'reply_repair_blocked',
    retry_count: Math.max(Number(queue.retry_count || 0), REPLY_REPAIR_MAX_ATTEMPTS)
  };
  const [updated] = await dbUpdate('post_queue', { id: queue.id }, patch);
  await logActivity({
    account_id: queue.account_id,
    project_id: queue.project_id,
    topic_id: queue.topic_id,
    post_id: queue.post_id,
    queue_id: queue.id,
    action: 'reply_link_repair_blocked',
    level: 'warn',
    message,
    payload: { reason, detail, previousStatus: queue.status }
  }).catch(() => null);
  return updated || { ...queue, ...patch };
}

async function replyLinkReadiness(account) {
  if (!isReplyLinkModeEnabled() || account?.threads_link_delivery_mode !== 'reply') {
    return {
      ok: false,
      code: 'REPLY_LINK_MODE_REQUIRED',
      message: '링크 글은 댓글 링크 모드에서만 예약/업로드할 수 있습니다.'
    };
  }
  const queues = await dbList('post_queue', { account_id: account.id });
  const failures = queues
    .filter(isReplyFailureQueue)
    .filter((row) => !isPastReplyIssueSuperseded(row, account));
  const permissionBlockers = failures.filter((row) => isActiveReplyPermissionBlocker(row, account));
  if (permissionBlockers.length > 0) {
    const reason = replyBlockReason(permissionBlockers);
    return {
      ok: false,
      code: reason.code,
      message: reason.message,
      unresolvedCount: permissionBlockers.length
    };
  }
  const repairable = failures.filter((row) => canRepairReplyFailureQueue(row, account));
  const recentHardFailures = failures
    .filter((row) => !canRepairReplyFailureQueue(row, account))
    .filter(isRecentReplyFailureSpikeCandidate);
  if (REPLY_LINK_FAILURE_BLOCK_THRESHOLD > 0 && recentHardFailures.length >= REPLY_LINK_FAILURE_BLOCK_THRESHOLD) {
    return {
      ok: false,
      code: 'REPLY_LINK_FAILURE_SPIKE',
      message: '최근 댓글 링크 실패가 반복되어 잠시 링크 글 업로드를 보류합니다. 복구/정리 후 다시 실행해주세요.',
      unresolvedCount: recentHardFailures.length
    };
  }
  if (repairable.length > 0) {
    return {
      ok: true,
      code: 'REPLY_LINK_REPAIR_PENDING',
      message: '이전 댓글 링크 실패 항목은 자동 복구 대상입니다.',
      unresolvedCount: repairable.length
    };
  }
  return { ok: true, code: null, message: null };
}

function canRecoverReplyLinkModeQueue(queue = {}, account = {}) {
  return ['manual_required', 'failed'].includes(queue.status)
    && (queue.post_mode || 'auto') === 'link'
    && account?.threads_link_delivery_mode === 'reply'
    && isReplyLinkModeRequiredQueue(queue);
}

function isAutomationStudioPost(post = {}) {
  return post?.metadata?.source === 'automation_studio'
    || String(post?.content_type || '').startsWith('automation_studio_');
}

async function getAutomationStudioQueueLink(queueId) {
  if (!queueId) return null;
  const [link] = await dbList('automation_studio_queue_links', { queue_id: queueId }).catch(() => []);
  return link || null;
}

async function syncAutomationStudioQueueLink(queueId, status) {
  const link = await getAutomationStudioQueueLink(queueId);
  if (!link) return null;
  const linkStatus = status === 'posted'
    ? 'posted'
    : status === 'skipped'
      ? 'stopped'
      : status;
  return dbUpdate('automation_studio_queue_links', { id: link.id }, { status: linkStatus }).catch(() => null);
}

function canSkipMonetizationPreflight({ queue = {}, post = {}, automationLink = null } = {}) {
  return Boolean(automationLink || isAutomationStudioPost(post))
    && (queue.post_mode || 'auto') === 'no_link';
}

function shouldUpgradeNoLinkQueueToLink({ queue = {}, post = {}, product = null, automationLink = null } = {}) {
  if ((queue.post_mode || 'auto') !== 'no_link') return false;
  if (canSkipMonetizationPreflight({ queue, post, automationLink })) return false;
  return isLinkableCoupangProduct(product);
}

function fallbackThreadsPostUrl(account = {}, postId = '') {
  const id = String(postId || '').trim();
  if (!id) return '';
  const handle = String(account.account_handle || account.name || 'unknown').replace(/^@/, '').trim() || 'unknown';
  return `https://www.threads.net/@${handle}/post/${id}`;
}

async function getFirstLinkableProductForTopic(topicId) {
  if (!topicId) return { postProduct: null, product: null };
  const topic = await dbGet('topics', { id: topicId });
  const account = topic?.account_id ? await dbGet('accounts', { id: topic.account_id }) : null;
  const rows = await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true });
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    const match = product && topic && account ? evaluateProductTopicMatch(product, topic, account) : { linkable: isLinkableCoupangProduct(product) };
    if (isLinkableCoupangProduct(product) && match.linkable) return { postProduct: row, product, match };
  }
  return { postProduct: null, product: null };
}

function extractThreadsPostId(postUrl = '') {
  const value = String(postUrl || '');
  const match = value.match(/\/post\/([^/?#]+)/i) || value.match(/threads\/([^/?#]+)/i);
  return match?.[1] || '';
}

async function resolveTrackingLinkForQueue(queue, post, product) {
  if (queue.tracking_link_id) {
    const existing = await dbGet('tracking_links', { id: queue.tracking_link_id }).catch(() => null);
    if (existing) return existing;
  }
  if (post?.id) {
    const existingRows = await dbList('tracking_links', { post_id: post.id }, { order: 'created_at', ascending: false, limit: 1 }).catch(() => []);
    if (existingRows[0]) return existingRows[0];
  }
  if (!product || !post) return null;
  return createTrackingLink({
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    product_id: product.id,
    destination_url: product.partner_url || product.product_url,
    link_type: 'coupang'
  });
}

async function assertRealLinkCandidateForPost(post, account, action = 'queue link post') {
  const { postProduct, product } = await getFirstLinkableProductForTopic(post.topic_id);
  if (postProduct && product) return { postProduct, product };
  await logActivity({
    account_id: post.account_id,
    project_id: post.project_id,
    topic_id: post.topic_id,
    post_id: post.id,
    action: 'link_queue_blocked_no_real_product',
    level: 'warn',
    message: '실제 쿠팡 상품 링크가 없어 링크 큐 생성을 차단했습니다.',
    payload: { code: 'NO_REAL_COUPANG_LINKS', action }
  }).catch(() => null);
  throw createNoRealCoupangLinksError('실상품 선택 후 다시 큐에 추가해주세요.');
}

async function isPostAllowedForQueue(post, account) {
  if (post.metadata?.qualityGate?.passed === false) {
    await logActivity({
      account_id: post.account_id,
      project_id: post.project_id,
      topic_id: post.topic_id,
      post_id: post.id,
      action: 'queue_quality_gate_skipped',
      level: 'warn',
      message: (post.metadata.qualityGate.reasons || ['품질 기준 미달']).join('; '),
      payload: { qualityGate: post.metadata.qualityGate }
    });
    await dbUpdate('posts', { id: post.id }, { status: 'manual_required' });
    return false;
  }
  const topic = post.topic_id ? await dbGet('topics', { id: post.topic_id }) : null;
  const guardrail = validatePostCandidate(post.body, account, topic);
  if (guardrail.allowed) return true;
  await logActivity({
    account_id: post.account_id,
    project_id: post.project_id,
    topic_id: post.topic_id,
    post_id: post.id,
    action: 'queue_guardrail_skipped',
    level: 'warn',
    message: guardrail.reasons.join('; '),
    payload: { context: guardrail.context }
  });
  await dbUpdate('posts', { id: post.id }, { status: 'manual_required' });
  return false;
}

function attachQueueDiagnostics(queued, diagnostics) {
  Object.defineProperty(queued, 'diagnostics', {
    value: diagnostics,
    enumerable: false
  });
  return queued;
}

export async function addPostToQueue(postId, scheduledAt = null, options = {}) {
  const post = await dbGet('posts', { id: postId });
  if (!post) throw new Error('Post not found');
  await assertAccountOwnerCanOperate(post.account_id);
  await assertAccountCanUpload(post.account_id);
  const account = await dbGet('accounts', { id: post.account_id });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot add post to queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'add post to queue');
  if (!(await isPostAllowedForQueue(post, account))) {
    const error = new Error('Post blocked by content guardrails');
    error.status = 422;
    throw error;
  }
  const existingQueue = (await dbList('post_queue', { post_id: post.id }, {
    order: 'updated_at',
    ascending: false,
    limit: 20
  })).find((row) => ['scheduled', 'posting', 'posted', 'retry', 'manual_required'].includes(row.status));
  if (existingQueue) {
    const error = new Error('Post already exists in the upload queue.');
    error.status = 409;
    error.code = 'POST_ALREADY_QUEUED';
    throw error;
  }
  const status = post.status === 'manual_required' || post.risk_level === 'high' ? 'manual_required' : 'scheduled';
  const requestedPostMode = ['link', 'no_link', 'sponsored_comment'].includes(options.postMode)
    ? options.postMode
    : null;
  const linkCandidate = ['no_link', 'sponsored_comment'].includes(requestedPostMode)
    ? { postProduct: null, product: null }
    : await assertRealLinkCandidateForPost(post, account, 'add post to queue');
  const postMode = requestedPostMode || (linkCandidate.product ? 'link' : 'no_link');
  if (postMode === 'link' && !linkCandidate.product) {
    throw createNoRealCoupangLinksError('링크 글로 큐에 추가하려면 실제 쿠팡 상품 선택이 필요합니다.');
  }
  if (postMode === 'link' && !options.skipReplyReadiness) {
    const reply = await replyLinkReadiness(account);
    if (!reply.ok) throw createReplyLinkRequiredError(reply.code, reply.message);
  }
  const payload = {
    project_id: post.project_id,
    account_id: post.account_id,
    topic_id: post.topic_id,
    post_id: post.id,
    platform: 'threads',
    scheduled_at: scheduledAt || new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    status,
    post_mode: postMode,
    retry_count: 0
  };
  try {
    return await dbInsert('post_queue', payload);
  } catch (error) {
    if (!/post_mode|schema cache|column/i.test(error.message || '')) throw error;
    const { post_mode, ...fallbackPayload } = payload;
    return dbInsert('post_queue', fallbackPayload);
  }
}

export async function createDailyQueue(accountId, options = {}) {
  await assertAccountOwnerCanOperate(accountId);
  const trialStatus = await assertAccountCanUpload(accountId);
  const account = await dbGet('accounts', { id: accountId });
  if (account?.status !== 'active') {
    const error = new Error(`Account is ${account?.status || 'missing'}; cannot create daily queue`);
    error.status = 409;
    throw error;
  }
  assertAutomationRunning(account, 'create daily queue');
  const lockHealth = await isCoupangSearchLockAvailable();
  if (!lockHealth.available) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_blocked_coupang_lock_unavailable',
      level: 'error',
      message: '쿠팡 검색 DB 락 테이블이 없어 일일 큐 생성을 차단했습니다.',
      payload: {
        reasonCode: 'COUPANG_LOCK_UNAVAILABLE',
        error: lockHealth.message
      }
    }).catch(() => null);
    await sendOpsAlert('daily_queue_blocked_coupang_lock_unavailable', {
      title: '일일 큐 생성 차단',
      account,
      code: 'COUPANG_LOCK_UNAVAILABLE',
      message: '쿠팡 검색 보호 락이 없어 링크 큐 생성을 차단했습니다.',
      hint: 'coupang_search_locks 마이그레이션과 DB 연결 상태를 확인하세요.'
    });
    const error = new Error('COUPANG_LOCK_UNAVAILABLE: 쿠팡 검색 보호 락이 준비되지 않아 링크 큐를 만들 수 없습니다.');
    error.status = 503;
    error.code = 'COUPANG_LOCK_UNAVAILABLE';
    throw error;
  }
  if (isCoupangCooldownActive(account)) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_blocked_coupang_cooldown',
      level: 'warn',
      message: '쿠팡 요청 제한 보호 중이라 일일 큐 생성을 차단했습니다.',
      payload: {
        reasonCode: 'COUPANG_RATE_LIMIT',
        cooldownUntil: account.coupang_search_cooldown_until
      }
    }).catch(() => null);
    await sendOpsAlert('daily_queue_blocked_coupang_cooldown', {
      title: '쿠팡 쿨다운으로 큐 생성 차단',
      account,
      code: 'COUPANG_RATE_LIMIT',
      message: '쿠팡 요청 제한 보호 중이라 일일 큐 생성을 차단했습니다.',
      hint: '쿨다운 해제 전까지 검색/자동화 재개를 피하세요.',
      payload: { cooldownUntil: account.coupang_search_cooldown_until }
    });
    throw createCoupangCooldownError(account);
  }
  if (!options.skipPreflight) {
    assertPreflightCanPublish(await preflightAccount(accountId, { includeQueue: false }));
  }
  const reply = await replyLinkReadiness(account);
  if (!reply.ok) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'daily_queue_link_posts_blocked_reply_link_mode',
      level: 'warn',
      message: reply.message,
      payload: {
        reasonCode: reply.code,
        message: reply.message,
        unresolvedReplyFailures: reply.unresolvedCount || 0
      }
    }).catch(() => null);
  }
  const allDrafts = [];
  for (const post of (await dbList('posts', { account_id: accountId })).filter((p) => ['draft', 'ready'].includes(p.status))) {
    if (await isPostAllowedForQueue(post, account)) allDrafts.push(post);
  }
  const topicIds = [...new Set(allDrafts.map((p) => p.topic_id))];
  const productsPerTopic = new Set();
  const primaryProductByTopic = new Map();
  for (const tid of topicIds) {
    const topic = await dbGet('topics', { id: tid });
    const pp = await dbList('post_products', { topic_id: tid });
    for (const row of pp) {
      const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
      const match = product && topic ? evaluateProductTopicMatch(product, topic, account) : { linkable: false };
      if (isRealCoupangProduct(product) && match.linkable) {
        productsPerTopic.add(tid);
        if (!primaryProductByTopic.has(tid)) primaryProductByTopic.set(tid, product);
        break;
      }
    }
  }

  const { start, end } = kstDayRange();
  const activeTodayQueues = (await dbList('post_queue', { account_id: accountId }))
    .filter((row) => ['scheduled', 'retry', 'posting', 'posted'].includes(row.status))
    .filter((row) => inRange(row.posted_at || row.scheduled_at, start, end));
  const spacingQueues = activeTodayQueues
    .map((row) => row.posted_at || row.scheduled_at)
    .filter(Boolean);
  const dailyLimit = dailyPostLimit(account);
  const remainingDailySlots = Math.max(0, dailyLimit - activeTodayQueues.length);
  const schedulePlan = createDailySchedulePlan(
    { ...account, daily_post_max: remainingDailySlots },
    new Date(),
    { blockedTimes: spacingQueues }
  );
  const scheduleTimes = schedulePlan.times;
  const times = trialStatus?.plan === 'free'
    ? scheduleTimes.slice(0, Math.max(0, Number(trialStatus.remaining ?? scheduleTimes.length)))
    : scheduleTimes;
  const visibleSchedulePlan = {
    ...schedulePlan.diagnostics,
    actualTimes: times,
    generatedCount: times.length,
    trialCapped: times.length < scheduleTimes.length
  };
  const total = times.length;
  const repairOutcomes = [];
  const recentHistory = await recentAccountQueueHistory(accountId, {
    days: Number(options.historyDays ?? DEFAULT_RECENT_QUEUE_HISTORY_DAYS)
  });
  const recentFormatCounts = formatCountsFromHistory(recentHistory);
  const recentDiversityCounts = buildDiversityCounts(recentHistory);
  const historyRejected = [];
  const queueableDrafts = [];
  for (const post of allDrafts) {
    const issue = historicalQueueIssue(post, recentHistory);
    if (issue) {
      historyRejected.push({ postId: post.id, topicId: post.topic_id, ...issue });
      continue;
    }
    queueableDrafts.push(post);
  }
  const withLink = queueableDrafts.filter((p) => productsPerTopic.has(p.topic_id));
  const withoutLink = queueableDrafts.filter((p) => !productsPerTopic.has(p.topic_id));

  const modeCounts = calculateQueueModeCounts(total, account, { allowLink: reply.ok });
  const linkSelection = reply.ok
    ? selectQueueDrafts({
      posts: withLink,
      times: times.slice(0, modeCounts.linkCount),
      topicProducts: primaryProductByTopic,
      requireLink: true,
      recentFormatCounts,
      diversityCounts: recentDiversityCounts
    })
    : { selected: [], rejected: [] };
  const candidateWithLink = withLink.slice(0, reply.ok ? modeCounts.linkCount : total);
  const primaryWithLink = linkSelection.selected.map((item) => item.post);
  const selectedIds = new Set(primaryWithLink.map((post) => post.id));
  const linkBlockedByReplyReadiness = !reply.ok && candidateWithLink.length > 0;
  const remainingSlots = linkBlockedByReplyReadiness ? 0 : Math.max(0, Math.min(modeCounts.noLinkCount, total - primaryWithLink.length));
  const noLinkSelection = selectQueueDrafts({
    posts: withoutLink
    .filter((post, index, list) => list.findIndex((row) => row.id === post.id) === index)
      .filter((post) => !selectedIds.has(post.id)),
    times: times.slice(0, remainingSlots),
    topicProducts: primaryProductByTopic,
    requireLink: false,
    recentFormatCounts,
    diversityCounts: recentDiversityCounts
  });
  const primaryNoLink = noLinkSelection.selected.map((item) => item.post);
  const linkCount = modeCounts.linkCount;
  const noLinkCount = modeCounts.noLinkCount;
  const linkShortage = Math.max(0, modeCounts.linkCount - primaryWithLink.length);
  const noLinkShortage = Math.max(0, remainingSlots - primaryNoLink.length);
  const linkOverflow = Math.max(0, withLink.length - primaryWithLink.length);
  let sponsoredSlotAvailable = !(await sponsoredCommentAlreadyQueuedToday(account.id));
  const noLinkDrafts = [];
  for (const post of primaryNoLink) {
    let postMode = 'no_link';
    if (sponsoredSlotAvailable) {
      const sponsor = await canUseSponsoredComment({ account, post });
      if (sponsor.ok) {
        postMode = 'sponsored_comment';
        sponsoredSlotAvailable = false;
      }
    }
    noLinkDrafts.push({ post, postMode });
  }
  const drafts = primaryWithLink.map((post) => ({ post, postMode: 'link' }))
    .concat(noLinkDrafts);
  const diagnostics = {
    scheduleCount: total,
    requiredLinkCount: linkCount,
    requiredNoLinkCount: noLinkCount,
    availableDraftPosts: allDrafts.length,
    queueableDraftPosts: queueableDrafts.length,
    availableLinkPosts: withLink.length,
    availableNoLinkPosts: queueableDrafts.length - withLink.length,
    selectedLinkPosts: primaryWithLink.length,
    selectedNoLinkPosts: primaryNoLink.length,
    linkShortage,
    linkOverflow,
    noLinkShortage,
    linkPostsBlocked: !reply.ok,
    replyLinkReadinessCode: reply.code,
    replyLinkReadinessMessage: reply.message,
    unresolvedReplyFailures: reply.unresolvedCount || 0,
    trialPlan: trialStatus?.plan || null,
    trialRemaining: trialStatus?.remaining ?? null,
    uncappedScheduleCount: scheduleTimes.length,
    dailyLimit,
    existingTodayQueueCount: activeTodayQueues.length,
    remainingDailySlots,
    blockedScheduleCount: spacingQueues.length,
    schedulePlan: visibleSchedulePlan,
    productRepairAttempts: repairOutcomes.length,
    productRepairFallbacks: repairOutcomes.filter((row) => row.finalMode === 'no_link').length,
    sponsoredCommentCount: drafts.filter((row) => row.postMode === 'sponsored_comment').length,
    qualityRejectedCount: linkSelection.rejected.length + noLinkSelection.rejected.length,
    qualityRejected: linkSelection.rejected.concat(noLinkSelection.rejected).slice(0, 10),
    formatRejectedCount: linkSelection.rejected.concat(noLinkSelection.rejected).filter((row) => row.reason === 'format_overused').length,
    diversityRejectedCount: linkSelection.rejected.concat(noLinkSelection.rejected)
      .filter((row) => ['format_overused', 'content_format_overused', 'content_goal_overused', 'length_bucket_overused', 'opening_pattern_overused'].includes(row.reason)).length,
    recentFormatCounts: Object.fromEntries(recentFormatCounts),
    recentContentFormatCounts: Object.fromEntries(recentDiversityCounts.contentFormat),
    recentContentGoalCounts: Object.fromEntries(recentDiversityCounts.contentGoal),
    recentLengthBucketCounts: Object.fromEntries(recentDiversityCounts.lengthBucket),
    selectedContentTypes: drafts.map((row) => row.post.content_type || ''),
    selectedContentFormats: drafts.map((row) => postDiversityProfile(row.post).contentFormat),
    selectedContentGoals: drafts.map((row) => postDiversityProfile(row.post).contentGoal),
    selectedLengthBuckets: drafts.map((row) => postDiversityProfile(row.post).lengthBucket),
    historyRejectedCount: historyRejected.length,
    historyRejected: historyRejected.slice(0, 10),
    repairOutcomes: repairOutcomes.map((row) => ({
      postId: row.postId,
      topicId: row.topicId,
      status: row.status,
      finalMode: row.finalMode,
      reasonCode: row.reasonCode,
      attempts: row.attempts?.length || 0
    })),
    reasonCode: null
  };
  const blockedLinkPosts = reply.ok ? 0 : candidateWithLink.length;

  diagnostics.blockedLinkPosts = blockedLinkPosts;

  if (total === 0) diagnostics.reasonCode = remainingDailySlots <= 0 ? 'DAILY_LIMIT_REACHED' : 'NO_SCHEDULE_TIMES';
  else if (allDrafts.length === 0) diagnostics.reasonCode = 'NO_DRAFT_POSTS';
  else if (queueableDrafts.length === 0 && historyRejected.length > 0) diagnostics.reasonCode = 'RECENT_DUPLICATE_DRAFTS_REJECTED';
  else if (repairOutcomes.some((row) => row.reasonCode === 'COUPANG_RATE_LIMIT')) diagnostics.reasonCode = 'COUPANG_RATE_LIMIT';
  else if (diagnostics.productRepairFallbacks > 0) diagnostics.reasonCode = 'PRODUCT_REPAIR_FALLBACK_TO_NO_LINK';
  else if (!reply.ok && candidateWithLink.length > 0 && drafts.length === 0) diagnostics.reasonCode = reply.code || 'REPLY_LINK_BLOCKED';
  else if (!reply.ok && candidateWithLink.length > 0) diagnostics.reasonCode = 'LINK_POSTS_BLOCKED_REPLY_REVIEW_NEEDED';
  else if (drafts.length === 0 && diagnostics.qualityRejectedCount > 0) diagnostics.reasonCode = 'QUALITY_FILTER_REJECTED_DRAFTS';
  else if (drafts.length === 0 && linkCount > 0) diagnostics.reasonCode = 'NO_REAL_COUPANG_LINKS';
  else if (drafts.length === 0) diagnostics.reasonCode = 'NO_QUEUEABLE_DRAFTS';
  else if (linkShortage > 0) diagnostics.reasonCode = 'PARTIAL_LINK_CANDIDATES';
  else if (noLinkShortage > 0) diagnostics.reasonCode = 'PARTIAL_NO_LINK_CANDIDATES';

  if (total === 0 || allDrafts.length === 0 || drafts.length === 0) {
    diagnostics.queuedCount = 0;
    return attachQueueDiagnostics([], diagnostics);
  }

  if (linkShortage > 0) {
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      action: 'queue_link_slots_shortage_partial',
      level: 'info',
      message: `수익화 가능한 링크 후보 ${primaryWithLink.length}개만 예약합니다.`,
      payload: diagnostics
    });
  }
  const queued = [];
  for (const [index, item] of drafts.slice(0, times.length).entries()) {
    queued.push(await addPostToQueue(item.post.id, times[index], {
      postMode: item.postMode,
      skipReplyReadiness: true
    }));
    await dbUpdate('posts', { id: item.post.id }, { status: 'queued' });
  }
  diagnostics.queuedCount = queued.length;
  return attachQueueDiagnostics(queued, diagnostics);
}

export async function recoverStalePostingQueue({ accountId = null, limit = 100 } = {}) {
  const filters = accountId ? { status: 'posting', account_id: accountId } : { status: 'posting' };
  const posting = await dbList('post_queue', filters, {
    order: 'updated_at',
    ascending: true,
    limit: Math.max(1, Math.min(Number(limit) || 100, 500))
  });
  const cutoff = Date.now() - QUEUE_POSTING_STALE_MS;
  let recovered = 0;
  for (const row of posting) {
    const updatedAt = new Date(row.updated_at || row.created_at || 0).getTime();
    if (!updatedAt || updatedAt > cutoff) continue;

    const ageMs = Date.now() - updatedAt;
    const abandoned = ageMs >= QUEUE_POSTING_ABANDONED_MS;
    const retry = (row.retry_count || 0) + 1;
    const status = abandoned || retry >= 3 ? 'manual_required' : 'retry';
    const message = abandoned
      ? `posting 상태가 ${QUEUE_POSTING_ABANDONED_MINUTES}분 이상 방치되어 수동 확인으로 전환했습니다.`
      : `posting 상태가 ${QUEUE_POSTING_STALE_MINUTES}분 이상 지속되어 ${status}로 복구했습니다.`;
    const classified = classifyQueueError(message);
    const [updated] = await dbUpdate('post_queue', { id: row.id, status: 'posting' }, {
      status,
      retry_count: retry,
      error_message: message,
      error_category: classified.category
    });
    if (!updated) continue;
    await syncAutomationStudioQueueLink(row.id, updated.status);
    recovered += 1;
    await logActivity({
      account_id: row.account_id,
      project_id: row.project_id,
      topic_id: row.topic_id,
      post_id: row.post_id,
      queue_id: row.id,
      action: 'queue_posting_stale_recovered',
      level: 'warn',
      message,
      payload: {
        retryCount: retry,
        nextStatus: status,
        staleMinutes: QUEUE_POSTING_STALE_MINUTES,
        abandoned,
        abandonedMinutes: QUEUE_POSTING_ABANDONED_MINUTES
      }
    });
  }
  return recovered;
}

export async function repairReplyLinkFailures({
  accountId = null,
  dryRun = false,
  limit = REPLY_REPAIR_BATCH_LIMIT
} = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || REPLY_REPAIR_BATCH_LIMIT, 100));
  const queueLookupLimit = Math.max(cappedLimit * 5, REPLY_REPAIR_LOOKUP_LIMIT);
  const [queues, accounts] = await Promise.all([
    accountId
      ? dbList('post_queue', { account_id: accountId }, { order: 'updated_at', ascending: false, limit: queueLookupLimit })
      : dbList('post_queue', {}, {
        order: 'updated_at',
        ascending: false,
        limit: queueLookupLimit,
        in: { status: ['posted', 'failed', 'retry', 'manual_required'] }
      }),
    accountId
      ? dbList('accounts', { id: accountId }, { limit: 1 })
      : dbList('accounts', { status: 'active' }, { limit: 500 })
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const targets = queues.filter((queue) => {
    if (accountId && queue.account_id !== accountId) return false;
    return canRepairReplyFailureQueue(queue, accountsById.get(queue.account_id));
  }).slice(0, cappedLimit);
  const repaired = [];
  const failed = [];
  const skipped = [];
  const wouldRepair = [];

  for (const queue of targets) {
    const account = accountsById.get(queue.account_id);
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    const automationLink = await getAutomationStudioQueueLink(queue.id);
    const threadsPostId = extractThreadsPostId(queue.post_url);
    let repairStage = 'preflight';

    if (!account || account.status !== 'active' || !isAutomationRunning(account)) {
      skipped.push({ queueId: queue.id, reason: 'account_not_active_or_automation_paused' });
      continue;
    }
    if (!post || !threadsPostId) {
      const reason = !post ? 'post_missing' : 'threads_post_id_missing';
      skipped.push({ queueId: queue.id, reason });
      if (!dryRun) await markReplyRepairBlocked(queue, reason);
      continue;
    }
    if (post.account_id && post.account_id !== queue.account_id) {
      skipped.push({ queueId: queue.id, reason: 'cross_account_reply_not_allowed' });
      continue;
    }

    try {
      const skipMonetizationChecks = canSkipMonetizationPreflight({ queue, post, automationLink });
      assertPreflightCanPublish(await preflightAccount(account.id, {
        includeQueue: false,
        allowInitialLinkDiscovery: true,
        skipMonetizationChecks
      }));
      repairStage = 'tracking_link';
      let trackingLink = queue.tracking_link_id
        ? await dbGet('tracking_links', { id: queue.tracking_link_id }).catch(() => null)
        : null;
      if (!trackingLink) {
        repairStage = 'product_lookup';
        const { product } = await getFirstLinkableProductForTopic(post.topic_id);
        if (!product || !isLinkableCoupangProduct(product)) {
          skipped.push({ queueId: queue.id, reason: 'linkable_product_missing' });
          if (!dryRun) await markReplyRepairBlocked(queue, 'linkable_product_missing');
          continue;
        }
        repairStage = 'tracking_link';
        trackingLink = await resolveTrackingLinkForQueue(queue, post, product);
      }
      if (!trackingLink) {
        skipped.push({ queueId: queue.id, reason: 'tracking_link_missing' });
        if (!dryRun) await markReplyRepairBlocked(queue, 'tracking_link_missing');
        continue;
      }
      const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
      const linkMode = String(process.env.THREADS_COUPANG_LINK_MODE || 'direct').toLowerCase();
      const linkUrl = linkMode === 'tracking' ? `${baseUrl}/r/${trackingLink.code}` : trackingLink.destination_url;
      if (dryRun) {
        wouldRepair.push({
          queueId: queue.id,
          accountId: queue.account_id,
          postId: queue.post_id,
          postUrl: queue.post_url,
          threadsPostId,
          trackingLinkId: trackingLink.id,
          linkMode,
          linkUrl
        });
        continue;
      }
      repairStage = 'reply_upload';
      await uploadReplyOnly({ account, postId: threadsPostId, text: buildReplyText(linkUrl) });
      let updatedRows;
      try {
        updatedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status: 'posted',
          tracking_link_id: trackingLink.id,
          error_message: null,
          error_category: null
        });
      } catch (updateError) {
        if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
        updatedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status: 'posted',
          tracking_link_id: trackingLink.id,
          error_message: null
        });
      }
      const [updated] = updatedRows;
      await syncAutomationStudioQueueLink(queue.id, updated.status);
      repaired.push(updated);
      await logActivity({
        account_id: queue.account_id,
        project_id: queue.project_id,
        topic_id: queue.topic_id,
        post_id: queue.post_id,
        queue_id: queue.id,
        action: 'reply_link_failure_repaired',
        level: 'info',
        message: '기존 Threads 게시글에 쿠팡 링크 댓글을 다시 등록했습니다.',
        payload: { postUrl: queue.post_url, threadsPostId, trackingLinkId: trackingLink.id, linkMode }
      }).catch(() => null);
    } catch (error) {
      if (repairStage !== 'reply_upload') {
        skipped.push({ queueId: queue.id, reason: `${repairStage}_failed`, message: error.message });
        if (!dryRun) await markReplyRepairBlocked(queue, `${repairStage}_failed`, error.message);
        continue;
      }
      if (dryRun) {
        failed.push({ queueId: queue.id, status: queue.status, retryCount: Number(queue.retry_count || 0), error: error.message });
        continue;
      }
      const retry = Number(queue.retry_count || 0) + 1;
      const status = retry >= REPLY_REPAIR_MAX_ATTEMPTS ? 'manual_required' : 'retry';
      const classified = classifyQueueError(error.message || 'THREADS_REPLY_FAILED');
      let failedRows;
      try {
        failedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          error_category: classified.category,
          post_url: queue.post_url || error.postUrl || null
        });
      } catch (updateError) {
        if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
        failedRows = await dbUpdate('post_queue', { id: queue.id }, {
          status,
          retry_count: retry,
          error_message: error.message,
          post_url: queue.post_url || error.postUrl || null
        });
      }
      const [updated] = failedRows || [];
      await syncAutomationStudioQueueLink(queue.id, updated?.status || status);
      failed.push({ queueId: queue.id, status, retryCount: retry, error: error.message });
      await logActivity({
        account_id: queue.account_id,
        project_id: queue.project_id,
        topic_id: queue.topic_id,
        post_id: queue.post_id,
        queue_id: queue.id,
        action: 'reply_link_failure_repair_failed',
        level: retry >= REPLY_REPAIR_MAX_ATTEMPTS ? 'error' : 'warn',
        message: error.message,
        payload: { retryCount: retry, nextStatus: status, maxAttempts: REPLY_REPAIR_MAX_ATTEMPTS }
      }).catch(() => null);
    }
  }

  return {
    ok: failed.length === 0,
    dryRun,
    targetCount: targets.length,
    wouldRepairCount: wouldRepair.length,
    repairedCount: repaired.length,
    failedCount: failed.length,
    skippedCount: skipped.length,
    wouldRepair,
    repaired,
    failed,
    skipped
  };
}

export async function processDueQueue({
  limit = QUEUE_PROCESS_BATCH_LIMIT,
  maxRunMs = QUEUE_PROCESS_MAX_RUN_MS,
  recoverMaintenance = true,
  repairReplies = false
} = {}) {
  const startedAt = Date.now();
  const cappedLimit = Math.max(1, Math.min(Number(limit) || QUEUE_PROCESS_BATCH_LIMIT, 100));
  if (recoverMaintenance) {
    await recoverStalePostingQueue();
    await recoverReplyLinkModeRequiredQueues();
    await enforceDailyQueueLimits();
  }
  if (repairReplies) {
    await repairReplyLinkFailures({ dryRun: false, limit: Math.min(10, cappedLimit) });
  }
  const nowIso = new Date().toISOString();
  const [scheduled, retrying] = await Promise.all([
    dbList('post_queue', { status: 'scheduled' }, {
      lte: { scheduled_at: nowIso },
      order: 'scheduled_at',
      ascending: true,
      limit: cappedLimit
    }),
    dbList('post_queue', { status: 'retry' }, {
      lte: { scheduled_at: nowIso },
      order: 'scheduled_at',
      ascending: true,
      limit: cappedLimit
    })
  ]);
  const rows = [...scheduled, ...retrying].filter((row) => (row.platform || 'threads') === 'threads');
  const activeAccounts = await dbList('accounts', { status: 'active' }, {
    select: 'id,status,automation_status',
    limit: 1000
  });
  const activeAccountIds = new Set(activeAccounts.filter(isAutomationRunning).map((account) => account.id));
  const due = rows
    .filter((row) => activeAccountIds.has(row.account_id) && new Date(row.scheduled_at) <= new Date())
    .slice(0, cappedLimit);
  let processed = 0;
  for (const row of due) {
    if (Date.now() - startedAt > maxRunMs) break;
    try {
      await uploadQueueItem(row.id);
      processed += 1;
    } catch (error) {
      if (error.code !== 'QUEUE_ALREADY_CLAIMED') {
        console.error('[processDueQueue] queue item failed', { queueId: row.id, error: error.message });
      }
    }
  }
  return processed;
}

export async function enforceDailyQueueLimits({ accountId = null, dryRun = false } = {}) {
  const { start, end } = kstDayRange();
  const [accounts, queue] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue')
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const queueByAccount = new Map();
  for (const row of queue) {
    if (accountId && row.account_id !== accountId) continue;
    if (row.customer_hidden_at) continue;
    if (!['scheduled', 'retry', 'posting', 'posted'].includes(row.status)) continue;
    if (!inRange(row.posted_at || row.scheduled_at, start, end)) continue;
    queueByAccount.set(row.account_id, [...(queueByAccount.get(row.account_id) || []), row]);
  }

  const results = [];
  for (const [targetAccountId, rows] of queueByAccount.entries()) {
    const account = accountsById.get(targetAccountId);
    if (!account) continue;
    const limit = dailyPostLimit(account);
    const fixedRows = rows.filter((row) => ['posted', 'posting'].includes(row.status));
    const pendingRows = rows
      .filter((row) => ['scheduled', 'retry'].includes(row.status))
      .sort((a, b) => new Date(a.scheduled_at || a.created_at || 0) - new Date(b.scheduled_at || b.created_at || 0));
    const keepPendingCount = Math.max(0, limit - fixedRows.length);
    const excessRows = pendingRows.slice(keepPendingCount);
    if (!excessRows.length) continue;

    const skipped = [];
    if (!dryRun) {
      for (const row of excessRows) {
        const [updated] = await dbUpdate('post_queue', { id: row.id, status: row.status }, {
          status: 'skipped',
          error_category: 'daily_limit_exceeded',
          error_message: 'DAILY_LIMIT_EXCEEDED: 오늘 예약 상한 초과로 자동 중지했습니다.'
        });
        if (!updated) continue;
        if (row.post_id) await dbUpdate('posts', { id: row.post_id }, { status: 'draft' });
        skipped.push(updated);
      }
      await logActivity({
        account_id: targetAccountId,
        project_id: account.project_id,
        action: 'daily_queue_limit_enforced',
        level: 'warn',
        message: `오늘 예약 상한 초과분 ${skipped.length}개를 자동 중지했습니다.`,
        payload: {
          limit,
          fixedCount: fixedRows.length,
          pendingCount: pendingRows.length,
          skippedQueueIds: skipped.map((row) => row.id)
        }
      }).catch(() => null);
    }

    results.push({
      accountId: targetAccountId,
      accountName: account.name,
      limit,
      fixedCount: fixedRows.length,
      pendingCount: pendingRows.length,
      excessCount: excessRows.length,
      skippedCount: dryRun ? 0 : skipped.length,
      excessQueueIds: excessRows.map((row) => row.id)
    });
  }

  return {
    ok: true,
    dryRun,
    accountCount: results.length,
    excessCount: results.reduce((sum, row) => sum + row.excessCount, 0),
    skippedCount: results.reduce((sum, row) => sum + row.skippedCount, 0),
    results
  };
}

export async function rescheduleTodayQueue({ accountId = null } = {}) {
  const { start, end } = kstDayRange();
  const [accounts, queue] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue')
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const todayRows = queue.filter((row) => {
    if (accountId && row.account_id !== accountId) return false;
    return inRange(row.scheduled_at || row.posted_at, start, end);
  });
  const targetsByAccount = new Map();
  for (const row of todayRows.filter((item) => item.status === 'scheduled')) {
    targetsByAccount.set(row.account_id, [...(targetsByAccount.get(row.account_id) || []), row]);
  }

  const results = [];
  for (const [targetAccountId, targets] of targetsByAccount.entries()) {
    const account = accountsById.get(targetAccountId);
    if (!account) continue;
    const targetIds = new Set(targets.map((row) => row.id));
    const blockedTimes = todayRows
      .filter((row) => row.account_id === targetAccountId && !targetIds.has(row.id))
      .filter((row) => ['posted', 'posting', 'retry'].includes(row.status))
      .map((row) => row.posted_at || row.scheduled_at)
      .filter(Boolean);
    const plan = createDailySchedulePlan({
      ...account,
      daily_post_max: targets.length
    }, new Date(), {
      blockedTimes,
      rollPastToNextDay: false
    });
    const sortedTargets = targets.slice().sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const updated = [];
    for (const [index, row] of sortedTargets.entries()) {
      const scheduledAt = plan.times[index];
      if (!scheduledAt) break;
      const [next] = await dbUpdate('post_queue', { id: row.id, status: 'scheduled' }, { scheduled_at: scheduledAt });
      if (next) updated.push(next);
    }
    await logActivity({
      account_id: targetAccountId,
      project_id: account.project_id,
      action: 'today_queue_rescheduled',
      level: 'info',
      message: `오늘 예약 ${updated.length}건을 09-23시 랜덤 분산으로 재배치했습니다.`,
      payload: { diagnostics: plan.diagnostics, targetCount: targets.length, updatedCount: updated.length }
    }).catch(() => null);
    results.push({
      accountId: targetAccountId,
      accountName: account.name,
      targetCount: targets.length,
      updatedCount: updated.length,
      diagnostics: plan.diagnostics,
      times: updated.map((row) => row.scheduled_at)
    });
  }

  return {
    ok: true,
    accountCount: results.length,
    updatedCount: results.reduce((sum, row) => sum + row.updatedCount, 0),
    results
  };
}

export async function recoverReplyLinkModeRequiredQueues({ accountId = null, limit = 100, dryRun = false } = {}) {
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const [queues, accounts] = await Promise.all([
    accountId
      ? dbList('post_queue', { account_id: accountId }, { order: 'updated_at', ascending: false, limit: cappedLimit })
      : dbList('post_queue', {}, {
        order: 'updated_at',
        ascending: false,
        limit: cappedLimit,
        in: { status: ['manual_required', 'failed'] }
      }),
    accountId ? dbList('accounts', { id: accountId }, { limit: 1 }) : dbList('accounts', { status: 'active' }, { limit: 500 })
  ]);
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const nowIso = new Date().toISOString();
  const recovered = [];
  const wouldRecover = [];
  const skipped = [];

  for (const queue of queues) {
    if (accountId && queue.account_id !== accountId) continue;
    const account = accountsById.get(queue.account_id);
    if (!canRecoverReplyLinkModeQueue(queue, account)) continue;
    if (account?.status !== 'active' || !isAutomationRunning(account)) {
      skipped.push({ queueId: queue.id, reason: 'account_not_active_or_automation_paused' });
      continue;
    }
    const post = queue.post_id ? await dbGet('posts', { id: queue.post_id }) : null;
    if (!post) {
      skipped.push({ queueId: queue.id, reason: 'post_missing' });
      continue;
    }
    try {
      assertPreflightCanPublish(await preflightAccount(account.id, { includeQueue: false, allowInitialLinkDiscovery: true }));
      const { product } = await getFirstLinkableProductForTopic(post.topic_id);
      if (!product || !isLinkableCoupangProduct(product)) {
        skipped.push({ queueId: queue.id, reason: 'linkable_product_missing' });
        continue;
      }
    } catch (error) {
      skipped.push({ queueId: queue.id, reason: 'preflight_failed', message: error.message });
      continue;
    }

    const scheduledAt = new Date(queue.scheduled_at || 0).getTime() <= Date.now()
      ? nowIso
      : queue.scheduled_at;
    if (dryRun) {
      wouldRecover.push({
        queueId: queue.id,
        accountId: queue.account_id,
        postId: queue.post_id,
        previousStatus: queue.status,
        scheduledAt
      });
      continue;
    }
    const [updated] = await dbUpdate('post_queue', { id: queue.id }, {
      status: 'retry',
      scheduled_at: scheduledAt,
      error_message: null,
      error_category: null
    });
    if (!updated) continue;
    recovered.push(updated);
    await logActivity({
      account_id: queue.account_id,
      project_id: queue.project_id,
      topic_id: queue.topic_id,
      post_id: queue.post_id,
      queue_id: queue.id,
      action: 'reply_link_mode_queue_recovered',
      level: 'info',
      message: '댓글 링크 모드 설정 누락으로 막힌 큐를 재시도 가능 상태로 복구했습니다.',
      payload: { previousStatus: queue.status, scheduledAt }
    }).catch(() => null);
  }

  return {
    ok: true,
    mode: dryRun ? 'dry-run' : 'apply',
    wouldRecoverCount: wouldRecover.length,
    recoveredCount: recovered.length,
    skippedCount: skipped.length,
    wouldRecover,
    recovered,
    skipped
  };
}

export async function uploadQueueItem(queueId) {
  const queue = await dbGet('post_queue', { id: queueId });
  if (!queue) {
    const error = new Error('Queue item not found');
    error.status = 404;
    throw error;
  }
  if ((queue.platform || 'threads') !== 'threads') {
    const error = new Error('Only Threads queue items can be uploaded automatically. Instagram preview queue is manual only.');
    error.status = 409;
    error.code = 'AUTOMATION_STUDIO_PREVIEW_ONLY';
    throw error;
  }
  const account = await dbGet('accounts', { id: queue.account_id });
  const post = await dbGet('posts', { id: queue.post_id });
  const automationLink = await getAutomationStudioQueueLink(queue.id);
  if (canRepairReplyFailureQueue(queue, account)) {
    await repairReplyLinkFailures({ accountId: queue.account_id });
    return dbGet('post_queue', { id: queueId });
  }
  if (!isAutomationRunning(account)) {
    const error = new Error('자동화가 중지되어 업로드를 보류했습니다.');
    error.status = 409;
    error.code = 'AUTOMATION_PAUSED';
    throw error;
  }
  const recoverableManualRequired = canRecoverReplyLinkModeQueue(queue, account);
  if (!['scheduled', 'retry'].includes(queue.status) && !recoverableManualRequired) {
    throw createQueueAlreadyClaimedError(queueId, queue.status);
  }
  const [claimed] = await dbUpdate('post_queue', { id: queueId, status: queue.status }, {
    status: 'posting',
    error_message: recoverableManualRequired ? null : queue.error_message,
    error_category: recoverableManualRequired ? null : queue.error_category
  });
  if (!claimed) {
    throw createQueueAlreadyClaimedError(queueId, queue.status);
  }
  let trackingLinkForFailure = queue.tracking_link_id || null;
  try {
    await assertAccountOwnerCanOperate(queue.account_id);
    await assertAccountCanUpload(queue.account_id);
    if (!post) {
      const error = new Error('Post not found for queue item');
      error.permanent = true;
      throw error;
    }
    if (account?.status !== 'active') {
      await logActivity({ account_id: queue.account_id, project_id: queue.project_id, post_id: queue.post_id, action: 'upload_skipped_inactive_account', level: 'warn', message: account?.status || 'missing' });
      const [updated] = await dbUpdate('post_queue', { id: queueId }, { status: 'skipped', error_message: `Account is ${account?.status || 'missing'}` });
      await syncAutomationStudioQueueLink(queueId, updated?.status || 'skipped');
      return updated;
    }
    const skipMonetizationChecks = canSkipMonetizationPreflight({ queue, post, automationLink });
    assertPreflightCanPublish(await preflightAccount(account.id, {
      includeQueue: false,
      skipMonetizationChecks
    }));
    const { product } = await getFirstLinkableProductForTopic(post.topic_id);
    // retry 시 기존 tracking_link 재사용 — 중복 생성 방지
    const existingLink = queue.tracking_link_id
      ? await dbGet('tracking_links', { id: queue.tracking_link_id })
      : null;
    const postMode = queue.post_mode || 'auto';
    const upgradeNoLinkQueue = shouldUpgradeNoLinkQueueToLink({ queue, post, product, automationLink });
    let requiresLink = postMode === 'link'
      || (postMode === 'auto' && isLinkableCoupangProduct(product))
      || upgradeNoLinkQueue;
    if (upgradeNoLinkQueue) {
      await logActivity({
        account_id: queue.account_id,
        project_id: queue.project_id,
        topic_id: queue.topic_id,
        post_id: queue.post_id,
        queue_id: queue.id,
        action: 'no_link_queue_upgraded_to_link',
        level: 'info',
        message: '상품이 연결된 일반 큐를 댓글 링크 글로 전환했습니다.',
        payload: { previousPostMode: postMode, productId: product?.id || null }
      }).catch(() => null);
    }
    const willSendLinkReply = requiresLink || Boolean(existingLink);
    if (willSendLinkReply) {
      const reply = await replyLinkReadiness(account);
      if (!reply.ok) {
        await logActivity({
          account_id: queue.account_id,
          project_id: queue.project_id,
          topic_id: queue.topic_id,
          post_id: queue.post_id,
          queue_id: queue.id,
          action: 'link_queue_blocked_reply_readiness',
          level: 'error',
          message: reply.message || '댓글 링크 상태가 안전하지 않아 링크 글 업로드를 막았습니다.',
          payload: { reasonCode: reply.code, unresolvedReplyFailures: reply.unresolvedCount || 0 }
        }).catch(() => null);
        throw createReplyLinkRequiredError(reply.code, reply.message);
      }
    }
    const resolvedPostMode = requiresLink ? 'link' : (postMode === 'sponsored_comment' ? 'sponsored_comment' : 'no_link');
    if (postMode !== resolvedPostMode) {
      await dbUpdate('post_queue', { id: queueId }, { post_mode: resolvedPostMode }).catch(() => []);
    }
    const ctas = requiresLink ? await listCtas(post.id) : [];
    const cta = requiresLink ? (ctas[Math.floor(Math.random() * Math.max(1, ctas.length))] || null) : null;
    if (requiresLink && !isLinkableCoupangProduct(product)) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글로 예약됐지만 연결 가능한 쿠팡 상품이 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const trackingLink = requiresLink ? (existingLink || (product ? await createTrackingLink({
      project_id: post.project_id,
      account_id: post.account_id,
      topic_id: post.topic_id,
      post_id: post.id,
      product_id: product.id,
      destination_url: product.partner_url || product.product_url,
      link_type: 'coupang'
    }) : null)) : existingLink;
    trackingLinkForFailure = trackingLink?.id || trackingLinkForFailure;
    if (requiresLink && !trackingLink) {
      const error = new Error('COUPANG_PRODUCT_MISSING: 링크 글의 트래킹 링크를 만들 수 없습니다.');
      error.status = 422;
      error.permanent = true;
      throw error;
    }
    const sponsor = resolvedPostMode === 'sponsored_comment'
      ? await getSponsorCommentText({ account, post })
      : { ok: false, commentText: '' };
    const uploaded = await uploadThreads({ account, post, cta, trackingLink, sponsoredReplyText: sponsor.commentText || '' });
    const replyClassification = uploaded.raw?.replyWarning
      ? classifyQueueError(uploaded.raw.replyWarning)
      : null;
    let postedRows;
    try {
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl || fallbackThreadsPostUrl(account, uploaded.raw?.postId),
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id || queue.tracking_link_id || null,
        error_message: uploaded.raw?.replyWarning || null,
        error_category: replyClassification?.category || null
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      postedRows = await dbUpdate('post_queue', { id: queueId }, {
        status: 'posted',
        posted_at: new Date().toISOString(),
        post_url: uploaded.postUrl || fallbackThreadsPostUrl(account, uploaded.raw?.postId),
        selected_cta_id: cta?.id,
        tracking_link_id: trackingLink?.id || queue.tracking_link_id || null,
        error_message: uploaded.raw?.replyWarning || null
      });
    }
    const [updated] = postedRows;
    await syncAutomationStudioQueueLink(queueId, updated.status);
    await dbUpdate('posts', { id: post.id }, { status: 'posted' });
    await recordSuccessfulUpload(account.id);
    await createMetricJobs(updated);
    const blogPost = await maybeGenerateBlogPostForQueue({ account, post, queue: updated }).catch(async (blogError) => {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'blog_auto_publish_failed',
        level: 'warn',
        message: blogError.message
      });
      return null;
    });
    if (blogPost) {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'blog_auto_published',
        message: blogPost.slug,
        payload: { blogPostId: blogPost.id, slug: blogPost.slug }
      });
    }
    await logActivity({ account_id: account.id, project_id: account.project_id, post_id: post.id, action: 'upload_completed', message: uploaded.postUrl });
    if (uploaded.raw?.replyWarning) {
      await logActivity({
        account_id: account.id,
        project_id: account.project_id,
        post_id: post.id,
        action: 'upload_reply_failed',
        level: 'warn',
        message: uploaded.raw.replyWarning,
        payload: { postUrl: uploaded.postUrl }
      });
    }
    return updated;
  } catch (error) {
    const retry = (queue.retry_count || 0) + 1;
    const status = error.permanent || retry >= 3 ? 'manual_required' : 'retry';
    const classified = classifyQueueError(error.message);
    if (error.code === 'THREADS_TOKEN_INVALID' || error.code === 'THREADS_TOKEN_MISSING') {
      await dbUpdate('accounts', { id: queue.account_id }, { threads_token_status: 'refresh_failed' });
    }
    let updatedRows;
    try {
      updatedRows = await dbUpdate('post_queue', { id: queueId }, {
        status,
        retry_count: retry,
        error_message: error.message,
        error_category: classified.category,
        post_url: error.postUrl || queue.post_url || null,
        tracking_link_id: trackingLinkForFailure
      });
    } catch (updateError) {
      if (!/error_category|schema cache|column/i.test(updateError.message || '')) throw updateError;
      updatedRows = await dbUpdate('post_queue', { id: queueId }, { status, retry_count: retry, error_message: error.message });
    }
    const [updated] = updatedRows;
    await syncAutomationStudioQueueLink(queueId, updated?.status || status);
    await logActivity({ account_id: queue.account_id, project_id: queue.project_id, action: 'upload_failed', level: 'error', message: error.message });
    await sendOpsAlert(status === 'manual_required' ? 'queue_manual_required' : 'queue_upload_failed', {
      title: status === 'manual_required' ? '큐 수동 검토 전환' : '큐 업로드 실패',
      account,
      code: error.code || classified.category || 'UPLOAD_FAILED',
      message: error.message,
      hint: status === 'manual_required' ? '관리자 큐에서 상세 오류와 링크/토큰 상태를 확인하세요.' : '재시도 예정입니다. 반복되면 수동 검토로 전환됩니다.',
      payload: {
        queueId,
        postId: queue.post_id,
        nextStatus: status,
        retryCount: retry,
        errorCategory: classified.category
      }
    });
    return updated;
  }
}
