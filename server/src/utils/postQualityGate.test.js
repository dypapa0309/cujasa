import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePostEngagement } from './postEngagementScoring.js';
import { evaluatePostQualityGate } from './postQualityGate.js';

test('passes lived-in save-worthy human posts', () => {
  const body = '자취템은 사기 전에 어디에 둘지 먼저 떠올리면 덜 후회하더라고요.\n\n매일 쓰다 보면 예쁜 모양보다 손이 가는 위치가 더 빨리 티 나요.\n\n저라면\n1. 설거지 끝나고 바로 내려둘 자리\n2. 빨래 돌리기 전 잠깐 모아둘 바구니 자리\n3. 현관에서 나갈 때 바로 집는 물건 자리\n부터 봐요.\n\n처음 자취할 때 “이건 빨리 사길 잘했다” 싶은 집기, 여러분은 뭐였어요?';
  const gate = evaluatePostQualityGate(scorePostEngagement(body));

  assert.equal(gate.passed, true);
  assert.equal(gate.reasons.length, 0);
});

test('fails shallow AI-like checklist posts with rewrite instructions', () => {
  const body = '수납함을 선택하는 것이 좋습니다.\n\n1. 자주 쓰는지\n2. 보관이 쉬운지\n3. 관리가 부담 없는지\n\n이런 기준은 도움이 됩니다.';
  const gate = evaluatePostQualityGate(scorePostEngagement(body));

  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((reason) => /생활 디테일|AI식|얕은 체크리스트/.test(reason)));
  assert.ok(gate.rewriteInstructions.some((item) => /생활 디테일/.test(item)));
});

test('passes high-scoring posts with only minor required-check misses', () => {
  const gate = evaluatePostQualityGate({
    engagementScore: 100,
    checks: {
      microDetail: true,
      saveWorthiness: true,
      humanWarmth: true,
      lowAdTone: true,
      productNatural: true,
      safe: true
    }
  });

  assert.equal(gate.passed, true);
  assert.equal(gate.reasons.length, 0);
});

test('fails repetitive fallback skeletons', () => {
  const body = '자취생을 위한 집기 추천, 많이 사는 것보다 “어디에 둘지”부터 정하면 덜 후회하더라고요.\n\n막상 살아보면 큰 기능보다 매일 손 가는 자리가 먼저 티 나요.\n\n저라면\n1. 설거지 끝나고 바로 내려둘 자리\n2. 빨래 돌리기 전 잠깐 모아둘 바구니 자리\n3. 현관에서 나갈 때 바로 집는 물건 자리\n부터 봐요.\n\n여러분은 뭐였어요?';
  const gate = evaluatePostQualityGate(scorePostEngagement(body));

  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((reason) => /반복/.test(reason)));
  assert.ok(gate.rewriteInstructions.some((item) => /최근 글|같은 첫 문장/.test(item)));
});

test('fails awkward phrases and category detail mismatches', () => {
  const awkward = '주방용품 고를 때 은근 놓치는 게 제자리에 돌려두는 흐름이에요.\n\n조리대와 싱크대 옆 자리가 맞으면 손이 덜 가요.\n\n여러분은 뭐부터 보세요?';
  const mismatch = '선물은 받는 사람이 바로 쓸 수 있는지가 먼저예요.\n\n아이 손이 닿는 낮은 자리인지, 기저귀나 물티슈를 바로 집을 수 있는지도 같이 봐요.\n\n여러분은 뭐가 좋았어요?';

  const awkwardGate = evaluatePostQualityGate(scorePostEngagement(awkward));
  const mismatchGate = evaluatePostQualityGate(scorePostEngagement(mismatch));

  assert.equal(awkwardGate.passed, false);
  assert.ok(awkwardGate.reasons.some((reason) => /금지 표현/.test(reason)));
  assert.ok(awkwardGate.rewriteInstructions.some((item) => /다시 두기 편한지/.test(item)));
  assert.equal(mismatchGate.passed, false);
  assert.ok(mismatchGate.reasons.some((reason) => /카테고리/.test(reason)));
  assert.ok(mismatchGate.rewriteInstructions.some((item) => /선물 글/.test(item)));
});

test('fails account-context category mismatches even when the body scores high', () => {
  const body = '반려동물 용품은 귀여운 것보다 치우기 쉬운지가 먼저, 막상 써보면 생각보다 자주 거슬리는 순간이 있어.\n1. 조리대 위에 올려도 손이 안 좁아지는지\n2. 싱크대 옆에 잠깐 둘 자리가 있는지\n이거 안 맞으면 손 잘 안 감. 설거지 후 물 빠짐이 괜찮은지까지 맞으면 꽤 오래 가고.\n이거 고를 때 다들 뭐부터 봄?';
  const gate = evaluatePostQualityGate(scorePostEngagement(body, {
    account: {
      name: '멍냥집사',
      content_scope: '반려동물 용품',
      target_audience: '강아지, 고양이를 키우는 사람들'
    },
    topic: {
      title: '펫템 고르는 기준'
    }
  }));

  assert.equal(gate.passed, false);
  assert.equal(gate.severity, 'critical');
  assert.ok(gate.reasons.some((reason) => /카테고리/.test(reason)));
});

test('fails mukbang or food details on pet accounts', () => {
  const body = '먹방 간식은 예쁜 세트보다 남았을 때 귀찮은지가 은근 크더라고요.\n\n손에 묻지 않고 바로 나눠 먹기 쉬운지, 냉장고 자리를 많이 차지하지 않는지부터 봐요.\n\n다들 먹거리 고를 때 뭐부터 보세요?';
  const gate = evaluatePostQualityGate(scorePostEngagement(body, {
    account: {
      name: '멍냥집사',
      content_scope: '반려동물 용품',
      target_audience: '강아지, 고양이를 키우는 사람들'
    },
    topic: {
      title: '산책 가방에서 매번 찾게 되는 작은 물건'
    }
  }));

  assert.equal(gate.passed, false);
  assert.equal(gate.severity, 'critical');
  assert.ok(gate.reasons.some((reason) => /카테고리/.test(reason)));
});
