import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRepetitiveContentPromptRule,
  findRepetitiveContentMatches,
  hasRepetitiveContentPattern
} from './repetitiveContentRules.js';

test('detects overused CUJASA repetitive content rules', () => {
  const matches = findRepetitiveContentMatches('장마철 가전 주변기기 습기와 케이블 엉킴, 멀티탭 정리함으로 해결해요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.');

  assert.equal(hasRepetitiveContentPattern('많이 사는 것보다 "어디에 둘지"부터 정하면 덜 후회하더라고요.'), true);
  assert.equal(hasRepetitiveContentPattern('현관 우산꽂이는 물 빠지는 자리랑 신발장 문 열리는 폭부터 맞추면 덜 불편해요.'), false);
  assert.deepEqual(matches.map((match) => match.id), ['not-only-me-tail']);
});

test('builds a prompt rule from the shared repetitive content list', () => {
  const rule = buildRepetitiveContentPromptRule();

  assert.match(rule, /Hard-ban recently overused CUJASA/);
  assert.match(rule, /나만 불편한 줄 알았는데/);
  assert.match(rule, /어디에 둘지/);
  assert.match(rule, /close paraphrases/);
});
