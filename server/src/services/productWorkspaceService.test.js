import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { dbInsert } from './supabaseService.js';
import {
  ingestPolibotKnowledge,
  listPolibotKnowledgeReviewQueue
} from './polibotKnowledgeDbService.js';
import {
  analyzeInfludexCandidates,
  buildProductWorkspaceSummary,
  getProductWorkspace,
  saveInfludexCandidates,
  savePolibotRecommendation,
  savePolibotRecommendationFeedback,
  saveSpreadApplicants,
  saveSpreadCampaign,
  reviewSpreadSubmission,
  updateSpreadCampaignStatus
} from './productWorkspaceService.js';

test('buildProductWorkspaceSummary returns hub cards with next actions', async () => {
  const userId = '10101010-1010-4110-8110-101010101010';
  const accountId = '20202020-2020-4220-8220-202020202020';
  await dbInsert('users', {
    id: userId,
    email: 'jasain-summary-test@example.com',
    password_hash: 'test',
    name: 'JASAIN Summary',
    role: 'customer'
  });
  await dbInsert('accounts', {
    id: accountId,
    project_id: 'summary-project',
    name: 'Summary CUJASA',
    account_handle: '@summary',
    status: 'active',
    has_threads_access_token: true,
    threads_token_status: 'connected',
    coupang_access_key: 'ak',
    coupang_secret_key: 'sk',
    coupang_partner_id: 'pid'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'dexor',
    status: 'active',
    role: 'customer',
    settings: {
      usage: { dexor: { limit: 5, used: 1 } },
      workspace: {
        candidates: [{ id: 'candidate-1', url: 'https://blog.naver.com/test' }],
        analysisResults: []
      }
    }
  });
  await dbInsert('post_queue', {
    id: '30303030-3030-4330-8330-303030303030',
    account_id: accountId,
    status: 'scheduled',
    scheduled_at: new Date().toISOString()
  });

  const summary = await buildProductWorkspaceSummary({ userId, allowedAccountIds: [accountId] });
  const cujasa = summary.products.find((item) => item.productId === 'cujasa');
  const dexor = summary.products.find((item) => item.productId === 'dexor');
  const polibot = summary.products.find((item) => item.productId === 'polibot');

  assert.equal(summary.overview.activeCount >= 2, true);
  assert.equal(summary.overview.scheduled, 1);
  assert.equal(cujasa.health, 'ready');
  assert.equal(cujasa.actionKey, 'posts');
  assert.equal(dexor.granted, true);
  assert.equal(dexor.health, 'needs_setup');
  assert.equal(dexor.actionKey, 'dexor-grade');
  assert.equal(dexor.usage.remaining, 4);
  assert.equal(polibot.granted, false);
  assert.equal(polibot.health, 'locked');
  assert.equal(polibot.actionKey, 'polibot');
});

test('stores POLIBOT recommendation knowledge snapshot with source trace', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-snapshot-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 테스트',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {}
  });
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'snapshot-test-삼성화재-퍼펙트플러스.txt',
      fileName: 'snapshot-test-삼성화재-퍼펙트플러스.txt',
      type: 'txt',
      size: 260,
      fileHash: 'snapshot-test-polibot-file-hash',
      text: '삼성화재 퍼펙트 플러스 종합보험 상품비교 가입설계 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원, 수술 보장을 확인합니다. 보험료: 월 180,000원 가입연령 20세~60세 비갱신'
    }],
    dryRun: false
  });

  const workspace = await savePolibotRecommendation(userId, {
    name: '이상빈',
    age: '34',
    gender: '남성',
    needs: ['암', '뇌', '심장'],
    budget: '40',
    existingMedicalPlan: '없음',
    medicalHistory: '없음',
    existingPremium: '30'
  });

  assert.ok(workspace.knowledgeSnapshot);
  assert.ok(workspace.knowledgeSnapshot.dbSummary.totalSources >= 1);
  assert.ok(workspace.knowledgeSnapshot.usedSources.length >= 1);
  assert.ok(Array.isArray(workspace.recommendations));
  assert.ok(workspace.recommendations[0]?.knowledgeSnapshot?.usedSourceIds?.length >= 1);
});

test('stores POLIBOT recommendation feedback and flags bad feedback for review', async () => {
  const userId = '22222222-2222-4222-8222-222222222222';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-feedback-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 피드백',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {}
  });
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'feedback-test-현대해상-굿앤굿.txt',
      fileName: 'feedback-test-현대해상-굿앤굿.txt',
      type: 'txt',
      size: 260,
      fileHash: 'feedback-test-polibot-file-hash',
      text: '현대해상 굿앤굿 어린이 종합보험 상품비교 가입설계 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원 보장을 확인합니다. 보험료: 월 120,000원 가입연령 20세~60세 비갱신'
    }],
    dryRun: false
  });
  const workspace = await savePolibotRecommendation(userId, {
    name: '김테스트',
    age: '35',
    gender: '남성',
    needs: ['암', '뇌', '심장'],
    budget: '40',
    existingMedicalPlan: '없음',
    medicalHistory: '없음',
    existingPremium: '30'
  });
  const target = workspace.recommendations[0];
  assert.ok(target);

  const next = await savePolibotRecommendationFeedback(userId, {
    recommendationId: target.id,
    feedback: '틀림',
    reason: '상품명 틀림',
    memo: '테스트 피드백'
  });

  const updated = next.recommendations.find((item) => item.id === target.id);
  assert.equal(updated.feedbackRating, 'wrong');
  assert.equal(next.feedback.rating, 'wrong');
  assert.equal(next.feedback.routed_to_review, true);

  const queue = await listPolibotKnowledgeReviewQueue({ status: 'all' });
  const savedFeedback = queue.feedback.find((item) => item.id === next.feedback.id);
  assert.ok(savedFeedback);
  assert.equal(savedFeedback.rating, 'wrong');
  assert.equal(savedFeedback.routedToReview, true);
});

test('INFLUDEX link analysis uses deterministic campaign selection scoring', async () => {
  const userId = '33333333-3333-4333-8333-333333333333';
  await dbInsert('users', {
    id: userId,
    email: 'infludex-score-test@example.com',
    password_hash: 'test',
    name: 'INFLUDEX 테스트',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'infludex',
    status: 'active',
    role: 'customer',
    settings: { usage: { infludex: { limit: 5, used: 0, remaining: 5 } } }
  });

  await saveInfludexCandidates(userId, {
    fileName: 'infludex.csv',
    rows: [
      'url,handle,category,followers,avgLikes,avgComments,recentPostAt,adMemo',
      'https://instagram.com/good,@good,뷰티,30000,1500,180,2026-05-01,',
      'https://instagram.com/weak,@weak,,30000,60,1,2025-01-01,협찬 많음'
    ].join('\n')
  });
  const first = await analyzeInfludexCandidates(userId);
  const second = await analyzeInfludexCandidates(userId);
  const good = first.infludexResults.find((item) => item.handle === 'good');
  const weak = first.infludexResults.find((item) => item.handle === 'weak');
  const goodAgain = second.infludexResults.find((item) => item.handle === 'good');

  assert.ok(good);
  assert.ok(weak);
  assert.ok(good.score > weak.score);
  assert.equal(good.score, goodAgain.score);
  assert.match(good.grade, /^[SABCD]$/);
  assert.ok(good.scoreBreakdown.engagementScore > weak.scoreBreakdown.engagementScore);
  assert.ok(weak.riskFlags.includes('ad_memo_present'));
});

test('INFLUDEX candidate upload reads DOCX files', async () => {
  const userId = '44444444-4444-4444-8444-444444444444';
  await dbInsert('users', {
    id: userId,
    email: 'infludex-docx-test@example.com',
    password_hash: 'test',
    name: 'INFLUDEX DOCX',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'infludex',
    status: 'active',
    role: 'customer',
    settings: { usage: { infludex: { limit: 5, used: 0, remaining: 5 } } }
  });

  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from('<w:document><w:body><w:t>url,handle,category,followers,avgLikes,avgComments,recentPostAt,adMemo</w:t><w:t> https://instagram.com/docx,@docx,생활,12000,520,44,2026-05-02,</w:t></w:body></w:document>'));
  const workspace = await saveInfludexCandidates(userId, {
    fileName: 'infludex.docx',
    files: [{
      fileName: 'infludex.docx',
      base64: zip.toBuffer().toString('base64')
    }]
  });

  assert.equal(workspace.candidates.length, 1);
  assert.equal(workspace.candidates[0].handle, 'docx');
  assert.equal(workspace.candidates[0].category, '생활');
  assert.match(workspace.candidateRows, /instagram\.com\/docx/);
});

test('INFLUDEX candidate upload reads DOCX table rows and keeps saved draft', async () => {
  const userId = '55555555-5555-4555-8555-555555555555';
  await dbInsert('users', {
    id: userId,
    email: 'infludex-docx-table-test@example.com',
    password_hash: 'test',
    name: 'INFLUDEX DOCX Table',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'infludex',
    status: 'active',
    role: 'customer',
    settings: { usage: { infludex: { limit: 5, used: 0, remaining: 5 } } }
  });

  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from([
    '<w:document><w:body><w:tbl>',
    '<w:tr><w:tc><w:p><w:t>url</w:t></w:p></w:tc><w:tc><w:p><w:t>handle</w:t></w:p></w:tc><w:tc><w:p><w:t>category</w:t></w:p></w:tc><w:tc><w:p><w:t>followers</w:t></w:p></w:tc><w:tc><w:p><w:t>avgLikes</w:t></w:p></w:tc><w:tc><w:p><w:t>avgComments</w:t></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:p><w:t>https://instagram.com/table</w:t></w:p></w:tc><w:tc><w:p><w:t>@table</w:t></w:p></w:tc><w:tc><w:p><w:t>육아</w:t></w:p></w:tc><w:tc><w:p><w:t>22000</w:t></w:p></w:tc><w:tc><w:p><w:t>700</w:t></w:p></w:tc><w:tc><w:p><w:t>80</w:t></w:p></w:tc></w:tr>',
    '</w:tbl></w:body></w:document>'
  ].join('')));
  const workspace = await saveInfludexCandidates(userId, {
    fileName: 'infludex-table.docx',
    files: [{
      fileName: 'infludex-table.docx',
      base64: zip.toBuffer().toString('base64')
    }]
  });
  const savedAgain = await saveInfludexCandidates(userId, {});

  assert.equal(workspace.candidates.length, 1);
  assert.equal(workspace.candidates[0].handle, 'table');
  assert.equal(workspace.candidates[0].category, '육아');
  assert.equal(savedAgain.candidates.length, 1);
});

test('INFLUDEX candidate upload ignores document title and Korean header rows', async () => {
  const userId = '66666666-6666-4666-8666-666666666666';
  await dbInsert('users', {
    id: userId,
    email: 'infludex-sidejob-docx-test@example.com',
    password_hash: 'test',
    name: 'INFLUDEX Sidejob DOCX',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'infludex',
    status: 'active',
    role: 'customer',
    settings: { usage: { infludex: { limit: 5, used: 0, remaining: 5 } } }
  });

  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from([
    '<w:document><w:body>',
    '<w:p><w:t>부업 관련 인스타그램 계정 수집 목록</w:t></w:p>',
    '<w:tbl>',
    '<w:tr><w:tc><w:p><w:t>닉네임 (ID)</w:t></w:p></w:tc><w:tc><w:p><w:t>이름/설명</w:t></w:p></w:tc><w:tc><w:p><w:t>링크</w:t></w:p></w:tc><w:tc><w:p><w:t>이메일/문의</w:t></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:p><w:t>@money_makers_youtube</w:t></w:p></w:tc><w:tc><w:p><w:t>머니메이커스</w:t></w:p></w:tc><w:tc><w:p><w:t>이동</w:t></w:p></w:tc><w:tc><w:p><w:t>nyeop2022@gmail.com</w:t></w:p></w:tc></w:tr>',
    '<w:tr><w:tc><w:p><w:t>@positive_feel.tr</w:t></w:p></w:tc><w:tc><w:p><w:t>긍정필터 (AI/인스타 마케팅)</w:t></w:p></w:tc><w:tc><w:p><w:t>이동</w:t></w:p></w:tc><w:tc><w:p><w:t>litt.ly/positive_feel.tr</w:t></w:p></w:tc></w:tr>',
    '</w:tbl></w:body></w:document>'
  ].join('')));
  const workspace = await saveInfludexCandidates(userId, {
    fileName: '부업_관련_인스타그램_계정_수집_목록.docx',
    files: [{
      fileName: '부업_관련_인스타그램_계정_수집_목록.docx',
      base64: zip.toBuffer().toString('base64')
    }]
  });
  const analyzed = await analyzeInfludexCandidates(userId);

  assert.equal(workspace.candidates.length, 2);
  assert.equal(workspace.candidates.some((item) => item.handle === '닉네임 (ID)'), false);
  assert.equal(workspace.candidates.some((item) => item.url === '이동'), false);
  assert.equal(workspace.candidates[0].displayName, '머니메이커스');
  assert.equal(workspace.candidates[0].contactMemo, 'nyeop2022@gmail.com');
  assert.ok(workspace.candidates.find((item) => item.handle === 'positive_feel.tr')?.category);
  assert.equal(analyzed.infludexResults.every((item) => item.analysisStatus === 'data_missing'), true);
  assert.equal(analyzed.infludexResults.every((item) => item.grade === null), true);
});

test('SPREAD campaign draft becomes an operating campaign card', async () => {
  const userId = '77777777-7777-4777-8777-777777777777';
  await dbInsert('users', {
    id: userId,
    email: 'spread-campaign-test@example.com',
    password_hash: 'test',
    name: 'SPREAD 캠페인',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'spread',
    status: 'active',
    role: 'customer',
    settings: { usage: { spread: { limit: 10, used: 0, remaining: 10 } } }
  });

  const created = await saveSpreadCampaign(userId, {
    goal: '신제품 체험단 모집',
    channel: '인스타그램',
    product: '생활용품'
  });
  assert.equal(created.campaigns.length, 1);
  assert.equal(created.campaigns[0].product, '생활용품');
  assert.equal(created.campaigns[0].status, 'draft');
  assert.equal(created.selectedCampaignId, created.campaigns[0].id);
  assert.equal(created.campaignDraft.id, created.campaigns[0].id);

  const applicants = await saveSpreadApplicants(userId, {
    campaignId: created.campaigns[0].id,
    applicants: '김체험\n이리뷰',
    criteria: '최근 활동성\n카테고리 적합도'
  });
  assert.equal(applicants.campaigns[0].applicants.length, 2);
  assert.equal(applicants.campaigns[0].status, 'selecting');
  assert.equal(applicants.applicants.length, 2);

  const reviewed = await reviewSpreadSubmission(userId, {
    campaignId: created.campaigns[0].id,
    url: 'https://example.com/review',
    required: '브랜드명',
    forbidden: '과장 표현'
  });
  assert.equal(reviewed.campaigns[0].status, 'reviewing');
  assert.equal(reviewed.campaigns[0].submissionReview.url, 'https://example.com/review');
  assert.equal(reviewed.submissionReview.url, 'https://example.com/review');

  const completed = await updateSpreadCampaignStatus(userId, {
    campaignId: created.campaigns[0].id,
    status: 'completed'
  });
  assert.equal(completed.campaigns[0].status, 'completed');
});

test('SPREAD legacy campaign draft is reused for applicants', async () => {
  const userId = '88888888-8888-4888-8888-888888888888';
  await dbInsert('users', {
    id: userId,
    email: 'spread-legacy-test@example.com',
    password_hash: 'test',
    name: 'SPREAD Legacy',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'spread',
    status: 'active',
    role: 'customer',
    settings: {
      workspace: {
        campaignDraft: {
          goal: '기존 체험단',
          channel: '블로그',
          product: '주방용품',
          headline: '기존 캠페인 초안'
        }
      },
      usage: { spread: { limit: 10, used: 0, remaining: 10 } }
    }
  });

  const before = await getProductWorkspace(userId, 'spread');
  assert.equal(before.campaignDraft.product, '주방용품');

  const next = await saveSpreadApplicants(userId, {
    applicants: '박블로거',
    criteria: '블로그 운영'
  });
  assert.equal(next.campaigns.length, 1);
  assert.equal(next.campaigns[0].product, '주방용품');
  assert.equal(next.campaigns[0].applicants.length, 1);
  assert.equal(next.selectedCampaignId, next.campaigns[0].id);
});
