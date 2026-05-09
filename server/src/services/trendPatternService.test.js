import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessTrendSimilarityRisk,
  buildTrendInspiredContentPreview,
  extractTrendPatterns,
  generateTrendInspiredPosts,
  rankTrendSamples
} from './trendPatternService.js';
import {
  buildReferencePatternContext,
  ingestTrendReferencesForAccount,
  saveAnonymousTrendPatternAssets,
  updateTrendPatternQualityStatus
} from './trendReferenceLearningService.js';
import { dbGet, dbList, dbUpdate } from './supabaseService.js';

const samples = [
  {
    id: 'safe-high',
    topicKeyword: '자취 꿀템',
    sourceText: '자취방 정리할 때 접어서 넣는 사람 vs 걸어두는 사람, 이거 은근 기준 갈리더라. 다들 어느 쪽이에요?',
    likes: 900,
    replies: 160,
    reposts: 30,
    views: 18000
  },
  {
    id: 'unsafe-high',
    topicKeyword: '생활',
    sourceText: '요즘 애들은 이런 것도 못 고르더라. 세대 차이 진짜 심한 듯?',
    likes: 2000,
    replies: 900,
    reposts: 100,
    views: 20000
  },
  {
    id: 'weak-low',
    topicKeyword: '생활',
    sourceText: '좋은 상품입니다. 편리하고 추천합니다.',
    likes: 10,
    replies: 0,
    reposts: 0,
    views: 5000
  }
];

test('rankTrendSamples orders high-performing samples above weak samples', () => {
  const ranked = rankTrendSamples(samples, { query: '자취 꿀템', limit: 3 });
  assert.equal(ranked[0].id, 'unsafe-high');
  assert.ok(ranked.findIndex((sample) => sample.id === 'safe-high') < ranked.findIndex((sample) => sample.id === 'weak-low'));
});

test('extractTrendPatterns removes unsafe conflict frames', async () => {
  const patterns = await extractTrendPatterns(samples, { query: '자취 꿀템', limit: 5, useAi: false });
  assert.ok(patterns.length >= 1);
  assert.ok(patterns.every((pattern) => pattern.sourceId !== 'unsafe-high'));
  assert.equal(patterns[0].sourceId, 'safe-high');
  assert.match(patterns[0].commentQuestion, /묻기|질문|어느/);
});

test('assessTrendSimilarityRisk detects copied source openings', () => {
  const patterns = [{
    sourceText: '자취방 정리할 때 접어서 넣는 사람 vs 걸어두는 사람, 이거 은근 기준 갈리더라. 다들 어느 쪽이에요?'
  }];
  assert.equal(
    assessTrendSimilarityRisk('자취방 정리할 때 접어서 넣는 사람 vs 걸어두는 사람, 이건 그대로 쓰면 안 됩니다.', patterns),
    'high'
  );
  assert.equal(
    assessTrendSimilarityRisk('수납 방식은 결국 매일 손이 가는지가 더 오래 남더라고요. 다들 기준이 뭐예요?', patterns),
    'low'
  );
});

test('generateTrendInspiredPosts returns scored safe variants without AI', async () => {
  const patterns = await extractTrendPatterns(samples, { query: '자취 꿀템', limit: 3, useAi: false });
  const posts = await generateTrendInspiredPosts({
    query: '자취 꿀템',
    contentScope: '생활용품',
    targetAudience: '2030 자취생',
    patterns,
    useAi: false
  });
  assert.equal(posts.length, 3);
  assert.ok(posts.every((post) => post.engagementScore > 0));
  assert.ok(posts.every((post) => post.similarityRisk === 'low'));
});

test('buildTrendInspiredContentPreview falls back to fixture provider', async () => {
  const preview = await buildTrendInspiredContentPreview({
    query: '자취 꿀템',
    contentScope: '생활용품',
    targetAudience: '2030 자취생',
    provider: 'fixture',
    useAi: false
  });
  assert.equal(preview.source.provider, 'fixture');
  assert.ok(preview.patterns.length > 0);
  assert.equal(preview.posts.length, 3);
});

test('anonymous learning off keeps customer references out of public assets', async () => {
  const [account] = await dbList('accounts', {}, { limit: 1 });
  await dbUpdate('accounts', { id: account.id }, { anonymous_learning_enabled: false, personal_reference_patterns: [] });
  const before = await dbList('trend_reference_patterns');
  const result = await ingestTrendReferencesForAccount(account.id, {
    category: '자취 수납',
    sourceType: 'text_paste',
    useAi: false,
    samples: [{
      sourceText: '자취방 수납은 접어서 넣는 쪽이랑 걸어두는 쪽이 은근 갈리더라. 다들 어느 쪽이 더 편해요?',
      likes: 500,
      replies: 80,
      views: 8000
    }]
  });
  const after = await dbList('trend_reference_patterns');
  assert.equal(result.anonymousLearningEnabled, false);
  assert.equal(result.sharedPatternCount, 0);
  assert.equal(after.length, before.length);
});

test('anonymous learning stores only sanitized pattern fields', async () => {
  const [account] = await dbList('accounts', {}, { limit: 1 });
  await dbUpdate('accounts', { id: account.id }, { anonymous_learning_enabled: true, personal_reference_patterns: [] });
  const result = await ingestTrendReferencesForAccount(account.id, {
    category: '살림',
    targetAudienceHint: '3040 살림 계정',
    sourceType: 'screenshot_ocr',
    useAi: false,
    samples: [{
      sourceText: '@popular_user 살림용품은 디자인보다 설거지 편한지가 오래 가더라. 댓글로 기준 알려줘요 https://threads.net/@popular_user/post/1',
      likes: 800,
      replies: 120,
      views: 12000
    }]
  });
  assert.equal(result.anonymousLearningEnabled, true);
  assert.equal(result.sharedPatternCount, 1);
  const [asset] = await dbList('trend_reference_patterns', {}, { order: 'created_at', ascending: false, limit: 1 });
  assert.equal(asset.source_type, 'screenshot_ocr');
  assert.equal(asset.quality_status, 'candidate');
  assert.equal(asset.category, '살림');
  const serialized = JSON.stringify(asset);
  assert.doesNotMatch(serialized, /popular_user|threads\.net|댓글로 기준 알려줘요/);
  assert.ok(asset.hook_pattern);
  assert.ok(asset.comment_question_pattern);
});

test('approved anonymous patterns can enrich accounts without personal references', async () => {
  const [account] = await dbList('accounts', {}, { limit: 1 });
  const [cleanAccount] = await dbUpdate('accounts', { id: account.id }, { personal_reference_patterns: [] });
  const [asset] = await saveAnonymousTrendPatternAssets([{
    hookPattern: '후회 방지 기준으로 시작',
    commentQuestion: '관리 편의와 디자인 중 무엇을 먼저 보는지 묻기',
    tensionType: 'choice',
    emotionSignal: '후회 방지',
    reusableStructure: '첫 문장 후회 포인트, 짧은 기준, 댓글 질문',
    performanceScore: 999,
    safetyFlags: []
  }], {
    category: cleanAccount.content_scope,
    targetAudienceHint: cleanAccount.target_audience,
    sourceType: 'admin_seed',
    qualityStatus: 'candidate'
  });
  await updateTrendPatternQualityStatus(asset.id, 'approved');
  const context = await buildReferencePatternContext(cleanAccount, { limit: 5 });
  assert.equal(context.mix.publicAnonymousPatterns, 0.6);
  assert.ok(context.patterns.some((pattern) => pattern.hookPattern === '후회 방지 기준으로 시작'));
  assert.ok(context.patterns.every((pattern) => !pattern.sourceText));
});
