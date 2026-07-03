import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inferAccountContentDomain,
  validatePostCandidate,
  validateProductCandidate,
  validateTopicCandidate
} from './contentGuardrails.js';

const petAccount = {
  name: '동물채널',
  account_handle: '@animal_channel',
  content_scope: '반려동물 용품과 산책 루틴',
  target_audience: '강아지 고양이 집사'
};

test('infers pet account domain from account profile text', () => {
  assert.equal(inferAccountContentDomain(petAccount), 'pet');
});

test('blocks mukbang and general food content on pet accounts', () => {
  const topic = validateTopicCandidate({
    title: '편의점 쿠키 먹방템 고르는 기준',
    angle: '야식 먹방처럼 보기 좋은 간식',
    searchKeywords: ['쿠키 먹방', '편의점 디저트']
  }, petAccount);
  const post = validatePostCandidate(
    '오늘은 편의점 쿠키 먹방처럼 먹기 좋은 간식 기준을 봐요. 손에 덜 묻고 나눠 먹기 쉬운지가 먼저예요.',
    petAccount,
    { title: '간식 추천', angle: '먹방형 간식' }
  );

  assert.equal(topic.allowed, false);
  assert.equal(post.allowed, false);
  assert.ok(topic.reasons.some((reason) => /도메인 불일치|먹방/.test(reason)));
  assert.ok(post.reasons.some((reason) => /도메인 불일치|먹방/.test(reason)));
});

test('blocks general snack products but allows pet-specific snack products', () => {
  const generalSnack = validateProductCandidate({
    product_name: '달콤한 초코 쿠키 세트',
    category_name: '식품 간식',
    keyword: '쿠키 디저트'
  }, petAccount);
  const petSnack = validateProductCandidate({
    product_name: '강아지 산책 간식 파우치',
    category_name: '반려동물 용품',
    keyword: '강아지 간식 보관'
  }, petAccount);

  assert.equal(generalSnack.allowed, false);
  assert.equal(petSnack.allowed, true);
});
