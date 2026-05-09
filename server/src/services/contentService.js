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
import { buildReferencePatternContext } from './trendReferenceLearningService.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';
import { sanitizePostBody } from '../utils/contentText.js';

const MIN_ENGAGEMENT_SCORE = 60;

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
    const risk = checkAndRewriteRisk(item.body);
    let prepared = prepareGeneratedPostBody(risk.body);
    prepared = { ...prepared, body: sanitizePostBody(prepared.body, account) };
    let contentTypeToSave = item.contentType || getFallbackContentType(account);
    const rejectionReasons = [];
    if (!prepared.body || prepared.body.length < 20) {
      prepared = prepareGeneratedPostBody(buildFallbackPostBody(topic, account));
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
      const strengthened = prepareGeneratedPostBody(strengthenPostHook(prepared.body, topic, account));
      strengthened.body = sanitizePostBody(strengthened.body, account);
      await logActivity({
        account_id: topic.account_id,
        project_id: topic.project_id,
        topic_id: topic.id,
        action: 'post_hook_strengthened',
        level: 'info',
        message: '첫 문장 후킹 신호가 약해 공감/댓글 유도형 훅으로 강화했습니다.',
        payload: {
          originalFirstSentence: hookScore.firstSentence,
          nextFirstSentence: scorePostHook(strengthened.body).firstSentence,
          checks: hookScore.checks
        }
      });
      prepared = strengthened;
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
      const fallbackPrepared = prepareGeneratedPostBody(buildChoiceTensionFallback(topic, account));
      fallbackPrepared.body = sanitizePostBody(fallbackPrepared.body, account);
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

  if (!candidates.length || Math.max(...candidates.map((candidate) => candidate.engagement.engagementScore)) < MIN_ENGAGEMENT_SCORE) {
    const fallbackBody = prepareGeneratedPostBody(buildChoiceTensionFallback(topic, account)).body;
    const fallbackRisk = checkAndRewriteRisk(fallbackBody);
    const fallbackPrepared = prepareGeneratedPostBody(fallbackRisk.body);
    fallbackPrepared.body = sanitizePostBody(fallbackPrepared.body, account);
    const fallbackGuardrail = validatePostCandidate(fallbackPrepared.body, account, topic);
    const fallbackStyleFit = validatePostStyleFit(fallbackPrepared.body, account);
    if (fallbackGuardrail.allowed && fallbackStyleFit.allowed && fallbackRisk.riskLevel !== 'high') {
      const fallbackCandidate = {
        item: { contentType: getFallbackContentType(account), riskLevel: fallbackRisk.riskLevel },
        body: fallbackPrepared.body,
        contentType: getFallbackContentType(account),
        riskLevel: fallbackRisk.riskLevel,
        status: 'draft',
        engagement: scorePostEngagement(fallbackPrepared.body, { products: selected }),
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
        message: '후보 점수가 기준 미달이라 선택 갈림형 fallback을 사용했습니다.',
        payload: {
          threshold: MIN_ENGAGEMENT_SCORE,
          candidateScores: candidates.map((candidate, index) => candidateScoreSummary(candidate, index, false))
        }
      });
    }
  }

  const ranked = candidates
    .slice()
    .sort((a, b) => b.engagement.engagementScore - a.engagement.engagementScore);
  const best = ranked[0];
  if (!best) return [];

  const allCandidates = [...candidates, ...rejectedCandidates];
  const selectedIndex = allCandidates.indexOf(best);
  const candidateScores = allCandidates.map((candidate, index) => candidateScoreSummary(candidate, index, index === selectedIndex));
  const metadata = {
    engagementScore: best.engagement.engagementScore,
    engagementPattern: best.engagement.engagementPattern,
    selectionReasons: best.engagement.selectionReasons,
    rubric: best.engagement.rubric,
    rejectedCandidateCount: rejectedCandidates.length + candidates.filter((candidate) => candidate !== best).length,
    candidateScores,
    fallbackUsed: Boolean(best.fallbackUsed),
    referencePatternMix: referenceContext.mix,
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
