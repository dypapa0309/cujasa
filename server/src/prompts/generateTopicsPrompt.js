import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function generateTopicsPrompt(account) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = getAccountStyleProfile(account);
  return [
    { role: 'system', content: 'You generate Korean affiliate content topics. Return strict JSON only. Account target, content scope, and tone are hard requirements, not optional hints.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Generate 8 high-intent Coupang Partners topics for this account.',
        contentContext,
        accountProfile,
        account: {
          name: account.name,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words,
          tone: account.tone
        },
        guardrails: [
          'Use currentDateKST and seasonKST as the only seasonal context.',
          'For spring/early-summer months, do not mention winter, cold wave, cold winter, thermal, padded jackets, gloves, or hot packs.',
          'Do not generate diet, supplement, medicine, treatment, prevention, or guaranteed-effect topics.',
          'stayWithinContentScope: topics must stay inside contentScope and targetAudience.',
          'Every topic title, angle, reason, and keyword must fit the accountProfile tone and contentScope.',
          'If tone includes review/emotional wording, topic angles must support that exact style instead of generic tips.',
          'Avoid all forbiddenTopics and forbiddenWords.'
        ],
        schema: {
          topics: [{
            title: 'string',
            angle: 'string',
            targetUser: 'string',
            reason: 'string',
            expectedIntent: 'low | medium | high',
            searchKeywords: ['string']
          }]
        }
      })
    }
  ];
}
