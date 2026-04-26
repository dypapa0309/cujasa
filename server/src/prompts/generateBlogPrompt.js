export function generateBlogPrompt(topic, products) {
  return [
    {
      role: 'system',
      content: `You are a Korean SEO blog writer. Write a detailed, natural-sounding Korean blog post. Return strict JSON only.`
    },
    {
      role: 'user',
      content: JSON.stringify({
        topic: { title: topic.title, angle: topic.angle, keywords: topic.search_keywords },
        products: products.map((p) => ({
          name: p.product_name,
          price: p.product_price,
          url: p.partner_url || p.product_url
        })),
        requirements: [
          '2000~3000자 분량',
          '구어체가 아닌 정보성 블로그 문체',
          '광고 느낌 없이 자연스럽게 상품 소개',
          'HTML 태그 사용 (h2, h3, p, ul, li, strong)',
          '상품 링크는 <a href="URL" target="_blank" rel="nofollow">상품명</a> 형태로 본문에 자연스럽게 삽입',
          '과장 표현(100%, 최고, 무조건 등) 금지',
          'SEO 키워드를 제목과 소제목에 자연스럽게 포함'
        ],
        schema: {
          title: '검색 최적화된 블로그 제목 (30~50자)',
          metaDescription: '검색 결과에 표시될 설명 (80~120자)',
          content: 'HTML 본문 전체'
        }
      })
    }
  ];
}
