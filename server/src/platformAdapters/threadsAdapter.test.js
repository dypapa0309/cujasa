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
    assert.equal(uploaded.raw.linkMode, 'direct');
    assert.match(uploaded.raw.replyText, /https:\/\/link\.coupang\.com\/example/);
    assert.doesNotMatch(uploaded.raw.replyText, /\/r\/abc/);
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('THREADS_REPLY_LINK_MODE_ENABLED', previousReply);
  }
});

test('uploadPost treats missing reply link env as enabled by default', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  const previousReply = process.env.THREADS_REPLY_LINK_MODE_ENABLED;
  process.env.MOCK_UPLOAD = 'true';
  delete process.env.THREADS_REPLY_LINK_MODE_ENABLED;

  try {
    const uploaded = await uploadPost({
      account: { name: 'test', threads_link_delivery_mode: 'reply' },
      post: { id: 'post-3', body: '본문' },
      trackingLink: { code: 'abc', destination_url: 'https://link.coupang.com/example' }
    });

    assert.equal(uploaded.raw.linkDeliveryMode, 'reply');
    assert.equal(uploaded.raw.linkMode, 'direct');
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
    restoreEnv('THREADS_REPLY_LINK_MODE_ENABLED', previousReply);
  }
});

test('uploadPost blocks leaked account ids before mock or live upload', async () => {
  const previousMock = process.env.MOCK_UPLOAD;
  process.env.MOCK_UPLOAD = 'true';

  try {
    await assert.rejects(
      uploadPost({
        account: { name: 'lovehyun45', account_handle: '@lovehyun45', threads_link_delivery_mode: 'reply' },
        post: {
          id: 'post-4',
          body: 'lovehyun45 냄새 줄이는 법, 이건 은근 기준이 갈리는 선택이에요.\n\n여러분은 이런 거 고를 때 실용성 쪽이에요, 아니면 편한 사용감 쪽이에요?'
        }
      }),
      (error) => error.code === 'POST_BODY_QUALITY_BLOCKED'
    );
  } finally {
    restoreEnv('MOCK_UPLOAD', previousMock);
  }
});

test('uploadPost returns posted result with reply warning when body succeeds but reply fails', async () => {
  const previousFetch = globalThis.fetch;
  const previousMock = process.env.MOCK_UPLOAD;
  delete process.env.MOCK_UPLOAD;
  const responses = [
    { ok: true, json: async () => ({ id: 'creation-1' }), text: async () => '{}' },
    { ok: true, json: async () => ({ id: 'post-threads-1' }), text: async () => '{}' },
    { ok: false, json: async () => ({}), text: async () => '{"error":{"message":"Application does not have permission for this action","code":10}}' }
  ];
  globalThis.fetch = async () => responses.shift();

  try {
    const uploaded = await uploadPost({
      account: {
        name: 'test',
        account_handle: '@replytest',
        threads_access_token: 'token',
        threads_link_delivery_mode: 'reply'
      },
      post: { id: 'post-5', body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽을 보세요, 보기 깔끔한 쪽을 보세요?' },
      trackingLink: { code: 'abc', destination_url: 'https://link.coupang.com/example' }
    });

    assert.equal(uploaded.postUrl, 'https://www.threads.net/@replytest/post/post-threads-1');
    assert.equal(uploaded.raw.replyFailed, true);
    assert.match(uploaded.raw.replyWarning, /permission/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('MOCK_UPLOAD', previousMock);
  }
});
