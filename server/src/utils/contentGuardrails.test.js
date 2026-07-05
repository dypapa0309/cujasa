import assert from 'node:assert/strict';
import test from 'node:test';

import { validateGeneratedContent } from './contentGuardrails.js';

const petAccount = {
  name: '멍냥집사',
  content_scope: '반려동물 용품',
  target_audience: '강아지 고양이를 키우는 집사'
};

test('blocks off-scope mukbang topics for pet accounts', () => {
  const result = validateGeneratedContent('먹방 간식 고를 때 손에 묻지 않고 나눠 먹기 쉬운 쿠키 세트', petAccount);

  assert.equal(result.allowed, false);
  assert.equal(result.context.accountDomain, 'pet');
  assert.ok(result.reasons.some((reason) => reason.includes('계정 카테고리 불일치')));
});

test('allows pet snack pouch wording when the pet context is explicit', () => {
  const result = validateGeneratedContent('산책 가방에서 바로 꺼내는 강아지 간식 파우치와 배변봉투 케이스', petAccount);

  assert.equal(result.allowed, true);
});
