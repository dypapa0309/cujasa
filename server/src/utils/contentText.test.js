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
