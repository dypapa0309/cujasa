import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function rewritePostQualityPrompt({ body = '', topic = {}, products = [], account = {}, engagement = {}, qualityGate = {} } = {}) {
  const accountProfile = getAccountStyleProfile(account);
  const referencePatterns = Array.isArray(account.referencePatterns) ? account.referencePatterns : [];
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
        referencePatterns: referencePatterns.map((pattern) => ({
          hookPattern: pattern.hookPattern,
          commentQuestion: pattern.commentQuestion,
          tensionType: pattern.tensionType,
          emotionSignal: pattern.emotionSignal,
          reusableStructure: pattern.reusableStructure,
          voicePattern: pattern.voicePattern,
          formatPattern: pattern.formatPattern,
          lineBreakPattern: pattern.lineBreakPattern,
          listStructure: pattern.listStructure,
          punctuationStyle: pattern.punctuationStyle,
          toneRegister: pattern.toneRegister,
          performanceScore: pattern.performanceScore,
          qualityScore: pattern.qualityScore,
          analysisProfile: pattern.analysisProfile,
          sourceType: pattern.sourceType || 'anonymous_pattern'
        })),
        quality: {
          score: engagement.engagementScore,
          pattern: engagement.engagementPattern,
          failedReasons: qualityGate.reasons || [],
          rewriteInstructions: qualityGate.rewriteInstructions || []
        },
        speechRegister: /반말|존댓말\s*금지/.test(String(account.tone || '').replace(/\s+/g, ''))
          ? {
            mode: 'banmal',
            rule: 'Use banmal only. Do not use 요, 죠, 네요, 세요, 입니다, 합니다, 됩니다, 이에요, 예요 endings anywhere.'
          }
          : {
            mode: 'polite_conversational',
            rule: 'Use one consistent polite conversational register. Prefer 해요체/죠/더라고요/같아요. Do not mix in banmal endings like 해, 했어, 같아, 뭐였어.'
          },
        rules: [
          'Keep the meaning aligned with topic and account.contentScope.',
          'Never include account names, login IDs, Threads handles, or @handles.',
          'Never mention links, profile links, comments with links, cheapest price, discount, special deal, or where to buy.',
          'Do not sound like an AI, blog article, balanced essay, or shopping recommendation.',
          /반말|존댓말\s*금지/.test(String(account.tone || '').replace(/\s+/g, ''))
            ? 'Speech register hard rule: banmal only. Never mix polite endings into a banmal account.'
            : 'Speech register hard rule: polite conversational Korean only. Never mix banmal endings into a polite account.',
          'Do not mix 반말 and 존댓말 in the same post.',
          referencePatterns.length
            ? 'Use approved referencePatterns as strong inspiration for pacing, line breaks, list shape, punctuation habits, tone register, hook pattern, and safe question style. Prioritize high qualityScore patterns that solve the failed qualityGate reasons. Do not copy source wording.'
            : 'No approved referencePatterns are available, so use the safe default CUJASA lived-in shape.',
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
