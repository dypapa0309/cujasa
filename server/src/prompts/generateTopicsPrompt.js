export function generateTopicsPrompt(account) {
  return [
    { role: 'system', content: 'You generate Korean affiliate content topics. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        task: 'Generate 8 high-intent Coupang Partners topics for this account.',
        account: {
          name: account.name,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words,
          tone: account.tone
        },
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
