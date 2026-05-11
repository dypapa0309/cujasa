import { getAccount } from './accountService.js';
import { buildReferencePatternContext } from './trendReferenceLearningService.js';
import { generateTrendInspiredPosts } from './trendPatternService.js';
import { scorePostEngagement } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { validatePostStyleFit } from '../utils/accountStyle.js';
import { dbList } from './supabaseService.js';
import { evaluateProductTopicMatch } from '../utils/productMatching.js';
import { buildReplyText } from '../platformAdapters/threadsAdapter.js';
import { assessContentPatternQuality } from '../utils/contentPatternQuality.js';

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

function keywordTokens(...values) {
  return [...new Set(values
    .join(' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 12))];
}

async function previewProductMatches(account, topic, body) {
  const candidates = await dbList('coupang_products', { account_id: account.id }, { order: 'created_at', ascending: false, limit: 80 });
  const keywords = keywordTokens(topic.title, topic.angle, account.content_scope, account.target_audience, body);
  const scored = candidates.map((product) => {
    const match = evaluateProductTopicMatch(product, {
      ...topic,
      search_keyword: keywords.join(' ')
    }, account, { body });
    return {
      product,
      match
    };
  }).sort((a, b) => b.match.score - a.match.score);
  const matches = scored.slice(0, 3).map(({ product, match }) => ({
    id: product.id,
    productId: product.product_id,
    name: product.product_name,
    price: product.product_price,
    image: product.product_image,
    partnerUrl: product.partner_url || product.product_url,
    group: match.group,
    score: match.score,
    matchReasons: match.matchReasons,
    riskReasons: match.riskReasons,
    linkable: match.linkable
  }));
  const selected = matches.find((match) => match.linkable) || null;
  return {
    searchKeywords: keywords.slice(0, 8),
    matches,
    selected,
    productLinkable: Boolean(selected),
    replyPreview: selected ? buildReplyText(selected.partnerUrl) : ''
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
  const peerBodies = posts.map((post) => post.body);
  const candidates = await Promise.all(posts.map(async (post, index) => {
    const engagement = scorePostEngagement(post.body);
    const qualityGate = evaluatePostQualityGate(engagement);
    const guardrail = validatePostCandidate(post.body, account, topic);
    const styleFit = validatePostStyleFit(post.body, account);
    const patternQuality = assessContentPatternQuality(post.body, peerBodies.filter((_, bodyIndex) => bodyIndex !== index));
    const productPreview = await previewProductMatches(account, topic, post.body);
    const productAllowed = input.productMentionStyle === 'none' || productPreview.productLinkable;
    const allowed = Boolean(post.allowed) && qualityGate.passed && guardrail.allowed && styleFit.allowed && productAllowed && patternQuality.allowed;
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
        ...(productAllowed ? [] : ['상품 매칭 실패']),
        ...(patternQuality.allowed ? [] : patternQuality.reasons),
        ...(post.safetyFlags || [])
      ].filter(Boolean),
      patternQuality,
      productPreview
    };
  }));
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
    productLinkable: Boolean(selected?.productPreview?.productLinkable)
  };
}
