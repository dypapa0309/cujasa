import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorkspaceAssistantIntent } from './workspaceAssistantService.js';

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
