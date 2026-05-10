import { getAccount } from './accountService.js';
import { buildReferencePatternContext } from './trendReferenceLearningService.js';
import { generateTrendInspiredPosts } from './trendPatternService.js';
import { scorePostEngagement } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { validatePostStyleFit } from '../utils/accountStyle.js';

function mergePreviewAccount(account = {}, input = {}) {
  return {
    ...account,
    target_audience: input.targetAudience || account.target_audience || '',
    content_scope: input.category || input.contentScope || account.content_scope || '',
    content_mode: input.contentMode || account.content_mode || 'auto',
    content_intensity: input.contentIntensity || account.content_intensity || 'normal',
    comment_induction_style: input.commentStyle || account.comment_induction_style || 'soft_question',
    product_mention_style: input.productMentionStyle || account.product_mention_style || 'natural',
    emoji_level: input.emojiLevel || account.emoji_level || 'low'
  };
}

function previewTopic(account, input = {}) {
  return {
    title: input.category || input.contentScope || account.content_scope || '생활용품',
    angle: input.angle || '생활 속 선택 기준',
    target_user: input.targetAudience || account.target_audience || ''
  };
}

export async function buildCujasaContentPreview(accountId, input = {}) {
  const baseAccount = await getAccount(accountId);
  if (!baseAccount) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const account = mergePreviewAccount(baseAccount, input);
  const topic = previewTopic(account, input);
  const reference = await buildReferencePatternContext(account, { limit: Number(input.patternLimit || 5) });
  const posts = await generateTrendInspiredPosts({
    query: topic.title,
    contentScope: account.content_scope,
    targetAudience: account.target_audience,
    productCategory: input.productCategory || account.content_scope,
    patterns: reference.patterns,
    useAi: input.useAi !== false
  });
  const candidates = posts.map((post, index) => {
    const engagement = scorePostEngagement(post.body);
    const qualityGate = evaluatePostQualityGate(engagement);
    const guardrail = validatePostCandidate(post.body, account, topic);
    const styleFit = validatePostStyleFit(post.body, account);
    const allowed = Boolean(post.allowed) && qualityGate.passed && guardrail.allowed && styleFit.allowed;
    return {
      ...post,
      index,
      allowed,
      selected: false,
      engagementScore: engagement.engagementScore,
      engagementPattern: engagement.engagementPattern,
      selectionReasons: engagement.selectionReasons,
      qualityGate,
      rejectionReasons: [
        ...(qualityGate.passed ? [] : qualityGate.reasons),
        ...(guardrail.allowed ? [] : guardrail.reasons),
        ...(styleFit.allowed ? [] : styleFit.reasons),
        ...(post.safetyFlags || [])
      ].filter(Boolean)
    };
  });
  const selected = candidates
    .filter((candidate) => candidate.allowed)
    .sort((a, b) => Number(b.engagementScore || 0) - Number(a.engagementScore || 0))[0] || null;
  if (selected) selected.selected = true;
  return {
    input: {
      accountId,
      category: topic.title,
      targetAudience: account.target_audience,
      contentMode: account.content_mode,
      contentIntensity: account.content_intensity,
      commentStyle: account.comment_induction_style,
      productMentionStyle: account.product_mention_style,
      emojiLevel: account.emoji_level
    },
    patternMix: reference.mix,
    patterns: reference.patterns.map((pattern) => ({
      sourceId: pattern.sourceId,
      sourceType: pattern.sourceType,
      hookPattern: pattern.hookPattern,
      qualityScore: Number(pattern.qualityScore || 0),
      matchedReasons: pattern.analysisProfile?.qualityReasons || []
    })),
    candidates,
    selectedIndex: selected?.index ?? -1,
    productLinkable: false
  };
}
