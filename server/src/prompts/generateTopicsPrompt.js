import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function generateTopicsPrompt(account, recentTopics = [], performanceSignals = null) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = getAccountStyleProfile(account);
  const recentTopicMemory = recentTopics.slice(0, 30).map((topic) => ({
    title: topic.title,
    angle: topic.angle,
    keywords: topic.search_keywords || []
  }));
  return [
    { role: 'system', content: 'You generate Korean affiliate content topics. Return strict JSON only. Account target, content scope, and tone are hard requirements, not optional hints.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Generate 8 high-intent Coupang Partners topics for this account.',
        contentContext,
        accountProfile,
        account: {
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words,
          tone: account.tone,
          contentStrategy: accountProfile.strategy
        },
        performanceSignals: performanceSignals ? {
          topTopics: performanceSignals.topTopics || [],
          topProducts: performanceSignals.topProducts || [],
          topProductGroups: performanceSignals.topProductGroups || [],
          guidance: performanceSignals.guidance || []
        } : null,
        recentTopicMemory,
        guardrails: [
          performanceSignals?.topTopics?.length
            ? 'Use performanceSignals to expand proven problem/product clusters, but do not repeat the same title or angle verbatim.'
            : 'No reliable click performance signals are available yet.',
          performanceSignals?.topProductGroups?.length
            ? 'Prefer adjacent purchasable product keywords near high-click product groups when they still fit contentScope.'
            : 'Do not invent performance claims without click signals.',
          'Avoid repeating recentTopicMemory titles, angles, hooks, and product keyword clusters.',
          'Never use the account name, login ID, Threads handle, or any @handle as a topic word. These are routing metadata, not content material.',
          'Distribute topic angles across problem-solving, checklist, comparison, mistake-prevention, small-space/occasion use, and relatable question frames when they fit contentScope.',
          'Do not generate eight topics with the same sentence pattern or the same purchase trigger.',
          accountProfile.strategy.seasonalityEnabled
            ? 'Use currentDateKST and seasonKST as the only seasonal context.'
            : 'Do not force seasonal context into topic titles or angles.',
          'For spring/early-summer months, do not mention winter, cold wave, cold winter, thermal, padded jackets, gloves, or hot packs.',
          'Do not generate diet, supplement, medicine, treatment, prevention, or guaranteed-effect topics.',
          'stayWithinContentScope: topics must stay inside contentScope and targetAudience.',
          'Every topic title, angle, reason, and keyword must fit the accountProfile tone and contentScope.',
          'Every searchKeywords item must be a concrete purchasable product noun that can be searched on Coupang and is likely to return real products with image, price, and URL.',
          'Do not use broad searchKeywords such as 생활용품, 실용적인 아이템, 가전 제품, 꿀템, 루틴, 방법, 추천템.',
          'Prefer specific Korean product terms such as 수납함, 접이식 테이블, 차량용 청소기, 미끄럼방지 매트, 멀티탭 정리함.',
          'Put the two strongest purchase-intent product keywords first because the pipeline searches the first keywords before trying repair.',
          'Generate 3-5 searchKeywords per topic and make each keyword meaningfully different by product type, not just adjective changes.',
          'Avoid abstract problem words as keywords; use the product a buyer would type into Coupang.',
          'If tone includes review/emotional wording, topic angles must support that exact style instead of generic tips.',
          'Avoid all forbiddenTopics and forbiddenWords.',
          ...accountProfile.rules
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
