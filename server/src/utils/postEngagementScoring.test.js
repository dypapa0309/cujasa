import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildChoiceTensionFallback,
  buildHumanStyleFallback,
  resolveFallbackFormatStyle,
  scorePostEngagement,
  scorePostSimilarity
} from './postEngagementScoring.js';

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

  assert.match(body, /설거지 끝나고 바로 내려둘 자리|조리대 위에 올려도 손이 안 좁아지는지|자주 쓰는 순간에 바로 닿는지/);
  assert.equal(score.checks.livedInStructure, true);
  assert.equal(score.checks.concreteCriteria, true);
  assert.equal(score.checks.genericTemplate, false);
  assert.equal(score.checks.repetitiveFallback, false);
  assert.ok(score.engagementScore >= 82);
});

test('choice tension fallback removes account login ids from topic titles', () => {
  const body = buildChoiceTensionFallback(
    { title: 'lovehyun45 냄새 줄이는 법', angle: '생활 속 원인부터 잡기' },
    { name: 'lovehyun45', account_handle: '@lovehyun45', content_scope: '생활 냄새 관리' }
  );

  assert.doesNotMatch(body, /lovehyun45/i);
  assert.match(body, /냄새|자취템|생활용품|청소용품/);
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
    { content_scope: '자취 생활 집기', target_audience: '자취생' },
    [],
    { formatStyle: 'numbered' }
  );
  const score = scorePostEngagement(body);

  assert.match(body, /어디에 둘지/);
  assert.match(body, /설거지 끝나고 바로 내려둘 자리/);
  assert.match(body, /빨래 돌리기 전 잠깐 모아둘 바구니 자리/);
  assert.match(body, /처음 자취할 때/);
  assert.equal(score.checks.livedInStructure, true);
  assert.equal(score.checks.concreteCriteria, true);
  assert.equal(score.checks.microDetail, true);
  assert.equal(score.checks.saveWorthiness, true);
  assert.equal(score.checks.humanWarmth, true);
  assert.equal(score.checks.shallowChecklist, false);
  assert.equal(score.checks.genericTemplate, false);
  assert.equal(score.checks.repetitiveFallback, false);
  assert.equal(score.checks.safe, true);
  assert.ok(score.engagementScore >= 82);
});

test('human style fallback supports non-numbered save-worthy posts', () => {
  const body = buildHumanStyleFallback(
    { id: 'topic-1', title: '주방 정리템 고르는 기준', angle: '생활 속 원인부터 잡기' },
    { id: 'acc', content_scope: '주방용품', target_audience: '30대 주부' },
    [],
    { formatStyle: 'prose' }
  );
  const score = scorePostEngagement(body);

  assert.doesNotMatch(body, /^\s*1\./m);
  assert.doesNotMatch(body, /흐름이에요|흐름이야/);
  assert.equal(score.checks.livedInStructure, true);
  assert.equal(score.checks.concreteCriteria, true);
  assert.equal(score.checks.microDetail, true);
  assert.equal(score.checks.saveWorthiness, true);
  assert.ok(score.engagementScore >= 82);
});

test('fallback format resolver mixes numbered and prose by mode', () => {
  const topic = { id: 'topic', title: '주방 정리템 고르는 기준', angle: '처음 살 때 체감되는 기준' };
  const counts = (account) => {
    const styles = Array.from({ length: 100 }, (_, index) => resolveFallbackFormatStyle(
      { ...topic, id: `topic-${index}` },
      account,
      { seed: `seed-${index}` }
    ));
    return styles.filter((style) => style === 'numbered').length;
  };

  const checklistNumbered = counts({ id: 'acc-1', content_mode: 'checklist' });
  const empathyNumbered = counts({ id: 'acc-2', content_mode: 'empathy' });
  const autoNumbered = counts({ id: 'acc-3', content_mode: 'auto' });

  assert.ok(checklistNumbered >= 55 && checklistNumbered <= 85);
  assert.ok(autoNumbered >= 20 && autoNumbered <= 45);
  assert.ok(empathyNumbered >= 10 && empathyNumbered <= 35);
  assert.ok(checklistNumbered > empathyNumbered);
});

test('fallback resolver breaks three repeated recent formats', () => {
  const topic = { id: 'topic', title: '청소포 보관 기준' };

  assert.equal(resolveFallbackFormatStyle(topic, { content_mode: 'checklist' }, {
    recentBodies: ['1. 하나\n2. 둘', '1. 하나\n2. 둘', '1. 하나\n2. 둘']
  }), 'prose');

  assert.equal(resolveFallbackFormatStyle(topic, { content_mode: 'auto' }, {
    recentBodies: ['문장형 글입니다', '또 문장형이에요', '질문으로 끝나요?']
  }), 'numbered');
});

test('penalizes awkward phrasing and category mismatched details', () => {
  const awkward = '주방용품 고를 때 은근 놓치는 게 제자리에 돌려두는 흐름이에요.\n\n조리대와 싱크대 옆에 둘 자리가 맞으면 좋아요.\n\n여러분은 뭐부터 보세요?';
  const mismatch = '선물은 포장 풀고 둘 자리도 봐야 해요.\n\n아이 손이 닿는 낮은 자리인지, 기저귀나 물티슈를 바로 집을 수 있는지부터 보면 덜 후회해요.\n\n여러분은 뭐가 좋았어요?';
  const kitchenMismatch = '주방용품은 처음엔 기능을 먼저 보게 되는데 오래 쓰는 건 자리에서 갈리더라고요.\n\n설거지 끝나고 바로 내려둘 자리와 빨래 돌리기 전 잠깐 모아둘 바구니 자리가 편한지 보면 덜 귀찮아요.\n\n여러분은 뭐부터 보세요?';

  const awkwardScore = scorePostEngagement(awkward);
  const mismatchScore = scorePostEngagement(mismatch);
  const kitchenMismatchScore = scorePostEngagement(kitchenMismatch);

  assert.equal(awkwardScore.checks.awkwardPhrase, true);
  assert.ok(awkwardScore.rubric.awkwardPhrasePenalty < 0);
  assert.equal(mismatchScore.checks.categoryMismatch, true);
  assert.ok(mismatchScore.rubric.categoryMismatchPenalty < 0);
  assert.equal(kitchenMismatchScore.checks.categoryMismatch, true);
});

test('gift fallback details count as concrete lived-in details', () => {
  const body = buildHumanStyleFallback(
    { id: 'gift-topic', title: '부담 적은 집들이 선물', angle: '취향 덜 타는 기준' },
    { id: 'gift-account', content_scope: '선물 추천', target_audience: '친구 선물 고민하는 사람' },
    [],
    { formatStyle: 'comparison' }
  );
  const score = scorePostEngagement(body);

  assert.match(body, /받는 사람|포장|취향/);
  assert.equal(score.checks.microDetail, true);
  assert.equal(score.checks.categoryMismatch, false);
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

test('detects near-duplicate recent post structure', () => {
  const body = '수납용품은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회하더라고요.\n\n매일 쓰다 보면 예쁜 모양보다 손이 가는 위치가 더 빨리 티 나요.\n\n저라면\n1. 설거지 끝나고 바로 내려둘 자리\n2. 빨래 돌리기 전 잠깐 모아둘 바구니 자리\n3. 현관에서 나갈 때 바로 집는 물건 자리\n부터 봐요.\n\n여러분은 수납용품 고를 때 제일 먼저 놓는 자리부터 보세요, 쓰는 순간부터 보세요?';
  const similar = '수납용품은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회하더라고요.\n\n매일 쓰다 보면 예쁜 모양보다 손이 가는 위치가 더 빨리 티 나요.\n\n저라면\n1. 설거지 끝나고 바로 내려둘 자리\n2. 빨래 돌리기 전 잠깐 모아둘 바구니 자리\n3. 현관에서 나갈 때 바로 집는 물건 자리\n부터 봐요.\n\n여러분은 수납용품 고를 때 제일 먼저 놓는 자리부터 보세요, 쓰는 순간부터 보세요?';
  const different = '욕실 선반은 샤워하고 난 뒤 물기가 어디로 떨어지는지부터 보면 실패가 줄어요.\n\n수건을 걸 자리와 바닥 청소할 동선이 겹치면 은근 귀찮더라고요.\n\n여러분은 욕실용품 고를 때 물기 관리부터 보세요, 수납칸 개수부터 보세요?';

  assert.equal(scorePostSimilarity(body, [similar]).duplicateRisk, true);
  assert.equal(scorePostSimilarity(body, [different]).duplicateRisk, false);
});
