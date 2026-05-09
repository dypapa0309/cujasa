import assert from 'node:assert/strict';
import test from 'node:test';
import { scorePostEngagement } from './postEngagementScoring.js';
import { evaluatePostQualityGate } from './postQualityGate.js';

test('passes lived-in save-worthy human posts', () => {
  const body = '자취생을 위한 집기 추천, 많이 사는 것보다 “어디에 둘지”부터 정하면 덜 후회하더라고요.\n\n처음엔 큰 것부터 눈에 들어오는데, 막상 살아보면 매일 손 가는 작은 자리가 더 먼저 티 나요.\n\n저라면 큰 가구보다\n1. 설거지 끝나고 바로 내려둘 자리\n2. 빨래 돌리기 전 잠깐 모아둘 바구니 자리\n3. 현관에서 나갈 때 바로 집는 물건 자리\n이 세 자리부터 맞출 것 같아요.\n\n처음 자취할 때 “이건 빨리 사길 잘했다” 싶은 집기, 여러분은 뭐였어요?';
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
