import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildCujasaContentPreview } from './contentPreviewService.js';
import { dbInsert } from './supabaseService.js';

test('content preview can select a content candidate even when products are not cached', async () => {
  const account = await dbInsert('accounts', {
    id: randomUUID(),
    name: '미리보기 테스트 계정',
    platform: 'threads',
    account_handle: '@preview_test',
    target_audience: '처음 자취하는 20대',
    content_scope: '자취용품',
    forbidden_topics: [],
    forbidden_words: [],
    tone: '친근하고 실제 후기처럼 짧게',
    cta_style: '댓글 유도형',
    content_mode: 'auto',
    content_intensity: 'normal',
    comment_induction_style: 'choice_question',
    product_mention_style: 'natural',
    emoji_level: 'none',
    personal_reference_patterns: [],
    anonymous_learning_enabled: false,
    status: 'active',
    automation_status: 'paused'
  });

  const preview = await buildCujasaContentPreview(account.id, {
    category: '자취용품',
    targetAudience: '처음 자취하는 20대',
    productMentionStyle: 'natural',
    useAi: false
  });

  assert.ok(preview.selectedIndex >= 0);
  assert.equal(preview.productLinkable, false);
  assert.equal(preview.queueReady, false);
  const selected = preview.candidates.find((candidate) => candidate.selected);
  assert.equal(selected.allowed, true);
  assert.equal(selected.queueReady, false);
  assert.deepEqual(selected.productWarnings, ['상품 매칭 필요']);
  assert.ok(!selected.rejectionReasons.includes('상품 매칭 실패'));
});
