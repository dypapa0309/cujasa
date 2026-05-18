import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';
import { rewritePostQualityPrompt } from '../prompts/rewritePostQualityPrompt.js';
import { checkAndRewriteRisk } from './riskService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { scorePostHook, strengthenPostHook, validatePostStyleFit } from '../utils/accountStyle.js';
import { prepareGeneratedPostBody } from '../utils/koreanContentQuality.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';
import { validatePostRewriteResponse, validatePostsResponse } from '../utils/aiResponseSchemas.js';
import { buildChoiceTensionFallback, scorePostEngagement, scorePostSimilarity } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';
import { buildReferencePatternContext, publicPatternIdFromSourceId } from './trendReferenceLearningService.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';
import { sanitizePostBody } from '../utils/contentText.js';
import { assessContentPatternQuality } from '../utils/contentPatternQuality.js';
import { buildPostVisualPlan } from '../utils/postVisualStrategy.js';
import { resolveVisualPlanImage } from './postImageService.js';
import {
  buildContentDiversityPlan,
  isShortReachFormat,
  resolveContentStrategyMetadata,
  scoreContentDiversityPlanFit,
  scoreFormatDiversity
} from '../utils/contentFormatStrategy.js';

const STABLE_HUMANLIKE_SCORE = 82;

function preparePostBodyCandidate(rawBody, account) {
  const initialRisk = checkAndRewriteRisk(rawBody);
  const prepared = prepareGeneratedPostBody(initialRisk.body);
  const sanitized = sanitizePostBody(prepared.body, account);
  const normalized = prepareGeneratedPostBody(sanitized);
  return {
    risk: checkAndRewriteRisk(normalized.body),
    prepared: {
      ...normalized,
      warnings: [...prepared.warnings, ...normalized.warnings]
    }
  };
}

function getFallbackContentType(account = {}) {
  const mode = account.content_mode || 'empathy';
  const typeMap = {
    auto: '공감형',
    daily: '일상형',
    empathy: '공감형',
    problem_solution: '문제 해결형',
    checklist: '체크리스트형',
    question: '질문형',
    safe_debate: '질문형'
  };
  return typeMap[mode] || '공감형';
}

function candidateScoreSummary(candidate, index, selected) {
  return {
    index,
    contentType: candidate.contentType || null,
    engagementScore: candidate.engagement?.engagementScore ?? 0,
    originalEngagementScore: candidate.engagement?.originalEngagementScore ?? candidate.engagement?.engagementScore ?? 0,
    duplicateSimilarity: candidate.similarity?.maxSimilarity ?? candidate.engagement?.duplicateSimilarity ?? 0,
    duplicatePenalty: candidate.similarity?.penalty ?? candidate.engagement?.duplicatePenalty ?? 0,
    engagementPattern: candidate.engagement?.engagementPattern || null,
    contentFormat: candidate.contentFormat || candidate.item?.contentFormat || null,
    contentGoal: candidate.contentGoal || candidate.item?.contentGoal || null,
    formatDiversity: candidate.formatDiversity || null,
    contentPlanFit: candidate.contentPlanFit || null,
    rubric: candidate.engagement?.rubric || {},
    qualityGate: candidate.qualityGate || null,
    qualityRewriteUsed: Boolean(candidate.qualityRewriteUsed),
    selected,
    rejected: Boolean(candidate.rejected),
    rejectionReasons: candidate.rejectionReasons || []
  };
}

function isStableHumanlikeCandidate(candidate) {
  const engagement = candidate?.engagement;
  const qualityGate = candidate?.qualityGate || evaluatePostQualityGate(engagement);
  return qualityGate.passed
    && engagement?.engagementScore >= STABLE_HUMANLIKE_SCORE
    && (
      engagement?.checks?.compactRelatable
      || (
        engagement?.checks?.livedInStructure
        && engagement?.checks?.concreteCriteria
        && engagement?.checks?.microDetail
        && engagement?.checks?.saveWorthiness
      )
    )
    && !engagement?.checks?.shallowChecklist
    && !engagement?.checks?.genericTemplate
    && !engagement?.checks?.repetitiveFallback
    && !engagement?.checks?.abstractSetup
    && !engagement?.checks?.awkwardMetaphor
    && !engagement?.checks?.duplicateRisk
    && !engagement?.checks?.aiLikeTone
    && !engagement?.checks?.accountTokenLeak;
}

async function buildRecentBodyContext(accountId, currentTopicId) {
  const rows = await dbList('posts', { account_id: accountId }, { order: 'created_at', ascending: false, limit: 80 });
  return rows
    .filter((row) => row.topic_id !== currentTopicId)
    .map((row) => String(row.body || '').trim())
    .filter(Boolean)
    .slice(0, 40);
}

async function buildRecentPostContext(accountId, currentTopicId) {
  return (await dbList('posts', { account_id: accountId }, { order: 'created_at', ascending: false, limit: 20 }))
    .filter((row) => row.topic_id !== currentTopicId);
}

function applySimilarityPenalty(candidate, recentBodies = []) {
  const similarity = scorePostSimilarity(candidate.body, recentBodies);
  const adjustedScore = Math.max(0, Number(candidate.engagement?.engagementScore || 0) - similarity.penalty);
  const engagement = {
    ...candidate.engagement,
    engagementScore: adjustedScore,
    originalEngagementScore: candidate.engagement?.engagementScore ?? adjustedScore,
    duplicateSimilarity: similarity.maxSimilarity,
    duplicatePenalty: similarity.penalty,
    checks: {
      ...(candidate.engagement?.checks || {}),
      duplicateRisk: similarity.duplicateRisk
    },
    selectionReasons: similarity.duplicateRisk
      ? [...new Set([...(candidate.engagement?.selectionReasons || []), '최근 글과 유사도 높음'])]
      : candidate.engagement?.selectionReasons
  };
  return {
    ...candidate,
    similarity,
    adjustedScore,
    engagement,
    qualityGate: evaluatePostQualityGate(engagement)
  };
}

function applyFormatDiversityPenalty(candidate, recentPosts = []) {
  const formatDiversity = scoreFormatDiversity({
    contentFormat: candidate.contentFormat,
    contentGoal: candidate.contentGoal,
    body: candidate.body
  }, recentPosts);
  const adjustedScore = formatDiversity.adjustedScore(candidate.engagement?.engagementScore || 0);
  const duplicateRisk = Boolean(candidate.engagement?.checks?.duplicateRisk) || formatDiversity.duplicateRisk;
  const engagement = {
    ...candidate.engagement,
    engagementScore: adjustedScore,
    originalEngagementScore: candidate.engagement?.originalEngagementScore ?? candidate.engagement?.engagementScore ?? adjustedScore,
    formatDiversityPenalty: formatDiversity.penalty,
    checks: {
      ...(candidate.engagement?.checks || {}),
      duplicateRisk
    },
    selectionReasons: formatDiversity.penalty > 0
      ? [...new Set([...(candidate.engagement?.selectionReasons || []), '최근 포맷 반복 감점'])]
      : candidate.engagement?.selectionReasons
  };
  return {
    ...candidate,
    formatDiversity,
    adjustedScore,
    engagement,
    qualityGate: evaluatePostQualityGate(engagement)
  };
}

function applyContentPlanBias(candidate, contentDiversityPlan = null) {
  const contentPlanFit = scoreContentDiversityPlanFit({
    contentFormat: candidate.contentFormat,
    contentGoal: candidate.contentGoal,
    body: candidate.body
  }, contentDiversityPlan);
  if (!contentPlanFit.bonus) {
    return { ...candidate, contentPlanFit };
  }
  const adjustedScore = clampSelectionScore((candidate.adjustedScore ?? candidate.engagement?.engagementScore ?? 0) + contentPlanFit.bonus);
  const engagement = {
    ...candidate.engagement,
    engagementScore: adjustedScore,
    originalEngagementScore: candidate.engagement?.originalEngagementScore ?? candidate.engagement?.engagementScore ?? adjustedScore,
    contentPlanBonus: contentPlanFit.bonus,
    selectionReasons: [...new Set([...(candidate.engagement?.selectionReasons || []), contentPlanFit.matchedReason])]
  };
  return {
    ...candidate,
    contentPlanFit,
    adjustedScore,
    engagement,
    qualityGate: evaluatePostQualityGate(engagement)
  };
}

function clampSelectionScore(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function buildRewriteFallback(topic, account, products = []) {
  return {
    body: buildChoiceTensionFallback(topic, account, products),
    contentType: getFallbackContentType(account),
    changeSummary: '품질 기준 미달 후보를 안전한 생활 장면 fallback으로 재작성했습니다.',
    riskLevel: 'low'
  };
}

async function tryRewriteCandidateForQuality({
  body,
  contentType,
  riskLevel,
  engagement,
  qualityGate,
  topic,
  account,
  products,
  logContext
}) {
  if (qualityGate.passed) {
    return {
      rewritten: false,
      body,
      contentType,
      riskLevel,
      engagement,
      qualityGate
    };
  }

  await logActivity({
    ...logContext,
    action: 'post_quality_rewrite_attempted',
    level: 'info',
    message: qualityGate.reasons.join('; '),
    payload: {
      contentType,
      score: engagement.engagementScore,
      reasons: qualityGate.reasons,
      rewriteInstructions: qualityGate.rewriteInstructions
    }
  });

  const rewrite = await getJson(
    rewritePostQualityPrompt({ body, topic, products, account, engagement, qualityGate }),
    () => buildRewriteFallback(topic, account, products),
    {
      schemaName: 'rewrite_post_quality',
      validate: validatePostRewriteResponse,
      logContext
    }
  );
  const rewriteContentType = rewrite.contentType || contentType || getFallbackContentType(account);
  const { risk: rewriteRisk, prepared: rewritePrepared } = preparePostBodyCandidate(rewrite.body, account);
  const rewriteGuardrail = validatePostCandidate(rewritePrepared.body, account, topic);
  const rewriteStyleFit = validatePostStyleFit(rewritePrepared.body, account);
  const rewriteEngagement = scorePostEngagement(rewritePrepared.body, { products });
  const rewriteQualityGate = evaluatePostQualityGate(rewriteEngagement);
  const rewriteRejectedReasons = [
    rewriteRisk.riskLevel === 'high' || rewrite.riskLevel === 'high' ? 'high_risk' : '',
    !rewriteGuardrail.allowed ? 'guardrail_blocked' : '',
    !rewriteStyleFit.allowed ? 'style_blocked' : '',
    !rewriteQualityGate.passed ? 'quality_gate_failed_after_rewrite' : ''
  ].filter(Boolean);

  if (rewriteRejectedReasons.length) {
    await logActivity({
      ...logContext,
      action: 'post_quality_rewrite_rejected',
      level: 'warn',
      message: rewriteRejectedReasons.join(', '),
      payload: {
        originalScore: engagement.engagementScore,
        rewriteScore: rewriteEngagement.engagementScore,
        originalReasons: qualityGate.reasons,
        rewriteReasons: rewriteQualityGate.reasons,
        guardrailReasons: rewriteGuardrail.reasons,
        styleReasons: rewriteStyleFit.reasons,
        changeSummary: rewrite.changeSummary || ''
      }
    });
    return {
      rewritten: false,
      rewriteAttempted: true,
      rewriteRejected: true,
      rewriteRejectedReasons,
      rewriteQualityGate,
      body,
      contentType,
      riskLevel,
      engagement,
      qualityGate
    };
  }

  await logActivity({
    ...logContext,
    action: 'post_quality_rewrite_used',
    level: 'info',
    message: rewrite.changeSummary || '품질 기준에 맞게 후보를 재작성했습니다.',
    payload: {
      originalScore: engagement.engagementScore,
      rewriteScore: rewriteEngagement.engagementScore,
      originalReasons: qualityGate.reasons,
      rewriteReasons: rewriteQualityGate.reasons,
      changeSummary: rewrite.changeSummary || ''
    }
  });

  return {
    rewritten: true,
    rewriteAttempted: true,
    body: rewritePrepared.body,
    contentType: rewriteContentType,
    riskLevel: rewrite.riskLevel || rewriteRisk.riskLevel,
    engagement: rewriteEngagement,
    qualityGate: rewriteQualityGate,
    rewriteSummary: rewrite.changeSummary || ''
  };
}

export async function generatePosts(topicId) {
  const topic = await dbGet('topics', { id: topicId });
  const account = await getAccount(topic.account_id);
  const referenceContext = await buildReferencePatternContext(account, { limit: 5 });
  const performanceSignals = await buildAccountPerformanceSignals(account.id);
  const accountForPrompt = {
    ...account,
    referencePatterns: referenceContext.patterns,
    referencePatternMix: referenceContext.mix,
    performanceSignals
  };
  const selectedRows = await dbList('post_products', { topic_id: topicId });
  const selected = (await Promise.all(selectedRows.map(async (row) => {
    const product = await dbGet('coupang_products', { id: row.product_id });
    return product && isRealCoupangProduct(product) ? { ...product, recommendation_reason: row.recommendation_reason, fit_score: row.fit_score, rank: row.rank } : null;
  }))).filter(Boolean);
  const recentBodies = await buildRecentBodyContext(topic.account_id, topic.id);
  const recentPosts = await buildRecentPostContext(topic.account_id, topic.id);
  const contentDiversityPlan = buildContentDiversityPlan({
    topic,
    account: accountForPrompt,
    recentPosts,
    performanceSignals
  });
  accountForPrompt.contentDiversityPlan = contentDiversityPlan;
  const fallback = {
    posts: [{
      contentType: getFallbackContentType(accountForPrompt),
      body: buildChoiceTensionFallback(topic, accountForPrompt, selected, { recentBodies }),
      riskLevel: 'low'
    }]
  };
  const result = await getJson(generatePostsPrompt(topic, selected, accountForPrompt), fallback, {
    schemaName: 'generate_posts',
    validate: validatePostsResponse,
    logContext: {
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id
    },
    temperature: 0.85
  });
  const candidates = [];
  const rejectedCandidates = [];
  for (const item of result.posts || []) {
    let { risk, prepared } = preparePostBodyCandidate(item.body, account);
    let contentTypeToSave = item.contentType || getFallbackContentType(account);
    let strategyMeta = resolveContentStrategyMetadata(item, prepared.body, contentTypeToSave);
    const rejectionReasons = [];
    if (!prepared.body || prepared.body.length < 20) {
      ({ risk, prepared } = preparePostBodyCandidate(buildChoiceTensionFallback(topic, account, selected, { recentBodies }), account));
      prepared.warnings.push('fallback_body_used_after_cta_cleanup');
      strategyMeta = resolveContentStrategyMetadata(item, prepared.body, contentTypeToSave);
    }
    if (prepared.warnings.length) {
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_quality_adjusted',
        level: 'info',
        message: prepared.warnings.join(', '),
        payload: { contentType: item.contentType, warnings: prepared.warnings }
      });
    }

    const hookScore = scorePostHook(prepared.body);
    const shortReachFormat = isShortReachFormat(strategyMeta.contentFormat, strategyMeta.contentGoal);
    if (!hookScore.strong && !shortReachFormat) {
      const strengthened = preparePostBodyCandidate(strengthenPostHook(prepared.body, topic, account), account);
      const strengthenedMeta = resolveContentStrategyMetadata(item, strengthened.prepared.body, contentTypeToSave);
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_hook_strengthened',
        level: 'info',
        message: '첫 문장 후킹 신호가 약해 공감/댓글 유도형 훅으로 강화했습니다.',
        payload: {
          originalFirstSentence: hookScore.firstSentence,
          nextFirstSentence: scorePostHook(strengthened.prepared.body).firstSentence,
          checks: hookScore.checks
        }
      });
      risk = strengthened.risk;
      prepared = strengthened.prepared;
      strategyMeta = strengthenedMeta;
    }

    const guardrail = validatePostCandidate(prepared.body, account, topic);
    if (!guardrail.allowed) {
      rejectionReasons.push('guardrail_blocked');
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_guardrail_blocked',
        level: 'warn',
        message: guardrail.reasons.join('; '),
        payload: { contentType: item.contentType, body: prepared.body, context: guardrail.context }
      });
      rejectedCandidates.push({
        contentType: contentTypeToSave,
        engagement: scorePostEngagement(prepared.body, { products: selected }),
        rejected: true,
        rejectionReasons
      });
      continue;
    }
    const styleFit = validatePostStyleFit(prepared.body, account);
    if (!styleFit.allowed) {
      const originalBody = prepared.body;
      let rewriteAction = 'post_style_blocked';
      let nextCandidate = preparePostBodyCandidate(strengthenPostHook(originalBody, topic, account), account);
      let nextPrepared = nextCandidate.prepared;
      let nextStyleFit = validatePostStyleFit(nextPrepared.body, account);

      if (!nextStyleFit.allowed || nextCandidate.risk.riskLevel === 'high') {
        nextCandidate = preparePostBodyCandidate(
          buildChoiceTensionFallback(topic, account, selected, { recentBodies, formatStyle: 'experience_question' }),
          account
        );
        nextPrepared = nextCandidate.prepared;
        nextStyleFit = validatePostStyleFit(nextPrepared.body, account);
      }

      if (nextStyleFit.allowed && nextCandidate.risk.riskLevel !== 'high') {
        rewriteAction = 'post_style_rewritten';
      }

      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: rewriteAction,
        level: 'info',
        message: styleFit.reasons.join('; '),
        payload: {
          contentType: item.contentType,
          originalBody,
          fallbackBody: nextPrepared.body,
          reasons: styleFit.reasons,
          fallbackReasons: nextStyleFit.reasons,
          contentMode: styleFit.profile.strategy.effectiveMode
        }
      });
      if (!nextStyleFit.allowed || nextCandidate.risk.riskLevel === 'high') {
        rejectionReasons.push('style_blocked');
        rejectedCandidates.push({
          contentType: contentTypeToSave,
          engagement: scorePostEngagement(originalBody, { products: selected }),
          rejected: true,
          rejectionReasons
        });
        continue;
      }
      risk = nextCandidate.risk;
      prepared = nextPrepared;
      contentTypeToSave = getFallbackContentType(account);
      strategyMeta = resolveContentStrategyMetadata(item, prepared.body, contentTypeToSave);
    }
    if (risk.riskLevel === 'high' || item.riskLevel === 'high') {
      rejectionReasons.push('high_risk');
      rejectedCandidates.push({
        contentType: contentTypeToSave,
        engagement: scorePostEngagement(prepared.body, { products: selected }),
        rejected: true,
        rejectionReasons
      });
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_candidate_rejected',
        level: 'warn',
        message: '고위험 후보를 저장 대상에서 제외했습니다.',
        payload: { contentType: contentTypeToSave, rejectionReasons }
      });
      continue;
    }
    const engagement = scorePostEngagement(prepared.body, { products: selected });
    const patternQuality = assessContentPatternQuality(prepared.body, recentBodies);
    if (!patternQuality.allowed) {
      rejectionReasons.push(...patternQuality.reasons);
      rejectedCandidates.push({
        contentType: contentTypeToSave,
        engagement,
        rejected: true,
        rejectionReasons,
        patternQuality
      });
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_pattern_blocked',
        level: 'warn',
        message: patternQuality.reasons.join('; '),
        payload: { contentType: contentTypeToSave, body: prepared.body, patternQuality }
      });
      continue;
    }
    const qualityGate = evaluatePostQualityGate(engagement);
    const rewriteResult = await tryRewriteCandidateForQuality({
      body: prepared.body,
      contentType: contentTypeToSave,
      riskLevel: item.riskLevel || risk.riskLevel,
      engagement,
      qualityGate,
      topic,
      account: accountForPrompt,
      products: selected,
      logContext: {
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id
      }
    });
    candidates.push(applyContentPlanBias(applyFormatDiversityPenalty(applySimilarityPenalty({
      item,
      body: rewriteResult.body,
      contentType: rewriteResult.contentType,
      ...resolveContentStrategyMetadata(item, rewriteResult.body, rewriteResult.contentType),
      riskLevel: rewriteResult.riskLevel,
      status: 'draft',
      engagement: rewriteResult.engagement,
      qualityGate: rewriteResult.qualityGate,
      qualityRewriteAttempted: Boolean(rewriteResult.rewriteAttempted),
      qualityRewriteUsed: Boolean(rewriteResult.rewritten),
      qualityRewriteSummary: rewriteResult.rewriteSummary || '',
      qualityRewriteRejected: Boolean(rewriteResult.rewriteRejected),
      qualityRewriteRejectedReasons: rewriteResult.rewriteRejectedReasons || [],
      rejected: false,
      rejectionReasons: []
    }, recentBodies), recentPosts), contentDiversityPlan));
  }

  if (!candidates.some(isStableHumanlikeCandidate)) {
    const { risk: fallbackRisk, prepared: fallbackPrepared } = preparePostBodyCandidate(buildChoiceTensionFallback(topic, account, selected, { recentBodies }), account);
    const fallbackGuardrail = validatePostCandidate(fallbackPrepared.body, account, topic);
    const fallbackStyleFit = validatePostStyleFit(fallbackPrepared.body, account);
    if (fallbackGuardrail.allowed && fallbackStyleFit.allowed && fallbackRisk.riskLevel !== 'high') {
      const fallbackEngagement = scorePostEngagement(fallbackPrepared.body, { products: selected });
      const fallbackCandidate = {
        item: { contentType: getFallbackContentType(account), riskLevel: fallbackRisk.riskLevel },
        body: fallbackPrepared.body,
        contentType: getFallbackContentType(account),
        ...resolveContentStrategyMetadata({}, fallbackPrepared.body, getFallbackContentType(account)),
        riskLevel: fallbackRisk.riskLevel,
        status: 'draft',
        engagement: fallbackEngagement,
        qualityGate: evaluatePostQualityGate(fallbackEngagement),
        rejected: false,
        rejectionReasons: [],
        fallbackUsed: true
      };
      candidates.push(applyContentPlanBias(applyFormatDiversityPenalty(applySimilarityPenalty(fallbackCandidate, recentBodies), recentPosts), contentDiversityPlan));
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_engagement_fallback_used',
        level: 'info',
        message: '후보가 안정형 생활 장면 기준에 못 미쳐 사람 말투 fallback을 추가했습니다.',
        payload: {
          threshold: STABLE_HUMANLIKE_SCORE,
          fallbackScore: fallbackEngagement.engagementScore,
          candidateScores: candidates.map((candidate, index) => candidateScoreSummary(candidate, index, false))
        }
      });
    }
  }

  const stableCandidates = candidates.filter(isStableHumanlikeCandidate);
  const qualityPassedCandidates = candidates.filter((candidate) => {
    const qualityGate = candidate.qualityGate || evaluatePostQualityGate(candidate.engagement);
    return qualityGate.passed;
  });
  const nonCriticalCandidates = candidates.filter((candidate) => {
    const qualityGate = candidate.qualityGate || evaluatePostQualityGate(candidate.engagement);
    return qualityGate.severity !== 'critical';
  });
  const selectableCandidates = stableCandidates.length
    ? stableCandidates
    : (qualityPassedCandidates.length ? qualityPassedCandidates : nonCriticalCandidates);
  const ranked = selectableCandidates
    .slice()
    .sort((a, b) => (b.adjustedScore ?? b.engagement.engagementScore) - (a.adjustedScore ?? a.engagement.engagementScore));
  const best = ranked[0];
  if (!best) return [];

  const allCandidates = [...candidates, ...rejectedCandidates];
  const selectedIndex = allCandidates.indexOf(best);
  const candidateScores = allCandidates.map((candidate, index) => candidateScoreSummary(candidate, index, index === selectedIndex));
  const referencePatternIds = referenceContext.patterns.map((pattern) => pattern.sourceId).filter(Boolean);
  const publicReferencePatternIds = referencePatternIds.map(publicPatternIdFromSourceId).filter(Boolean);
  const metadata = {
    contentFormat: best.contentFormat,
    contentGoal: best.contentGoal,
    lengthBucket: best.formatDiversity?.lengthBucket || null,
    engagementScore: best.engagement.engagementScore,
    engagementPattern: best.engagement.engagementPattern,
    selectionReasons: best.engagement.selectionReasons,
    rubric: best.engagement.rubric,
    qualityGate: best.qualityGate || evaluatePostQualityGate(best.engagement),
    qualityRewriteUsed: Boolean(best.qualityRewriteUsed),
    qualityRewriteAttempted: Boolean(best.qualityRewriteAttempted),
    qualityRewriteReasons: best.qualityGate?.reasons || [],
    qualityRewriteSummary: best.qualityRewriteSummary || '',
    rejectedCandidateCount: rejectedCandidates.length + candidates.filter((candidate) => candidate !== best).length,
    candidateScores,
    selectedFormatDiversity: best.formatDiversity || null,
    contentDiversityPlan,
    selectedContentPlanFit: best.contentPlanFit || null,
    fallbackUsed: Boolean(best.fallbackUsed),
    referencePatternMix: referenceContext.mix,
    referencePatternIds,
    publicReferencePatternIds,
    referencePatternQuality: referenceContext.patterns.map((pattern) => ({
      sourceId: pattern.sourceId,
      qualityScore: Number(pattern.qualityScore || 0),
      matchedReasons: pattern.analysisProfile?.qualityReasons || [],
      bestFor: pattern.analysisProfile?.bestFor || [],
      previewDerived: Array.isArray(pattern.previewPosts) && pattern.previewPosts.length > 0
    })),
    referencePatternMatchedReasons: referenceContext.matchedReasons || [],
    referencePatternCount: referenceContext.patterns.length,
    publicReferencePatternCount: referenceContext.publicPatternCount,
    personalReferencePatternCount: referenceContext.personalPatternCount
  };
  metadata.visualPlan = await resolveVisualPlanImage(buildPostVisualPlan({
    post: best,
    topic,
    account,
    products: selected,
    recentPosts
  }), { post: best, topic, account });

  for (const [index, candidate] of allCandidates.entries()) {
    if (candidate === best) continue;
    await logActivity({
      account_id: topic.account_id,
      project_id: topic.project_id,
      topic_id: topic.id,
      action: 'post_candidate_rejected',
      level: candidate.rejected ? 'warn' : 'info',
      message: candidate.rejectionReasons?.length
        ? candidate.rejectionReasons.join(', ')
        : '댓글 유도 점수가 더 높은 후보가 선택되어 저장하지 않았습니다.',
      payload: candidateScoreSummary(candidate, index, false)
    });
  }

  const inserted = await dbInsert('posts', {
    project_id: topic.project_id,
    account_id: topic.account_id,
    topic_id: topic.id,
    content_type: best.contentType,
    body: best.body,
    risk_level: best.riskLevel,
    status: best.status,
    metadata
  });

  await logActivity({
    account_id: topic.account_id,
    project_id: topic.project_id,
    topic_id: topic.id,
    action: 'post_candidate_selected',
    level: 'info',
    message: `댓글 유도 점수 ${best.engagement.engagementScore}점 후보를 저장했습니다.`,
    payload: metadata
  });

  return [inserted];
}

export const listPosts = (accountId) => dbList('posts', { account_id: accountId }, { order: 'created_at' });
