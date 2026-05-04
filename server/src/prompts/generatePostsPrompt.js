import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function generatePostsPrompt(topic, products, account) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = getAccountStyleProfile(account);
  return [
    { role: 'system', content: 'You write short, natural Korean Threads posts. Return strict JSON only. Account tone is a style guide, not a keyword checklist. Natural readability comes first.' },
    {
      role: 'user',
      content: JSON.stringify({
        contentContext,
        accountProfile,
        account: {
          name: account.name,
          tone: account.tone,
          ctaStyle: account.cta_style,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words
        },
        topic,
        selectedProducts: products.map((p) => ({
          name: p.product_name,
          category: p.category_name,
          price: p.product_price,
          keyword: p.keyword,
          reason: p.recommendation_reason
        })),
        rules: [
          'Use currentDateKST and seasonKST as the seasonal context.',
          'Do not mention off-season winter/cold-wave/thermal/padded/glove/hot-pack themes unless seasonKST is winter.',
          'Do not write diet, supplement, medicine, treatment, prevention, or guaranteed-effect content.',
          'stayWithinContentScope: keep every post inside the account contentScope.',
          'Make the first sentence naturally reflect the target reader and situation.',
          'Write for accountProfile.targetAudience, not a generic reader.',
          'Only use product/category situations inside accountProfile.contentScope.',
          'When selectedProducts exist, make the post situation naturally explain why those product categories solve the reader problem.',
          'Do not list unrelated generic categories. Anchor the post in the selected product use case.',
          'If tone contains 후기/review, use review-like observation without pretending actual personal use.',
          'If tone contains 설레/emotional, use subtle anticipation only when it fits. Do not force emotional keywords.',
          'Use natural Korean spacing and line breaks. Avoid awkward machine-translated phrasing.',
          'Use zero or one emoji at most. Never decorate every sentence with emoji.',
          'Do not use bland generic phrases if preferredExpressions are provided.',
          'Do not mention links, comments, profile links, prices, cheapest price, or where to buy in the post body.',
          'The post body must read like a normal standalone Threads post. CTA, link, and ad disclosure are handled separately in a reply.',
          'Strong first sentence',
          'Short sentences',
          'Minimize ad tone',
          'Do not overuse product names',
          'Avoid 100%, 무조건, 완벽, 보장, 치료, 예방'
        ],
        contentTypes: ['공감형', '문제 해결형', '체크리스트형', '질문형', '일상형'],
        schema: { posts: [{ contentType: 'string', body: 'string', styleChecklist: ['string'], riskLevel: 'low | medium | high' }] }
      })
    }
  ];
}
