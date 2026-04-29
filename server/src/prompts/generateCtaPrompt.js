export function generateCtaPrompt(post, account) {
  return [
    { role: 'system', content: 'Generate quiet Korean comment helper text for affiliate replies. Return strict JSON only. Do not use pushy link CTA language.' },
    {
      role: 'user',
      content: JSON.stringify({
        postBody: post.body,
        accountTone: account.tone,
        style: account.cta_style,
        count: 3,
        rules: [
          'Do not say 링크는 댓글에, 아래 링크, 최저가, 구매하세요, 자세한 건 링크.',
          'Keep it optional and low-pressure.',
          'The actual URL and ad disclosure are added separately by the uploader.'
        ],
        schema: { ctas: [{ variantKey: 'A', ctaText: 'string' }] }
      })
    }
  ];
}
