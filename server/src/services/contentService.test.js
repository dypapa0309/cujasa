import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePosts } from './contentService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';

test('generatePosts stores one selected post with engagement metadata', async () => {
  const [account] = await dbList('accounts', {}, { limit: 1 });
  const topic = await dbInsert('topics', {
    project_id: account.project_id,
    account_id: account.id,
    title: '원룸 수납함 고르는 기준',
    angle: '꺼내기 쉬운 구조와 깔끔한 보관'
  });

  const posts = await generatePosts(topic.id);
  assert.equal(posts.length, 1);

  const saved = await dbGet('posts', { id: posts[0].id });
  assert.ok(saved.metadata.engagementScore >= 60);
  assert.equal(saved.metadata.engagementPattern, 'choice_tension');
  assert.ok(Array.isArray(saved.metadata.selectionReasons));
  assert.ok(Array.isArray(saved.metadata.candidateScores));
  assert.ok(saved.metadata.rubric);
  assert.equal(typeof saved.metadata.rubric.hookScore, 'number');
  assert.equal(typeof saved.metadata.rubric.commentEaseScore, 'number');
  assert.equal(typeof saved.metadata.rubric.choiceTensionScore, 'number');
  assert.equal(typeof saved.metadata.rubric.adTonePenalty, 'number');
  assert.ok(saved.metadata.referencePatternMix);
  assert.equal(typeof saved.metadata.referencePatternCount, 'number');
});
