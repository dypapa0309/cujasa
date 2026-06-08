import assert from 'node:assert/strict';
import test from 'node:test';
import { hasLinkProductsForContentGeneration, runFullPipeline } from './pipelineService.js';
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

test('full pipeline skips billing-expired accounts without failing scheduler run', async () => {
  const user = await dbInsert('users', {
    email: `billing-expired-${Date.now()}@example.com`,
    username: `billing-expired-${Date.now()}`,
    buyer_name: '만료 테스트',
    status: 'active',
    plan: 'monthly',
    billing_status: 'past_due',
    paid_until: '2026-06-01T00:00:00.000Z',
    max_accounts: 1
  });
  const project = await dbInsert('projects', {
    name: 'billing expired pipeline test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    project_id: project.id,
    name: 'billing expired account',
    platform: 'threads',
    account_handle: '@billing-expired',
    automation_status: 'running',
    status: 'active',
    threads_access_token: 'token',
    threads_user_id: 'threads-user',
    threads_token_status: 'valid',
    coupang_access_key: 'access',
    coupang_secret_key: 'secret',
    coupang_partner_id: 'partner',
    coupang_tracking_code: 'tracking'
  });
  await dbInsert('user_accounts', { user_id: user.id, account_id: account.id });
  await dbInsert('user_products', {
    user_id: user.id,
    product_id: 'cujasa',
    status: 'expired',
    role: 'customer',
    settings: {}
  });

  const result = await runFullPipeline({
    accountIds: [account.id],
    requestedBy: 'billing-expired-test',
    skipFutureScheduled: false
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].status, 'skipped');
  assert.equal(result.results[0].code, 'BILLING_EXPIRED');
  assert.equal(result.skipped.length, 1);
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
