import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveVisualPlanImage } from './postImageService.js';

test('resolveVisualPlanImage keeps generated cards as metadata when no API endpoint is configured', async () => {
  const plan = {
    attachImage: true,
    imageSourceType: 'generated_card',
    imagePrompt: 'card prompt'
  };
  const resolved = await resolveVisualPlanImage(plan, {}, { endpoint: '' });

  assert.equal(resolved, plan);
});

test('resolveVisualPlanImage fills public image URL from auvibot-compatible API response', async () => {
  const plan = {
    attachImage: true,
    imageSourceType: 'generated_card',
    imagePrompt: 'card prompt',
    imageRole: 'meme_card',
    imageCaptionRole: 'hook'
  };
  const requests = [];
  const resolved = await resolveVisualPlanImage(plan, {
    post: { body: '정리 전후 밈', contentType: '밈 카드형' },
    topic: { id: 'topic' },
    account: { id: 'account', content_scope: '자취' }
  }, {
    endpoint: 'https://auvibot.example/images',
    fetchImpl: async (url, request) => {
      requests.push({ url, request });
      return {
        ok: true,
        text: async () => JSON.stringify({ imageUrl: 'https://cdn.example.com/card.png', provider: 'auvibot' })
      };
    }
  });

  assert.equal(resolved.imageUrl, 'https://cdn.example.com/card.png');
  assert.equal(resolved.imageGenerationStatus, 'ready');
  assert.equal(resolved.imageProvider, 'auvibot');
  assert.equal(requests[0].url, 'https://auvibot.example/images');
  assert.match(JSON.parse(requests[0].request.body).prompt, /card prompt/);
});
