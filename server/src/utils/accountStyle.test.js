import assert from 'node:assert/strict';
import test from 'node:test';
import { getAccountStyleProfile, scorePostHook, strengthenPostHook, validatePostStyleFit } from './accountStyle.js';

test('auto content mode allows mixed content types without mode-specific blocking', () => {
  const profile = getAccountStyleProfile({
    content_mode: 'auto',
    target_audience: '2030 자취생',
    content_scope: '생활용품'
  });

  const result = validatePostStyleFit('자취 꿀템, 이건 상황마다 기준이 은근 갈리는 포인트예요.\n\n여러분은 편한 사용감 쪽이에요, 오래 쓰는 쪽이에요?', {
    content_mode: 'auto',
    target_audience: '2030 자취생',
    content_scope: '생활용품'
  });

  assert.equal(profile.strategy.effectiveMode, 'auto');
  assert.deepEqual(profile.strategy.allowedContentTypes, [
    '일상형',
    '공감형',
    '문제 해결형',
    '체크리스트형',
    '질문형',
    '공감 실패담형',
    '밈 카드형',
    '사지 말아야 할 기준형',
    '모음집 브릿지형'
  ]);
  assert.equal(result.allowed, true);
});

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

test('strengthened hooks do not expose account login ids', () => {
  const strengthened = strengthenPostHook('좋은 제품을 고르는 방법입니다.', {
    title: 'lovehyun45 냄새 줄이는 법',
    angle: '생활 속 원인'
  }, {
    name: 'lovehyun45',
    account_handle: '@lovehyun45',
    content_mode: 'empathy',
    target_audience: '생활용품 관심 고객',
    content_scope: '생활 냄새 관리'
  });

  assert.doesNotMatch(strengthened, /lovehyun45/i);
  assert.match(strengthened, /냄새 줄이는 법/);
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

test('blocks polite endings on banmal accounts', () => {
  const result = validatePostStyleFit('수납용품, 많이 사는 것보다 둘 자리를 먼저 정하면 덜 후회하더라고요.\n\n나는 현관 자리를 먼저 봐.', {
    tone: '반말',
    content_mode: 'auto',
    target_audience: '자취생',
    content_scope: '생활용품'
  });

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes('말투 불일치')));
});

test('allows consistent banmal on banmal accounts', () => {
  const result = validatePostStyleFit('수납용품, 많이 사는 것보다 둘 자리를 먼저 정하면 덜 후회해.\n\n나는 현관에서 바로 집는 물건 자리부터 봐.\n\n너는 어떤 기준 먼저 봐?', {
    tone: '반말',
    content_mode: 'auto',
    target_audience: '자취생',
    content_scope: '생활용품'
  });

  assert.equal(result.allowed, true);
});
