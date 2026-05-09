export function extractTrendPatternsPrompt({ query = '', samples = [] } = {}) {
  return [
    {
      role: 'system',
      content: [
        'Extract reusable Korean Threads content patterns.',
        'Return strict JSON only.',
        'Do not copy source sentences.',
        'Summarize hook structure, safe comment question, mild choice tension, emotion signal, reusable structure, voice rhythm, line breaks, list format, punctuation habits, and tone register.',
        'The goal is to imitate the feel, pacing, and format without storing or reusing exact wording.',
        'Flag unsafe political, hateful, insulting, gender/age conflict, or fearmongering frames.'
      ].join(' ')
    },
    {
      role: 'user',
      content: JSON.stringify({
        query,
        samples,
        schema: {
          patterns: [{
            sourceId: 'string',
            hookPattern: 'string',
            commentQuestion: 'string',
            tensionType: 'choice | habit | space | budget | frequency | use_case | empathy | checklist',
            emotionSignal: 'string',
            reusableStructure: 'string',
            voicePattern: 'string',
            formatPattern: 'string',
            lineBreakPattern: 'string',
            listStructure: 'string',
            punctuationStyle: 'string',
            toneRegister: 'string',
            safetyFlags: ['string']
          }]
        }
      })
    }
  ];
}
