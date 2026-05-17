import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectGeneratedPostText, sanitizeContentTitle, sanitizePostBody } from './contentText.js';

test('sanitizes account handles without removing normal English product names', () => {
  const account = { name: 'lovehyun45', account_handle: '@lovehyun45', content_scope: '생활용품' };

  assert.equal(sanitizeContentTitle('lovehyun45 냄새 줄이는 법', account), '냄새 줄이는 법');
  assert.equal(sanitizePostBody('lovehyun45 냄새 줄이는 법은 원인부터 보는 게 좋아요.', account), '냄새 줄이는 법은 원인부터 보는 게 좋아요.');
  assert.equal(sanitizeContentTitle('Dyson 청소기 보관 기준', account), 'Dyson 청소기 보관 기준');
  assert.equal(sanitizePostBody('LPM 1200 같은 모델명보다 조리대 옆 폭이 먼저예요.', account), 'LPM 1200 같은 모델명보다 조리대 옆 폭이 먼저예요.');
});

test('product names with letters are not treated as account token leaks', () => {
  const account = { name: 'lovehyun45', account_handle: '@lovehyun45' };
  const inspected = inspectGeneratedPostText('Dyson 청소기는 보관 위치부터 잡는 게 편하더라고요.', account);

  assert.equal(inspected.accountTokenLeak, false);
  assert.equal(inspected.publishable, true);
});

test('rejects generic practicality versus comfort template posts', () => {
  const account = { name: 'lovehyun45', account_handle: '@lovehyun45' };
  const inspected = inspectGeneratedPostText(
    'lovehyun45 냄새 줄이는 법, 이건 은근 기준이 갈리는 선택이에요.\n생활 속 원인부터 잡기를 먼저 보는 사람도 있고, 편하게 쓰는 쪽을 더 중요하게 보는 사람도 있더라고요.\n여러분은 이런 거 고를 때 실용성 쪽이에요, 아니면 편한 사용감 쪽이에요?',
    account
  );

  assert.equal(inspected.accountTokenLeak, true);
  assert.equal(inspected.genericTemplate, true);
  assert.equal(inspected.publishable, false);
});

test('rejects topic-title echo and body CTA leaks', () => {
  const titleEcho = inspectGeneratedPostText('홈인테리어,주방용품,소형 생활가전 정리 쉽게 하는 법, 평소에는 별거 아닌데 막상 필요할 때마다 은근 신경 쓰여.');
  const ctaLeak = inspectGeneratedPostText('정리함은 둘 자리부터 봐야 됨. 댓글 참고해봐!');

  assert.equal(titleEcho.genericTemplate, true);
  assert.equal(ctaLeak.genericTemplate, true);
  assert.equal(titleEcho.publishable, false);
  assert.equal(ctaLeak.publishable, false);
});

test('rejects ad-like social proof phrases that sound generated', () => {
  const inspected = inspectGeneratedPostText('후기에서 자주 보는 체크포인트 기준에서 추천하는 제품 있으세요? 요즘 인기인 수납함이 괜히 기분 좋아지는 이유 같아요.');

  assert.equal(inspected.genericTemplate, true);
  assert.equal(inspected.publishable, false);
});
