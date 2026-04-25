export function repurposeContentPrompt(post) {
  return [
    { role: 'system', content: 'Repurpose Korean Threads content. Return strict JSON only.' },
    { role: 'user', content: JSON.stringify({ post, schema: { variants: [{ contentType: 'string', body: 'string' }] } }) }
  ];
}
