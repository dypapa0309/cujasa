import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPostText, buildReplyText, uploadPost, uploadVideoPost } from './threadsAdapter.js';
import { isTrustedThreadsPostUrl, threadsPostUrlStatus } from '../utils/threadsPostUrl.js';

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

test('buildPostText strips legacy affiliate disclosure and product-info CTA', () => {
  const body = buildPostText({
    body: '봄이 왔으니 집 정리할 시간! 필요한 것들 쏙쏙 넣다 보면 집안이 확 달라져.\n\n(이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다) 사지마 구경만햐~🔗제품정보 요기아래 👇'
  });

  assert.match(body, /봄이 왔으니 집 정리할 시간/);
  assert.doesNotMatch(body, /쿠팡\s*파트너스|수수료|사지마|구경만|제품\s*정보|요기아래|🔗|👇/);
});

test('buildReplyText includes disclosure and the link', () => {
  const reply = buildReplyText('https://link.coupang.com/example');

  assert.match(reply, /\[광고\]/);
  assert.match(reply, /https:\/\/link\.coupang\.com\/example/);
});

test('Threads post URL trust check hides numeric media id fallbacks', () => {
  assert.equal(isTrustedThreadsPostUrl('https://www.threads.net/@dangzang.gogo/post/18081644654439950'), false);
  assert.equal(isTrustedThreadsPostUrl('https://www.threads.net/@dangzang.gogo/post/DYKHE_GmMiP'), true);
  assert.equal(threadsPostUrlStatus('https://www.threads.net/@dangzang.gogo/post/18081644654439950').status, 'numeric_media_id');
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
    { ok: true, json: async () => ({}), text: async () => JSON.stringify({ id: 'post-threads-1', permalink: 'https://www.threads.net/@replytest/post/SHORT1', shortcode: 'SHORT1', username: 'replytest' }) },
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

    assert.equal(uploaded.postUrl, 'https://www.threads.net/@replytest/post/SHORT1');
    assert.equal(uploaded.raw.replyFailed, true);
    assert.equal(uploaded.raw.postDetails.shortcode, 'SHORT1');
    assert.match(uploaded.raw.replyWarning, /permission/);
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('MOCK_UPLOAD', previousMock);
  }
});

test('uploadPost stores no postUrl when Threads permalink lookup returns only media id', async () => {
  const previousFetch = globalThis.fetch;
  const previousMock = process.env.MOCK_UPLOAD;
  delete process.env.MOCK_UPLOAD;
  const responses = [
    { ok: true, json: async () => ({ id: 'creation-1' }), text: async () => '{}' },
    { ok: true, json: async () => ({ id: '18081644654439950' }), text: async () => '{}' },
    { ok: true, json: async () => ({ id: '18081644654439950', username: 'replytest' }), text: async () => JSON.stringify({ id: '18081644654439950', username: 'replytest' }) }
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
      post: { id: 'post-6', body: '집 정리할 때 수납 기준은 은근 갈리죠. 꺼내기 쉬운 쪽을 보세요, 보기 깔끔한 쪽을 보세요?' }
    });

    assert.equal(uploaded.postUrl, null);
    assert.equal(uploaded.raw.postUrlStatus.status, 'missing');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('MOCK_UPLOAD', previousMock);
  }
});

test('uploadVideoPost requires a public video URL', async () => {
  await assert.rejects(
    uploadVideoPost({
      account: { name: 'test', threads_access_token: 'token' },
      videoUrl: '/local/render.mp4',
      text: '오늘 테스트 영상입니다.'
    }),
    (error) => error.code === 'THREADS_VIDEO_URL_REQUIRED'
  );
});

test('uploadVideoPost creates, waits, publishes, and returns permalink', async () => {
  const previousFetch = globalThis.fetch;
  const previousMock = process.env.MOCK_UPLOAD;
  delete process.env.MOCK_UPLOAD;
  const requests = [];
  const responses = [
    { ok: true, json: async () => ({ id: 'creation-video-1' }), text: async () => '{}' },
    { ok: true, json: async () => ({ status_code: 'FINISHED' }), text: async () => JSON.stringify({ status_code: 'FINISHED' }) },
    { ok: true, json: async () => ({ id: 'post-video-1' }), text: async () => '{}' },
    { ok: true, json: async () => ({ id: 'post-video-1', permalink: 'https://www.threads.net/@videotest/post/SHORTV1', shortcode: 'SHORTV1', username: 'videotest' }), text: async () => JSON.stringify({ id: 'post-video-1', permalink: 'https://www.threads.net/@videotest/post/SHORTV1', shortcode: 'SHORTV1', username: 'videotest' }) }
  ];
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    return responses.shift();
  };

  try {
    const uploaded = await uploadVideoPost({
      account: {
        name: 'test',
        account_handle: '@videotest',
        threads_access_token: 'token'
      },
      videoUrl: 'https://cdn.example.com/render.mp4',
      text: '오늘 테스트 영상입니다. 반응 기준을 확인합니다.',
      poll: { attempts: 1, intervalMs: 0 }
    });

    assert.equal(requests[0].body.media_type, 'VIDEO');
    assert.equal(requests[0].body.video_url, 'https://cdn.example.com/render.mp4');
    assert.match(requests[1].url, /fields=status/);
    assert.equal(uploaded.postUrl, 'https://www.threads.net/@videotest/post/SHORTV1');
    assert.equal(uploaded.raw.mediaType, 'VIDEO');
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv('MOCK_UPLOAD', previousMock);
  }
});
