import assert from 'node:assert/strict';
import test from 'node:test';
import { buildChoiceTensionFallback, buildHumanStyleFallback, scorePostEngagement } from './postEngagementScoring.js';

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

  assert.match(body, /1\./);
  assert.match(body, /제일 먼저/);
  assert.equal(score.engagementPattern, 'choice_tension');
  assert.equal(score.checks.livedInStructure, true);
  assert.equal(score.checks.concreteCriteria, true);
  assert.ok(score.engagementScore >= 82);
});

test('choice tension fallback removes account login ids from topic titles', () => {
  const body = buildChoiceTensionFallback(
    { title: 'lovehyun45 냄새 줄이는 법', angle: '생활 속 원인부터 잡기' },
    { name: 'lovehyun45', account_handle: '@lovehyun45', content_scope: '생활 냄새 관리' }
  );

  assert.doesNotMatch(body, /lovehyun45/i);
  assert.match(body, /냄새 줄이는 법/);
  assert.match(body, /1\./);
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

test('does not treat product model numbers as account id leaks', () => {
  const body = '주방 수납장은 막상 들이면 깊이감이 제일 먼저 보이더라고요.\n\nLPM 1200 같은 모델명보다 우리 집 조리대 옆 폭이 먼저예요.\n\n여러분은 넉넉한 수납 쪽을 보세요, 딱 맞는 크기 쪽을 보세요?';
  const score = scorePostEngagement(body);

  assert.equal(score.checks.accountTokenLeak, false);
  assert.ok(score.engagementScore >= 60);
});

test('human style fallback matches the target lived-in post shape', () => {
  const body = buildHumanStyleFallback(
    { title: '자취생을 위한 집기 추천', angle: '처음 살 때 체감되는 기준' },
    { content_scope: '자취 생활 집기', target_audience: '자취생' }
  );
  const score = scorePostEngagement(body);

  assert.match(body, /어디에 둘지/);
  assert.match(body, /1\. 설거지 끝나고 바로 내려둘 자리/);
  assert.match(body, /빨래 돌리기 전 잠깐 모아둘 바구니 자리/);
  assert.match(body, /처음 자취할 때/);
  assert.equal(score.checks.livedInStructure, true);
  assert.equal(score.checks.concreteCriteria, true);
  assert.equal(score.checks.microDetail, true);
  assert.equal(score.checks.saveWorthiness, true);
  assert.equal(score.checks.humanWarmth, true);
  assert.equal(score.checks.shallowChecklist, false);
  assert.equal(score.checks.safe, true);
  assert.ok(score.engagementScore >= 82);
});

test('penalizes shallow checklist without lived-in micro details', () => {
  const shallow = '자취생을 위한 집기 추천 고를 때는 처음 눈에 띄는 것보다 계속 쓸 상황을 먼저 보는 게 좋더라고요.\n\n1. 자주 쓰는지\n2. 보관이 쉬운지\n3. 관리가 부담 없는지\n\n여러분은 셋 중에 뭐가 제일 중요해요?';
  const score = scorePostEngagement(shallow);

  assert.equal(score.checks.genericTemplate, true);
  assert.equal(score.checks.microDetail, false);
  assert.equal(score.checks.shallowChecklist, true);
  assert.ok(score.rubric.shallowChecklistPenalty < 0);
  assert.ok(score.engagementScore < 70);
});
