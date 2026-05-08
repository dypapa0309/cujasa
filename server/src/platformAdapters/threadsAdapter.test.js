import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostText, buildReplyText, uploadPost } from './threadsAdapter.js';

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test('buildPostText never appends coupang links to the post body', () => {
  const body = buildPostText({
    body: '정리하다 보면 수납장이 제일 애매하죠.\n\n댓글 링크 확인!\nhttps://link.coupang.com/example'
  });

  assert.match(body, /정리하다 보면/);
  assert.doesNotMatch(body, /link\.coupang|댓글 링크|광고/);
});

test('buildReplyText includes disclosure and the link', () => {
  const reply = buildReplyText('https://link.coupang.com/example');

  assert.match(reply, /\[광고\]/);
  assert.match(reply, /https:\/\/link\.coupang\.com\/example/);
});

test('uploadPost rejects link posts unless reply link mode is enabled for the account', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousReply = process.env.THREADS_REPLY_LINK_MODE_ENABLED;
  process.env.MOCK_UPLOAD = 'true';
  process.env.THREADS_REPLY_LINK_MODE_ENABLED = 'false';

  try {
    await assert.rejects(
      uploadPost({
        account: { name: 'test', threads_link_delivery_mode: 'reply' },
        post: { id: 'post-1', body: '본문' },
        trackingLink: { code: 'abc', destination_url: 'https://link.coupang.com/example' }
      }),
      /THREADS_REPLY_LINK_MODE_REQUIRED/
    );
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('THREADS_REPLY_LINK_MODE_ENABLED', previousReply);
  }
});

test('uploadPost mock uses reply delivery when reply link mode is enabled', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousReply = process.env.THREADS_REPLY_LINK_MODE_ENABLED;
  process.env.MOCK_UPLOAD = 'true';
  process.env.THREADS_REPLY_LINK_MODE_ENABLED = 'true';

  try {
    const uploaded = await uploadPost({
      account: { name: 'test', threads_link_delivery_mode: 'reply' },
      post: { id: 'post-2', body: '본문' },
      trackingLink: { code: 'abc', destination_url: 'https://link.coupang.com/example' }
    });

    assert.equal(uploaded.raw.linkDeliveryMode, 'reply');
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('THREADS_REPLY_LINK_MODE_ENABLED', previousReply);
  }
});
