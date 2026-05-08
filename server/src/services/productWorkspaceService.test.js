import test from 'node:test';
import assert from 'node:assert/strict';
import { dbInsert } from './supabaseService.js';
import {
  ingestPolibotKnowledge,
  listPolibotKnowledgeReviewQueue
} from './polibotKnowledgeDbService.js';
import {
  savePolibotRecommendation,
  savePolibotRecommendationFeedback
} from './productWorkspaceService.js';

test('stores POLIBOT recommendation knowledge snapshot with source trace', async () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-snapshot-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 테스트',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {}
  });
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'snapshot-test-삼성화재-퍼펙트플러스.txt',
      fileName: 'snapshot-test-삼성화재-퍼펙트플러스.txt',
      type: 'txt',
      size: 260,
      fileHash: 'snapshot-test-polibot-file-hash',
      text: '삼성화재 퍼펙트 플러스 종합보험 상품비교 가입설계 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원, 수술 보장을 확인합니다. 보험료: 월 180,000원 가입연령 20세~60세 비갱신'
    }],
    dryRun: false
  });

  const workspace = await savePolibotRecommendation(userId, {
    name: '이상빈',
    age: '34',
    gender: '남성',
    needs: ['암', '뇌', '심장'],
    budget: '40',
    existingMedicalPlan: '없음',
    medicalHistory: '없음',
    existingPremium: '30'
  });

  assert.ok(workspace.knowledgeSnapshot);
  assert.ok(workspace.knowledgeSnapshot.dbSummary.totalSources >= 1);
  assert.ok(workspace.knowledgeSnapshot.usedSources.length >= 1);
  assert.ok(Array.isArray(workspace.recommendations));
  assert.ok(workspace.recommendations[0]?.knowledgeSnapshot?.usedSourceIds?.length >= 1);
});

test('stores POLIBOT recommendation feedback and flags bad feedback for review', async () => {
  const userId = '22222222-2222-4222-8222-222222222222';
  await dbInsert('users', {
    id: userId,
    email: 'polibot-feedback-test@example.com',
    password_hash: 'test',
    name: 'POLIBOT 피드백',
    role: 'customer'
  });
  await dbInsert('user_products', {
    user_id: userId,
    product_id: 'polibot',
    status: 'active',
    role: 'customer',
    settings: {}
  });
  await ingestPolibotKnowledge({
    scope: 'global',
    sourceChannel: 'local_ingest',
    month: '2026-05',
    files: [{
      name: 'feedback-test-현대해상-굿앤굿.txt',
      fileName: 'feedback-test-현대해상-굿앤굿.txt',
      type: 'txt',
      size: 260,
      fileHash: 'feedback-test-polibot-file-hash',
      text: '현대해상 굿앤굿 어린이 종합보험 상품비교 가입설계 자료입니다. 암 진단비, 뇌혈관 진단비, 심장 진단비, 입원 보장을 확인합니다. 보험료: 월 120,000원 가입연령 20세~60세 비갱신'
    }],
    dryRun: false
  });
  const workspace = await savePolibotRecommendation(userId, {
    name: '김테스트',
    age: '35',
    gender: '남성',
    needs: ['암', '뇌', '심장'],
    budget: '40',
    existingMedicalPlan: '없음',
    medicalHistory: '없음',
    existingPremium: '30'
  });
  const target = workspace.recommendations[0];
  assert.ok(target);

  const next = await savePolibotRecommendationFeedback(userId, {
    recommendationId: target.id,
    feedback: '틀림',
    reason: '상품명 틀림',
    memo: '테스트 피드백'
  });

  const updated = next.recommendations.find((item) => item.id === target.id);
  assert.equal(updated.feedbackRating, 'wrong');
  assert.equal(next.feedback.rating, 'wrong');
  assert.equal(next.feedback.routed_to_review, true);

  const queue = await listPolibotKnowledgeReviewQueue({ status: 'all' });
  const savedFeedback = queue.feedback.find((item) => item.id === next.feedback.id);
  assert.ok(savedFeedback);
  assert.equal(savedFeedback.rating, 'wrong');
  assert.equal(savedFeedback.routedToReview, true);
});
