import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLinkProductsForContentGeneration } from './pipelineService.js';
import { generatePostsPrompt } from '../prompts/generatePostsPrompt.js';
import { dbGet, dbInsert } from './supabaseService.js';
import { expireStalePipelineRuns, getRunningPipeline, pipelineStaleReason } from './pipelineRunService.js';

test('skips content generation when no link product was selected', () => {
  assert.equal(hasLinkProductsForContentGeneration([]), false);
  assert.equal(hasLinkProductsForContentGeneration(null), false);
});

test('allows content generation when at least one link product was selected', () => {
  assert.equal(hasLinkProductsForContentGeneration([{ id: 'selected-product' }]), true);
});

test('post generation prompt includes strong but safe hook guidance', () => {
  const prompt = generatePostsPrompt(
    { title: '수납함 고르는 기준', angle: '뚜껑과 크기' },
    [],
    {
      name: '살림 계정',
      target_audience: '살림 관심 고객',
      content_scope: '살림용품',
      content_mode: 'empathy',
      comment_induction_style: 'choice_question'
    }
  );
  const body = prompt.map((item) => item.content).join('\n');

  assert.match(body, /강한|stronger hook|나만 불편한 줄/);
  assert.match(body, /hostile polarization|identity attacks/);
  assert.match(body, /exactly 5 candidate posts/);
  assert.match(body, /choice-tension|A\/B choice/);
});

test('expires stale pipeline runs and does not block next execution', async () => {
  const accountId = '33333333-3333-4333-8333-333333333333';
  const run = await dbInsert('pipeline_runs', {
    account_id: accountId,
    status: 'running',
    started_at: '2026-05-08T00:00:00.000Z',
    expires_at: '2026-05-08T02:00:00.000Z',
    result: { stage: 'products', updatedAt: '2026-05-08T00:10:00.000Z' }
  });

  const stale = pipelineStaleReason(run);
  assert.equal(stale.code, 'PIPELINE_LOCK_EXPIRED');
  assert.equal(stale.label, '만료된 실행 잠금');

  const expired = await expireStalePipelineRuns(accountId);
  assert.equal(expired.length, 1);
  const saved = await dbGet('pipeline_runs', { id: run.id });
  assert.equal(saved.status, 'expired');
  assert.equal(saved.result.staleStage, 'products');
  assert.equal(await getRunningPipeline(accountId), null);
});
