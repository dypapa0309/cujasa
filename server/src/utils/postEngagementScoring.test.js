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

  assert.match(body, /쪽이에요/);
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
  assert.match(body, /관리 쉬운 쪽/);
});
