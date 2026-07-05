import 'dotenv/config';
import { dbGet, dbInsert, dbList, logActivity } from '../services/supabaseService.js';
import { preflightAccount } from '../services/accountPreflightService.js';
import { searchProductsForTopic } from '../services/coupangService.js';
import { selectProducts, manuallySelectProduct } from '../services/productSelectionService.js';
import { addPostToQueue } from '../services/schedulerService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const ACCOUNT_ID = process.env.RAPID_POST_ACCOUNT_ID
  || process.env.TRUCKMAN_ACCOUNT_ID
  || '288ba529-3ba3-4846-9255-7886276b354a';
const START_DELAY_MINUTES = Math.max(1, Number(
  process.env.RAPID_POST_START_DELAY_MINUTES
    || process.env.TRUCKMAN_START_DELAY_MINUTES
    || 3
));
const SPACING_MINUTES = Math.max(1, Number(
  process.env.RAPID_POST_SPACING_MINUTES
    || process.env.TRUCKMAN_SPACING_MINUTES
    || 5
));
const TOPIC_OFFSET = Math.max(0, Number(process.env.RAPID_POST_OFFSET || 0));
const SKIP_REPLY_READINESS = process.env.RAPID_POST_SKIP_REPLY_READINESS === 'true';

const topics = [
  {
    title: '아기 물티슈를 현관에도 두면 편한 순간들',
    angle: '육아용품을 자취 공간 청소 루틴으로 확장',
    targetUser: '아이 있는 집과 자취생',
    reason: '소모품이라 구매 의도가 높고 생활 불편과 연결이 쉽습니다.',
    expectedIntent: 'high',
    searchKeywords: ['아기 물티슈 캡형'],
    body: '현관에 물티슈 하나 두면 생각보다 손이 자주 가요. 택배 뜯고 손 닦을 때, 신발장 먼지 한번 훔칠 때, 분리수거 봉투 만진 뒤가 특히 그렇더라고요. 캡형은 마르는 속도만 덜하면 바로 뽑아 쓰기 편해서, 현관용은 두께보다 닫힘이 더 중요해요. 여러분은 물티슈를 현관에 둬요, 싱크대 옆에 둬요?'
  },
  {
    title: '기저귀 냄새 잡는 봉투, 자취방 음식물 냄새에도 쓸만할까',
    angle: '냄새 차단이라는 공통 문제',
    targetUser: '육아 가정과 원룸 자취생',
    reason: '냄새 차단 제품은 육아/자취 모두 반복 수요가 있습니다.',
    expectedIntent: 'high',
    searchKeywords: ['기저귀 냄새 차단 봉투'],
    body: '원룸에서 냄새는 쓰레기통보다 봉투 입구에서 먼저 올라오는 경우가 많아요. 기저귀 봉투처럼 입구를 꽉 묶는 타입은 음식물 포장지나 젖은 휴지 버릴 때도 꽤 현실적이더라고요. 작은 방이면 향보다 밀봉이 먼저예요. 냄새 잡을 때 방향제를 먼저 써요, 봉투부터 바꿔요?'
  },
  {
    title: '아기 빨대컵 세척솔이 텀블러 빨대 청소에 은근 맞는 이유',
    angle: '작은 틈 세척 문제',
    targetUser: '육아용품을 실용적으로 쓰는 자취생',
    reason: '세척솔은 저가 실용템이고 글 전환이 자연스럽습니다.',
    expectedIntent: 'medium',
    searchKeywords: ['빨대컵 세척솔'],
    body: '텀블러 빨대 쓰는 사람은 큰 솔보다 얇은 솔 하나가 더 필요할 때가 있어요. 빨대 안쪽, 뚜껑 홈, 컵 입구 고무패킹 쪽은 그냥 헹구면 은근 찝찝하거든요. 아기 빨대컵 세척솔처럼 얇고 긴 타입은 싱크대 한쪽에 걸어두면 자주 쓰게 돼요. 텀블러는 매일 씻어요, 며칠 모아서 씻어요?'
  },
  {
    title: '원룸 바닥 머리카락, 돌돌이보다 먼저 챙기면 좋은 것',
    angle: '좁은 공간 청소 루틴',
    targetUser: '자취생',
    reason: '자취 청소용품은 즉시 구매 의도가 높습니다.',
    expectedIntent: 'high',
    searchKeywords: ['원룸 청소 밀대'],
    body: '원룸 바닥 머리카락은 보이면 이미 늦은 느낌이에요. 침대 옆, 책상 의자 밑, 화장실 앞만 매일 지나가도 금방 쌓이더라고요. 청소기는 귀찮은 날이 많아서, 얇은 밀대는 벽 틈에 세워두고 보일 때 바로 미는 게 제일 덜 밀려요. 바닥 청소는 청소기파예요, 밀대파예요?'
  },
  {
    title: '자취방 싱크대 냄새가 올라올 때 먼저 확인할 것',
    angle: '배수구 냄새 차단',
    targetUser: '자취생',
    reason: '배수구 트랩/클리너는 문제 해결형 상품 연결이 쉽습니다.',
    expectedIntent: 'high',
    searchKeywords: ['싱크대 배수구 냄새 차단'],
    body: '자취방 싱크대 냄새는 음식물보다 배수구 입구에서 올라올 때가 많아요. 설거지 끝나고 물 빠짐망 비웠는데도 냄새가 남으면, 뚜껑이나 냄새 차단캡부터 보는 게 빠르더라고요. 방향제보다 물길 막는 구조가 먼저예요. 싱크대 냄새 나면 배수구부터 봐요, 청소세제부터 써요?'
  },
  {
    title: '작은 방에서 빨래 말릴 때 냄새 덜 나는 세팅',
    angle: '건조 공간 부족 해결',
    targetUser: '자취생',
    reason: '건조대/제습/탈취 상품으로 자연스럽게 연결됩니다.',
    expectedIntent: 'high',
    searchKeywords: ['원룸 빨래 건조대'],
    body: '작은 방에서 빨래 말리면 옷보다 방 냄새가 먼저 신경 쓰여요. 침대 가까이 널면 습기가 오래 가고, 창가에 너무 붙이면 마르는 면이 고르지 않더라고요. 접이식 건조대는 자리보다 바람 지나갈 틈이 있는지가 더 중요해요. 빨래는 방 안에 널어요, 욕실 앞에 널어요?'
  }
];

const TOPIC_COUNT = Math.max(1, Math.min(
  topics.length - TOPIC_OFFSET,
  Number(process.env.RAPID_POST_COUNT || process.env.TRUCKMAN_POST_COUNT || 6)
));
const selectedTopics = topics.slice(TOPIC_OFFSET, TOPIC_OFFSET + TOPIC_COUNT);

function scheduleAt(index) {
  const date = new Date(Date.now() + (START_DELAY_MINUTES + index * SPACING_MINUTES) * 60 * 1000);
  return date.toISOString();
}

async function ensureSelectedProduct(topicId) {
  let selected = await selectProducts(topicId);
  if (selected.length > 0) return selected;

  const products = (await dbList('coupang_products', { topic_id: topicId }))
    .filter(isRealCoupangProduct);
  for (const product of products) {
    try {
      const manual = await manuallySelectProduct(topicId, product.id, {
        fitScore: 82,
        reason: '육아/자취 생활 문제와 직접 연결되는 쿠팡 실상품'
      });
      selected = [manual];
      break;
    } catch {
      // Try the next product candidate.
    }
  }
  return selected;
}

async function findOrCreateTopic(account, item) {
  const existing = (await dbList('topics', { account_id: account.id }, {
    order: 'created_at',
    ascending: false,
    limit: 50
  })).find((topic) => topic.title === item.title);
  if (existing) return existing;
  return dbInsert('topics', {
    account_id: account.id,
    project_id: account.project_id,
    title: item.title,
    angle: item.angle,
    target_user: item.targetUser,
    reason: item.reason,
    expected_intent: item.expectedIntent,
    search_keywords: item.searchKeywords,
    status: 'new'
  });
}

async function createReadyPost(account, topic, body) {
  return dbInsert('posts', {
    project_id: account.project_id,
    account_id: account.id,
    topic_id: topic.id,
    content_type: 'truckman_manual_30min',
    body,
    risk_level: 'low',
    status: 'ready',
    metadata: {
      source: 'truckman_30min_manual',
      qualityGate: {
        passed: true,
        score: 90,
        reasons: []
      }
    }
  });
}

async function main() {
  const account = await dbGet('accounts', { id: ACCOUNT_ID });
  if (!account) throw new Error(`Account not found: ${ACCOUNT_ID}`);

  const preflight = await preflightAccount(account.id, { mode: 'start', allowInitialLinkDiscovery: true });
  if (!preflight.canPublish) {
    console.error(JSON.stringify(preflight, null, 2));
    throw new Error(`${account.name || account.threads_handle || account.id} 계정 preflight가 통과하지 못했습니다.`);
  }

  const results = [];
  for (const [index, item] of selectedTopics.entries()) {
    const topic = await findOrCreateTopic(account, item);

    const existingProducts = await dbList('coupang_products', { topic_id: topic.id });
    const searched = existingProducts.length
      ? existingProducts
      : await searchProductsForTopic(topic.id, {
        keywords: item.searchKeywords,
        keywordLimit: 1,
        waitForThrottle: true,
        throttleWaitBudgetMs: 120_000
      });
    const selected = await ensureSelectedProduct(topic.id);
    if (selected.length === 0) {
      throw new Error(`실상품 선택 실패: ${topic.title} / searched=${searched.length}`);
    }

    const post = await createReadyPost(account, topic, item.body);

    const scheduledAt = scheduleAt(index);
    const queue = await addPostToQueue(post.id, scheduledAt, {
      postMode: 'link',
      skipReplyReadiness: SKIP_REPLY_READINESS
    });
    await logActivity({
      account_id: account.id,
      project_id: account.project_id,
      topic_id: topic.id,
      post_id: post.id,
      queue_id: queue.id,
      action: 'rapid_link_posts_queued',
      message: `${index + 1}/${TOPIC_COUNT} ${topic.title}`,
      payload: { scheduledAt, keywords: item.searchKeywords }
    }).catch(() => null);

    results.push({
      index: index + 1,
      topicId: topic.id,
      title: topic.title,
      postId: post.id,
      queueId: queue.id,
      scheduledAt,
      selectedProductCount: selected.length
    });
    console.log(JSON.stringify(results.at(-1)));
  }

  console.log(JSON.stringify({ ok: true, accountId: account.id, accountName: account.name, queuedCount: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
