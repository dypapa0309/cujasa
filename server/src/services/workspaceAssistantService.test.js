import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestWorkspaceAssistantWorkflow, classifyWorkspaceAssistantIntent } from './workspaceAssistantService.js';

const allProducts = ['cujasa', 'dexor', 'spread', 'polibot', 'infludex'];

function classify(message, options = {}) {
  return classifyWorkspaceAssistantIntent({
    message,
    currentProduct: options.currentProduct || 'cujasa',
    availableProducts: options.availableProducts || allProducts,
    workspace: options.workspace || {}
  });
}

const routingCases = [
  ['쿠팡 API 어디에 넣어?', 'settings', 'cujasa'],
  ['오늘 자동화 실행해줘', 'run', 'cujasa'],
  ['예약된 포스팅 현황 보여줘', 'posts', 'cujasa'],
  ['결제 상태 확인하고 싶어', 'billing', 'cujasa'],
  ['맛집 블로그 후보 분석해줘', 'dexor-upload', 'dexor'],
  ['덱서 등급 분석 열어줘', 'dexor-grade', 'dexor'],
  ['DEXOR 결과 csv 다운로드', 'dexor-download', 'dexor'],
  ['스프레드 인스타 캠페인 추천해줘', 'spread-campaign', 'spread'],
  ['SPREAD 신청자 선정 열어줘', 'spread-applicants', 'spread'],
  ['스프레드 제출물 검수', 'spread-review', 'spread'],
  ['폴리봇 PDF 자료 업로드', 'polibot-upload', 'polibot'],
  ['POLIBOT 고객 관리', 'polibot-customers', 'polibot'],
  ['폴리봇 결과 다운로드', 'polibot-download', 'polibot']
];

test('routes high-confidence workspace utterances to expected actions', () => {
  for (const [message, action, productId] of routingCases) {
    const result = classify(message);
    assert.equal(result.action, action, message);
    assert.equal(result.productId, productId, message);
    assert.ok(result.confidence >= 0.8, message);
  }
});

test('extracts CUJASA settings draft fields', () => {
  const result = classify('3040 여성 반말로 주방용품 포스팅해줘');
  assert.equal(result.action, 'settings');
  assert.equal(result.intent, 'cujasa_settings_draft');
  assert.equal(result.draft.target_audience, '3040 여성');
  assert.equal(result.draft.tone, '반말');
  assert.equal(result.draft.content_scope, '주방용품');
});

test('extracts POLIBOT recommendation draft fields', () => {
  const result = classify('37세 남성 김민수 고객 암 실비 진단비 월 15만원 보험 추천');
  assert.equal(result.action, 'polibot-recommend');
  assert.equal(result.productId, 'polibot');
  assert.equal(result.draft.name, '김민수');
  assert.equal(result.draft.age, '37');
  assert.equal(result.draft.gender, '남성');
  assert.equal(result.draft.budget, '15');
  assert.match(result.draft.needs, /암/);
  assert.match(result.draft.needs, /실비/);
  assert.match(result.draft.needs, /진단비/);
  assert.equal(result.draft.company, '전체 보험사');
});

test('extracts POLIBOT disclosure and disease events from consultation text', () => {
  const result = classify('김민수 45세 남성 암 뇌 심장 보험 추천 목표 20 현재 12 실손 없음 2026.01.15 I10 고혈압 통원 투약중 1년고지 있음 5년고지 없음 비갱신 선호', {
    currentProduct: 'polibot'
  });
  assert.equal(result.action, 'polibot-recommend');
  assert.equal(result.draft.name, '김민수');
  assert.equal(result.draft.age, '45');
  assert.equal(result.draft.budget, '20');
  assert.equal(result.draft.existingPremium, '12');
  assert.equal(result.draft.existingMedicalPlan, '없음');
  assert.equal(result.draft.renewalPreference, '비갱신 선호');
  assert.equal(result.draft.disclosureDetails.recent1Year, '있음');
  assert.equal(result.draft.disclosureDetails.recent5Years, '없음');
  assert.equal(result.draft.disclosureDetails.diseaseEvents[0].occurredAt, '2026-01-15');
  assert.equal(result.draft.disclosureDetails.diseaseEvents[0].kcdCode, 'I10');
  assert.equal(result.draft.disclosureDetails.diseaseEvents[0].diseaseName, '고혈압');
  assert.equal(result.draft.disclosureDetails.diseaseEvents[0].eventType, '투약');
  assert.equal(result.draft.disclosureDetails.diseaseEvents[0].status, '투약중');
});

test('clarifies ambiguous utterances without opening a panel', () => {
  const result = classify('도와줘');
  assert.equal(result.intent, 'clarification_required');
  assert.equal(result.action, '');
  assert.equal(result.clarification, true);
  assert.ok(result.buttons.length >= 2);
});

test('routes product-not-started requests to product start action', () => {
  const result = classify('폴리봇으로 37세 남성 암보험 추천', {
    availableProducts: ['cujasa']
  });
  assert.equal(result.intent, 'product_start_required');
  assert.equal(result.action, 'polibot');
  assert.equal(result.productId, 'polibot');
  assert.equal(result.requiresConfirmation, true);
});

test('routes JASAIN hub and next-action requests to home', () => {
  const overview = classify('자사인 뭐 하는 서비스야?');
  assert.equal(overview.intent, 'jasain_product_overview');
  assert.equal(overview.action, 'home');
  assert.ok(overview.answer.includes('허브'));
  assert.ok(overview.buttons.some((item) => item.actionKey === 'home'));

  const next = classify('지금 뭐 해야 돼?');
  assert.equal(next.intent, 'jasain_home_next_action');
  assert.equal(next.action, 'home');
});

test('test workflow collects POLIBOT recommendation fields across turns', () => {
  const first = buildTestWorkspaceAssistantWorkflow({
    message: '이상빈 34세 남성 심장 실손 목표 40 현재 30',
    currentProduct: 'polibot',
    workflow: { enabled: true, key: 'polibot_recommendation' }
  });
  assert.equal(first.action, 'polibot-recommend');
  assert.equal(first.workflow.key, 'polibot_recommendation');
  assert.equal(first.draft.name, '이상빈');
  assert.equal(first.draft.age, '34');
  assert.equal(first.draft.gender, '남성');
  assert.equal(first.draft.budget, '40');
  assert.equal(first.draft.existingPremium, '30');
  assert.match(first.draft.needs, /심장/);
  assert.match(first.draft.needs, /실손/);
  assert.equal(first.readyToSubmit, true);
  assert.ok(first.missingFields.some((field) => field.key === 'medicalHistory'));

  const second = buildTestWorkspaceAssistantWorkflow({
    message: '실손 없음 고지 없음 2025-03-01 H25 백내장 수술 완치 1년고지 있음 5년고지 있음',
    currentProduct: 'polibot',
    workflow: {
      enabled: true,
      key: 'polibot_recommendation',
      state: first.workflow
    }
  });
  assert.equal(second.draft.existingMedicalPlan, '없음');
  assert.match(second.draft.medicalHistory, /백내장|H25/);
  assert.equal(second.draft.disclosureDetails.recent1Year, '있음');
  assert.equal(second.draft.disclosureDetails.recent5Years, '있음');
  assert.equal(second.draft.disclosureDetails.diseaseEvents[0].kcdCode, 'H25');
  assert.equal(second.draft.disclosureDetails.diseaseEvents[0].eventType, '수술');
  assert.equal(second.readyToSubmit, true);
  assert.equal(second.missingFields.filter((field) => field.importance === 'confirm').length, 0);
});
