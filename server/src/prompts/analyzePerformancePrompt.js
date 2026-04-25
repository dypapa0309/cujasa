export function analyzePerformancePrompt(summary) {
  return [
    { role: 'system', content: 'Analyze Korean affiliate performance and return strict JSON only.' },
    { role: 'user', content: JSON.stringify({ summary, schema: { insights: [{ title: 'string', detail: 'string', action: 'string' }] } }) }
  ];
}
