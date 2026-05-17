import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractPolibotPremiumCandidates,
  extractPolibotPremiumTableRows,
  normalizePolibotPremiumAmountText
} from './polibotPremiumTableParser.js';

test('normalizes comma won and manwon premium text', () => {
  assert.equal(normalizePolibotPremiumAmountText('월 45,400원'), '45,400원');
  assert.equal(normalizePolibotPremiumAmountText('보험료: 월 12.5 만 원'), '12.5만원');
});

test('extracts gender and age matrix premium rows with unit conversion', () => {
  const text = [
    '삼성화재 퍼펙트 플러스 종합보험',
    '보험료 예시 [월납, 단위:천원]',
    '구분 남자 40세 여자 40세 남자 50세',
    '표준플랜 45.4 39.2 58.1'
  ].join('\n');

  const rows = extractPolibotPremiumTableRows(text, '삼성화재 퍼펙트 플러스 종합보험');

  assert.deepEqual(rows.slice(0, 3).map((row) => ({
    amount: row.amount,
    age: row.age,
    gender: row.gender,
    plan: row.plan,
    confidence: row.confidence
  })), [
    { amount: '45,400원', age: '40', gender: '남성', plan: '표준플랜', confidence: 'product_premium_matrix' },
    { amount: '39,200원', age: '40', gender: '여성', plan: '표준플랜', confidence: 'product_premium_matrix' },
    { amount: '58,100원', age: '50', gender: '남성', plan: '표준플랜', confidence: 'product_premium_matrix' }
  ]);
});

test('does not treat coverage amounts as premium table rows', () => {
  const text = [
    '담보 가입금액',
    '일반암 진단비 3,000만원',
    '유사암 진단비 600만원',
    '뇌혈관질환 진단비 2,000만원'
  ].join('\n');

  const rows = extractPolibotPremiumTableRows(text);
  assert.equal(rows.length, 0);
});

test('ignores rider amounts that sit before a monthly premium on the same line', () => {
  const text = [
    '삼성화재 상품비교 가입설계 자료입니다. 상품명 (무)건강맞춤종합보험.',
    '질병수술비 100만원 입원일당 3만원. 보험료: 월 140,000원 가입연령 20세~60세 비갱신'
  ].join('\n');

  const rows = extractPolibotPremiumCandidates(text, '(무)건강맞춤종합보험');
  assert.ok(rows.some((row) => row.amount === '140,000원'));
  assert.equal(rows.some((row) => row.amount === '3만원'), false);
  assert.equal(rows.some((row) => row.amount === '100만원'), false);
});

test('merges direct premium candidates with structured premium rows', () => {
  const text = [
    '현대해상 굿앤굿 어린이 종합보험',
    '보험료: 월 120,000원',
    '보험료 예시 [월납, 단위:천원]',
    '구분 남자 40세 여자 40세',
    '실속플랜 33.2 29.8'
  ].join('\n');

  const rows = extractPolibotPremiumCandidates(text, '현대해상 굿앤굿 어린이 종합보험');
  assert.ok(rows.some((row) => row.amount === '120,000원' && row.confidence === 'direct_context'));
  assert.ok(rows.some((row) => row.amount === '33,200원' && row.gender === '남성' && row.plan === '실속플랜'));
  assert.ok(rows.some((row) => row.amount === '29,800원' && row.gender === '여성' && row.plan === '실속플랜'));
});
