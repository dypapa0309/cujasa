import 'dotenv/config';
import { generatePosts } from '../services/contentService.js';
import { generateCtas } from '../services/ctaService.js';
import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from '../services/supabaseService.js';
import { buildHumanStyleFallback, scorePostEngagement } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';
import { assessContentPatternQuality } from '../utils/contentPatternQuality.js';
import {
  buildContentDiversityPlan,
  resolveContentStrategyMetadata,
  contentLengthBucket
} from '../utils/contentFormatStrategy.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const includeManual = args.has('--include-manual');
const includeRetry = args.has('--include-retry');
const accountId = valueAfter('--account-id');
const limit = Math.max(1, Math.min(Number(valueAfter('--limit') || 100), 500));
const attempts = Math.max(1, Math.min(Number(valueAfter('--attempts') || 3), 5));
const forceFallback = args.has('--force-fallback');
const fallbackOnly = args.has('--fallback-only');
const skipCta = args.has('--skip-cta');
const onlyRepetitive = args.has('--only-repetitive');
const historyDays = Math.max(7, Math.min(Number(valueAfter('--history-days') || 30), 90));

const queueHistoryCache = new Map();
const postCache = new Map();

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

function statusFilter() {
  const statuses = ['scheduled'];
  if (includeManual) statuses.push('manual_required');
  if (includeRetry) statuses.push('retry');
  return statuses;
}

function futureQueue(row) {
  const time = new Date(row.scheduled_at || 0).getTime();
  return Number.isFinite(time) && time >= Date.now();
}

function queueSort(a, b) {
  return new Date(a.scheduled_at || 0).getTime() - new Date(b.scheduled_at || 0).getTime();
}

async function targetQueues() {
  const filters = accountId ? { account_id: accountId } : {};
  const rows = await dbList('post_queue', filters, {
    order: 'scheduled_at',
    ascending: true,
    limit: 1000,
    in: { status: statusFilter() }
  });
  const candidates = rows
    .filter((row) => row.post_id && futureQueue(row))
    .sort(queueSort);
  if (!onlyRepetitive) return candidates.slice(0, limit);
  const repeated = [];
  for (const queue of candidates) {
    const issue = await repetitionIssueForQueue(queue);
    if (!issue) continue;
    queue.repetitionIssue = issue;
    repeated.push(queue);
    if (repeated.length >= limit) break;
  }
  return repeated;
}

function regeneratable(queue) {
  return Boolean(queue.topic_id);
}

async function previewQueue(queue) {
  const [account, post, topic] = await Promise.all([
    dbGet('accounts', { id: queue.account_id }),
    getPost(queue.post_id),
    queue.topic_id ? dbGet('topics', { id: queue.topic_id }) : null
  ]);
  return {
    queueId: queue.id,
    accountId: queue.account_id,
    accountName: account?.name || '',
    status: queue.status,
    postMode: queue.post_mode || '',
    scheduledAt: queue.scheduled_at,
    topicId: queue.topic_id,
    topicTitle: topic?.title || '',
    oldPostId: queue.post_id,
    oldBody: post?.body || '',
    repetitionIssue: queue.repetitionIssue || await repetitionIssueForQueue(queue)
  };
}

async function regenerateQueue(queue) {
  if (!regeneratable(queue)) {
    return { queueId: queue.id, skipped: true, reason: 'topic_missing' };
  }
  const oldPost = await getPost(queue.post_id);
  if (!oldPost) return { queueId: queue.id, skipped: true, reason: 'old_post_missing' };
  const peerBodies = await recentPeerBodiesForQueue(queue);

  let newPost = fallbackOnly ? await createFallbackPostForQueue(queue, oldPost) : null;
  if (fallbackOnly && !newPost?.id) {
    return {
      queueId: queue.id,
      skipped: true,
      reason: 'fallback_quality_failed'
    };
  }
  let lastRejected = null;
  for (let attempt = 1; !newPost?.id && attempt <= attempts; attempt += 1) {
    const [candidate] = await generatePosts(oldPost.topic_id || queue.topic_id);
    if (!candidate?.id) {
      lastRejected = { reason: 'new_post_missing', attempt };
      continue;
    }
    const quality = validateRegeneratedPost(candidate, { peerBodies });
    if (quality.accepted) {
      newPost = candidate;
      break;
    }
    lastRejected = { ...quality, attempt, postId: candidate.id, body: candidate.body };
    await dbUpdate('posts', { id: candidate.id }, {
      status: 'rejected_regeneration',
      metadata: {
        ...(candidate.metadata || {}),
        rejectedRegenerationForQueueId: queue.id,
        rejectedRegenerationAt: new Date().toISOString(),
        rejectedRegenerationReasons: quality.reasons
      }
    });
  }
  if (!newPost?.id && forceFallback) {
    newPost = await createFallbackPostForQueue(queue, oldPost);
  }
  if (!newPost?.id) {
    return {
      queueId: queue.id,
      skipped: true,
      reason: 'quality_regeneration_failed',
      lastRejected
    };
  }

  if (!skipCta) {
    await generateCtas(newPost.id).catch((error) => logActivity({
      account_id: queue.account_id,
      project_id: queue.project_id,
      topic_id: queue.topic_id,
      post_id: newPost.id,
      action: 'scheduled_post_regenerate_cta_failed',
      level: 'warn',
      message: error.message || 'CTA generation failed while regenerating scheduled post',
      payload: { queueId: queue.id }
    }));
  }

  await dbUpdate('post_queue', { id: queue.id }, {
    post_id: newPost.id,
    topic_id: newPost.topic_id,
    tracking_link_id: null,
    error_message: null,
    error_category: null
  });

  await dbUpdate('posts', { id: newPost.id }, {
    status: queue.status === 'manual_required' ? 'manual_required' : 'queued',
    metadata: {
      ...(newPost.metadata || {}),
      regeneratedFromPostId: oldPost.id,
      regeneratedForQueueId: queue.id,
      regeneratedAt: new Date().toISOString()
    }
  });

  await dbUpdate('posts', { id: oldPost.id }, {
    status: 'replaced',
    metadata: {
      ...(oldPost.metadata || {}),
      replacedByPostId: newPost.id,
      replacedQueueId: queue.id,
      replacedAt: new Date().toISOString()
    }
  });

  await logActivity({
    account_id: queue.account_id,
    project_id: queue.project_id,
    topic_id: newPost.topic_id,
    post_id: newPost.id,
    action: 'scheduled_post_regenerated',
    level: 'info',
    message: '예약 글을 최신 콘텐츠 다양화 로직으로 재생성했습니다.',
    payload: {
      queueId: queue.id,
      oldPostId: oldPost.id,
      newPostId: newPost.id,
      oldRepetitionIssue: queue.repetitionIssue || null,
      scheduledAt: queue.scheduled_at,
      postMode: queue.post_mode || null,
      contentFormat: newPost.metadata?.contentFormat || null,
      contentGoal: newPost.metadata?.contentGoal || null,
      visualPlan: newPost.metadata?.visualPlan || null,
      ctaSkipped: skipCta
    }
  });

  return {
    queueId: queue.id,
    scheduledAt: queue.scheduled_at,
    oldPostId: oldPost.id,
    newPostId: newPost.id,
    oldRepetitionIssue: queue.repetitionIssue || null,
    oldBody: oldPost.body,
    newBody: newPost.body,
    contentFormat: newPost.metadata?.contentFormat || null,
    contentGoal: newPost.metadata?.contentGoal || null,
    attachImage: Boolean(newPost.metadata?.visualPlan?.attachImage),
    ctaSkipped: skipCta
  };
}

async function createFallbackPostForQueue(queue, oldPost) {
  const [topic, account, recentPosts] = await Promise.all([
    dbGet('topics', { id: oldPost.topic_id || queue.topic_id }),
    dbGet('accounts', { id: queue.account_id }),
    dbList('posts', { account_id: queue.account_id }, { order: 'created_at', ascending: false, limit: 20 })
  ]);
  if (!topic || !account) return null;
  const peerBodies = await recentPeerBodiesForQueue(queue);
  const diversityPlan = buildContentDiversityPlan({ topic, account, recentPosts });
  const blueprint = selectFallbackBlueprint(diversityPlan, queue);
  const fallbackStyles = fallbackStylesForBlueprint(blueprint, queue);
  let accepted = null;
  for (const formatStyle of fallbackStyles) {
    const body = buildHumanStyleFallback(topic, account, [], {
      seed: `${queue.id}:${queue.scheduled_at || ''}:${formatStyle}`,
      formatStyle
    });
    const quality = validateRegeneratedPost({ body }, { relaxed: true, peerBodies });
    if (quality.accepted) {
      accepted = { body, quality, formatStyle };
      break;
    }
  }
  if (!accepted) return null;
  const { body, quality, formatStyle } = accepted;
  const strategy = resolveContentStrategyMetadata({}, body, oldPost.content_type || '공감형');
  const metadata = {
    contentFormat: strategy.contentFormat,
    contentGoal: strategy.contentGoal,
    lengthBucket: contentLengthBucket(body),
    engagementScore: quality.score,
    engagementPattern: quality.qualityGate?.engagementPattern || null,
    qualityGate: quality.qualityGate,
    contentDiversityPlan: diversityPlan,
    selectedContentPlanFit: {
      matchedSlot: blueprint?.slotKey || null,
      matchedReason: blueprint?.slotLabel ? `${blueprint.slotLabel} fallback blueprint` : null
    },
    fallbackFormatStyle: formatStyle,
    fallbackUsed: true,
    forcedRegenerationFallback: true,
    regeneratedFromPostId: oldPost.id,
    regeneratedForQueueId: queue.id,
    regeneratedAt: new Date().toISOString()
  };
  return dbInsert('posts', {
    project_id: oldPost.project_id,
    account_id: oldPost.account_id,
    topic_id: oldPost.topic_id || queue.topic_id,
    content_type: oldPost.content_type || '공감형',
    body,
    risk_level: oldPost.risk_level || 'low',
    status: 'draft',
    metadata
  });
}

function selectFallbackBlueprint(plan = {}, queue = {}) {
  const blueprints = plan.candidateBlueprints || [];
  if (!blueprints.length) return null;
  const seed = `${queue.id || ''}:${queue.scheduled_at || ''}`;
  let hash = 2166136261;
  for (const char of seed) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return blueprints[hash % blueprints.length];
}

function fallbackStyleForFormat(format = '', queue = {}) {
  if (format === 'pov_scene') return 'pov_scene';
  if (format === 'myth_reality' || format === 'photo_dump_caption' || format === 'series_note') return 'myth_reality';
  if (format === 'ranked_list' || format === 'checklist_card' || format === 'before_buy_check') return 'ranked_list';
  if (format === 'imaginary_reply') return 'imaginary_reply';
  if (format === 'send_to_friend') return 'share';
  if (format === 'wrong_purchase' || format === 'anti_buy') return 'wrong_purchase';
  if (format === 'lazy_person_tip' || format === 'anti_aesthetic') return 'lazy_tip';
  if (format === 'mini_story' || format === 'micro_story') return 'mini_story';
  if (format === 'choice_question' || format === 'soft_question' || format === 'mini_poll') return 'experience_question';
  if (queue.post_mode === 'no_link') return 'prose';
  return 'hot_take';
}

function fallbackStylesForBlueprint(blueprint = null, queue = {}) {
  const preferred = (blueprint?.preferredFormats || []).map((format) => fallbackStyleForFormat(format, queue));
  const accountCycle = [
    'share',
    'ranked_list',
    'pov_scene',
    'myth_reality',
    'imaginary_reply',
    'wrong_purchase',
    'lazy_tip',
    'mini_story',
    'hot_take',
    'prose',
    'experience_question',
    'numbered'
  ];
  const index = Number(queue.regenerationIndexForAccount || 0);
  const offset = accountCycle.length ? index % accountCycle.length : 0;
  const rotatedCycle = accountCycle.slice(offset).concat(accountCycle.slice(0, offset));
  return [...new Set([
    ...rotatedCycle,
    ...preferred,
    'pov_scene',
    'myth_reality',
    'ranked_list',
    'imaginary_reply',
    'share',
    'wrong_purchase',
    'lazy_tip',
    'mini_story',
    'hot_take',
    'prose',
    'experience_question',
    'numbered'
  ])];
}

async function getPost(postId) {
  if (!postId) return null;
  if (postCache.has(postId)) return postCache.get(postId);
  const post = await dbGet('posts', { id: postId });
  postCache.set(postId, post || null);
  return post || null;
}

async function recentQueueHistory(accountId) {
  if (queueHistoryCache.has(accountId)) return queueHistoryCache.get(accountId);
  const cutoff = Date.now() - historyDays * 24 * 60 * 60 * 1000;
  const rows = (await dbList('post_queue', { account_id: accountId }, {
    order: 'updated_at',
    ascending: false,
    limit: 500
  })).filter((row) => {
    if (row.customer_hidden_at) return false;
    if (!['scheduled', 'posting', 'posted', 'retry', 'manual_required'].includes(row.status)) return false;
    const time = new Date(row.posted_at || row.scheduled_at || row.updated_at || row.created_at || 0).getTime();
    return time && time >= cutoff;
  });
  queueHistoryCache.set(accountId, rows);
  return rows;
}

async function recentPeerBodiesForQueue(queue) {
  const rows = await recentQueueHistory(queue.account_id);
  const bodies = [];
  for (const row of rows) {
    if (row.id === queue.id || row.post_id === queue.post_id) continue;
    const post = await getPost(row.post_id);
    if (post?.body) bodies.push(post.body);
  }
  return bodies;
}

async function repetitionIssueForQueue(queue) {
  const post = await getPost(queue.post_id);
  if (!post?.body) return null;
  const engagement = scorePostEngagement(post.body || '');
  const gate = evaluatePostQualityGate(engagement);
  const gateReasons = gate.reasons || [];
  if (engagement.checks?.repetitiveFallback || gateReasons.some((reason) => /반복|유사/.test(reason))) {
    return {
      reason: 'quality_gate_repetition',
      score: engagement.engagementScore,
      reasons: gateReasons,
      contentFormat: post.metadata?.contentFormat || null,
      contentGoal: post.metadata?.contentGoal || null
    };
  }
  const patternQuality = assessContentPatternQuality(post.body, await recentPeerBodiesForQueue(queue));
  if (!patternQuality.allowed) {
    return {
      reason: 'pattern_similarity',
      reasons: patternQuality.reasons,
      duplicateSimilarity: patternQuality.duplicateSimilarity,
      duplicateTokenOverlap: patternQuality.duplicateTokenOverlap,
      duplicateSignal: patternQuality.duplicateSignal,
      duplicatePenalty: patternQuality.duplicatePenalty,
      contentFormat: post.metadata?.contentFormat || null,
      contentGoal: post.metadata?.contentGoal || null
    };
  }
  return null;
}

function validateRegeneratedPost(post = {}, { relaxed = false, peerBodies = [] } = {}) {
  const engagement = scorePostEngagement(post.body || '');
  const gate = evaluatePostQualityGate(engagement);
  const patternQuality = assessContentPatternQuality(post.body || '', peerBodies);
  const reasons = [
    ...(gate.reasons || []),
    ...(patternQuality.allowed ? [] : patternQuality.reasons)
  ];
  if (relaxed && gate.severity !== 'critical' && engagement.engagementScore >= 82) {
    if (!patternQuality.allowed) {
      return {
        accepted: false,
        reasons,
        score: engagement.engagementScore,
        qualityGate: gate,
        patternQuality
      };
    }
    return {
      accepted: true,
      reasons,
      score: engagement.engagementScore,
      qualityGate: gate
    };
  }
  if (!gate.passed || !patternQuality.allowed) {
    return {
      accepted: false,
      reasons,
      score: engagement.engagementScore,
      qualityGate: gate,
      patternQuality
    };
  }
  return {
    accepted: true,
    reasons: [],
    score: engagement.engagementScore,
    qualityGate: gate
  };
}

async function main() {
  const queues = await targetQueues();
  if (!apply) {
    const preview = [];
    for (const queue of queues) preview.push(await previewQueue(queue));
    console.log(JSON.stringify({
      mode: 'dry-run',
      targetCount: preview.length,
      regeneratableCount: preview.filter((queue) => queue.topicId).length,
      skippedCount: preview.filter((queue) => !queue.topicId).length,
      statuses: statusFilter(),
      accountId: accountId || null,
      onlyRepetitive,
      historyDays,
      queues: preview
    }, null, 2));
    return;
  }

  const updated = [];
  const failed = [];
  const accountQueueCounts = new Map();
  for (const queue of queues) {
    const count = accountQueueCounts.get(queue.account_id) || 0;
    queue.regenerationIndexForAccount = count;
    accountQueueCounts.set(queue.account_id, count + 1);
  }
  for (const queue of queues) {
    try {
      const result = await regenerateQueue(queue);
      if (result.skipped) failed.push(result);
      else updated.push(result);
    } catch (error) {
      failed.push({
        queueId: queue.id,
        postId: queue.post_id,
        scheduledAt: queue.scheduled_at,
        error: error.message || String(error)
      });
    }
  }

  console.log(JSON.stringify({
    mode: 'apply',
    targetCount: queues.length,
    updatedCount: updated.length,
    failedCount: failed.length,
    statuses: statusFilter(),
    accountId: accountId || null,
    onlyRepetitive,
    historyDays,
    updated,
    failed
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
