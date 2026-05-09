import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChoiceTensionFallback, scorePostEngagement } from './postEngagementScoring.js';

test('scores safe choice questions higher than generic ad copy', () => {
  const choicePost = '좁은 주방 정리할 때 이건 은근 갈리더라고요.\n\n꺼내기 쉬운 쪽이 좋아요, 아니면 보기 깔끔한 쪽이 좋아요?';
  const adPost = 'Kleeno 접이식 수납장은 꼭 필요한 필수템입니다. 지금 구매하면 정리가 완벽해져요.';

  const choiceScore = scorePostEngagement(choicePost);
  const adScore = scorePostEngagement(adPost);

  assert.equal(choiceScore.engagementPattern, 'choice_tension');
  assert.ok(choiceScore.engagementScore > adScore.engagementScore);
  assert.ok(choiceScore.selectionReasons.includes('답하기 쉬운 질문'));
  assert.ok(choiceScore.rubric.hookScore > 0);
  assert.ok(choiceScore.rubric.commentEaseScore > adScore.rubric.commentEaseScore);
  assert.ok(adScore.rubric.adTonePenalty < 0);
});

test('penalizes unsafe conflict and heavy product repetition', () => {
  const unsafe = '남자들은 왜 이런 수납 기준을 못 고를까요? Kleeno 수납장 Kleeno 수납장 제품 추천합니다.';
  const score = scorePostEngagement(unsafe, {
    products: [{ product_name: 'Kleeno 수납장' }]
  });

  assert.equal(score.checks.safe, false);
  assert.equal(score.checks.productNatural, false);
  assert.ok(score.rubric.safetyPenalty < 0);
  assert.ok(score.rubric.productFitScore < 0);
  assert.ok(score.engagementScore < 50);
});

test('choice tension fallback is comment-oriented', () => {
  const body = buildChoiceTensionFallback(
    { title: '접이식 수납장', angle: '공간 절약' },
    { content_scope: '살림' }
  );
  const score = scorePostEngagement(body);

  assert.match(body, /쪽을 보세요/);
  assert.equal(score.engagementPattern, 'choice_tension');
  assert.ok(score.engagementScore >= 60);
});

test('choice tension fallback removes account login ids from topic titles', () => {
  const body = buildChoiceTensionFallback(
    { title: 'lovehyun45 냄새 줄이는 법', angle: '생활 속 원인부터 잡기' },
    { name: 'lovehyun45', account_handle: '@lovehyun45', content_scope: '생활 냄새 관리' }
  );

  assert.doesNotMatch(body, /lovehyun45/i);
  assert.match(body, /냄새 줄이는 법/);
  assert.match(body, /관리하기 쉬운 쪽/);
});

test('penalizes leaked account ids and generic template questions', () => {
  const bad = 'lovehyun45 냄새 줄이는 법, 이건 은근 기준이 갈리는 선택이에요.\n생활 속 원인부터 잡기를 먼저 보는 사람도 있고, 편하게 쓰는 쪽을 더 중요하게 보는 사람도 있더라고요.\n여러분은 이런 거 고를 때 실용성 쪽이에요, 아니면 편한 사용감 쪽이에요?';
  const score = scorePostEngagement(bad);

  assert.equal(score.checks.accountTokenLeak, true);
  assert.equal(score.checks.genericTemplate, true);
  assert.ok(score.rubric.accountTokenPenalty < 0);
  assert.ok(score.rubric.templatePenalty < 0);
  assert.ok(score.engagementScore < 60);
});

test('penalizes formal AI-like explanatory tone', () => {
  const formal = '수납함을 선택하는 것이 좋습니다.\n\n공간 활용에 도움이 됩니다.\n\n관리 기준을 고려해야 합니다.';
  const score = scorePostEngagement(formal);

  assert.equal(score.checks.aiLikeTone, true);
  assert.ok(score.rubric.aiTonePenalty < 0);
  assert.ok(score.engagementScore < 60);
});
