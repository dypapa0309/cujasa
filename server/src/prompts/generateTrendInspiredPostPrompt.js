export function generateTrendInspiredPostPrompt({ query = '', contentScope = '', targetAudience = '', productCategory = '', patterns = [] } = {}) {
  return [
    {
      role: 'system',
      content: [
        'Write original Korean Threads posts inspired by reusable trend patterns.',
        'Return strict JSON only.',
        'Do not copy source sentences, proper nouns, handles, or distinctive exact phrasing.',
        'Strongly follow the reference feel: sentence length, line breaks, list shape, comparison markers, casual rhythm, and question style.',
        'The result should feel recognizably inspired by the source pattern, but not be a duplicate.',
        'Avoid polished explanatory essay tone. Do not sound like a report, blog article, or marketing summary.',
        'Prefer raw Korean Threads phrasing: short subjective observations, slightly unfinished endings, casual qualifiers like "뭔가", "살짝", "대체적으로", "느낌", and compact list lines.',
        'When the reference uses "label > observation" lines, produce a similar list format with new labels and new observations.',
        'Do not over-explain the meaning after the list. End with one short, easy comment question or a loose trailing line.',
        'Do not include links.',
        'Do not write salesy ad copy.',
        'Use safe comment-oriented hooks and mild preference questions.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        query,
        contentScope,
        targetAudience,
        productCategory,
        patterns,
        styleRules: [
          'No formal phrases like "경향이 있습니다", "영향을 미칩니다", "특징이 있습니다", "중시하는 경향".',
          'No broad sociological explanation. Write like a person posting a quick personal take.',
          'Use one-line observations more than paragraphs.',
          'If using a list, each line should be short and a little subjective.',
          'Keep the feeling close enough that readers think "this follows that format", while avoiding exact wording.'
        ],
        schema: {
          posts: [{
            contentType: 'string',
            body: 'string',
            patternSourceId: 'string'
          }]
        }
      })
    }
  ];
}
