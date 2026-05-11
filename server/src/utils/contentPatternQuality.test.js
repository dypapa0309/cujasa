import assert from 'node:assert/strict';
import test from 'node:test';

import { assessContentPatternQuality } from './contentPatternQuality.js';

test('blocks repetitive template pattern used across topics', () => {
  const result = assessContentPatternQuality('주방 정리 고를 때 처음엔 예쁜 것부터 보이는데, 살아보면 귀찮은 순간이 기준을 바꾸더라고요.\n\n다시 넣을 때 손이 덜 가는 구조처럼 잠깐 둘 곳이 있으면 바닥에 쌓이는 일이 확 줄어요.');

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('반복 템플릿 문장 구조'));
});

