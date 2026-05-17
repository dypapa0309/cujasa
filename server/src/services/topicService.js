import { getJson } from './openaiService.js';
import { assertAccountActive, getAccount } from './accountService.js';
import { dbInsert, dbList, logActivity } from './supabaseService.js';
import { generateTopicsPrompt } from '../prompts/generateTopicsPrompt.js';
import { isDuplicateTopic } from './similarityService.js';
import { validateTopicCandidate } from '../utils/contentGuardrails.js';
import { validateTopicsResponse } from '../utils/aiResponseSchemas.js';
import { buildAccountPerformanceSignals } from './analyticsService.js';
import { sanitizeContentTitle } from '../utils/contentText.js';

function buildFallbackTopicBank(account = {}) {
  const scope = sanitizeContentTitle(account.content_scope || '생활용품', account);
  const context = `${scope} ${account.target_audience || ''}`;
  if (/음식|푸드|먹|간식|식품/.test(context)) {
    return [
      ['외출 간식 고를 때 은근 실패하는 기준', '손에 묻는 순간과 보관 자리 비교', ['개별포장 간식', '미니 약과', '견과류 바']],
      ['냉장고 자리 없을 때 오래 두기 편한 간식', '남았을 때 보관 부담 줄이기', ['소포장 과자', '컵과일', '실온 보관 간식']],
      ['선물용 먹거리, 예쁜 포장보다 먼저 볼 것', '받는 사람이 바로 나눠 먹기 쉬운지 확인', ['과일 선물세트', '쿠키 선물세트', '견과 선물세트']]
    ];
  }
  if (/주방|조리|식기/.test(context)) {
    return [
      ['주방 수납함 큰 거 하나 샀다가 후회하는 경우', '조리대 동선과 꺼내는 빈도 비교', ['주방 수납함', '싱크대 정리대', '양념통 정리대']],
      ['설거지 후 물 고이는 주방템 피하는 기준', '물 빠짐과 잠깐 둘 자리 확인', ['식기 건조대', '수세미 거치대', '싱크대 물막이']],
      ['좁은 조리대에서 진짜 손이 가는 도구 기준', '꺼내기 쉬운 구조와 보관 자리 비교', ['접이식 도마', '주방 집게', '멀티 조리도구']]
    ];
  }
  if (/육아|아이(?!템)|아기/.test(context)) {
    return [
      ['육아용품은 귀여운 것보다 밤에 바로 집히는지가 먼저', '낮은 자리와 한 손 사용 동선', ['기저귀 정리함', '물티슈 캡형', '아기 빨대컵']],
      ['장난감 수납함 살 때 제일 빨리 티 나는 기준', '아이 손 닿는 높이와 통째 이동', ['장난감 수납함', '리빙박스', '폴딩 바구니']],
      ['외출 전 가방에서 계속 찾게 되는 육아템', '작은 소모품을 따로 빼두는 방식', ['휴대용 물티슈', '기저귀 파우치', '간식 케이스']]
    ];
  }
  if (/반려|강아지|고양이|펫/.test(context)) {
    return [
      ['반려동물 용품은 귀여운 것보다 치우기 쉬운지가 먼저', '털과 물기 정리 동선 확인', ['배변패드 정리함', '펫 물그릇 매트', '털 제거 브러시']],
      ['집사가 사고 나서 바로 후회하는 펫템 기준', '세척과 보관 자리 비교', ['고양이 모래삽', '강아지 리드줄', '펫타월']],
      ['산책 가방에서 매번 찾게 되는 작은 물건', '나가기 직전 바로 집히는지 확인', ['배변봉투 케이스', '휴대용 물통', '간식 파우치']]
    ];
  }
  if (/차량|자동차|운전|차박/.test(context)) {
    return [
      ['차량용품은 예쁜 것보다 흔들릴 때 티 남', '운전 중 굴러다니는지 먼저 확인', ['차량용 수납함', '컵홀더 트레이', '차량용 쓰레기통']],
      ['차 안 정리하려다 더 어수선해지는 경우', '콘솔과 조수석 발밑 자리 비교', ['시트 사이드 포켓', '트렁크 정리함', '케이블 홀더']],
      ['비 오는 날 차에 두면 바로 체감되는 물건', '젖은 우산과 신발 물기 처리', ['차량용 우산꽂이', '방수 매트', '김서림 방지 용품']]
    ];
  }
  if (/운동|헬스|홈트|러닝|캠핑|등산/.test(context)) {
    return [
      ['운동용품은 의욕 있을 때보다 귀찮을 때 기준이 맞음', '꺼내는 거리와 보관 자리 확인', ['요가매트 스트랩', '운동 밴드', '폼롤러']],
      ['캠핑용품 사고 나서 제일 먼저 걸리는 것', '접었을 때 부피와 차에 싣는 동선', ['접이식 의자', '캠핑 박스', '랜턴']],
      ['러닝 준비하다가 자꾸 늦어지는 작은 이유', '양말과 이어폰을 바로 찾는 구조', ['러닝 벨트', '양말 정리함', '스포츠 타월']]
    ];
  }
  if (/뷰티|화장|스킨|헤어/.test(context)) {
    return [
      ['화장대 정리는 예쁜 통보다 다시 넣기 쉬운지가 먼저', '매일 쓰는 제품이 앞에 있는지 확인', ['화장품 정리함', '브러쉬 꽂이', '헤어 집게']],
      ['헤어용품은 선 정리 안 되면 바로 방치됨', '콘센트와 식히는 자리 비교', ['고데기 거치대', '드라이기 홀더', '케이블 정리끈']],
      ['파우치가 무거워지는 사람한테 필요한 기준', '밖에서 실제로 다시 꺼내는 것만 남기기', ['미니 파우치', '립 보관함', '휴대용 거울']]
    ];
  }
  if (/청소|수납|정리|생활|자취|원룸|살림/.test(context)) {
    return [
      ['수납함은 많이 사는 순간부터 방이 더 좁아질 수 있음', '넣기 전 둘 자리와 꺼내는 동선', ['리빙박스', '접이식 수납함', '틈새 수납장']],
      ['원룸 청소용품, 성능보다 먼저 망하는 포인트', '보이는 곳에 세워둘 수 있는지 확인', ['원룸 청소 밀대', '돌돌이 테이프', '먼지떨이']],
      ['빨래 냄새 잡으려고 향부터 바꾸면 놓치는 것', '말리는 자리와 바람길 먼저 보기', ['접이식 건조대', '빨래 바구니', '섬유탈취제']],
      ['현관에 두면 의외로 매일 쓰는 자취템', '나가기 직전 바로 집는 물건 정리', ['우산꽂이', '키트레이', '신발장 정리대']],
      ['책상 위 케이블 정리, 감성보다 안 귀찮은 쪽', '충전기와 멀티탭을 다시 넣는 동선', ['케이블 정리함', '멀티탭 정리함', '충전기 거치대']],
      ['욕실 물기 때문에 매번 미루는 정리', '샤워 후 바로 걸고 말리는 자리', ['욕실 선반', '수건 걸이', '물빠짐 바구니']],
      ['택배 박스 못 버리는 사람한테 필요한 기준', '분리수거 봉투와 임시 보관 자리', ['분리수거함', '접이식 카트', '박스 커터']],
      ['회사 책상에 두면 티 안 나게 편한 정리템', '자주 쓰는 펜과 충전기 위치', ['데스크 오거나이저', '케이블 홀더', '미니 서랍']]
    ];
  }
  return [
    [`${scope} 살 때 예쁜 것보다 먼저 볼 기준`, '쓰는 순간과 보관 자리 비교', ['수납함', '정리함', '생활용품']],
    [`${scope} 사고 나서 은근 후회하는 포인트`, '처음 일주일에 불편한 지점 찾기', ['생활용품', '멀티 정리대', '보관함']],
    [`${scope} 고를 때 댓글 갈리는 기준`, '취향이 아니라 사용 빈도 기준으로 비교', ['생활용품', '정리용품', '소모품']],
    [`${scope} 안 사도 되는 것부터 거르는 기준`, '후회 방지와 과소비 방지 각도', ['생활용품', '정리용품', '보관함']],
    [`${scope} 친구한테 보내고 싶은 현실 공감`, '짧은 공유형 공감 포맷', ['생활용품', '청소용품', '수납용품']],
    [`${scope} 감성보다 동선이 이기는 순간`, '사진빨보다 실제 손 가는 기준', ['생활용품', '인테리어 정리함', '소형 정리대']]
  ];
}

const sampleTopics = (account) => ({
  topics: buildFallbackTopicBank(account).map(([title, angle, searchKeywords], index) => ({
    title,
    angle,
    targetUser: account.target_audience || '일상 사용자',
    reason: index === 0 ? '후회 방지 훅이 강하고 구매 전환 의도가 높음' : '구체적인 생활 불편과 상품 검색어가 직접 연결됨',
    expectedIntent: index === 0 ? 'high' : 'medium',
    searchKeywords
  }))
});

export async function generateTopics(accountId) {
  const account = await getAccount(accountId);
  assertAccountActive(account, 'generate topics');
  const recent = await dbList('topics', { account_id: accountId }, { order: 'created_at', limit: 100 });
  const performanceSignals = await buildAccountPerformanceSignals(accountId);
  const generated = await getJson(generateTopicsPrompt(account, recent, performanceSignals), () => sampleTopics(account), {
    schemaName: 'generate_topics',
    validate: validateTopicsResponse,
    logContext: {
      account_id: accountId,
      project_id: account.project_id
    },
    temperature: 0.85
  });
  const rows = [];
  for (const topic of generated.topics || []) {
    const sanitizedTopic = {
      ...topic,
      title: sanitizeContentTitle(topic.title, account)
    };
    const guardrail = validateTopicCandidate(sanitizedTopic, account);
    if (!guardrail.allowed) {
      await logActivity({
        account_id: accountId,
        project_id: account.project_id,
        action: 'topic_guardrail_blocked',
        level: 'warn',
        message: sanitizedTopic.title,
        payload: { reasons: guardrail.reasons, context: guardrail.context }
      });
      continue;
    }
    const duplicate = isDuplicateTopic(sanitizedTopic, recent.concat(rows));
    if (duplicate.duplicate) {
      await logActivity({ account_id: accountId, project_id: account.project_id, action: 'topic_duplicate_skipped', message: sanitizedTopic.title });
      continue;
    }
    rows.push(await dbInsert('topics', {
      account_id: accountId,
      project_id: account.project_id,
      title: sanitizedTopic.title,
      angle: sanitizedTopic.angle,
      target_user: sanitizedTopic.targetUser,
      reason: sanitizedTopic.reason,
      expected_intent: sanitizedTopic.expectedIntent,
      search_keywords: sanitizedTopic.searchKeywords || [],
      status: 'new'
    }));
  }
  return rows;
}

export const listTopics = (accountId) => dbList('topics', { account_id: accountId }, { order: 'created_at' });

export async function createManualTopic(accountId, { title, angle }) {
  const account = await getAccount(accountId);
  assertAccountActive(account, 'create manual topic');
  const sanitizedTitle = sanitizeContentTitle(title, account);
  const guardrail = validateTopicCandidate({ title: sanitizedTitle, angle, searchKeywords: [] }, account);
  if (!guardrail.allowed) {
    await logActivity({
      account_id: accountId,
      project_id: account.project_id,
      action: 'manual_topic_guardrail_blocked',
      level: 'warn',
      message: sanitizedTitle,
      payload: { reasons: guardrail.reasons, context: guardrail.context }
    });
    const error = new Error(`Topic blocked by content guardrails: ${guardrail.reasons.join(', ')}`);
    error.status = 422;
    throw error;
  }
  return dbInsert('topics', {
    account_id: accountId,
    project_id: account.project_id,
    title: sanitizedTitle,
    angle: angle || null,
    search_keywords: [],
    status: 'new'
  });
}
