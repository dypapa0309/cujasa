import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePolibotCoverageDocument, parsePolibotCoverageDocumentText } from './polibotCoverageDocumentService.js';

test('parses customer coverage analysis text into POLIBOT recommendation form values', () => {
  const text = `
이보림(33세 ,여자) 님의 전체 보장현황
392,901
일반암 9,000만 - 5,000만 4,000만 -
유사암 1,800만 - 1,400만 400만 -
뇌혈관질환 2,500만 - 500만 2,000만 -
허혈성심장질환 2,500만 - 500만 2,000만 -
질병수술비 60만 - 60만 -
상해입원의료비 5,000만 - 5,000만 -
교통사고처리지원금 2억 1,000만 - 2억 1,000만 -

이보림 님의 담보별 가입 현황
일반암
미래에셋생명 예방하자 암보험Ⅱ 무배당 1804 [비갱신형(저해지환급형)] 암진단 4,000만 2018-04-30 2093-04-30
삼성화재 무배당 삼성화재 건강보험 마이헬스 파트너 [갱신형] 암 진단비(유사암 제외) 2,000만 2020-10-12 2093-10-12
뇌혈관질환
흥국생명 간편건강보험 뇌혈관질환 2,000만 2026-01-21 2093-01-21
삼성화재 건강보험 [갱신형] 뇌혈관질환 진단비A 500만 2020-10-12 2093-10-12

이보림 님의 전체 계약리스트
1 메리츠화재 (무) 펫퍼민트 Puppy Family보험 다이렉트 2508 2025-09-16 월납 20년 52세 35,750원
2 삼성화재 무배당 삼성화재 건강보험 마이헬스 파트너 2020-10-12 월납 73년 100세 75,000원
3 삼성화재 무배당 삼성화재 재물보험 수퍼비즈니스
(BOP)(2304.20) 2024-01-17 0년 36세 보험료미제공
상품별 가입현황
(3) 삼성화재
무배당 삼성화재 재물보험
수퍼비즈니스
(BOP)(2304.20)
36세 만기
2024.01.17~2029.01.17
보험료미제공
최근 5년 입원 수술 없음
`;
  const values = parsePolibotCoverageDocumentText(text, '이보림 보장분석.pdf');
  assert.equal(values.name, '이보림');
  assert.equal(values.age, '33');
  assert.equal(values.gender, '여성');
  assert.equal(values.existingPolicyDetails.length, 3);
  assert.equal(values.existingPremium, '11.1');
  assert.equal(values.existingPolicyDetails[2].premium, '보험료미제공');
  assert.equal(values.existingPolicyDetails[2].status, '보험료 확인 필요');
  assert.equal(values.currentCoverage.cancer.amount, '9,000만');
  assert.equal(values.currentCoverage.cancer.renewalType, '혼합(갱신/비갱신)');
  assert.equal(values.currentCoverage.cancer.maturity, '2093년');
  assert.equal(values.currentCoverage.brain.amount, '2,500만');
  assert.equal(values.currentCoverage.brain.renewalType, '갱신형');
  assert.equal(values.currentCoverage.brain.maturity, '2093년');
  assert.equal(values.currentCoverage.driver.amount, '2억 1,000만');
  assert.equal(values.existingMedicalPlan, '있음');
});

test('analyzes uploaded text coverage document without stale local variable references', async () => {
  const text = `
김정숙(61세 ,여자) 님의 전체 보장현황
일반암 3,000만 - 5,000만 - -
상해입원의료비 5,000만 - 5,000만 -
김정숙 님의 전체 계약리스트
1 삼성화재 무배당 건강보험 2020-01-01 월납 20년 100세 50,000원
상품별 가입현황
`;
  const result = await analyzePolibotCoverageDocument({
    fileName: '김정숙 보장분석.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(text, 'utf8').toString('base64')
  });
  assert.equal(result.values.name, '김정숙');
  assert.equal(result.document.type, 'customer_coverage');
  assert.equal(result.document.customerCoverage, true);
  assert.equal(result.confidence.policies, 'high');
  assert.equal(result.fileName, '김정숙 보장분석.txt');
});

test('classifies insurer sales materials separately from customer coverage analysis', async () => {
  const text = `
GA소식지 2026년 5월호
본 자료는 판매인 교육용이며 고객 제시 불가 자료입니다.
암 주요치료비 순환계 주요치료비 간편심사형 상품 안내
상품 관련 자세한 사항은 반드시 약관 및 상품설명서를 확인하시기 바랍니다.
`;
  const result = await analyzePolibotCoverageDocument({
    fileName: 'AIA생명_26.5월 GA소식지.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(text, 'utf8').toString('base64')
  });
  assert.equal(result.document.type, 'sales_material');
  assert.equal(result.document.customerCoverage, false);
  assert.ok(result.warnings.some((warning) => warning.includes('보험사 상품자료')));
});

test('classifies HIRA visit summaries separately from customer coverage analysis', async () => {
  const text = `
2026-5-25 순번 병·의원&약국 입원(외래)일수 총 진료비 건강보험 등 혜택받은 금액 내가 낸 의료비
1 서울정형외과의원 0(12) 100,000 70,000 30,000
2 행복약국 0(5) 50,000 35,000 15,000
진료정보요약 · 본 자료는 병·의원&약국에서 청구한 요양급여비용 기준입니다.
`;
  const result = await analyzePolibotCoverageDocument({
    fileName: 'report1.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(text, 'utf8').toString('base64')
  });
  assert.equal(result.document.type, 'hira');
  assert.equal(result.document.customerCoverage, false);
  assert.equal(result.document.label, '심평원 자료');
  assert.match(result.values.disclosureDetails.recent3Months, /최근 3개월 문진 필요/);
  assert.match(result.values.medicalHistory, /심평원 자료종류/);
  assert.match(result.values.medicalHistory, /치료횟수 12회/);
  assert.match(result.values.medicalHistory, /투약일수 5일/);
  assert.match(result.values.underwritingAssessment.note, /최근 3개월/);
  assert.ok(result.warnings.some((warning) => warning.includes('최근 3개월')));
});

test('extracts HIRA basic and medication thresholds for healthy disclosure review', async () => {
  const text = `
기본진료정보
2026-5-25 순번 병·의원&약국 입원(외래)일수 총 진료비 건강보험 등 혜택받은 금액 내가 낸 의료비
1 서울내과의원 0(8) 100,000 70,000 30,000
약제정보
2 행복약국 0(0) 50,000 35,000 15,000
총 투약일수 35일
`;
  const result = await analyzePolibotCoverageDocument({
    fileName: '기본진료정보_약제정보.txt',
    mimeType: 'text/plain',
    base64: Buffer.from(text, 'utf8').toString('base64')
  });
  assert.equal(result.document.type, 'hira');
  assert.deepEqual(result.values.disclosureDetails.hiraDocumentTypes, ['기본진료정보', '약제정보', '진료비정보']);
  assert.match(result.values.disclosureDetails.healthyDisclosureCheck, /7회 이상 치료/);
  assert.match(result.values.disclosureDetails.healthyDisclosureCheck, /30일 이상 투약/);
  assert.match(result.values.medicalHistory, /치료횟수 8회/);
  assert.match(result.values.medicalHistory, /투약일수 35일/);
});
