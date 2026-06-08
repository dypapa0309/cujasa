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

  assert.match(body, /설거지 끝나고 바로 내려둘 자리|조리대 위에 올려도 손이 안 좁아지는지|자주 쓰는 순간에 바로 닿는지|펼쳤을 때 방문이 걸리지 않는지|침대 밑에 넣을 수 있는지/);
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

test('penalizes repeated CUJASA tail skeletons from posted queues', () => {
  const repeatedTail = scorePostEngagement('장마철 가전 주변기기 습기와 케이블 엉킴, 멀티탭 정리함으로 해결해요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.');
  const repeatedPoint = scorePostEngagement('책상 수납함 고르기 전 꼭 피해야 할 5가지 특징, 이건 상황마다 기준이 은근 갈리는 포인트야.');
  const repeatedFirstWeek = scorePostEngagement('주방용품은 첫 주에 불편하면 거의 계속 불편하더라고요. 조리대 위에 올려도 손이 안 좁아지는지랑 싱크대 옆에 잠깐 둘 자리가 있는지 여기서 이미 답 나오는 경우 많아요. 다들 이럴 때 뭐 먼저 보세요?');

  assert.equal(repeatedTail.checks.repetitiveFallback, true);
  assert.equal(repeatedPoint.checks.repetitiveFallback, true);
  assert.equal(repeatedFirstWeek.checks.repetitiveFallback, true);
  assert.ok(repeatedTail.rubric.repetitiveFallbackPenalty < 0);
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

  assert.match(body, /사진만 보면|첫 주에 바로 티/);
  assert.match(body, /설거지 끝나고 바로 내려둘 자리/);
  assert.match(body, /빨래 돌리기 전 잠깐 모아둘 바구니 자리/);
  assert.match(body, /공감|어디까지|예민한|필수/);
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

test('penalizes unclear compressed internet-style openings', () => {
  const vagueCleaning = '청소는 꺼내는 시간이 길면 시작도 안 하게 됨.\n\n먼지가 보여도 그냥 지나치게 되는 경우 많음.\n\n이거 나만 그런가?';
  const vagueStorage = '수납하려고 샀는데 방이 더 좁아지는 거 진짜 있음.\n\n정리템 살 때 은근 조심해야 함.\n\n다들 공감함?';
  const clearStorage = '좁은 방 정리하려고 수납장 샀는데 방이 더 좁아짐 ㅋㅋ\n\n정리템 잘못 사면 큰 짐 하나 더 생기는 느낌임.\n\n이거 겪어본 사람 은근 많지 않나';

  const vagueCleaningScore = scorePostEngagement(vagueCleaning);
  const vagueStorageScore = scorePostEngagement(vagueStorage);
  const clearStorageScore = scorePostEngagement(clearStorage);

  assert.equal(vagueCleaningScore.checks.ambiguousCompressedSetup, true);
  assert.equal(vagueStorageScore.checks.ambiguousCompressedSetup, true);
  assert.equal(clearStorageScore.checks.ambiguousCompressedSetup, false);
  assert.ok(vagueCleaningScore.rubric.ambiguousCompressedSetupPenalty < 0);
  assert.ok(clearStorageScore.engagementScore > vagueStorageScore.engagementScore);
});

test('penalizes body CTA leaks and topic-title echo posts', () => {
  const ctaLeak = '예전엔 조리도구가 여기저기 흩어져서 설거지 후 둘 데 찾느라 난감했어. 다들 어떤 기준으로 고름? 댓글 참고해봐!';
  const titleEcho = '홈인테리어,주방용품,소형 생활가전 정리 쉽게 하는 법, 평소에는 별거 아닌데 막상 필요할 때마다 은근 신경 쓰여.';

  const ctaScore = scorePostEngagement(ctaLeak);
  const echoScore = scorePostEngagement(titleEcho);

  assert.equal(ctaScore.checks.ctaLeak, true);
  assert.equal(echoScore.checks.topicTitleEcho, true);
  assert.ok(ctaScore.rubric.ctaLeakPenalty < 0);
  assert.ok(echoScore.rubric.topicTitleEchoPenalty < 0);
  assert.ok(ctaScore.engagementScore < 70);
  assert.ok(echoScore.engagementScore < 70);
});

test('rewards share meme lazy and wrong-purchase shapes', () => {
  const share = scorePostEngagement('택배 박스 못 버리는 사람한테 보내야 됨\n현관 앞에 쌓이면 분리수거 봉투 찾는 순간부터 의욕 사라짐');
  const wrong = scorePostEngagement('선반 샀는데 선반 둘 자리가 없었음\n좁은 방은 정리템 잘못 사면 큰 짐 하나 더 생김 ㅋㅋ');
  const lazy = scorePostEngagement('부지런한 사람 기준 말고 다시 넣기 귀찮은 사람 기준으로 봐야 됨\n손 안 가면 결국 바닥에 쌓임');

  assert.equal(share.checks.shareTrigger, true);
  assert.equal(wrong.checks.wrongPurchase, true);
  assert.equal(lazy.checks.lazyAngle, true);
  assert.ok(share.rubric.shareabilityScore > 0);
  assert.ok(wrong.rubric.wrongPurchaseScore > 0);
  assert.ok(lazy.rubric.lazyAngleScore > 0);
});

test('rewards native social scene formats without forcing questions', () => {
  const pov = scorePostEngagement('POV: 방 치우려고 일어났는데 충전선이 발에 걸림\n침대 옆 선이 바닥에 늘어지면 청소할 때마다 멈칫함');
  const ranked = scorePostEngagement('화장대 정리템 볼 때 제 우선순위\n1순위 매일 쓰는 제품이 앞에 나와 있는지\n2순위 파우치 안에서 다시 찾기 쉬운지');
  const reply = scorePostEngagement('댓글에서 차량용품 뭐부터 보냐고 물어보면 난 컵홀더 막는지부터 봄\n운전 중 바닥에 굴러다니면 첫날부터 거슬림');

  assert.equal(pov.checks.nativeSocialShape, true);
  assert.equal(ranked.checks.rankedPriority, true);
  assert.equal(reply.checks.imaginaryReply, true);
  assert.ok(pov.rubric.nativeSocialShapeScore > 0);
  assert.ok(ranked.rubric.rankedPriorityScore > 0);
  assert.ok(reply.rubric.communityReplyScore > 0);
  assert.ok(ranked.engagementScore >= 82);
});

test('accepts short relatable one-liners as a valid content format', () => {
  const oneLiner = '좁은 방 정리하려고 수납장 샀는데 방이 더 좁아짐 ㅋㅋ';
  const twoLine = '먼지 보여도 돌돌이 안 보이면 그냥 못 본 척하게 됨.\n이거 나만 그런 거 아니지';

  const oneLinerScore = scorePostEngagement(oneLiner);
  const twoLineScore = scorePostEngagement(twoLine);

  assert.equal(oneLinerScore.checks.compactRelatable, true);
  assert.equal(twoLineScore.checks.compactRelatable, true);
  assert.equal(oneLinerScore.checks.ambiguousCompressedSetup, false);
  assert.ok(oneLinerScore.engagementScore >= 82);
  assert.ok(twoLineScore.engagementScore >= 82);
});

test('penalizes over-written metaphors that do not sound like normal Korean posts', () => {
  const awkward = '집이 좁은 게 아니라 내가 물건을 너무 믿었음';
  const natural = '방 좁은데 수납장까지 들어오니까 더 답답함 ㅋㅋ';

  const awkwardScore = scorePostEngagement(awkward);
  const naturalScore = scorePostEngagement(natural);

  assert.equal(awkwardScore.checks.awkwardMetaphor, true);
  assert.equal(naturalScore.checks.awkwardMetaphor, false);
  assert.ok(awkwardScore.rubric.awkwardMetaphorPenalty < 0);
  assert.ok(naturalScore.engagementScore > awkwardScore.engagementScore);
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

test('detects repeated tail skeletons even when topic words differ', () => {
  const body = '장마철 가전 주변기기 습기와 케이블 엉킴, 멀티탭 정리함으로 해결해요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.';
  const recent = '여름철 냉방기기 주변 케이블 엉킴, 멀티탭 정리함으로 깔끔하게 정리했어요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.';
  const score = scorePostSimilarity(body, [recent]);

  assert.equal(score.duplicateRisk, true);
  assert.ok(score.maxTokenOverlap >= 0.66);
  assert.ok(score.penalty > 0);
});
