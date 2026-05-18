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
  deleteSublogSubscription,
  getProductWorkspace,
  getProductWorkspaceStatus,
  listSublogSubscriptions,
  saveInfludexCandidates,
  savePolibotRecommendation,
  savePolibotRecommendationFeedback,
  saveSpreadApplicants,
  saveSpreadCampaign,
  saveSublogSubscription,
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

test('getProductWorkspaceStatus returns lightweight POLIBOT customer status', async () => {
  const userId = '11111111-2026-4110-8110-101010101010';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-status-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT Status',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {
      usage: { polibot: { limit: 5, used: 2 } },
      workspace: {
        knowledgeSources: [{ id: 'source-1', fileName: 'status.pdf' }],
        recommendations: []
      }
    }
  });

  const status = await getProductWorkspaceStatus(userId, 'polibot');

  assert.equal(status.productId, 'polibot');
  assert.equal(status.granted, true);
  assert.equal(status.actionKey, 'polibot-recommend');
  assert.equal(status.usage.remaining, 3);
});

test('POLIBOT incomplete recommendation stores draft without consuming usage', async () => {
  const userId = '11111111-2026-4110-8110-202020202020';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-incomplete-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT Incomplete',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {
      usage: { polibot: { limit: 5, used: 0 } },
      workspace: {}
    }
  });

  const workspace = await savePolibotRecommendation(userId, { age: '45' });

  assert.equal(workspace.customerProfile.age, '45');
  assert.equal(workspace.recommendations.length, 0);
  assert.match(workspace.recommendationNotice, /필요 보장/);
  assert.equal(workspace.usage.used, 0);
  assert.equal(workspace.usage.remaining, 5);
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
  const recommendation = workspace.recommendations[0];
  assert.ok(recommendation?.knowledgeSnapshot?.usedSourceIds?.length >= 1);
  assert.ok(recommendation.decisionAnalysis?.itemDecisionSummary);
  assert.ok(recommendation.decisionAnalysis?.decisionScore?.scoreFormula?.components?.length >= 1);
  assert.ok(recommendation.decisionAnalysis?.itemDiagnostics?.[0]?.decisionBreakdown);
  assert.ok(recommendation.decisionAnalysis.itemDiagnostics[0].decisionBreakdown.scoreFormula?.components?.length >= 1);
  assert.ok(recommendation.reviewSummary);
  assert.match(recommendation.recommendationStatusLabel, /추천|상담|검수/);
  assert.ok(Array.isArray(recommendation.reviewReasons));
  assert.ok(Array.isArray(recommendation.routineChecks));
  assert.ok(recommendation.catalogItems?.[0]?.decisionBreakdown);
  assert.match(recommendation.catalogItems[0].decisionBreakdown.level, /추천|후보|검토/);
});

function buildPolibotXlsxBuffer() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<si><t>메리츠화재 상품비교 가입설계 자료입니다</t></si>',
    '<si><t>상품명</t></si>',
    '<si><t>(무)The간편한건강보험</t></si>',
    '<si><t>간편고지 유병자 고혈압 당뇨 고객 검토 가능 상품입니다</t></si>',
    '<si><t>암 진단비</t></si>',
    '<si><t>3,000만원</t></si>',
    '<si><t>뇌혈관 진단비</t></si>',
    '<si><t>1,000만원</t></si>',
    '<si><t>보험료</t></si>',
    '<si><t>95,000원</t></si>',
    '<si><t>가입연령</t></si>',
    '<si><t>40세~75세</t></si>',
    '</sst>'
  ].join('')));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>',
    '<row r="3"><c r="A3" t="s"><v>3</v></c></row>',
    '<row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4" t="s"><v>5</v></c><c r="C4" t="s"><v>6</v></c><c r="D4" t="s"><v>7</v></c></row>',
    '<row r="5"><c r="A5" t="s"><v>8</v></c><c r="B5" t="s"><v>9</v></c><c r="C5" t="s"><v>10</v></c><c r="D5" t="s"><v>11</v></c></row>',
    '</sheetData></worksheet>'
  ].join('')));
  return zip.toBuffer();
}

test('creates POLIBOT recommendations from uploaded xlsx product tables', async () => {
  const userId = '13131313-1313-4131-8131-131313131313';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-xlsx-recommendation-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 엑셀',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {}
  });
  const xlsx = buildPolibotXlsxBuffer();
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'persona-xlsx-메리츠화재-상품비교.xlsx',
      fileName: 'persona-xlsx-메리츠화재-상품비교.xlsx',
      type: 'xlsx',
      size: xlsx.length,
      fileHash: 'persona-xlsx-polibot-file-hash',
      base64: xlsx.toString('base64')
    }],
    dryRun: false
  });

  const workspace = await savePolibotRecommendation(userId, {
    name: '엑셀 페르소나',
    age: '52',
    gender: '남성',
    needs: ['암', '뇌', '유병자'],
    budget: '12',
    existingMedicalPlan: '있음',
    medicalHistory: '고혈압 약 복용 중',
    existingPremium: '18',
    purpose: '보험료 절감'
  });

  const recommendation = workspace.recommendations[0];
  assert.ok(recommendation);
  assert.ok((recommendation.evidence || []).some((source) => source.fileName.endsWith('.xlsx')));
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.premium?.status === 'within_budget'));
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.premium?.matchQuality));
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.underwriting?.classification));
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.evidence?.quality));
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.scoreFormula?.components?.some((component) => component.key === 'evidence')));
  assert.ok(recommendation.reviewSummary);
  assert.ok(Array.isArray(recommendation.reviewReasons));
  assert.ok((recommendation.catalogItems || []).some((item) => (item.evidenceAnchors || []).length >= 1));
});

test('builds POLIBOT monthly change report from versioned product data', async () => {
  const userId = '14141414-1414-4141-8141-141414141414';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-monthly-change-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 월별변경',
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
    month: '2026-04',
    files: [{
      name: 'monthly-change-2026-04-삼성화재-건강맞춤.txt',
      fileName: 'monthly-change-2026-04-삼성화재-건강맞춤.txt',
      type: 'txt',
      size: 320,
      fileHash: 'monthly-change-2026-04-hash',
      text: '삼성화재 상품비교 가입설계 자료입니다. 상품명 (무)건강맞춤종합보험. 암 진단비 3,000만원 뇌혈관 진단비 1,000만원 보험료: 월 120,000원 가입연령 20세~55세 비갱신'
    }],
    dryRun: false
  });
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'monthly-change-2026-05-삼성화재-건강맞춤.txt',
      fileName: 'monthly-change-2026-05-삼성화재-건강맞춤.txt',
      type: 'txt',
      size: 320,
      fileHash: 'monthly-change-2026-05-hash',
      text: '삼성화재 상품비교 가입설계 자료입니다. 상품명 (무)건강맞춤종합보험. 암 진단비 5,000만원 뇌혈관 진단비 2,000만원 보험료: 월 140,000원 가입연령 20세~60세 비갱신'
    }],
    dryRun: false
  });

  const workspace = await getProductWorkspace(userId, 'polibot');
  assert.equal(workspace.monthlyChangeReport.latestMonth, '2026-05');
  assert.equal(workspace.monthlyChangeReport.previousMonth, '2026-04');
  assert.ok((workspace.monthlyChangeReport.changed || []).some((item) => item.productName.includes('건강맞춤종합보험') && item.changedFields.includes('보험료')));
  assert.ok((workspace.monthlyChangeReport.changed || []).some((item) => (item.changeDetails || []).some((detail) => /%|추가 담보|가입연령/.test(detail))));
});

test('scores POLIBOT persona recommendations with underwriting and item breakdowns', async () => {
  const userId = '12121212-1212-4121-8121-121212121212';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-persona-score-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 페르소나',
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
    files: [
      {
        name: 'persona-test-메리츠화재-The간편건강보험.txt',
        fileName: 'persona-test-메리츠화재-The간편건강보험.txt',
        type: 'txt',
        size: 420,
        fileHash: 'persona-test-polibot-simple-file-hash',
        text: [
          '메리츠화재 상품비교 가입설계 자료입니다. 상품명 (무)The간편한건강보험.',
          '(무)The간편한건강보험은 간편고지 유병자 고혈압 당뇨 고객 검토 가능 상품입니다.',
          '암 진단비 3,000만원 뇌혈관 진단비 1,000만원 허혈성심장질환 진단비 1,000만원.',
          '보험료: 월 95,000원 가입연령 40세~75세 갱신형'
        ].join('\n')
      },
      {
        name: 'persona-test-메리츠화재-표준건강보험.txt',
        fileName: 'persona-test-메리츠화재-표준건강보험.txt',
        type: 'txt',
        size: 360,
        fileHash: 'persona-test-polibot-standard-file-hash',
        text: [
          '메리츠화재 상품비교 가입설계 자료입니다. 상품명 (무)표준건강보험.',
          '(무)표준건강보험은 일반고지 표준심사 고객 중심 상품입니다.',
          '암 진단비 3,000만원 뇌혈관 진단비 1,000만원 심장 진단비 1,000만원.',
          '보험료: 월 80,000원 가입연령 20세~60세 비갱신'
        ].join('\n')
      }
    ],
    dryRun: false
  });

  const workspace = await savePolibotRecommendation(userId, {
    name: '유병자 페르소나',
    age: '55',
    gender: '남성',
    needs: ['암', '뇌', '심장', '유병자'],
    budget: '12',
    existingMedicalPlan: '있음',
    medicalHistory: '당뇨 진단 후 약 복용 중',
    existingPremium: '18',
    purpose: '보험료 절감'
  });

  const recommendation = workspace.recommendations[0];
  assert.ok(recommendation);
  assert.ok(recommendation.decisionAnalysis);
  assert.equal(recommendation.decisionAnalysis.medicalRisk.level, 'review');
  assert.ok(recommendation.decisionAnalysis.underwritingRoute.some((item) => item.type === 'simple' || item.type === 'chronic_special'));
  assert.ok((recommendation.decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.underwriting?.status === 'simple_fit'));
  assert.ok((recommendation.decisionAnalysis.itemDecisionSummary?.priorityItems || []).length >= 1);
  assert.ok((recommendation.catalogItems || []).some((item) => item.decisionBreakdown?.premium?.status === 'within_budget'));
  assert.ok((recommendation.nextQuestions || []).some((item) => /투약|병력|입원|수술|표준형|간편심사/.test(item)));
  assert.ok((recommendation.reviewReasons || []).some((item) => /고지|가입 가능성|심사/.test(item)));
});

test('generates POLIBOT recommendation outputs for 10 persona scenarios', async () => {
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [
      {
        name: 'persona-suite-삼성화재-건강맞춤보험.txt',
        fileName: 'persona-suite-삼성화재-건강맞춤보험.txt',
        type: 'txt',
        size: 420,
        fileHash: 'persona-suite-polibot-standard-health',
        text: '삼성화재 상품비교 가입설계 자료입니다. 상품명 (무)건강맞춤종합보험. (무)건강맞춤종합보험은 일반고지 표준심사 고객 중심 상품입니다. 암 진단비 5,000만원 뇌혈관 진단비 2,000만원 허혈성심장질환 진단비 2,000만원 수술비 보장. 보험료: 월 140,000원 가입연령 20세~60세 비갱신'
      },
      {
        name: 'persona-suite-메리츠화재-간편건강보험.txt',
        fileName: 'persona-suite-메리츠화재-간편건강보험.txt',
        type: 'txt',
        size: 420,
        fileHash: 'persona-suite-polibot-simple-health',
        text: '메리츠화재 상품비교 가입설계 자료입니다. 상품명 (무)The간편한건강보험. (무)The간편한건강보험은 간편고지 유병자 고혈압 당뇨 고객 검토 가능 상품입니다. 암 진단비 3,000만원 뇌혈관 진단비 1,000만원 허혈성심장질환 진단비 1,000만원. 보험료: 월 95,000원 가입연령 40세~75세 갱신형'
      },
      {
        name: 'persona-suite-현대해상-운전자보험.txt',
        fileName: 'persona-suite-현대해상-운전자보험.txt',
        type: 'txt',
        size: 360,
        fileHash: 'persona-suite-polibot-driver',
        text: '현대해상 상품비교 가입설계 자료입니다. 상품명 (무)굿앤굿운전자보험. 운전자 자동차 교통사고처리지원금 벌금 변호사선임비용 보장. 보험료: 월 25,000원 가입연령 18세~70세 갱신형'
      },
      {
        name: 'persona-suite-KB손해보험-간병치매보험.txt',
        fileName: 'persona-suite-KB손해보험-간병치매보험.txt',
        type: 'txt',
        size: 390,
        fileHash: 'persona-suite-polibot-care',
        text: 'KB손해보험 상품비교 가입설계 자료입니다. 상품명 (무)든든간병치매보험. 간병 치매 장기요양 생활비 보장. 치매 진단비 2,000만원 간병 생활비 월 100만원. 보험료: 월 130,000원 가입연령 45세~80세 갱신형'
      },
      {
        name: 'persona-suite-DB손해보험-어린이보험.txt',
        fileName: 'persona-suite-DB손해보험-어린이보험.txt',
        type: 'txt',
        size: 380,
        fileHash: 'persona-suite-polibot-child',
        text: 'DB손해보험 상품비교 가입설계 자료입니다. 상품명 (무)아이러브어린이보험. 어린이 자녀 암 뇌 심장 입원 수술 상해 골절 보장. 보험료: 월 70,000원 가입연령 0세~30세 비갱신'
      }
    ],
    dryRun: false
  });

  const personas = [
    { id: '15151515-1515-4151-8151-151515151501', name: '표준 건강 고객', age: '34', gender: '남성', needs: ['암', '뇌', '심장'], budget: '18', existingMedicalPlan: '없음', medicalHistory: '없음', existingPremium: '12', purpose: '보장 강화', renewalPreference: '비갱신 선호' },
    { id: '15151515-1515-4151-8151-151515151502', name: '당뇨 유병자 고객', age: '55', gender: '남성', needs: ['암', '뇌', '유병자'], budget: '12', existingMedicalPlan: '있음', medicalHistory: '당뇨 진단 후 약 복용 중', existingPremium: '18', purpose: '보험료 절감' },
    { id: '15151515-1515-4151-8151-151515151503', name: '운전자 보장 고객', age: '42', gender: '여성', needs: ['운전자'], budget: '5', existingMedicalPlan: '있음', medicalHistory: '없음', existingPremium: '4', purpose: '신규 가입', renewalPreference: '허용' },
    { id: '15151515-1515-4151-8151-151515151504', name: '고령 간병 고객', age: '68', gender: '여성', needs: ['간병', '치매'], budget: '15', existingMedicalPlan: '있음', medicalHistory: '고혈압 약 복용 중', existingPremium: '20', purpose: '보장 강화', renewalPreference: '허용' },
    { id: '15151515-1515-4151-8151-151515151505', name: '자녀 보험 고객', age: '8', gender: '남성', needs: ['암', '입원', '수술', '상해'], budget: '8', existingMedicalPlan: '없음', medicalHistory: '없음', existingPremium: '0', purpose: '신규 가입', renewalPreference: '비갱신 선호' },
    { id: '15151515-1515-4151-8151-151515151506', name: '보험료 절감 고객', age: '48', gender: '남성', needs: ['암', '뇌', '심장'], budget: '10', existingMedicalPlan: '있음', medicalHistory: '없음', existingPremium: '24', purpose: '보험료 절감' },
    { id: '15151515-1515-4151-8151-151515151507', name: '보장 강화 고객', age: '39', gender: '여성', needs: ['암', '뇌', '심장', '수술'], budget: '25', existingMedicalPlan: '있음', medicalHistory: '없음', existingPremium: '15', purpose: '보장 강화', renewalPreference: '비갱신 선호' },
    { id: '15151515-1515-4151-8151-151515151508', name: '갱신 허용 고객', age: '61', gender: '남성', needs: ['암', '간병'], budget: '14', existingMedicalPlan: '있음', medicalHistory: '고지혈증 약 복용 중', existingPremium: '16', purpose: '리모델링', renewalPreference: '허용' },
    { id: '15151515-1515-4151-8151-151515151509', name: '가입연령 경계 고객', age: '82', gender: '여성', needs: ['치매', '간병'], budget: '18', existingMedicalPlan: '있음', medicalHistory: '없음', existingPremium: '12', purpose: '보장 강화', renewalPreference: '허용' },
    { id: '15151515-1515-4151-8151-151515151510', name: '초저예산 고객', age: '45', gender: '남성', needs: ['암', '뇌', '심장'], budget: '3', existingMedicalPlan: '없음', medicalHistory: '없음', existingPremium: '3', purpose: '보험료 절감' }
  ];

  const outputs = [];
  for (const persona of personas) {
    await dbInsert('users', {
      id: persona.id,
      email: `${persona.id}@polibot-persona.test`,
      password_hash: 'test',
      name: persona.name,
      role: 'customer'
    });
    await dbInsert('user_products', {
      user_id: persona.id,
      product_id: 'polibot',
      status: 'active',
      role: 'customer',
      settings: {}
    });
    const workspace = await savePolibotRecommendation(persona.id, persona);
    const recommendation = workspace.recommendations[0];
    outputs.push({
      persona: persona.name,
      recommendation
    });
  }

  assert.equal(outputs.length, 10);
  outputs.forEach((output) => {
    assert.ok(output.recommendation, output.persona);
    assert.ok(output.recommendation.decisionAnalysis?.decisionScore?.scoreFormula?.components?.length >= 1, output.persona);
    assert.ok(output.recommendation.catalogItems?.[0]?.decisionBreakdown?.scoreFormula?.components?.length >= 1, output.persona);
    assert.ok((output.recommendation.nextQuestions || []).length >= 1, output.persona);
    assert.ok(output.recommendation.reviewSummary, output.persona);
    assert.match(output.recommendation.recommendationStatusLabel, /추천|상담|검수/, output.persona);
  });
  assert.ok(outputs.some((output) => output.recommendation.decisionAnalysis?.medicalRisk?.level === 'review'));
  assert.ok(outputs.some((output) => output.recommendation.decisionAnalysis?.ageChecks?.some((item) => item.status === 'blocked' || item.status === 'unknown')));
  assert.ok(outputs.some((output) => ['over_budget', 'reference_over_budget', 'severe_over_budget', 'reference_severe_over_budget'].includes(output.recommendation.decisionAnalysis?.premiumFit?.level)));
  const ageBlockedOutput = outputs.find((output) => output.persona === '가입연령 경계 고객');
  assert.ok(ageBlockedOutput.recommendation.decisionAnalysis?.ageChecks?.some((item) => item.status === 'blocked'));
  assert.equal(ageBlockedOutput.recommendation.score <= 58, true);
  assert.match(ageBlockedOutput.recommendation.reviewReasons.join(' '), /가입연령/);
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
  assert.ok(savedFeedback.recommendationSnapshot?.learningSignal?.reasonFlags?.length >= 1);
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

test('INFLUDEX caps risky high scores with confidence and quality signals', async () => {
  const userId = '33333333-3333-4333-8333-444444444444';
  await dbInsert('users', {
    id: userId,
    email: 'infludex-risk-cap-test@example.com',
    password_hash: 'test',
    name: 'INFLUDEX 리스크 캡',
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
    fileName: 'infludex-risk.csv',
    rows: [
      'url,handle,campaign,category,followers,avgLikes,avgComments,recentPostAt,adMemo',
      'https://instagram.com/suspicious,@suspicious,뷰티,가전,30000,12000,0,,광고 많음'
    ].join('\n')
  });
  const analyzed = await analyzeInfludexCandidates(userId);
  const target = analyzed.infludexResults.find((item) => item.handle === 'suspicious');

  assert.ok(target);
  assert.equal(['B', 'C', 'D'].includes(target.grade), true);
  assert.ok(Number(target.originalScore || 0) > Number(target.score || 0));
  assert.ok(target.riskFlags.includes('category_mismatch'));
  assert.ok(target.riskFlags.includes('heavy_ad_risk'));
  assert.ok(target.riskFlags.includes('suspicious_high_engagement'));
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

test('SUBLOG subscriptions are stored per user', async () => {
  const userId = '91919191-9191-4911-8911-919191919191';
  await dbInsert('users', {
    id: userId,
    email: 'sublog-storage-test@example.com',
    password_hash: 'test',
    name: 'SUBLOG Storage',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'sublog',
    status: 'active',
    role: 'customer',
    settings: {}
  });

  const created = await saveSublogSubscription(userId, {
    name: 'ChatGPT Plus',
    amount: 20,
    currency: 'USD',
    billingDay: 12,
    category: 'AI',
    memo: '업무 보조'
  });
  assert.equal(created.item.name, 'ChatGPT Plus');
  assert.equal(created.item.billingDay, 12);

  const updated = await saveSublogSubscription(userId, {
    id: created.item.id,
    name: 'ChatGPT Team',
    amount: 25,
    currency: 'USD',
    billingDay: 15,
    category: 'AI',
    memo: '팀 계정'
  });
  assert.equal(updated.item.name, 'ChatGPT Team');
  assert.equal(updated.item.amount, 25);

  const listed = await listSublogSubscriptions(userId);
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0].memo, '팀 계정');

  await deleteSublogSubscription(userId, created.item.id);
  const afterDelete = await listSublogSubscriptions(userId);
  assert.equal(afterDelete.items.length, 0);
});
