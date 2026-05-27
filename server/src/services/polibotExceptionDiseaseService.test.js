import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPolibotExceptionDiseases,
  normalizePolibotExceptionDiseaseSource,
  summarizePolibotExceptionDiseases
} from './polibotExceptionDiseaseService.js';

test('extracts coded exception disease rows with KCD and underwriting conditions', () => {
  const text = [
    'NO KCD코드 한글진단명 경과기간 인수가능 입원일수 시술/수술 여부',
    '1 A00 콜레라 즉시인수 14일이내 입원만',
    '13 A02.1 살모넬라패혈증 6개월 7일이내 입원만',
    '328 K22.9 기타 식도 질환 3개월 30일 무관 상해+2대 X X X 완화'
  ].join('\n');
  const source = normalizePolibotExceptionDiseaseSource({
    fileName: '흥국화재_유병자 예외질환 KCD리스트.pdf',
    sourceZip: '손보_간편보험 예외질환 리스트.zip',
    text,
    fileType: 'pdf'
  });
  const rows = extractPolibotExceptionDiseases({ source, text });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].company, '흥국화재');
  assert.equal(rows[0].carrierType, 'nonlife');
  assert.equal(rows[0].kcdCode, 'A00');
  assert.equal(rows[0].diseaseName, '콜레라');
  assert.equal(rows[0].eligibilityLevel, 'immediate_accept');
  assert.equal(rows[1].waitingPeriod.label, '6개월');
  assert.equal(rows[2].kcdCode, 'K22.9');
  assert.equal(rows[2].eligibilityLevel, 'restricted');
});

test('extracts uncoded table rows and keeps filename company over body aliases', () => {
  const text = [
    'ABL생명 참고 문구가 있어도 파일명 회사가 우선입니다.',
    '진단명 입원 수술조건 추가조건 치료종결 다음날 즉시인수 담보조건',
    '갑상선기능저하증 X 14일내 수술시 불가 갑상선담보 제한 X',
    '무지외반증 ○ 15일내 양측수술 필수 전담보 가능'
  ].join('\n');
  const source = normalizePolibotExceptionDiseaseSource({
    fileName: '흥국생명_간편고지보험_경증예외질환_현장가이드.xlsx',
    sourceZip: '생보_간편보험 예외질환 리스트.Zip',
    text,
    fileType: 'xlsx'
  });
  const rows = extractPolibotExceptionDiseases({ source, text });
  assert.equal(source.company, '흥국생명');
  assert.equal(source.carrierType, 'life');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].diseaseName, '갑상선기능저하증');
  assert.equal(rows[0].kcdCode, '');
  assert.equal(rows[0].hasSurgeryLimit, true);
  assert.equal(rows[1].diseaseCategory, '근골격/상해');
});

test('summarizes exception disease extraction', () => {
  const source = normalizePolibotExceptionDiseaseSource({
    fileName: '교보생명_간편심사보험 고지 유형별 인수 가능 질병 리스트.xlsx',
    sourceZip: '생보_간편보험 예외질환 리스트.Zip',
    text: 'A00 콜레라 ○ ○ X',
    fileType: 'xlsx'
  });
  const diseases = extractPolibotExceptionDiseases({ source, text: 'A00 콜레라 ○ ○ X' });
  const summary = summarizePolibotExceptionDiseases([source], diseases);
  assert.equal(summary.sourceCount, 1);
  assert.equal(summary.diseaseCount, 1);
  assert.equal(summary.codedDiseaseCount, 1);
  assert.deepEqual(summary.companies, ['교보생명']);
});
