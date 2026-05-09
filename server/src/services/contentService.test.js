import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePosts } from './contentService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';
import { rewritePostQualityPrompt } from '../prompts/rewritePostQualityPrompt.js';

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
  assert.equal(typeof saved.metadata.candidateScores[0].qualityRewriteUsed, 'boolean');
  assert.ok(saved.metadata.candidateScores[0].qualityGate);
  assert.ok(saved.metadata.rubric);
  assert.ok(saved.metadata.qualityGate);
  assert.equal(saved.metadata.qualityGate.passed, true);
  assert.equal(typeof saved.metadata.qualityRewriteUsed, 'boolean');
  assert.equal(typeof saved.metadata.qualityRewriteAttempted, 'boolean');
  assert.ok(Array.isArray(saved.metadata.qualityRewriteReasons));
  assert.equal(typeof saved.metadata.rubric.hookScore, 'number');
  assert.equal(typeof saved.metadata.rubric.commentEaseScore, 'number');
  assert.equal(typeof saved.metadata.rubric.choiceTensionScore, 'number');
  assert.equal(typeof saved.metadata.rubric.adTonePenalty, 'number');
  assert.equal(typeof saved.metadata.rubric.usefulSpecificityScore, 'number');
  assert.equal(typeof saved.metadata.rubric.saveWorthinessScore, 'number');
  assert.equal(typeof saved.metadata.rubric.humanWarmthScore, 'number');
  assert.equal(typeof saved.metadata.rubric.shallowChecklistPenalty, 'number');
  assert.ok(saved.metadata.referencePatternMix);
  assert.ok(Array.isArray(saved.metadata.referencePatternIds));
  assert.ok(Array.isArray(saved.metadata.publicReferencePatternIds));
  assert.equal(typeof saved.metadata.referencePatternCount, 'number');
  assert.equal(saved.metadata.rubric.livedInStructureScore > 0, true);
  assert.equal(saved.metadata.rubric.concreteCriteriaScore > 0, true);
  assert.equal(saved.metadata.rubric.usefulSpecificityScore > 0, true);
  assert.equal(saved.metadata.rubric.saveWorthinessScore > 0, true);
  assert.equal(saved.metadata.rubric.humanWarmthScore > 0, true);
  assert.match(saved.body, /1\./);
  assert.match(saved.body, /여러분|뭐였어요|보세요/);
  assert.doesNotMatch(saved.body, /이건 은근 기준이 갈리는 선택|실용성.*사용감|작은 기준 하나만 정해도/);
  assert.match(saved.body, /설거지|빨래|현관|욕실|조리대|바닥|물기|바구니|꺼내/);
});

test('rewritePostQualityPrompt includes approved pattern fields without raw source text', () => {
  const prompt = rewritePostQualityPrompt({
    body: '수납함은 자주 쓰는지 보면 좋습니다.',
    topic: { title: '원룸 수납함 고르는 기준' },
    account: {
      tone: '담백한 생활 관찰',
      target_audience: '2030 자취생',
      content_scope: '자취 집기',
      referencePatterns: [{
        hookPattern: '생활 속 은근한 불편으로 시작',
        commentQuestion: '자신만의 기준을 가볍게 묻기',
        tensionType: 'space',
        emotionSignal: '생활 공감',
        reusableStructure: '짧은 생활 기준 뒤 질문',
        voicePattern: '담백한 관찰체',
        sourceText: '@raw_account 원문은 절대 들어가면 안 됨'
      }]
    },
    engagement: { engagementScore: 50, engagementPattern: 'empathy_prompt' },
    qualityGate: { reasons: ['생활 디테일이 부족함'], rewriteInstructions: [] }
  });
  const payload = JSON.parse(prompt[1].content);
  assert.equal(payload.referencePatterns.length, 1);
  assert.equal(payload.referencePatterns[0].hookPattern, '생활 속 은근한 불편으로 시작');
  assert.doesNotMatch(JSON.stringify(payload), /raw_account|원문은 절대/);
});
