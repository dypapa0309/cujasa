import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateProductTopicMatch } from './productMatching.js';

const baseProduct = {
  id: 'product-row',
  product_id: 'product-1',
  product_name: '일상나눔 스마일 하수구 냄새 차단 매트 2p',
  product_price: 8900,
  product_image: 'https://example.com/image.jpg',
  partner_url: 'https://link.coupang.com/example',
  category_name: '생활',
  is_fallback: false
};

test('blocks child keyword false positives like 아이 matching 아이트랩', () => {
  const product = {
    ...baseProduct,
    product_name: '두진 원터치 고무 아이트랩 세면대 부속품',
    keyword: '냄새 차단'
  };
  const match = evaluateProductTopicMatch(product, { title: '아이 있는 집 냄새 관리' }, { content_scope: '생활', target_audience: '육아맘' });

  assert.equal(match.linkable, false);
  assert.ok(match.riskReasons.some((reason) => reason.includes('오매칭')));
});

test('keeps directly relevant storage products linkable', () => {
  const product = {
    ...baseProduct,
    product_name: '깔끔조아 다용도 투명 정리함 수납함',
    keyword: '주방 정리 수납'
  };
  const match = evaluateProductTopicMatch(product, { title: '주방 정리' }, { content_scope: '생활', target_audience: '육아맘' });

  assert.equal(match.linkable, true);
  assert.ok(match.score >= 45);
});

test('blocks weak broad gift matches', () => {
  const product = {
    ...baseProduct,
    product_name: '데미무드 다용도 스택 정리함',
    keyword: '생활 정리'
  };
  const match = evaluateProductTopicMatch(product, { title: '가정의 달 선물' }, { content_scope: '생활', target_audience: '육아맘' });

  assert.equal(match.linkable, false);
  assert.ok(match.riskReasons.includes('선물 맥락 약함'));
});

test('blocks general food products on pet accounts', () => {
  const product = {
    ...baseProduct,
    product_name: '달콤한 초코 쿠키 세트',
    category_name: '식품 간식',
    keyword: '쿠키 디저트'
  };
  const match = evaluateProductTopicMatch(product, {
    title: '강아지 산책 간식 파우치',
    angle: '산책 가방에서 바로 찾는 기준'
  }, {
    name: '동물채널',
    content_scope: '반려동물 용품과 산책 루틴',
    target_audience: '강아지 고양이 집사'
  });

  assert.equal(match.linkable, false);
  assert.ok(match.riskReasons.some((reason) => /도메인 불일치|먹방|음식/.test(reason)));
});

test('keeps pet-specific snack pouches linkable for pet accounts', () => {
  const product = {
    ...baseProduct,
    product_name: '강아지 산책 간식 파우치',
    category_name: '반려동물 용품',
    keyword: '강아지 간식 보관'
  };
  const match = evaluateProductTopicMatch(product, {
    title: '강아지 산책 간식 파우치',
    angle: '나가기 직전 바로 집히는지 확인'
  }, {
    name: '동물채널',
    content_scope: '반려동물 용품과 산책 루틴',
    target_audience: '강아지 고양이 집사'
  });

  assert.equal(match.linkable, true);
  assert.ok(match.score >= 45);
});
