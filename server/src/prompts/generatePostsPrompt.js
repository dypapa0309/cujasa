export function generatePostsPrompt(topic, products, account) {
  return [
    { role: 'system', content: 'You write short Korean Threads posts. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        account: { name: account.name, tone: account.tone, ctaStyle: account.cta_style },
        topic,
        selectedProducts: products.map((p) => ({ name: p.product_name, reason: p.recommendation_reason })),
        rules: [
          'Strong first sentence',
          'Short sentences',
          'Minimize ad tone',
          'Do not overuse product names',
          'Avoid 100%, 무조건, 완벽, 보장, 치료, 예방'
        ],
        contentTypes: ['공감형', '문제 해결형', '체크리스트형', '질문형', '일상형'],
        schema: { posts: [{ contentType: 'string', body: 'string', riskLevel: 'low | medium | high' }] }
      })
    }
  ];
}
