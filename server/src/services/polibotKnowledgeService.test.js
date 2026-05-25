import test from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import {
  buildPolibotProductCandidates,
  extractPolibotCoverageCodes,
  extractPolibotTextFromBuffer,
  inferPolibotFileType,
  normalizePolibotKnowledgeSource
} from './polibotKnowledgeService.js';

test('does not reject product names when a short insurer alias is contained in the insurer name', () => {
  const candidates = buildPolibotProductCandidates({
    fileName: '메리츠화재 간편건강보험.txt',
    text: [
      '메리츠화재 상품비교 가입설계 자료입니다.',
      '상품명 메리츠화재 (무)The간편한건강보험.',
      '간편고지 유병자 고혈압 당뇨 고객 검토 가능 상품입니다.',
      '보험료: 월 95,000원 가입연령 40세~75세 갱신형'
    ].join('\n')
  });

  const product = candidates.find((item) => item.name.includes('The간편한건강보험'));
  assert.ok(product);
  assert.notEqual(product.reason, 'multiple_companies_in_candidate');
  assert.notEqual(product.status, 'excluded');
});

test('normalizes no-paren mutual product fragments before candidate review', () => {
  const candidates = buildPolibotProductCandidates({
    fileName: '메리츠화재 간편건강보험.txt',
    text: '메리츠화재 상품비교 자료입니다. 상품명 무)The간편한건강보험. 보험료: 월 95,000원 가입연령 40세~75세'
  });
  assert.ok(candidates.some((item) => item.name === '(무)The간편한건강보험'));
  assert.equal(candidates.some((item) => item.name === '무)The간편한건강보험'), false);
});

test('extracts only explicit POLIBOT coverage codes and route codes', () => {
  const candidates = extractPolibotCoverageCodes({
    fileName: 'sample.pdf',
    text: [
      '질병코드 질병명 I47~I49 부정맥 I50 심부전 I60~I62 뇌출혈',
      '암 진단비 초기이상100만, 중기이상600만',
      '삼성화재 보장코드 305 암 진단비 특약',
      '상품명 (335 간편고지형) 남성 45세 보험료 30,000원',
      '실손(질병입원) 551,281 질병수술비'
    ].join('\n')
  });
  const codes = candidates.map((item) => item.code);
  assert.ok(codes.includes('305'));
  assert.ok(codes.includes('335'));
  assert.equal(codes.includes('100'), false);
  assert.equal(codes.includes('600'), false);
  assert.equal(codes.includes('47'), false);
  assert.equal(codes.includes('49'), false);
  assert.equal(codes.includes('281'), false);
});

test('does not treat QA or dated file prefixes as product names', () => {
  const candidates = buildPolibotProductCandidates({
    fileName: 'qa30-12345678-메리츠화재-간편건강보험.txt',
    text: [
      '메리츠화재 상품비교 가입설계 자료입니다.',
      '상품명 (무)The간편한건강보험.',
      '암 진단비 3,000만원 보험료: 월 95,000원 가입연령 40세~75세'
    ].join('\n')
  });
  assert.equal(candidates.some((item) => /^qa\d*-/.test(item.name)), false);
  assert.ok(candidates.some((item) => item.name === '(무)The간편한건강보험'));
});


test('does not mix monthly premium won values into coverage amounts', () => {
  const source = normalizePolibotKnowledgeSource({
    fileName: '메리츠화재 간편건강보험.txt',
    month: '2026-05',
    text: [
      '메리츠화재 상품비교 가입설계 자료입니다. 상품명 (무)The간편한건강보험.',
      '(무)The간편한건강보험은 간편고지 유병자 고객 검토 가능 상품입니다.',
      '암 진단비 3,000만원',
      '뇌혈관 진단비 1,000만원',
      '허혈성심장질환 진단비 1,000만원. 보험료: 월 95,000원',
      '가입연령 40세~75세 갱신형'
    ].join('\n')
  });

  const coverageAmounts = [
    ...(source.coverageDetails || []).map((item) => item.amount),
    ...(source.coverageTableRows || []).map((item) => item.amount),
    ...(source.linkedBenefitGroups || []).flatMap((group) => (group.coverages || []).map((item) => item.amount))
  ].filter(Boolean);
  const premiumAmounts = [
    ...(source.premiumCandidates || []).map((item) => item.amount),
    ...(source.premiumTableRows || []).map((item) => item.amount)
  ].filter(Boolean);

  assert.ok(coverageAmounts.includes('3,000만원'));
  assert.ok(coverageAmounts.includes('1,000만원'));
  assert.equal(coverageAmounts.includes('95,000원'), false);
  assert.ok(premiumAmounts.includes('95,000원'));
});

test('extracts xlsx worksheet rows so uploaded spreadsheets can feed POLIBOT analysis', async () => {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'));
  zip.addFile('xl/sharedStrings.xml', Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    '<si><t>상품명</t></si>',
    '<si><t>(무)The간편한건강보험</t></si>',
    '<si><t>담보</t></si>',
    '<si><t>암 진단비</t></si>',
    '<si><t>가입금액</t></si>',
    '<si><t>3,000만원</t></si>',
    '<si><t>보험료</t></si>',
    '<si><t>95,000원</t></si>',
    '<si><t>가입연령</t></si>',
    '<si><t>40세~75세</t></si>',
    '</sst>'
  ].join('')));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
    '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="C2" t="s"><v>4</v></c><c r="D2" t="s"><v>5</v></c></row>',
    '<row r="3"><c r="A3" t="s"><v>6</v></c><c r="B3" t="s"><v>7</v></c><c r="C3" t="s"><v>8</v></c><c r="D3" t="s"><v>9</v></c></row>',
    '</sheetData></worksheet>'
  ].join('')));

  assert.equal(inferPolibotFileType('2026-05-상품비교.xlsx'), 'xlsx');
  const text = await extractPolibotTextFromBuffer(zip.toBuffer(), '2026-05-상품비교.xlsx');
  assert.match(text, /상품명\s+\(무\)The간편한건강보험/);
  assert.match(text, /암 진단비\s+가입금액\s+3,000만원/);
  assert.match(text, /보험료\s+95,000원\s+가입연령\s+40세~75세/);

  const source = normalizePolibotKnowledgeSource({
    fileName: '2026-05-상품비교.xlsx',
    month: '2026-05',
    text
  });
  assert.equal(source.fileType, 'xlsx');
  assert.ok((source.productCandidates || []).some((item) => item.name.includes('The간편한건강보험') && item.status !== 'excluded'));
  assert.ok((source.premiumCandidates || []).some((item) => item.amount === '95,000원'));
  assert.ok((source.coverageDetails || []).some((item) => item.amount === '3,000만원'));
});

test('adds fine coverage categories and evidence anchors to parsed benefits', () => {
  const source = normalizePolibotKnowledgeSource({
    fileName: '2026-05-삼성화재-건강맞춤보험.txt',
    month: '2026-05',
    text: [
      '삼성화재 상품비교 가입설계 자료입니다. 상품명 (무)건강맞춤종합보험.',
      '일반암 진단비 5,000만원',
      '유사암 진단비 1,000만원',
      '뇌출혈 진단비 1,000만원',
      '허혈성심장질환 진단비 2,000만원',
      '교통사고처리지원금 1억원',
      '질병수술비 100만원',
      '보험료: 월 140,000원 가입연령 20세~60세 비갱신'
    ].join('\n')
  });

  const fineCategories = new Set((source.coverageDetails || []).map((item) => item.fineCategory));
  assert.ok(fineCategories.has('일반암'));
  assert.ok(fineCategories.has('유사암'));
  assert.ok(fineCategories.has('뇌출혈'));
  assert.ok(fineCategories.has('허혈성심장'));
  assert.ok(fineCategories.has('사고처리지원금'));
  assert.ok((source.coverageDetails || []).every((item) => item.evidenceAnchor?.fileName));
  assert.ok((source.catalogItems || []).some((item) => (item.evidenceAnchors || []).length >= 1));
});
