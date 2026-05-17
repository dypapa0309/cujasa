import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPostVisualPlan,
  classifyContentBridge
} from './postVisualStrategy.js';

test('classifies normal-content-first visual roles', () => {
  assert.equal(classifyContentBridge('정리 전: 물건 때문에 좁음\n정리 후: 정리템 때문에 좁음 ㅋㅋ', '밈 카드형'), 'meme_card');
  assert.equal(classifyContentBridge('1. 틈새\n2. 접이식\n3. 문 뒤', '체크리스트형'), 'checklist_card');
  assert.equal(classifyContentBridge('사지 말아야 할 수납 기준 있음', '사지 말아야 할 기준형'), 'anti_recommendation');
});

test('visual plan attaches images by ratio without forcing every post', () => {
  const account = { id: 'acc', image_post_ratio: 1 };
  const post = {
    body: '정리 전엔 물건 때문에 좁고 정리 후엔 정리템 때문에 좁음 ㅋㅋ',
    contentType: '밈 카드형'
  };
  const noRecentPlan = buildPostVisualPlan({ post, topic: { id: 'topic' }, account });
  const overusedPlan = buildPostVisualPlan({
    post,
    topic: { id: 'topic' },
    account,
    recentPosts: [
      { metadata: { visualPlan: { attachImage: true } } },
      { metadata: { visualPlan: { attachImage: true } } },
      { metadata: { visualPlan: { attachImage: true } } }
    ]
  });

  assert.equal(noRecentPlan.attachImage, true);
  assert.equal(noRecentPlan.imageSourceType, 'generated_card');
  assert.equal(noRecentPlan.imageRisk, 'low');
  assert.match(noRecentPlan.imagePrompt, /Korean relatable meme-style text card/);
  assert.equal(overusedPlan.attachImage, false);
});

test('visual plan can use product image sparingly for collection bridge', () => {
  const product = { product_image: 'https://example.com/item.jpg', product_name: '틈새 수납장' };
  const plan = buildPostVisualPlan({
    post: {
      body: '좁은 방에서 덜 답답한 기준만 모아봄',
      contentType: '모음집 브릿지형'
    },
    topic: { id: 'topic-product-image', title: '수납 기준' },
    account: { id: 'acc-product-image', image_post_ratio: 1 },
    products: [product]
  });

  assert.equal(plan.attachImage, true);
  assert.ok(['generated_card', 'product_image'].includes(plan.imageSourceType));
  if (plan.imageSourceType === 'product_image') {
    assert.equal(plan.imageUrl, product.product_image);
    assert.equal(plan.imageRisk, 'medium');
  }
});
