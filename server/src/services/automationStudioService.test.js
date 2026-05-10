import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  createAutomationCampaign,
  deleteAutomationAsset,
  deleteAutomationCampaign,
  deleteAutomationSet,
  expandAutomationAsset,
  getAutomationCampaign,
  getAutomationStudioAnalytics,
  getPublicLeadForm,
  listAutomationCampaignLeads,
  regenerateAutomationCampaignAssets,
  runAutomationCampaign,
  stopAutomationCampaign,
  submitPublicLeadForm,
  updateAutomationAsset,
  updateAutomationCampaign
} from './automationStudioService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';
import { processDueQueue, uploadQueueItem } from './schedulerService.js';

async function createAccountFixture() {
  const project = await dbInsert('projects', {
    id: randomUUID(),
    name: 'Automation Studio Test',
    type: 'coupang',
    status: 'active'
  });
  const account = await dbInsert('accounts', {
    id: randomUUID(),
    project_id: project.id,
    name: 'JASAIN 내부 테스트',
    platform: 'threads',
    account_handle: '@jasain_test',
    target_audience: '20대 자취생',
    content_scope: '제품 카드 광고 운영',
    forbidden_topics: [],
    forbidden_words: [],
    tone: '명확하고 짧게',
    cta_style: '저장 유도',
    status: 'active',
    automation_status: 'running',
    threads_access_token: 'test-token',
    threads_token_status: 'connected',
    threads_link_delivery_mode: 'reply'
  });
  return { project, account };
}

test('automation studio creates assets and separated queue links for Threads and Instagram', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '접이식 수납함',
    productUrl: 'https://jasain.co.kr/cujasa',
    productPrice: 12900,
    objectiveType: 'consultation',
    optimizationGoal: 'consultation',
    conversionDestination: 'dm_or_form',
    audienceStage: 'warm',
    audiencePersona: '부업 관심자',
    audiencePain: '매일 상품 찾기가 번거로움',
    proofPoint: '상품 찾기, 글 생성, 예약까지 자동화',
    priority: 'high',
    hookStyle: 'problem_first',
    activeStart: '10:00',
    activeEnd: '20:00',
    targetGoal: '제품 관심 전환',
    targetAudience: '자취생',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads', 'instagram']
  }, { type: 'admin', email: 'admin@example.com' });

  const running = await runAutomationCampaign(campaign.id, { type: 'admin', email: 'admin@example.com' });

  assert.equal(running.status, 'running');
  assert.equal(running.objective_type, 'consultation');
  assert.equal(running.priority, 'high');
  assert.equal(running.assets.length, 2);
  assert.equal(running.queueLinks.length, 2);
  assert.equal(running.queues.filter((queue) => queue.platform === 'threads').length, 1);
  assert.equal(running.queues.filter((queue) => queue.platform === 'instagram').length, 1);
  assert.equal(running.queues.find((queue) => queue.platform === 'instagram').status, 'manual_required');
  assert.match(running.assets.find((asset) => asset.platform === 'instagram').image_data_url, /^data:image\/svg\+xml;base64,/);
  assert.equal(running.assets.find((asset) => asset.platform === 'threads').metadata.objectiveType, 'consultation');
  assert.ok(Number.isFinite(running.assets.find((asset) => asset.platform === 'threads').metadata.qualityScore));
  assert.ok(['ready', 'review', 'weak'].includes(running.assets.find((asset) => asset.platform === 'threads').metadata.qualityStatus));
  assert.ok(running.queues.some((queue) => queue.tracking_link_id));
  assert.equal(running.operation_set.conversionDestination, 'dm_or_form');
  assert.equal(running.operation_set.audienceStage, 'warm');
  const trackedPost = await dbGet('posts', { id: running.queues.find((queue) => queue.tracking_link_id).post_id });
  assert.match(trackedPost.body, /\/r\//);
});

test('automation studio requires a real account before creating runnable campaigns', async () => {
  await assert.rejects(() => createAutomationCampaign({
    productName: '쿠자사',
    targetGoal: '계정 없는 캠페인 방지',
    days: 1,
    dailyPostMax: 1
  }, { type: 'admin' }), /accountId is required/);

  await assert.rejects(() => createAutomationCampaign({
    accountId: randomUUID(),
    productName: '쿠자사',
    targetGoal: '존재하지 않는 계정 방지',
    days: 1,
    dailyPostMax: 1
  }, { type: 'admin' }), /account not found/);
});

test('automation studio sanitizes Instagram card image sources', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '이미지 검증 제품',
    productImageUrl: 'javascript:alert(1)',
    targetGoal: '이미지 소스 검증',
    days: 1,
    dailyPostMax: 1,
    platforms: ['instagram']
  }, { type: 'admin' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const instagramAsset = running.assets.find((asset) => asset.platform === 'instagram');
  const svg = Buffer.from(instagramAsset.image_data_url.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString('utf8');

  assert.doesNotMatch(svg, /javascript:alert/);
  assert.match(svg, /PRODUCT/);
});

test('automation studio analytics groups clicks by campaign asset channel and time', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '쿠자사',
    productUrl: 'https://jasain.co.kr/cujasa',
    targetGoal: '쿠파스 자동화 판매',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads']
  }, { type: 'admin' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const queue = running.queues.find((item) => item.platform === 'threads');
  const link = running.queueLinks.find((item) => item.queue_id === queue.id);
  await dbInsert('click_events', {
    tracking_link_id: queue.tracking_link_id,
    project_id: running.project_id,
    account_id: running.account_id,
    post_id: queue.post_id,
    created_at: '2026-05-09T03:10:00.000Z'
  });
  await dbInsert('click_events', {
    tracking_link_id: queue.tracking_link_id,
    project_id: running.project_id,
    account_id: running.account_id,
    post_id: queue.post_id,
    created_at: '2026-05-09T03:40:00.000Z'
  });

  const analytics = await getAutomationStudioAnalytics({ campaignId: running.id });
  const assetRow = analytics.assets.find((row) => row.assetId === link.asset_id);
  const channelRow = analytics.byChannel.find((row) => row.key === 'threads');

  assert.equal(analytics.totals.clicks, 2);
  assert.equal(assetRow.clicks, 2);
  assert.equal(channelRow.clicks, 2);
  assert.ok(analytics.byDate.some((row) => row.key === '2026-05-09' && row.clicks === 2));
  assert.ok(analytics.nextActions.length >= 1);
});

test('expands a performing asset into a new draft campaign', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '쿠자사',
    productUrl: 'https://jasain.co.kr/cujasa',
    targetGoal: '쿠파스 자동화 판매',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads', 'instagram']
  }, { type: 'admin', email: 'admin@example.com' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin', email: 'admin@example.com' });
  const sourceAsset = running.assets.find((asset) => asset.platform === 'threads');
  const expanded = await expandAutomationAsset(running.id, sourceAsset.id, { days: 2, platforms: ['threads'] }, { type: 'admin', email: 'admin@example.com' });

  assert.equal(expanded.status, 'draft');
  assert.equal(expanded.product_name, running.product_name);
  assert.deepEqual(expanded.platforms, ['threads']);
  assert.equal(expanded.days, 2);
  assert.equal(expanded.summary.sourceCampaignId, running.id);
  assert.equal(expanded.summary.sourceAssetId, sourceAsset.id);
  assert.equal(expanded.operation_set.primaryMessage, sourceAsset.body);
});

test('Instagram preview queue is never uploaded by scheduler', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '미니 가습기',
    targetGoal: '수동 업로드 전 카드 검수',
    days: 1,
    dailyPostMax: 1,
    platforms: ['instagram']
  }, { type: 'admin' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const instagramQueue = running.queues.find((queue) => queue.platform === 'instagram');

  await assert.rejects(() => uploadQueueItem(instagramQueue.id), /Only Threads queue items/);
  const processed = await processDueQueue();
  const after = await dbGet('post_queue', { id: instagramQueue.id });

  assert.equal(processed, 0);
  assert.equal(after.status, 'manual_required');
});

test('rerunning a campaign archives stale assets and shows only the latest generation', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '쿠자사',
    targetGoal: '내부 콘텐츠 운영',
    targetAudience: '내부 운영자',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads', 'instagram']
  }, { type: 'admin' });
  const firstRun = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const secondRun = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const detail = await getAutomationCampaign(campaign.id);
  const allAssets = await dbList('automation_studio_assets', { campaign_id: campaign.id });

  assert.equal(firstRun.assets.length, 2);
  assert.equal(secondRun.assets.length, 2);
  assert.equal(detail.assets.length, 2);
  assert.ok(allAssets.length >= 4);
  assert.ok(detail.assets.every((asset) => asset.metadata.generationId === secondRun.summary.currentGenerationId));
  assert.ok(detail.assets.every((asset) => !asset.body.includes('\n')));
  assert.ok(detail.assets.find((asset) => asset.platform === 'threads').body.length < 90);
  assert.match(detail.assets.find((asset) => asset.platform === 'threads').body, /쿠팡 파트너스 자동화|쿠파스 자동화|예약 콘텐츠|제휴 콘텐츠/);
  assert.ok(detail.queues.every((queue) => ['scheduled', 'manual_required'].includes(queue.status)));
});

test('stopping a campaign skips pending queue items without deleting customer automation data', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '책상 정리함',
    targetGoal: '예약 중지 검증',
    days: 1,
    dailyPostMax: 1
  }, { type: 'admin' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const stopped = await stopAutomationCampaign(running.id, { type: 'admin' });
  const queues = await dbList('post_queue');
  const detail = await getAutomationCampaign(running.id);

  assert.equal(stopped.status, 'stopped');
  assert.ok(detail.queues.every((queue) => queue.status === 'skipped'));
  assert.ok(queues.some((queue) => running.queues.some((created) => created.id === queue.id)));
});

test('automation studio soft deletes assets sets and campaigns with scoped queues', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '쿠자사',
    targetGoal: '쿠파스 자동화 판매',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads', 'instagram']
  }, { type: 'admin' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const threadsAsset = running.assets.find((asset) => asset.platform === 'threads');
  const afterAssetDelete = await deleteAutomationAsset(running.id, threadsAsset.id, { type: 'admin' });
  const afterSetDelete = await deleteAutomationSet(running.id, 'instagram', { type: 'admin' });
  const deleted = await deleteAutomationCampaign(running.id, { type: 'admin' });
  const campaigns = await dbList('automation_studio_campaigns');
  const detailRow = campaigns.find((row) => row.id === running.id);

  assert.equal(deleted.deleted, true);
  assert.ok(!afterAssetDelete.assets.some((asset) => asset.id === threadsAsset.id));
  assert.ok(afterSetDelete.assets.every((asset) => asset.platform !== 'instagram'));
  assert.ok(detailRow.summary.deletedAt);
});

test('campaign and asset review metadata can be updated for internal operations', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '상담 전환 카드',
    targetGoal: '상담 전환',
    nextActionNote: '첫 반응 확인',
    days: 1,
    dailyPostMax: 1
  }, { type: 'admin', email: 'admin@example.com' });
  const running = await runAutomationCampaign(campaign.id, { type: 'admin', email: 'admin@example.com' });
  const asset = running.assets.find((item) => item.platform === 'threads');

  const reviewed = await updateAutomationAsset(running.id, asset.id, {
    status: 'approved',
    body: '쿠팡 파트너스 운영, 상품 찾기부터 포스팅까지 쿠자사로 줄여보세요.',
    operationNote: '후킹 문구 재사용 가능',
    reusable: true
  }, { type: 'admin', email: 'admin@example.com' });
  const updatedAsset = reviewed.assets.find((item) => item.id === asset.id);
  const noted = await updateAutomationCampaign(running.id, {
    nextActionNote: '클릭 낮으면 문제 제기형으로 재생성'
  }, { type: 'admin', email: 'admin@example.com' });

  assert.equal(updatedAsset.review_status, 'approved');
  assert.equal(updatedAsset.body, '쿠팡 파트너스 운영, 상품 찾기부터 포스팅까지 쿠자사로 줄여보세요.');
  assert.equal(updatedAsset.operation_note, '후킹 문구 재사용 가능');
  assert.equal(updatedAsset.reusable, true);
  assert.ok(updatedAsset.metadata.qualityScore >= 58);
  assert.equal(noted.next_action_note || noted.summary.nextActionNote, '클릭 낮으면 문제 제기형으로 재생성');
});

test('lead campaigns create public lead forms and collect submissions', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: 'JASAIN 도입 안내',
    productUrl: 'https://jasain.kr',
    objectiveType: 'lead',
    optimizationGoal: 'lead',
    conversionDestination: 'lead_form',
    leadOffer: '무료 자동화 점검',
    leadFields: ['name', 'phone', 'business'],
    targetGoal: '잠재고객 신청 수집',
    days: 1,
    dailyPostMax: 1,
    platforms: ['threads']
  }, { type: 'admin', email: 'admin@example.com' });

  assert.ok(campaign.leadForm?.slug);
  assert.match(campaign.leadForm.public_url, /\/lead-forms\/lead-/);
  const publicForm = await getPublicLeadForm(campaign.leadForm.slug);
  assert.deepEqual(publicForm.fields, ['name', 'phone', 'business']);

  const submission = await submitPublicLeadForm(campaign.leadForm.slug, {
    name: '홍길동',
    phone: '010-0000-0000',
    business: '소상공인',
    privacyAccepted: true
  }, { userAgent: 'node-test' });
  const leads = await listAutomationCampaignLeads(campaign.id);

  assert.equal(submission.ok, true);
  assert.equal(leads.submissions.length, 1);
  assert.equal(leads.submissions[0].payload.name, '홍길동');
});

test('regenerating assets applies the latest campaign image to Instagram metadata', async () => {
  const { account } = await createAccountFixture();
  const campaign = await createAutomationCampaign({
    accountId: account.id,
    productName: '이미지 적용 상품',
    productImageUrl: 'https://example.com/old.png',
    targetGoal: '이미지 반영 확인',
    days: 1,
    dailyPostMax: 1,
    platforms: ['instagram']
  }, { type: 'admin' });
  const firstRun = await runAutomationCampaign(campaign.id, { type: 'admin' });
  const updated = await updateAutomationCampaign(firstRun.id, { productImageUrl: 'https://example.com/new.png' }, { type: 'admin' });

  assert.equal(updated.diagnostics.media.needsRegeneration, true);
  const regenerated = await regenerateAutomationCampaignAssets(firstRun.id, { type: 'admin' });
  const instagramAsset = regenerated.assets.find((asset) => asset.platform === 'instagram');

  assert.equal(regenerated.diagnostics.media.appliedToCurrentAssets, true);
  assert.equal(instagramAsset.metadata.sourceProductImageUrl, 'https://example.com/new.png');
});
