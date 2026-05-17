import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPolibotDbKnowledgeSummary,
  ingestPolibotKnowledge,
  listPolibotDbKnowledgeSources,
  listPolibotKnowledgeReviewQueue,
  runPolibotSourceOcr,
  searchPolibotCodeCandidates,
  updatePolibotCatalogItemReview
} from './polibotKnowledgeDbService.js';

test('ingests POLIBOT global knowledge and skips duplicate files', async () => {
  const file = {
    name: '2026-05 삼성화재 퍼펙트 플러스 종합보험.txt',
    fileName: '2026-05 삼성화재 퍼펙트 플러스 종합보험.txt',
    type: 'txt',
    size: 240,
    text: '삼성화재 퍼펙트 플러스 종합보험 상품비교 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원, 수술 보장을 확인합니다. 보험료: 월 180,000원'
  };

  const first = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [file],
    dryRun: false
  });
  assert.equal(first.summary.insertedSources, 1);
  assert.ok(first.summary.insertedChunks >= 1);
  assert.ok(first.summary.insertedCatalogItems >= 1);

  const second = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [file],
    dryRun: false
  });
  assert.equal(second.summary.insertedSources, 0);
  assert.equal(second.summary.duplicateSources, 1);

  const sources = await listPolibotDbKnowledgeSources();
  const target = sources.find((source) => source.fileName === file.fileName);
  assert.ok(target);
  assert.equal(target.scope, 'global');
  assert.ok((target.catalogItems || []).length >= 1);
  assert.ok(target.evidenceQualityScore >= 58);
  assert.ok(target.evidenceQualityReasons.includes('상품/보험료 자료 맥락'));

  const summary = await getPolibotDbKnowledgeSummary();
  assert.ok(summary.totalSources >= 1);
  assert.ok(summary.catalogItems >= 1);
  assert.ok(summary.chunks >= 1);
  assert.equal(summary.sourceChannelCounts.local_ingest >= 1, true);
  assert.equal(summary.mediumQualitySources + summary.highQualitySources >= 1, true);
});

test('detects KakaoTalk txt uploads as consultation insights', async () => {
  const file = {
    name: 'kakao-polibot-consult-test.txt',
    fileName: 'kakao-polibot-consult-test.txt',
    type: 'txt',
    size: 180,
    text: [
      '[상담사] 오전 10:12 고객님 기존 실손보험이 있나요?',
      '[고객] 오전 10:13 실손은 있고 현재 보험료 30만원 정도예요.',
      '[상담사] 오전 10:14 목표 월 보험료는 어느 정도인가요?',
      '[고객] 오전 10:15 목표는 40만원이고 암, 뇌, 심장 진단비를 보고 싶어요.'
    ].join('\n')
  };

  const result = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'web_upload',
    files: [file],
    dryRun: false
  });

  assert.equal(result.summary.insertedSources, 1);
  assert.equal(result.summary.insertedConversationInsights, 1);
  assert.equal(result.sources[0].sourceChannel, 'kakao_txt');

  const summary = await getPolibotDbKnowledgeSummary();
  assert.ok(summary.conversationInsights >= 1);
  assert.equal(summary.sourceChannelCounts.kakao_txt >= 1, true);
});

test('skips duplicate chunks across different POLIBOT sources in the same scope', async () => {
  const sharedText = '현대해상 굿앤굿 어린이 종합보험 상품비교 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원 보장을 확인합니다.';
  const first = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [{
      name: 'chunk-dedupe-a.txt',
      fileName: 'chunk-dedupe-a.txt',
      type: 'txt',
      size: 150,
      fileHash: 'chunk-dedupe-a-file-hash',
      text: sharedText
    }],
    dryRun: false
  });
  const second = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [{
      name: 'chunk-dedupe-b.txt',
      fileName: 'chunk-dedupe-b.txt',
      type: 'txt',
      size: 160,
      fileHash: 'chunk-dedupe-b-file-hash',
      text: `${sharedText}\n\n추가 자료: 2026년 5월 기준 가입설계 메모입니다.`
    }],
    dryRun: false
  });

  assert.equal(first.summary.insertedChunks >= 1, true);
  assert.equal(second.summary.insertedSources, 1);
  assert.equal(second.summary.duplicateChunks >= 1, true);
  assert.equal(second.summary.insertedChunks, 1);
});

test('marks privacy risk POLIBOT sources and keeps them out of recommendable catalog items', async () => {
  const result = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'kakao_txt',
    files: [{
      name: 'privacy-risk-polibot-consult.txt',
      fileName: 'privacy-risk-polibot-consult.txt',
      type: 'txt',
      size: 220,
      text: [
        '[상담사] 오전 9:01 홍길동 고객님 연락처 010-1234-5678 확인했습니다.',
        '[고객] 오전 9:02 주민번호는 900101-1234567이고 서울 강남구 테헤란로 거주 중입니다.',
        '[상담사] 오전 9:03 암, 뇌, 심장 진단비와 실손보험 상담을 진행합니다.'
      ].join('\n')
    }],
    dryRun: false
  });

  assert.equal(result.summary.insertedSources, 1);
  assert.equal(result.summary.insertedCatalogItems, 0);
  assert.equal(result.sources[0].knowledgeStatus, 'privacy_risk');
  assert.equal(result.sources[0].recommendationEligible, false);
  assert.match(result.sources[0].redactedSnippet, /\[전화번호\]|\[민감번호\]|\[주소\]/);

  const summary = await getPolibotDbKnowledgeSummary();
  assert.equal(summary.privacyRiskSources >= 1, true);
});

test('queues image and textless PDF sources for OCR and records OCR failures', async () => {
  const result = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [
      {
        name: 'scan-image-polibot-test.png',
        fileName: 'scan-image-polibot-test.png',
        type: 'image',
        size: 120,
        fileHash: 'scan-image-polibot-test-file-hash'
      },
      {
        name: 'scan-pdf-polibot-test.pdf',
        fileName: 'scan-pdf-polibot-test.pdf',
        type: 'pdf',
        size: 220,
        fileHash: 'scan-pdf-polibot-test-file-hash',
        text: ''
      }
    ],
    dryRun: false
  });

  assert.equal(result.summary.insertedSources, 2);
  assert.equal(result.sources.filter((source) => source.knowledgeStatus === 'ocr_needed').length, 2);

  const queue = await listPolibotKnowledgeReviewQueue({ status: 'ocr_needed', scope: 'global' });
  const imageSource = queue.sources.find((source) => source.fileName === 'scan-image-polibot-test.png');
  assert.ok(imageSource);

  const ocrResult = await runPolibotSourceOcr(imageSource.id, { reviewerId: 'test-admin' });
  assert.equal(ocrResult.source.status, 'ocr_needed');
  assert.equal(ocrResult.source.ocrStatus, 'failed');
  assert.match(ocrResult.source.ocrLastError, /원본 파일 경로|Storage/);
});

test('marks catalog items as conflict when same product has different core facts', async () => {
  const baseFile = {
    name: 'conflict-product-a.txt',
    fileName: 'conflict-product-a.txt',
    type: 'txt',
    size: 220,
    fileHash: 'conflict-product-a-file-hash',
    text: '현대해상 굿앤굿 어린이 종합보험 상품비교 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비 보장. 보험료: 월 100,000원 가입연령 0세~30세 비갱신'
  };
  const changedFile = {
    name: 'conflict-product-b.txt',
    fileName: 'conflict-product-b.txt',
    type: 'txt',
    size: 220,
    fileHash: 'conflict-product-b-file-hash',
    text: '현대해상 굿앤굿 어린이 종합보험 상품비교 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비 보장. 보험료: 월 120,000원 가입연령 0세~30세 비갱신'
  };

  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [baseFile],
    dryRun: false
  });
  const changed = await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [changedFile],
    dryRun: false
  });

  assert.equal(changed.summary.insertedSources, 1);
  const conflictItem = changed.sources[0].catalogItems.find((item) => item.conflictReasons?.length);
  assert.ok(conflictItem);
  assert.equal(conflictItem.status, 'excluded');

  const summary = await getPolibotDbKnowledgeSummary();
  assert.equal(summary.conflictCatalogItems >= 1, true);
});

test('lists and updates POLIBOT catalog review queue', async () => {
  const queue = await listPolibotKnowledgeReviewQueue({ status: 'conflict', scope: 'global' });
  const conflictItem = queue.catalogItems.find((item) => item.status === 'conflict');
  assert.ok(conflictItem);

  const updated = await updatePolibotCatalogItemReview(conflictItem.id, {
    status: 'excluded',
    reviewNote: '테스트에서 충돌 후보 제외',
    reviewerId: 'test-admin'
  });
  assert.equal(updated.status, 'excluded');
  assert.equal(updated.reviewNote, '테스트에서 충돌 후보 제외');
});

test('searches POLIBOT coverage code candidates by code and coverage context', async () => {
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    files: [{
      name: 'coverage-code-search-test.txt',
      fileName: 'coverage-code-search-test.txt',
      type: 'txt',
      size: 180,
      fileHash: 'coverage-code-search-test-file-hash',
      text: '삼성화재 보장코드 305 암 진단비 특약 자료입니다. 33번 담보는 뇌혈관 진단비 보장으로 확인합니다.'
    }],
    dryRun: false
  });

  const byCode = await searchPolibotCodeCandidates('', { query: '305' });
  assert.ok(byCode.some((item) => item.code === '305' && item.coverageKeywords.includes('암')));

  const byCoverage = await searchPolibotCodeCandidates('', { query: '뇌혈관 진단비' });
  assert.ok(byCoverage.some((item) => item.code === '33'));
});
