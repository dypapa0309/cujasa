import { getJson } from './openaiService.js';
import { getAccount } from './accountService.js';
import { dbGet, dbInsert, dbList, logActivity } from './supabaseService.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';
import { checkAndRewriteRisk } from './riskService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { buildFallbackPostBody, scorePostHook, strengthenPostHook, validatePostStyleFit } from '../utils/accountStyle.js';
import { prepareGeneratedPostBody } from '../utils/koreanContentQuality.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';
import { validatePostsResponse } from '../utils/aiResponseSchemas.js';
import { buildChoiceTensionFallback, scorePostEngagement } from '../utils/postEngagementScoring.js';
import { buildReferencePatternContext, publicPatternIdFromSourceId } from './trendReferenceLearningService.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';
import { sanitizePostBody } from '../utils/contentText.js';

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
    engagementPattern: candidate.engagement?.engagementPattern || null,
    rubric: candidate.engagement?.rubric || {},
    selected,
    rejected: Boolean(candidate.rejected),
    rejectionReasons: candidate.rejectionReasons || []
  };
}

function isStableHumanlikeCandidate(candidate) {
  const engagement = candidate?.engagement;
  return engagement?.engagementScore >= STABLE_HUMANLIKE_SCORE
    && engagement?.checks?.livedInStructure
    && engagement?.checks?.concreteCriteria
    && engagement?.checks?.microDetail
    && engagement?.checks?.saveWorthiness
    && !engagement?.checks?.shallowChecklist
    && !engagement?.checks?.genericTemplate
    && !engagement?.checks?.aiLikeTone
    && !engagement?.checks?.accountTokenLeak;
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
  const fallback = {
    posts: [{
      contentType: getFallbackContentType(accountForPrompt),
      body: buildFallbackPostBody(topic, accountForPrompt),
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
    }
  });
  const candidates = [];
  const rejectedCandidates = [];
  for (const item of result.posts || []) {
    let { risk, prepared } = preparePostBodyCandidate(item.body, account);
    let contentTypeToSave = item.contentType || getFallbackContentType(account);
    const rejectionReasons = [];
    if (!prepared.body || prepared.body.length < 20) {
      ({ risk, prepared } = preparePostBodyCandidate(buildFallbackPostBody(topic, account), account));
      prepared.warnings.push('fallback_body_used_after_cta_cleanup');
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
    if (!hookScore.strong) {
      const strengthened = preparePostBodyCandidate(strengthenPostHook(prepared.body, topic, account), account);
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
      const fallbackCandidate = preparePostBodyCandidate(buildChoiceTensionFallback(topic, account), account);
      const fallbackPrepared = fallbackCandidate.prepared;
      const fallbackStyleFit = validatePostStyleFit(fallbackPrepared.body, account);
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: fallbackStyleFit.allowed ? 'post_style_rewritten' : 'post_style_blocked',
        level: 'info',
        message: styleFit.reasons.join('; '),
        payload: {
          contentType: item.contentType,
          originalBody,
          fallbackBody: fallbackPrepared.body,
          reasons: styleFit.reasons,
          fallbackReasons: fallbackStyleFit.reasons,
          contentMode: styleFit.profile.strategy.effectiveMode
        }
      });
      if (!fallbackStyleFit.allowed) {
        rejectionReasons.push('style_blocked');
        rejectedCandidates.push({
          contentType: contentTypeToSave,
          engagement: scorePostEngagement(originalBody, { products: selected }),
          rejected: true,
          rejectionReasons
        });
        continue;
      }
      risk = fallbackCandidate.risk;
      prepared = fallbackPrepared;
      contentTypeToSave = getFallbackContentType(account);
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
    candidates.push({
      item,
      body: prepared.body,
      contentType: contentTypeToSave,
      riskLevel: item.riskLevel || risk.riskLevel,
      status: 'draft',
      engagement,
      rejected: false,
      rejectionReasons: []
    });
  }

  if (!candidates.some(isStableHumanlikeCandidate)) {
    const { risk: fallbackRisk, prepared: fallbackPrepared } = preparePostBodyCandidate(buildChoiceTensionFallback(topic, account), account);
    const fallbackGuardrail = validatePostCandidate(fallbackPrepared.body, account, topic);
    const fallbackStyleFit = validatePostStyleFit(fallbackPrepared.body, account);
    if (fallbackGuardrail.allowed && fallbackStyleFit.allowed && fallbackRisk.riskLevel !== 'high') {
      const fallbackEngagement = scorePostEngagement(fallbackPrepared.body, { products: selected });
      const fallbackCandidate = {
        item: { contentType: getFallbackContentType(account), riskLevel: fallbackRisk.riskLevel },
        body: fallbackPrepared.body,
        contentType: getFallbackContentType(account),
        riskLevel: fallbackRisk.riskLevel,
        status: 'draft',
        engagement: fallbackEngagement,
        rejected: false,
        rejectionReasons: [],
        fallbackUsed: true
      };
      candidates.push(fallbackCandidate);
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

  const selectableCandidates = candidates.some(isStableHumanlikeCandidate)
    ? candidates.filter(isStableHumanlikeCandidate)
    : candidates;
  const ranked = selectableCandidates
    .slice()
    .sort((a, b) => b.engagement.engagementScore - a.engagement.engagementScore);
  const best = ranked[0];
  if (!best) return [];

  const allCandidates = [...candidates, ...rejectedCandidates];
  const selectedIndex = allCandidates.indexOf(best);
  const candidateScores = allCandidates.map((candidate, index) => candidateScoreSummary(candidate, index, index === selectedIndex));
  const referencePatternIds = referenceContext.patterns.map((pattern) => pattern.sourceId).filter(Boolean);
  const publicReferencePatternIds = referencePatternIds.map(publicPatternIdFromSourceId).filter(Boolean);
  const metadata = {
    engagementScore: best.engagement.engagementScore,
    engagementPattern: best.engagement.engagementPattern,
    selectionReasons: best.engagement.selectionReasons,
    rubric: best.engagement.rubric,
    rejectedCandidateCount: rejectedCandidates.length + candidates.filter((candidate) => candidate !== best).length,
    candidateScores,
    fallbackUsed: Boolean(best.fallbackUsed),
    referencePatternMix: referenceContext.mix,
    referencePatternIds,
    publicReferencePatternIds,
    referencePatternCount: referenceContext.patterns.length,
    publicReferencePatternCount: referenceContext.publicPatternCount,
    personalReferencePatternCount: referenceContext.personalPatternCount
  };

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
