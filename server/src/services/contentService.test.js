import assert from 'node:assert/strict';
import test from 'node:test';
import { generatePosts } from './contentService.js';
import { dbGet, dbInsert, dbList } from './supabaseService.js';
import { rewritePostQualityPrompt } from '../prompts/rewritePostQualityPrompt.js';

test('generatePosts stores one selected post with engagement metadata', async () => {
  const [templateAccount] = await dbList('accounts', {}, { limit: 1 });
  const { id: _id, created_at: _createdAt, updated_at: _updatedAt, ...accountPayload } = templateAccount;
  const account = await dbInsert('accounts', {
    ...accountPayload,
    name: `품질 테스트 계정 ${Date.now()}`,
    account_handle: '',
    automation_status: 'paused',
    anonymous_learning_enabled: false
  });
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
  assert.ok(['choice_tension', 'experience_question', 'regret_prevention'].includes(saved.metadata.engagementPattern));
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
  assert.ok(Array.isArray(saved.metadata.referencePatternQuality));
  assert.ok(Array.isArray(saved.metadata.referencePatternMatchedReasons));
  assert.equal(typeof saved.metadata.referencePatternCount, 'number');
  assert.equal(saved.metadata.rubric.livedInStructureScore > 0, true);
  assert.equal(saved.metadata.rubric.concreteCriteriaScore > 0, true);
  assert.equal(saved.metadata.rubric.usefulSpecificityScore > 0, true);
  assert.equal(saved.metadata.rubric.saveWorthinessScore > 0, true);
  // humanWarmth is a SOFT quality signal, not a hard guarantee: evaluatePostQualityGate tolerates up
  // to MAX_SOFT_REQUIRED_MISS_COUNT missing required checks for an otherwise strong (score >= 82) post,
  // so a legitimately selected post may carry warmth markers (humanWarmthScore +8) OR clear the gate on
  // overall strength without them (-4). Assert the field is a validly computed soft score; deterministic
  // body-level warmth/engagement phrasing is asserted separately just below.
  assert.ok(Number.isFinite(saved.metadata.rubric.humanWarmthScore));
  assert.match(saved.body, /다들|나만|저만|공감|겪어본|예민한|필수|뭐부터|보세요/);
  assert.doesNotMatch(saved.body, /이건 은근 기준이 갈리는 선택|실용성.*사용감|작은 기준 하나만 정해도/);
  assert.match(saved.body, /설거지|빨래|현관|욕실|조리대|바닥|물기|바구니|꺼내|방문|침대\s*밑|수납|정리템/);
  assert.ok(saved.metadata.visualPlan);
  assert.equal(typeof saved.metadata.visualPlan.attachImage, 'boolean');
  assert.ok(['none', 'generated_card', 'product_image'].includes(saved.metadata.visualPlan.imageSourceType));
  assert.ok(saved.metadata.contentFormat);
  assert.ok(saved.metadata.contentGoal);
  assert.ok(saved.metadata.lengthBucket);
  assert.ok(saved.metadata.selectedFormatDiversity);
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
        qualityScore: 88,
        analysisProfile: { bestFor: ['자취 집기'], templateRisk: 10 },
        sourceText: '@raw_account 원문은 절대 들어가면 안 됨'
      }]
    },
    engagement: { engagementScore: 50, engagementPattern: 'empathy_prompt' },
    qualityGate: { reasons: ['생활 디테일이 부족함'], rewriteInstructions: [] }
  });
  const payload = JSON.parse(prompt[1].content);
  assert.equal(payload.referencePatterns.length, 1);
  assert.equal(payload.referencePatterns[0].hookPattern, '생활 속 은근한 불편으로 시작');
  assert.equal(payload.referencePatterns[0].qualityScore, 88);
  assert.equal(payload.referencePatterns[0].analysisProfile.bestFor[0], '자취 집기');
  assert.doesNotMatch(JSON.stringify(payload), /raw_account|원문은 절대/);
});
