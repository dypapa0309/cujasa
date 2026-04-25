export function selectProductsPrompt(topic, products) {
  return [
    { role: 'system', content: 'You evaluate Coupang products for Korean social commerce posts. Return strict JSON only.' },
    {
      role: 'user',
      content: JSON.stringify({
        topic,
        products: products.map((p) => ({
          productId: p.product_id,
          productName: p.product_name,
          price: p.product_price,
          category: p.category_name,
          keyword: p.keyword
        })),
        criteria: ['relevance', 'purchase intent', 'low friction price', 'natural content fit', 'less ad-like'],
        schema: {
          selectedProducts: [{
            productId: 'string',
            fitScore: 0,
            reason: 'string',
            recommendedUse: 'string'
          }]
        }
      })
    }
  ];
}
