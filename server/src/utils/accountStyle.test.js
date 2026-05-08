import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccountStyleProfile, scorePostHook, strengthenPostHook, validatePostStyleFit } from './accountStyle.js';

test('scores strong hook signals in the first sentence', () => {
  const score = scorePostHook('이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.\n\n기준만 잡으면 쉬워요.');

  assert.equal(score.strong, true);
  assert.equal(score.checks.concreteInconvenience, true);
});

test('strengthens weak first sentence with a safer engagement hook', () => {
  const body = '좋은 제품을 고르는 방법입니다.\n\n기준을 보면 됩니다.';
  const strengthened = strengthenPostHook(body, {
    title: '수납함 고르는 기준',
    angle: '뚜껑과 크기'
  }, {
    content_mode: 'empathy',
    target_audience: '자취생',
    content_scope: '자취 생활용품'
  });

  assert.notEqual(strengthened, body);
  assert.equal(scorePostHook(strengthened).strong, true);
});

test('blocks hostile safe-debate framing', () => {
  const result = validatePostStyleFit('남자들은 이런 거 못 고르더라.\n\n여러분은 어느 쪽이에요?', {
    content_mode: 'safe_debate',
    safe_debate_enabled: true,
    target_audience: '생활용품 관심 고객',
    content_scope: '생활용품'
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('비하/혐오/조롱')));
});

test('exposes strong-hook guidance in the account style profile', () => {
  const profile = getAccountStyleProfile({
    content_mode: 'question',
    target_audience: '살림 관심 고객',
    content_scope: '살림용품'
  });

  assert.equal(profile.strategy.effectiveMode, 'question');
  assert.ok(profile.rules.some((rule) => rule.includes('question')));
});
