import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackBriefing,
  clusterNewsItems,
  extractKeywords,
  keywordSignatureOverlap,
  matchProductRule,
  slugifyIssue
} from './issueService.js';

test('extractKeywords strips brackets, particles, stopwords and short tokens', () => {
  const keywords = extractKeywords('[속보] 폭염에 전기요금 부담 커진다 (종합)');
  assert.ok(keywords.includes('폭염'));
  assert.ok(keywords.includes('전기요금'));
  assert.ok(!keywords.includes('속보'));
  assert.ok(!keywords.includes('종합'));
});

test('extractKeywords dedupes and drops pure numbers', () => {
  const keywords = extractKeywords('폭염 폭염 2026 40도 폭염');
  assert.deepEqual(keywords.filter((keyword) => keyword === '폭염').length, 1);
  assert.ok(!keywords.includes('2026'));
});

test('clusterNewsItems groups items sharing keywords and keeps singletons apart', () => {
  const items = [
    { title: '폭염에 전기요금 부담 급증', link: 'u1' },
    { title: '전기요금 폭염 대책 발표', link: 'u2' },
    { title: '폭염 전기요금 인상 논의', link: 'u3' },
    { title: '반려동물 등록제 시행 확대', link: 'u4' }
  ];
  const clusters = clusterNewsItems(items);
  const big = clusters.find((cluster) => cluster.items.length === 3);
  assert.ok(big, 'expected a 3-item cluster');
  assert.ok(big.keywords.includes('폭염'));
  assert.ok(big.keywords.includes('전기요금'));
  const single = clusters.find((cluster) => cluster.items.length === 1);
  assert.ok(single);
});

test('matchProductRule maps issue keywords to shopping keywords and category', () => {
  const rule = matchProductRule(['폭염', '전기요금']);
  assert.ok(rule);
  assert.equal(rule.category, '생활');
  assert.ok(rule.keywords.length > 0);
  assert.equal(matchProductRule(['우주', '탐사']), null);
});

test('slugifyIssue is deterministic per keywords+day and url-safe', () => {
  const date = new Date('2026-07-14T05:00:00Z');
  const a = slugifyIssue(['폭염', '전기요금', '냉방'], date);
  const b = slugifyIssue(['폭염', '전기요금', '냉방'], date);
  assert.equal(a, b);
  assert.ok(a.startsWith('20260714-'));
  assert.ok(!/[^0-9a-z가-힣-]/.test(a));
  const c = slugifyIssue(['다른', '키워드'], date);
  assert.notEqual(a, c);
});

test('keywordSignatureOverlap measures overlap against the smaller set', () => {
  assert.equal(keywordSignatureOverlap(['a', 'b', 'c'], ['a', 'b']), 1);
  assert.equal(keywordSignatureOverlap(['a', 'b'], ['c', 'd']), 0);
  assert.ok(keywordSignatureOverlap(['a', 'b', 'c', 'd'], ['a', 'b', 'x', 'y']) >= 0.5);
});

test('buildFallbackBriefing mentions keywords and publishers without LLM', () => {
  const briefing = buildFallbackBriefing({
    keywords: ['폭염', '전기요금'],
    items: [
      { title: 't1', publisher: '연합뉴스' },
      { title: 't2', publisher: 'KBS' },
      { title: 't3', publisher: null }
    ]
  });
  assert.ok(briefing.includes('폭염'));
  assert.ok(briefing.includes('연합뉴스'));
  assert.ok(briefing.includes('2개 매체'));
});
