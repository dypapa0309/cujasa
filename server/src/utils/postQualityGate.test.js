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

test('fails pet account posts that drift into mukbang food content', () => {
  const body = '오늘은 편의점 쿠키 먹방처럼 나눠 먹기 좋은 간식 기준을 봐요.\n\n손에 덜 묻고 포장 뜯기 쉬운지가 은근 중요하더라고요.\n\n여러분은 뭐부터 보세요?';
  const engagement = scorePostEngagement(body, {
    account: {
      name: '동물채널',
      content_scope: '반려동물 용품과 산책 루틴',
      target_audience: '강아지 고양이 집사'
    },
    topic: {
      title: '강아지 산책 준비',
      angle: '집사가 바로 챙기는 기준'
    }
  });
  const gate = evaluatePostQualityGate(engagement);

  assert.equal(engagement.checks.categoryMismatch, true);
  assert.equal(gate.passed, false);
  assert.ok(gate.reasons.some((reason) => /카테고리/.test(reason)));
});
