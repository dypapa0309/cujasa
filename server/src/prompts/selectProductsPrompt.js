import { getContentGuardrailContext } from '../utils/contentGuardrails.js';
import { getAccountStyleProfile } from '../utils/accountStyle.js';

export function selectProductsPrompt(topic, products, account = null) {
  const contentContext = getContentGuardrailContext();
  const accountProfile = account ? getAccountStyleProfile(account) : null;
  return [
    { role: 'system', content: 'You evaluate Coupang products for Korean social commerce posts. Return strict JSON only. Account target, content scope, and tone are hard requirements.' },
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
          keyword: p.keyword
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
          'no diet/supplement/medicine/guaranteed-effect products'
        ],
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
