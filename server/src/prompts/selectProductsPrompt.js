import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function selectProductsPrompt(topic, products, account = null, performanceSignals = null) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = account ? getAccountStyleProfile(account) : null;
  return [
    { role: 'system', content: 'You evaluate Coupang products for Korean social commerce posts. Return strict JSON only. Account target, content scope, tone, season fit, and product diversity are hard requirements. It is better to select fewer products than to force a weak match.' },
    {
      role: 'user',
      content: JSON.stringify({
        contentContext,
        accountProfile,
        account: account ? {
          name: account.name,
          targetAudience: account.target_audience,
          contentScope: account.content_scope,
          forbiddenTopics: account.forbidden_topics,
          forbiddenWords: account.forbidden_words
        } : null,
        topic,
        performanceSignals: performanceSignals ? {
          topProducts: performanceSignals.topProducts || [],
          topProductGroups: performanceSignals.topProductGroups || [],
          topTopics: performanceSignals.topTopics || []
        } : null,
        products: products.map((p) => ({
          productId: p.product_id,
          productName: p.product_name,
          price: p.product_price,
          category: p.category_name,
          keyword: p.keyword,
          productGroup: p.product_group,
          imagePresent: Boolean(p.product_image),
          productUrlPresent: Boolean(p.partner_url || p.product_url)
        })),
        criteria: [
          'relevance',
          'purchase intent',
          'low friction price',
          'natural content fit',
          'less ad-like',
          'current Korean season fit',
          'account target audience fit',
          'account content scope fit',
          'account tone fit',
          performanceSignals?.topProducts?.length
            ? 'When candidates are otherwise equally relevant, prefer products or product groups similar to historically high-click products.'
            : 'No reliable product click history is available yet, so judge fit from the current topic and account only.',
          'Do not select a high-click product group if it feels random for the current topic.',
          'only select products whose name, category, or keyword naturally matches the topic title, angle, search keyword, and account content scope',
          'reason must mention the concrete product type, the exact use situation in the post, and why it does not feel random for this topic',
          'recommendedUse must describe the role in content using a specific situation, not a generic label like 메인 추천 only',
          'if the product would feel random under the generated post, exclude it',
          'if there are multiple usable products, prefer the one with the clearest product-name match to the first two search keywords',
          'it is better to return fewer than three products than to fill weak products',
          'no diet/supplement/medicine/guaranteed-effect products',
          'choose a balanced set, not three near-identical items',
          'avoid selecting more than one item from the same productGroup when alternatives exist',
          'give each selected product a distinct role such as main gift, add-on gift, packaging/card, practical option, or emotional decor',
          'exclude off-season product names such as Christmas, winter, cold wave, heat-retention, padded clothing, gloves, or hot packs unless the current season is winter'
        ],
        schema: {
          selectedProducts: [{
            productId: 'string',
            fitScore: 0,
            reason: 'string',
            recommendedUse: 'string',
            productGroup: 'string'
          }]
        }
      })
    }
  ];
}
