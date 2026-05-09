import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function rewritePostQualityPrompt({ body = '', topic = {}, products = [], account = {}, engagement = {}, qualityGate = {} } = {}) {
  const accountProfile = getAccountStyleProfile(account);
  return [
    {
      role: 'system',
      content: 'Rewrite one Korean Threads post to pass a strict humanlike quality gate. Return strict JSON only.'
    },
    {
      role: 'user',
      content: JSON.stringify({
        originalBody: body,
        topic,
        account: {
          tone: account.tone,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words,
          contentStrategy: accountProfile.strategy
        },
        selectedProducts: products.map((product) => ({
          name: product.product_name || product.name,
          category: product.category_name,
          keyword: product.keyword,
          reason: product.recommendation_reason
        })),
        quality: {
          score: engagement.engagementScore,
          pattern: engagement.engagementPattern,
          failedReasons: qualityGate.reasons || [],
          rewriteInstructions: qualityGate.rewriteInstructions || []
        },
        rules: [
          'Keep the meaning aligned with topic and account.contentScope.',
          'Never include account names, login IDs, Threads handles, or @handles.',
          'Never mention links, profile links, comments with links, cheapest price, discount, special deal, or where to buy.',
          'Do not sound like an AI, blog article, balanced essay, or shopping recommendation.',
          'Use at least two small lived-in physical details or chores.',
          'Include one save-worthy tiny standard that helps the reader avoid regret.',
          'Use warm but plain Korean endings such as "덜 후회하더라고요", "먼저 티 나요", "저라면 여기부터 봐요".',
          'Use 2-5 short sentences. One easy experience question is allowed but not required.',
          'Do not make medical, diet, supplement, treatment, prevention, investment, legal, or guaranteed-effect claims.'
        ],
        schema: {
          body: 'string',
          contentType: 'string',
          changeSummary: 'string',
          riskLevel: 'low | medium | high'
        }
      })
    }
  ];
}
