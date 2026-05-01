import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function selectProductsPrompt(topic, products, account = null) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = account ? getAccountStyleProfile(account) : null;
  return [
    { role: 'system', content: 'You evaluate Coupang products for Korean social commerce posts. Return strict JSON only. Account target, content scope, tone, season fit, and product diversity are hard requirements.' },
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
        products: products.map((p) => ({
          productId: p.product_id,
          productName: p.product_name,
          price: p.product_price,
          category: p.category_name,
          keyword: p.keyword,
          productGroup: p.product_group
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
