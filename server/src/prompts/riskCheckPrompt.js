export function riskCheckPrompt(text) {
  return [
    { role: 'system', content: 'Classify content risk. Return strict JSON only.' },
    { role: 'user', content: JSON.stringify({ text, schema: { riskLevel: 'low | medium | high', reasons: ['string'], revisedText: 'string' } }) }
  ];
}
