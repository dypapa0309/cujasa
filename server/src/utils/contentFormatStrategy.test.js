import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContentDiversityPlan,
  inferContentFormat,
  inferContentGoal,
  resolveContentStrategyMetadata,
  scoreContentDiversityPlanFit,
  scoreFormatDiversity
} from './contentFormatStrategy.js';

test('infers short reach and reply formats from natural Korean posts', () => {
  assert.equal(inferContentFormat('방 좁은데 수납장까지 들어오니까 더 답답함 ㅋㅋ'), 'daily_one_liner');
  assert.equal(inferContentGoal('방 좁은데 수납장까지 들어오니까 더 답답함 ㅋㅋ'), 'reach_only');
  assert.equal(inferContentFormat('먼지 보여도 돌돌이 안 보이면 그냥 못 본 척함\n이거 나만 그런 거 아니지'), 'two_line_empathy');
  assert.equal(inferContentGoal('먼지 보여도 돌돌이 안 보이면 그냥 못 본 척함\n이거 나만 그런 거 아니지'), 'reply');
});

test('infers structured save and conversion formats', () => {
  const checklist = '좁은 방에서 조심해야 하는 말\n\n대용량\n넉넉한 수납\n감성 인테리어';
  assert.equal(inferContentFormat(checklist), 'checklist_card');
  assert.equal(inferContentGoal(checklist), 'save');

  const beforeBuy = '정리함 사기 전에 정리함 둘 자리부터 봐야 됨';
  assert.equal(inferContentFormat(beforeBuy), 'before_buy_check');
  assert.equal(inferContentGoal(beforeBuy), 'save');

  const bridge = '좁은 방에서 오래 쓰는 기준 모아봄';
  assert.equal(inferContentFormat(bridge), 'collection_bridge');
  assert.equal(inferContentGoal(bridge), 'conversion');
});

test('infers share meme anti-buy and lazy formats', () => {
  assert.equal(inferContentFormat('택배 박스 못 버리는 사람한테 보내야 됨'), 'send_to_friend');
  assert.equal(inferContentGoal('택배 박스 못 버리는 사람한테 보내야 됨'), 'share');

  assert.equal(inferContentFormat('정리 전: 수납함 사면 끝\n정리 후: 수납함 둘 자리 찾는 중'), 'before_after');
  assert.equal(inferContentGoal('정리 전: 수납함 사면 끝\n정리 후: 수납함 둘 자리 찾는 중'), 'meme');

  assert.equal(inferContentFormat('선반 샀는데 선반 둘 자리가 없었음'), 'wrong_purchase');
  assert.equal(inferContentGoal('선반 샀는데 선반 둘 자리가 없었음'), 'anti_buy');

  assert.equal(inferContentFormat('부지런한 사람 기준 말고 다시 넣기 귀찮은 사람 기준으로 봐야 됨'), 'lazy_person_tip');
  assert.equal(inferContentGoal('부지런한 사람 기준 말고 다시 넣기 귀찮은 사람 기준으로 봐야 됨'), 'rant');
});

test('infers native social scene and community formats', () => {
  const pov = 'POV: 방 치우려고 일어났는데 충전선이 발에 걸림';
  assert.equal(inferContentFormat(pov), 'pov_scene');
  assert.equal(inferContentGoal(pov), 'meme');

  const reality = '생각: 수납함 사면 끝\n현실: 수납함 둘 자리부터 찾음';
  assert.equal(inferContentFormat(reality), 'myth_reality');
  assert.equal(inferContentGoal(reality), 'meme');

  const ranked = '원룸 정리템 볼 때 1순위는 바닥 안 막는지';
  assert.equal(inferContentFormat(ranked), 'ranked_list');
  assert.equal(inferContentGoal(ranked), 'save');

  const reply = '댓글에서 정리함 뭐 보냐고 물어보면 난 깊이보다 둘 자리부터 봄';
  assert.equal(inferContentFormat(reply), 'imaginary_reply');
  assert.equal(inferContentGoal(reply), 'community');
});

test('uses valid AI-provided format and goal before inference', () => {
  const metadata = resolveContentStrategyMetadata({
    contentFormat: 'fake_chat',
    contentGoal: 'reach_only'
  }, '친구: 방 정리했다며\n나: 사진 각도임', '일상형');

  assert.equal(metadata.contentFormat, 'fake_chat');
  assert.equal(metadata.contentGoal, 'reach_only');
});

test('penalizes repeated recent formats, goals, and length buckets', () => {
  const recentPosts = Array.from({ length: 5 }, (_, index) => ({
    metadata: {
      contentFormat: index < 4 ? 'daily_one_liner' : 'checklist_card',
      contentGoal: 'reach_only',
      lengthBucket: 'one_line'
    }
  }));
  const diversity = scoreFormatDiversity({
    contentFormat: 'daily_one_liner',
    contentGoal: 'reach_only',
    body: '방 좁은데 수납장까지 들어오니까 더 답답함 ㅋㅋ'
  }, recentPosts);

  assert.ok(diversity.penalty > 0);
  assert.equal(diversity.duplicateRisk, true);
  assert.ok(diversity.adjustedScore(100) < 100);
});

test('builds a target diversity plan and scores matching candidates', () => {
  const recentPosts = [
    { metadata: { contentFormat: 'daily_one_liner', contentGoal: 'reach_only', lengthBucket: 'one_line' } },
    { metadata: { contentFormat: 'daily_one_liner', contentGoal: 'reach_only', lengthBucket: 'one_line' } },
    { metadata: { contentFormat: 'soft_question', contentGoal: 'reply', lengthBucket: 'short' } }
  ];
  const plan = buildContentDiversityPlan({
    topic: { id: 'topic', title: '택배 박스 정리' },
    account: { id: 'account' },
    recentPosts
  });

  assert.ok(plan.primarySlot.key);
  assert.notEqual(plan.primarySlot.key, 'short_reach');
  assert.equal(plan.candidateBlueprints.length, 5);
  assert.equal(new Set(plan.candidateBlueprints.map((blueprint) => blueprint.slotKey)).size, 5);
  assert.ok(plan.candidateBlueprints.every((blueprint) => blueprint.preferredFormats.length > 0));
  assert.ok(plan.candidateBlueprints.some((blueprint) => blueprint.questionMode === 'no_question'));

  const fit = scoreContentDiversityPlanFit({
    contentFormat: plan.primarySlot.formats[0],
    contentGoal: plan.primarySlot.goals[0],
    body: '택배 박스 못 버리는 사람한테 보내야 됨'
  }, plan);

  assert.ok(fit.bonus > 0);
  assert.equal(fit.matchedSlot, plan.primarySlot.key);
});

test('uses performance signals as tie breaker when recent slots are not overused', () => {
  const plan = buildContentDiversityPlan({
    topic: { id: 'topic', title: '자취방 정리' },
    account: { id: 'account' },
    recentPosts: [],
    performanceSignals: {
      topContentFormats: [{ name: 'ranked_list', clicks: 12 }],
      topContentGoals: [{ name: 'save', clicks: 12 }]
    }
  });

  const selectedSlots = [plan.primarySlot, ...plan.secondarySlots];
  assert.ok(selectedSlots.some((slot) => slot.key === 'community_answer' || slot.key === 'save_anti_buy'));
  assert.ok(selectedSlots.some((slot) => Number(slot.performanceScore || 0) > 0));
});
