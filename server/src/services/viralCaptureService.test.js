import assert from 'node:assert/strict';
import test from 'node:test';

import { __viralCaptureInternals } from './viralCaptureService.js';

function restoreGlobalFetch(previousFetch) {
  globalThis.fetch = previousFetch;
}

test('viral capture only accepts Threads source URLs', () => {
  assert.equal(
    __viralCaptureInternals.normalizeCaptureUrl('https://www.threads.com/@ihho6263/post/DYhfBQeGdgk'),
    'https://www.threads.com/@ihho6263/post/DYhfBQeGdgk'
  );
  assert.throws(
    () => __viralCaptureInternals.normalizeCaptureUrl('http://127.0.0.1:3000/internal'),
    (error) => error.code === 'VIRAL_CAPTURE_UNSUPPORTED_SOURCE_URL'
  );
  assert.throws(
    () => __viralCaptureInternals.normalizeCaptureUrl('https://example.com/post'),
    (error) => error.code === 'VIRAL_CAPTURE_UNSUPPORTED_SOURCE_URL'
  );
});

test('viral capture only accepts known Threads media hosts', () => {
  assert.equal(
    __viralCaptureInternals.assertAllowedMediaUrl('https://scontent.cdninstagram.com/v/t50.2886-16/video.mp4'),
    'https://scontent.cdninstagram.com/v/t50.2886-16/video.mp4'
  );
  assert.throws(
    () => __viralCaptureInternals.assertAllowedMediaUrl('https://example.com/video.mp4'),
    (error) => error.code === 'VIRAL_CAPTURE_UNSUPPORTED_MEDIA_URL'
  );
});

test('guarded fetch rejects redirects outside the allowed host set', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, {
    status: 302,
    headers: { location: 'http://127.0.0.1:3000/private' }
  });
  try {
    await assert.rejects(
      __viralCaptureInternals.fetchWithGuards('https://www.threads.com/@a/post/b', {}, {
        validator: __viralCaptureInternals.isAllowedThreadsSourceUrl,
        code: 'VIRAL_CAPTURE_UNSUPPORTED_SOURCE_URL',
        message: 'Threads 게시글 URL만 사용할 수 있어요.'
      }),
      (error) => error.code === 'VIRAL_CAPTURE_UNSUPPORTED_SOURCE_URL'
    );
  } finally {
    restoreGlobalFetch(previousFetch);
  }
});

test('response body reader enforces byte limits even without content-length', async () => {
  const response = new Response('abcdef');
  await assert.rejects(
    __viralCaptureInternals.readResponseBufferWithLimit(response, 3, 'VIRAL_CAPTURE_TEST_TOO_LARGE'),
    (error) => error.code === 'VIRAL_CAPTURE_TEST_TOO_LARGE' && error.status === 413
  );
});

test('video metadata capture ignores malicious embedded media URLs', async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    '<html><head><meta property="og:video" content="http://127.0.0.1:3000/private.mp4"></head></html>',
    { status: 200, headers: { 'content-type': 'text/html' } }
  );
  try {
    await assert.rejects(
      __viralCaptureInternals.captureVideoUrlFromMetadata('https://www.threads.com/@a/post/b'),
      (error) => error.code === 'VIRAL_CAPTURE_VIDEO_NOT_FOUND'
    );
  } finally {
    restoreGlobalFetch(previousFetch);
  }
});

test('test1 user bypasses the viral capture daily limit for image and video posts', async () => {
  const actor = { email: 'test1@test.com' };
  assert.equal(__viralCaptureInternals.isViralCaptureUnlimitedActor(actor), true);
  await assert.doesNotReject(
    __viralCaptureInternals.assertViralCaptureDailyLimit('account-1', 'viral_capture_threads', actor)
  );
  await assert.doesNotReject(
    __viralCaptureInternals.assertViralCaptureDailyLimit('account-1', 'viral_capture_video_threads', actor)
  );
});
