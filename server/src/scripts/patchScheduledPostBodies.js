import 'dotenv/config';
import { dbGet, dbUpdate } from '../services/supabaseService.js';
import { scorePostEngagement } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';
import { resolveContentStrategyMetadata, contentLengthBucket } from '../utils/contentFormatStrategy.js';

const patches = [
  {
    queueId: 'eada1643-10fe-48fe-a4bc-40fbbb58ceb4',
    body: '주방용품은 처음엔 예뻐 보여도 조리대 위에서 손이 좁아지면 바로 귀찮아져요.\n\n싱크대 옆에 잠깐 둘 자리랑 설거지 후 물 빠지는 자리, 이 두 개 안 맞으면 결국 밖에 꺼내두게 되더라고요.\n\n저라면 자주 쓰는 것부터 이 기준 먼저 봐요.'
  },
  {
    queueId: 'e6c9eeb3-68be-48a1-a59a-a05b31d060e3',
    body: '주방 정리는 수납함보다 꺼내는 동선에서 갈리는 듯.\n\n싱크대 옆에 잠깐 둘 자리 없으면 설거지하고 바로 쌓이고, 자주 쓰는 게 맨 아래 깔리면 손 안 감.\n\n이거 나만 은근 신경 쓰이나?'
  },
  {
    queueId: 'e9b78d8d-dcf4-4431-ab09-38ce59a49ce2',
    body: '아이 방 수납은 큰 정리함 하나로 끝날 줄 알았는데 장난감이 맨 아래 깔리면 또 안 꺼내더라고요.\n\n아이가 직접 넣고 꺼낼 높이인지, 침대 옆에 둬도 안 막히는지 먼저 보게 돼요.\n\n다들 수납함 고를 때 뭐부터 보세요?'
  }
];

async function main() {
  const updated = [];
  for (const patch of patches) {
    const queue = await dbGet('post_queue', { id: patch.queueId });
    if (!queue?.post_id) {
      updated.push({ queueId: patch.queueId, skipped: true, reason: 'queue_or_post_missing' });
      continue;
    }
    const post = await dbGet('posts', { id: queue.post_id });
    if (!post) {
      updated.push({ queueId: patch.queueId, skipped: true, reason: 'post_missing' });
      continue;
    }
    const engagement = scorePostEngagement(patch.body);
    const qualityGate = evaluatePostQualityGate(engagement);
    if (!qualityGate.passed) {
      updated.push({ queueId: patch.queueId, skipped: true, reason: 'quality_failed', qualityGate });
      continue;
    }
    const strategy = resolveContentStrategyMetadata({}, patch.body, post.content_type);
    await dbUpdate('posts', { id: post.id }, {
      body: patch.body,
      metadata: {
        ...(post.metadata || {}),
        contentFormat: strategy.contentFormat,
        contentGoal: strategy.contentGoal,
        lengthBucket: contentLengthBucket(patch.body),
        engagementScore: engagement.engagementScore,
        engagementPattern: engagement.engagementPattern,
        selectionReasons: engagement.selectionReasons,
        rubric: engagement.rubric,
        qualityGate,
        manualScheduledBodyPatch: true,
        manualScheduledBodyPatchedAt: new Date().toISOString()
      }
    });
    updated.push({
      queueId: patch.queueId,
      postId: post.id,
      score: engagement.engagementScore,
      contentFormat: strategy.contentFormat,
      contentGoal: strategy.contentGoal,
      body: patch.body
    });
  }
  console.log(JSON.stringify({ updated }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
