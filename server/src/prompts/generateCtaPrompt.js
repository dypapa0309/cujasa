export function generateCtaPrompt(post, account) {
  return [
    { role: 'system', content: 'Generate Korean CTA variants for affiliate comments. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        postBody: post.body,
        accountTone: account.tone,
        style: account.cta_style,
        count: 3,
        schema: { ctas: [{ variantKey: 'A', ctaText: 'string' }] }
      })
    }
  ];
}
