import assert from 'node:assert/strict';
import test from 'node:test';

import { assessContentPatternQuality } from './contentPatternQuality.js';

test('blocks repetitive template pattern used across topics', () => {
  const result = assessContentPatternQuality('주방 정리 고를 때 처음엔 예쁜 것부터 보이는데, 살아보면 귀찮은 순간이 기준을 바꾸더라고요.\n\n다시 넣을 때 손이 덜 가는 구조처럼 잠깐 둘 곳이 있으면 바닥에 쌓이는 일이 확 줄어요.');

  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('반복 템플릿 문장 구조'));
  assert.ok(result.repetitiveMatches.some((match) => match.id === 'pretty-first-annoying-later'));
});

test('blocks repeated CUJASA tail phrases found in posted queues', () => {
  const repeatedTail = assessContentPatternQuality('여름철 냉방기기 주변 케이블 엉킴, 멀티탭 정리함으로 깔끔하게 정리했어요, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.');
  const repeatedPoint = assessContentPatternQuality('책상 정리 초보가 꼭 알아야 할 수납함 고르는 기준 5가지, 이건 상황마다 기준이 은근 갈리는 포인트야.');
  const repeatedFirstWeek = assessContentPatternQuality('육아용품은 첫 주에 불편하면 거의 계속 불편하더라고요. 아이 손이 닿는 낮은 자리인지랑 기저귀나 물티슈를 바로 집을 수 있는지 여기서 이미 답 나오는 경우 많아요. 다들 이럴 때 뭐 먼저 보세요?');

  assert.equal(repeatedTail.allowed, false);
  assert.equal(repeatedPoint.allowed, false);
  assert.equal(repeatedFirstWeek.allowed, false);
});
