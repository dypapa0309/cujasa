import { inspectGeneratedPostText, sanitizeContentTitle } from './contentText.js';
import { hasRepetitiveContentPattern } from './repetitiveContentRules.js';

function firstSentenceOf(body = '') {
  return String(body || '').split(/\n|[.!?。！？]/).map((line) => line.trim()).filter(Boolean)[0] || '';
}

function countMatches(text, pattern) {
  return (String(text || '').match(pattern) || []).length;
}

function unique(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function clampScore(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function contentWords(value = '') {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !/^(그리고|그래서|하지만|이런|저는|나는|여러분|진짜|정말|은근|막상|먼저|기준|고를|때|같은)$/.test(word));
}

function jaccard(a = [], b = []) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / (setA.size + setB.size - intersection);
}

function tokenOverlap(a = [], b = []) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection += 1;
  }
  return intersection / Math.max(setA.size, setB.size);
}

export function scorePostSimilarity(body = '', others = []) {
  const words = contentWords(body);
  const compared = others.map((other) => {
    const otherWords = contentWords(other);
    return {
      similarity: jaccard(words, otherWords),
      tokenOverlap: tokenOverlap(words, otherWords)
    };
  });
  const maxSimilarity = compared.reduce((max, item) => Math.max(max, item.similarity), 0);
  const maxTokenOverlap = compared.reduce((max, item) => Math.max(max, item.tokenOverlap), 0);
  const duplicateSignal = Math.max(maxSimilarity, maxTokenOverlap);
  const duplicateRisk = maxSimilarity >= 0.58 || maxTokenOverlap >= 0.66;
  return {
    maxSimilarity,
    maxTokenOverlap,
    duplicateSignal,
    duplicateRisk,
    penalty: duplicateRisk ? Math.round((duplicateSignal - 0.5) * 120) : 0
  };
}

function variantIndex(seed = '', count = 1) {
  const text = String(seed || '');
  let hash = 0;
  for (const char of text) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return count ? hash % count : 0;
}

function topicParticle(label = '') {
  const text = String(label || '').trim();
  const last = text.codePointAt(text.length - 1);
  if (!last || last < 0xac00 || last > 0xd7a3) return '은';
  return ((last - 0xac00) % 28) ? '은' : '는';
}

function compactDetails(details = []) {
  const [first = '', second = '', third = ''] = details;
  return { first, second, third };
}

function casualPromptQuestion({ itemLabel = '이거', banmal = false, isSelfLiving = false, seed = '' } = {}) {
  const casual = isSelfLiving
    ? [
      '이거 나만 은근 신경 쓰이나?',
      '자취해본 사람들 이거 공감함?',
      '다들 이거 어디까지 봄?',
      '이 정도면 예민한 거임, 아니면 필수임?',
      '이거 겪어본 사람 은근 많지 않나'
    ]
    : [
      `이거 고를 때 다들 뭐부터 봄?`,
      `${itemLabel} 이 기준까지 보는 거 과함?`,
      `써본 사람들은 뭐가 제일 거슬렸음?`,
      `이거 은근 갈리는 포인트 맞지 않나`,
      `다들 이럴 때 뭐 먼저 봄?`
    ];
  const polite = isSelfLiving
    ? [
      '이거 저만 은근 신경 쓰이나요?',
      '자취해본 분들 이거 공감하시나요?',
      '다들 이거 어디까지 보세요?',
      '이 정도면 예민한 걸까요, 아니면 필수일까요?',
      '이거 겪어본 분들 은근 많지 않나요?'
    ]
    : [
      `이거 고를 때 다들 뭐부터 보세요?`,
      `${itemLabel} 이 기준까지 보는 거 과할까요?`,
      `써본 분들은 뭐가 제일 거슬렸나요?`,
      `이거 은근 갈리는 포인트 맞지 않나요?`,
      `다들 이럴 때 뭐 먼저 보세요?`
    ];
  const list = banmal ? casual : polite;
  return list[variantIndex(`${seed} casual question`, list.length)];
}

function topicIntent(topic = {}, account = {}) {
  const text = normalizeText(`${topic.title || ''} ${topic.angle || ''} ${account.content_scope || ''}`);
  if (/냄새|탈취|악취|물비린내/.test(text)) return 'smell';
  if (/빨래|건조|습기/.test(text)) return 'laundry';
  if (/청소|먼지|머리카락|바닥|닦/.test(text)) return 'cleaning';
  if (/선물|기념일|답례|축하/.test(text)) return 'gift';
  if (/간식|먹거리|음식|푸드|식품/.test(text)) return 'food';
  if (/정리|수납|공간|좁|원룸|자취/.test(text)) return 'storage';
  return 'general';
}

const NUMBERED_RATIO_BY_MODE = {
  checklist: 0.7,
  problem_solution: 0.35,
  auto: 0.3,
  empathy: 0.2,
  daily: 0.2,
  question: 0.2,
  safe_debate: 0.2
};

const AWKWARD_PHRASE_PATTERN = /흐름이에요|흐름이야|생활\s*속에서|고려해야|도움이\s*됩니다|중요합니다|요즘\s*인기인|후기에서\s*자주\s*보는|추천하는\s*(제품|상품|수납함|아이템)\s*있|이런\s*기준에서\s*추천하는|괜히\s*기분\s*좋아지는\s*이유/;
const AWKWARD_METAPHOR_PATTERN = /집이\s*좁은\s*게\s*아니라\s*내가\s*물건을\s*너무\s*믿|물건을\s*너무\s*믿었|청소는\s*시작하기\s*전까지는\s*인생\s*개조\s*프로젝트|정리는\s*체력\s*있을\s*때\s*하는\s*게\s*아니라|오늘의\s*결론\s*:\s*정리는|나\s*자신이\s*이해가\s*안\s*갔던게|방이\s*나를\s*거부|물건이\s*나를\s*이김/;

export function detectPostFormatStyle(body = '') {
  const text = String(body || '');
  if (/^\s*(POV|pov|관점)\s*[:：]/.test(text) || /내\s*상태\s*[:：]/.test(text)) return 'pov_scene';
  if (/(생각|상상|기대)\s*[:：].*(현실|실제)\s*[:：]|(현실|실제)\s*[:：].*(생각|상상|기대)\s*[:：]/s.test(text)) return 'myth_reality';
  if (/(1위|2위|3위|TOP\s*3|top\s*3|우선순위|먼저\s*보는\s*순서)/i.test(text)) return 'ranked_list';
  if (/(누가|친구가|댓글에서).*(물어보|묻|라고\s*하면|라길래)|^답\s*[:：]/.test(text)) return 'imaginary_reply';
  if (/(보내야|생각남|이거\s*너|친구한테)/.test(text)) return 'share';
  if (/(정리\s*전|정리\s*후|현실|상상|짤|밈)/.test(text)) return 'meme';
  if (/(샀는데|샀다가|사고\s*나서).*(없었|후회|망함|애매|더\s*좁)/.test(text)) return 'wrong_purchase';
  if (/(사기\s*전|고르기\s*전|살\s*때).*(먼저|봐야|체크)/.test(text)) return 'before_buy_check';
  if (/(감성|예쁜|사진빨).*(동선|손\s*가|꺼내기|보다)/.test(text)) return 'anti_aesthetic';
  if (/^\s*\d+\.\s+/m.test(text)) return 'numbered';
  if (/( vs |VS|아니면|둘\s*중|보이는\s*깔끔함|꺼내기\s*편한\s*쪽|쪽을\s*(먼저|더)|쪽이에요|쪽이야)/.test(text)) return 'comparison';
  if (/[?？]/.test(text)) return 'experience_question';
  return 'prose';
}

function targetNumberedRatio(account = {}) {
  const mode = String(account.content_mode || account.mode || 'auto').trim() || 'auto';
  return NUMBERED_RATIO_BY_MODE[mode] ?? NUMBERED_RATIO_BY_MODE.auto;
}

export function resolveFallbackFormatStyle(topic = {}, account = {}, { recentBodies = [], seed = '' } = {}) {
  const ratio = targetNumberedRatio(account);
  const effectiveSeed = `${seed} ${topic.id || ''} ${topic.title || ''} ${topic.angle || ''} ${account.id || ''} ${account.content_mode || ''}`;
  const recentStyles = recentBodies.map(detectPostFormatStyle).slice(0, 3);
  const recentNumbered = recentStyles.filter((style) => style === 'numbered').length;
  const recentNonNumbered = recentStyles.length - recentNumbered;

  if (recentNumbered >= 3) return 'prose';
  if (recentNonNumbered >= 3 && ratio >= 0.25) return 'numbered';

  const bucket = variantIndex(effectiveSeed, 100);
  if (bucket < Math.round(ratio * 100)) return 'numbered';
  return ['prose', 'comparison', 'experience_question', 'hot_take', 'share', 'wrong_purchase', 'lazy_tip', 'mini_story', 'pov_scene', 'myth_reality', 'ranked_list', 'imaginary_reply'][variantIndex(`${effectiveSeed} prose`, 12)];
}

function classifyDetailDomain(topic = {}, account = {}, products = []) {
  const topicContext = normalizeText(`${topic.title || ''} ${topic.angle || ''}`);
  const productContext = normalizeText(products.map((product) => [
    product.product_name || product.name,
    product.category_name || product.category,
    product.keyword
  ].filter(Boolean).join(' ')).join(' '));
  const scopeContext = normalizeText(account.content_scope || '');
  const mainContext = `${topicContext} ${productContext}`;
  const fullContext = `${mainContext} ${scopeContext}`;

  if (/선물|기념일|답례|축하|이벤트/.test(mainContext)) return 'gift';
  if (/주방|조리|식기|싱크|조리대|설거지|수세미|냄비|프라이팬|컵|수저/.test(mainContext)) return 'kitchen';
  if (/청소|먼지|청소포|돌돌이|욕실\s*물기|물걸레|닦/.test(mainContext)) return 'cleaning';
  if (/육아|아이(?!템)|아기|기저귀|물티슈|장난감|유모차/.test(mainContext)) return 'childcare';
  if (/반려|강아지|고양이|펫|배변|산책/.test(mainContext)) return 'pet';
  if (/차량|자동차|운전|차박|트렁크|콘솔|컵홀더/.test(mainContext)) return 'car';
  if (/운동|헬스|홈트|러닝|캠핑|등산|요가/.test(mainContext)) return 'activity';
  if (/뷰티|화장|스킨|헤어|파우치|고데기|드라이기/.test(mainContext)) return 'beauty';
  if (/욕실|화장실|샤워|물기/.test(mainContext)) return 'bathroom';
  if (/음식|푸드|먹거리|먹기|먹을|먹어|간식|냉장|식품/.test(mainContext)) return 'food';
  if (/자취|원룸|집기/.test(mainContext)) return 'self_living';

  if (/선물|기념일|답례|축하|이벤트/.test(scopeContext)) return 'gift';
  if (/주방|조리|식기/.test(scopeContext) && !/육아|아이(?!템)|아기/.test(fullContext)) return 'kitchen';
  if (/청소/.test(scopeContext)) return 'cleaning';
  if (/육아|아이(?!템)|아기/.test(scopeContext)) return 'childcare';
  if (/반려|강아지|고양이|펫/.test(scopeContext)) return 'pet';
  if (/차량|자동차|운전|차박/.test(scopeContext)) return 'car';
  if (/운동|헬스|홈트|러닝|캠핑|등산|요가/.test(scopeContext)) return 'activity';
  if (/뷰티|화장|스킨|헤어/.test(scopeContext)) return 'beauty';
  if (/욕실|화장실|샤워/.test(scopeContext)) return 'bathroom';
  if (/음식|푸드|먹거리|먹기|먹을|먹어|간식/.test(scopeContext)) return 'food';
  if (/자취|원룸|집기|살림|생활/.test(scopeContext)) return 'self_living';
  return 'general';
}

function pickLivingDetails(topic = {}, account = {}, products = []) {
  const intent = topicIntent(topic, account);
  const domain = classifyDetailDomain(topic, account, products);
  if (intent === 'smell' || intent === 'laundry') {
    if (domain === 'food') return ['손에 묻지 않고 바로 나눠 먹기 쉬운지', '남았을 때 냉장고 자리를 많이 차지하지 않는지', '포장 냄새가 오래 남지 않는지'];
    if (domain === 'kitchen') return ['싱크대 입구 냄새가 먼저 올라오는지', '설거지 후 물 고이는 자리가 있는지', '음식물 포장지를 바로 묶어둘 수 있는지'];
    return ['젖은 수건이나 빨래를 잠깐 둘 자리가 있는지', '바람 지나갈 틈을 만들 수 있는지', '침대 가까이 습기가 오래 남지 않는지'];
  }
  if (domain === 'childcare') {
    return ['아이 손이 닿는 낮은 자리인지', '기저귀나 물티슈를 바로 집을 수 있는지', '장난감 치울 때 통째로 옮기기 쉬운지'];
  }
  if (domain === 'pet') {
    return ['털 붙은 물건을 바로 털어낼 수 있는지', '물그릇 옆 바닥이 덜 젖는지', '산책 나갈 때 봉투를 바로 집을 수 있는지'];
  }
  if (domain === 'car') {
    return ['운전 중 바닥에 굴러다니지 않는지', '컵홀더나 콘솔을 막지 않는지', '비 오는 날 젖은 물건을 잠깐 둘 수 있는지'];
  }
  if (domain === 'activity') {
    return ['꺼내는 데 오래 걸리지 않는지', '접었을 때 방 한쪽을 너무 차지하지 않는지', '끝나고 땀 묻은 물건을 따로 둘 수 있는지'];
  }
  if (domain === 'beauty') {
    return ['매일 쓰는 제품이 앞에 나와 있는지', '선 있는 기기를 식혀둘 자리가 있는지', '파우치 안에서 다시 찾기 쉬운지'];
  }
  if (domain === 'kitchen') {
    return ['조리대 위에 올려도 손이 안 좁아지는지', '싱크대 옆에 잠깐 둘 자리가 있는지', '설거지 후 물 빠짐이 괜찮은지'];
  }
  if (domain === 'cleaning') {
    return ['청소포를 바로 꺼낼 수 있는지', '먼지가 보일 때 바로 닦기 쉬운지', '욕실 물기 치운 뒤 보관 자리가 있는지'];
  }
  if (domain === 'bathroom') {
    return ['샤워 후 물기 닿아도 괜찮은지', '젖은 물건을 잠깐 걸 곳이 있는지', '청소할 때 한 번에 치울 수 있는지'];
  }
  if (domain === 'gift') {
    return ['받는 사람이 바로 쓸 만한지', '포장 풀고 둘 자리가 애매하지 않은지', '취향을 너무 많이 타지 않는지'];
  }
  if (domain === 'food') {
    return ['손에 묻지 않고 바로 집어 먹기 쉬운지', '냉장고 자리를 많이 차지하지 않는지', '남았을 때 다시 묶어두기 편한지'];
  }
  if (domain === 'self_living') {
    const topicContext = normalizeText(`${topic.title || ''} ${topic.angle || ''}`);
    if (/현관|나가기|신발장|우산|열쇠|키트레이/.test(topicContext)) {
      return ['문 앞에서 바로 집을 수 있는지', '신발장 위에 올려도 어수선하지 않은지', '우산이나 열쇠가 바닥에 굴러다니지 않는지'];
    }
    if (/멀티탭|전선|케이블|충전/.test(topicContext)) {
      return ['침대 옆 충전선이 바닥에 늘어지지 않는지', '멀티탭 스위치를 손 뻗어 끌 수 있는지', '청소할 때 전선을 한 번에 들 수 있는지'];
    }
    if (/책상|데스크|서랍|문구/.test(topicContext)) {
      return ['자주 쓰는 충전기나 펜이 손 닿는 곳에 있는지', '컵 하나 올려도 책상 위가 꽉 차지 않는지', '잠들기 전 다시 넣기 귀찮지 않은지'];
    }
    if (/빨래|바구니|수건|건조/.test(topicContext)) {
      return ['젖은 수건을 마른 옷이랑 따로 둘 수 있는지', '세탁기 돌리기 전까지 냄새가 덜 올라오는지', '방 한가운데 바구니가 계속 걸리지 않는지'];
    }
    if (/청소|머리카락|돌돌이|바닥|먼지/.test(topicContext)) {
      return ['침대 옆 머리카락이 보일 때 바로 집을 수 있는지', '책상 의자 밑까지 밀기 쉬운지', '문 뒤나 벽 틈에 세워둬도 거슬리지 않는지'];
    }
    if (/접이식|폴딩|리빙박스|수납함|정리함/.test(topicContext)) {
      return ['펼쳤을 때 방문이 걸리지 않는지', '안 쓰는 날 접어서 침대 밑에 넣을 수 있는지', '자주 꺼내는 물건이 맨 아래 깔리지 않는지'];
    }
    return ['설거지 끝나고 바로 내려둘 자리', '빨래 돌리기 전 잠깐 모아둘 바구니 자리', '현관에서 나갈 때 바로 집는 물건 자리'];
  }
  return ['자주 쓰는 순간에 바로 닿는지', '둘 자리가 애매하게 남지 않는지', '관리할 때 손이 한 번 덜 가는지'];
}

function wantsBanmal(account = {}) {
  return /반말|존댓말\s*금지/.test(String(account.tone || '').replace(/\s+/g, ''));
}

function inferItemLabel(topic = {}, account = {}, products = []) {
  const domain = classifyDetailDomain(topic, account, products);
  if (domain === 'kitchen') return '주방용품';
  if (domain === 'cleaning') return '청소용품';
  if (domain === 'childcare') return '육아용품';
  if (domain === 'pet') return '펫템';
  if (domain === 'car') return '차량용품';
  if (domain === 'activity') return '운동용품';
  if (domain === 'beauty') return '뷰티템';
  if (domain === 'bathroom') return '욕실용품';
  if (domain === 'gift') return '선물';
  if (domain === 'food') return '먹거리';
  if (domain === 'self_living') return '자취템';
  const scopeContext = normalizeText(account.content_scope || '');
  const productContext = normalizeText(products.map((product) => [
    product.product_name || product.name,
    product.category_name || product.category,
    product.keyword
  ].filter(Boolean).join(' ')).join(' '));
  const topicContext = normalizeText(`${topic.title || ''} ${topic.angle || ''}`);
  const primaryContext = scopeContext || topicContext || productContext;
  if (/주방|조리|식기/.test(primaryContext)) return '주방용품';
  if (/청소/.test(primaryContext)) return '청소용품';
  if (/수납|정리|공간/.test(primaryContext)) return '수납용품';
  if (/욕실|화장실|샤워/.test(primaryContext)) return '욕실용품';
  if (/자취|원룸|집기/.test(primaryContext)) return '자취템';
  if (/선물|기념일|이벤트/.test(primaryContext)) return '선물';
  if (/음식|푸드|먹/.test(primaryContext)) return '먹거리';
  if (/육아|아이(?!템)|아기/.test(primaryContext)) return '육아용품';
  if (/반려|강아지|고양이|펫/.test(primaryContext)) return '펫템';
  if (/차량|자동차|운전|차박/.test(primaryContext)) return '차량용품';
  if (/운동|헬스|홈트|러닝|캠핑|등산|요가/.test(primaryContext)) return '운동용품';
  if (/뷰티|화장|스킨|헤어/.test(primaryContext)) return '뷰티템';
  const context = normalizeText(`${productContext} ${scopeContext} ${topicContext}`);
  if (/음식|푸드|먹/.test(context)) return '먹거리';
  if (/육아|아이(?!템)|아기/.test(context)) return '육아용품';
  if (/반려|강아지|고양이|펫/.test(context)) return '펫템';
  if (/차량|자동차|운전|차박/.test(context)) return '차량용품';
  if (/운동|헬스|홈트|러닝|캠핑|등산|요가/.test(context)) return '운동용품';
  if (/뷰티|화장|스킨|헤어/.test(context)) return '뷰티템';
  if (/선물|기념일|이벤트/.test(context)) return '선물';
  if (/주방|조리|식기/.test(context)) return '주방용품';
  if (/청소/.test(context)) return '청소용품';
  if (/수납|정리|공간/.test(context)) return '수납용품';
  if (/욕실|화장실|샤워/.test(context)) return '욕실용품';
  if (/자취|원룸|집기/.test(context)) return '자취템';
  const text = normalizeText(sanitizeContentTitle(topic.title || account.content_scope || '생활용품', account))
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1) || '';
  if (/집기/.test(text)) return '집기';
  if (/수납/.test(text)) return '수납용품';
  if (/주방/.test(text)) return '주방용품';
  if (/욕실/.test(text)) return '욕실용품';
  if (/청소/.test(text)) return '청소용품';
  return text.replace(/[?？!！.,]/g, '').slice(0, 18) || '생활용품';
}

export function detectCategoryMismatch(body = '') {
  const text = String(body || '');
  const hasChildcareDetail = /(아이\s*손|아이에게|아기|기저귀|물티슈|장난감|유모차|낮은\s*자리)/.test(text);
  const hasKitchenChoreDetail = /(조리대|싱크대|설거지|수세미|물\s*빠짐|냄비|프라이팬|컵|수저)/.test(text);
  const hasCleaningDetail = /(청소포|먼지|욕실\s*물기|물걸레|닦기|청소할\s*때)/.test(text);
  const hasSelfLivingChoreDetail = /(빨래|현관|신발장|분리수거|침대\s*옆|우산|열쇠)/.test(text);
  const giftContext = /선물|기념일|답례|축하|받는\s*사람|포장/.test(text);
  const kitchenContext = /주방용품|주방|조리|식기/.test(text);
  const cleaningContext = /청소용품|청소|먼지|청소포/.test(text);
  const foodContext = /먹거리|음식|푸드|간식|냉장고/.test(text);

  return (giftContext && (hasChildcareDetail || hasKitchenChoreDetail || hasCleaningDetail))
    || (kitchenContext && (hasChildcareDetail || hasSelfLivingChoreDetail))
    || (cleaningContext && hasChildcareDetail)
    || (foodContext && (hasChildcareDetail || hasKitchenChoreDetail || hasCleaningDetail));
}

export function scorePostEngagement(body = '', { products = [] } = {}) {
  const text = String(body || '').trim();
  const first = firstSentenceOf(text);
  const inspection = inspectGeneratedPostText(text);
  const productNames = products.map((product) => String(product.product_name || product.name || '').trim()).filter(Boolean);
  const productMentions = productNames.reduce((sum, name) => sum + (name && text.includes(name) ? 1 : 0), 0);
  const questionCount = countMatches(text, /[?？]/g);
  const numberedCriteriaCount = countMatches(text, /^\s*\d+\.\s+/gm);
  const paragraphCount = text.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean).length;
  const lineCount = text.split(/\n+/).map((line) => line.trim()).filter(Boolean).length;
  const microDetailMatches = countMatches(text, /(설거지|빨래|현관|욕실|샤워|조리대|침대\s*(옆|밑)|방문|바닥|물기|멀티탭|분리수거|쓰레기|수건|젖은|바구니|문\s*앞|싱크대|냉장고|신발장|서랍|행거|컵|수저|수세미|청소포|돌돌이|충전기|열쇠|우산|아이|아기|기저귀|물티슈|장난감|유모차|낮은\s*자리|받는\s*사람|포장|취향|손에\s*묻|손\s*닿는\s*곳|맨\s*아래|나눠\s*먹|다시\s*묶|소포장|털|물그릇|산책|배변|콘솔|컵홀더|트렁크|고데기|드라이기|파우치|요가매트|폼롤러|랜턴)/g);
  const sensoryDetailMatches = countMatches(text, /(손이\s*(덜|잘|자주)|손에\s*묻|손\s*닿는\s*곳|바로\s*(집|꺼내|닿|두|나눠)|한\s*번\s*덜|덜\s*어지|덜\s*젖|물\s*빠|먼지|냄새|미끄|좁아|쌓이|굴러다니|말릴|걸리지|깔리|흔들리|젖|털어낼|식혀둘)/g);
  const shallowChecklist = /(자주\s*쓰는지|보관이\s*쉬운지|관리(가|는)?\s*부담\s*없|실용성|사용감|가격을\s*보세요|관리하기\s*쉬운지)/.test(text)
    && microDetailMatches < 2;
  const repetitiveFallback = hasRepetitiveContentPattern(text);
  const ctaLeak = /댓글\s*(참고|확인|봐|달|남겨|공유|알려|부탁)|쿠팡|파트너스|제휴|링크\s*(확인|참고|보기)?/.test(text);
  const topicTitleEcho = /정리\s*쉽게\s*하는\s*법,\s*평소에는\s*별거\s*아닌데|,\s*평소에는\s*별거\s*아닌데\s*막상\s*필요할\s*때마다/.test(text);
  const awkwardPhrase = AWKWARD_PHRASE_PATTERN.test(text);
  const awkwardMetaphor = AWKWARD_METAPHOR_PATTERN.test(text);
  const categoryMismatch = detectCategoryMismatch(text);
  const abstractSetup = /생활\s*속에서|고려해야|중요한\s*게\s*사실|정말\s*중요/.test(first) || awkwardPhrase;
  const ambiguousCompressedSetup = /(청소는\s*꺼내는\s*시간|수납하려고\s*샀는데\s*방이\s*더\s*좁|정리하려고\s*샀는데\s*더\s*좁|꺼내는\s*시간이\s*길면\s*시작도\s*안)/.test(first);
  const compactRelatable = text.length >= 18
    && text.length <= 95
    && lineCount <= 2
    && /(ㅋㅋ|나만|진짜|은근|듯|많음|있음|공감|겪어본|왜 이럼|이거 뭐임|현실)/.test(text)
    && /(방|집|자취|원룸|책상|욕실|주방|바닥|수납|정리|청소|빨래|먼지|충전|멀티탭|선반|서랍|침대|현관|냉장고)/.test(text)
    && !ambiguousCompressedSetup;
  const shareTrigger = /(보내야|생각남|떠오름|이거\s*너|친구한테|누구\s*생각|태그하고\s*싶)/.test(text);
  const memeShape = /(정리\s*전|정리\s*후|현실|상상|짤|밈|ㅋㅋ)/.test(text) && text.length <= 140;
  const wrongPurchase = /(샀는데|샀다가|사고\s*나서).*(없었|후회|망함|애매|더\s*좁|안\s*씀|손\s*안\s*감)/.test(text);
  const lazyAngle = /(귀찮|게으른|부지런|다시\s*넣기|꺼내기\s*귀찮|손\s*안\s*감|의욕\s*사라)/.test(text);
  const antiAesthetic = /(감성|예쁜|인테리어|사진빨).*(보다|말고|이김|동선|꺼내기|손\s*가)/.test(text);
  const povScene = /^\s*(POV|pov|관점)\s*[:：]/.test(text) || /내\s*상태\s*[:：]/.test(text);
  const mythReality = /(생각|상상|기대)\s*[:：].*(현실|실제)\s*[:：]|(현실|실제)\s*[:：].*(생각|상상|기대)\s*[:：]/s.test(text);
  const rankedPriority = /(1위|2위|3위|TOP\s*3|top\s*3|우선순위|먼저\s*보는\s*순서|1순위)/i.test(text);
  const imaginaryReply = /(누가|친구가|댓글에서).*(물어보|묻|라고\s*하면|라길래)|^답\s*[:：]/.test(text);
  const nativeSocialShape = povScene || mythReality || rankedPriority || imaginaryReply;
  const checks = {
    hook: /(불편|막상|은근|갈리|후회|실수|어렵|귀찮|헷갈|고민|다들|써본|써보신|어느 쪽|vs|VS|좁아|ㅋㅋ|이거\s*뭐임|POV|pov|생각|현실|1순위|댓글에서)/.test(first),
    choiceTension: /( vs |VS|아니면|쪽|갈리|취향|습관|공간|예산|빈도|기준|먼저|차이|보이는|숨기는|실용성|사용감)/.test(text),
    easyQuestion: /[?？]|여러분|다들|써본|써보신|어때|뭐가|어느 쪽|고르|추천|쪽이에요|공감함|겪어본|나만|어디까지\s*봄|예민한\s*거임|필수임/.test(text),
    concreteSituation: /(자취|집|방|주방|욕실|수납|정리|청소|빨래|차량|사무실|아이|반려|펫|강아지|고양이|운전|운동|캠핑|러닝|화장대|파우치|헤어|원룸|좁은|꺼내|접이|보관|설치)/.test(text),
    lowAdTone: !/(구매|최저가|특가|할인|링크|가격|꼭 필요한|필수템|강추|대박|완벽|무조건)/.test(text),
    productNatural: productMentions <= 1 && !/(상품|제품).{0,8}(추천|구매)/.test(text),
    concise: text.length >= 18 && text.length <= 230,
    safe: !/(한심|극혐|노답|틀딱|맘충|남혐|여혐|무식|병신|정치|남자들은|여자들은|요즘 애들|아줌마|아재|지역|진보|보수|(^|[\s.,!?])거지(?=$|[\s.,!?]))/.test(text),
    genericTemplate: inspection.genericTemplate,
    aiLikeTone: inspection.aiLikeTone,
    repetitiveFallback,
    ctaLeak,
    topicTitleEcho,
    abstractSetup,
    ambiguousCompressedSetup,
    awkwardPhrase,
    awkwardMetaphor,
    categoryMismatch,
    accountTokenLeak: inspection.accountTokenLeak,
    compactRelatable,
    shareTrigger,
    memeShape,
    wrongPurchase,
    lazyAngle,
    antiAesthetic,
    povScene,
    mythReality,
    rankedPriority,
    imaginaryReply,
    nativeSocialShape,
    livedInStructure: ((paragraphCount >= 3 || lineCount >= 3 || numberedCriteriaCount >= 2) || nativeSocialShape)
      && /(처음엔|막상|살아보면|매일|자주|손\s*(가|안\s*감)|먼저|저라면|저는|나는|첫\s*주|사고\s*나서|방치|안\s*사게|사진빨)/.test(text),
    concreteCriteria: numberedCriteriaCount >= 2 || /(둘 곳|모아둘 곳|말릴 곳|닦이는 곳|꺼내기|보관|물기|설거지|빨래|바닥|조리대|싱크대|청소포|먼지|현관|욕실|낮은\s*자리|기저귀|물티슈|장난감|유모차|받는\s*사람|포장|취향|손에\s*묻|손\s*닿는\s*곳|냉장고|다시\s*묶|방문|침대\s*밑|맨\s*아래|털|물그릇|산책|배변|콘솔|컵홀더|트렁크|고데기|드라이기|파우치|요가매트|폼롤러|랜턴)/.test(text),
    microDetail: microDetailMatches >= 2 || (microDetailMatches >= 1 && sensoryDetailMatches >= 1),
    saveWorthiness: /(저라면|먼저|덜\s*후회|덜\s*쌓|사기\s*전|시작할\s*때|처음\s*자취|체크|기준|자리부터|맞춰두|나중에|한\s*번\s*덜|첫\s*주|사진빨|방치|안\s*사게|손\s*안\s*감|공감함|공감하시나요|어디까지\s*봄|필수임|필수일까요|예민한\s*거임|예민한\s*걸까요)/.test(text)
      && (microDetailMatches >= 1 || numberedCriteriaCount >= 2),
    humanWarmth: /(저라면|저는|나는|같아요|같아|걸까요|많아요|더라고요|더라|되더라고요|덜\s*후회|살아보면|처음엔|막상|은근|진짜|나만|공감함|듯|많음|겪어본|안\s*사게|손\s*안\s*감|ㅋㅋ)/.test(text)
      && !/(습니다|합니다|됩니다|중요합니다)/.test(text),
    shallowChecklist
  };
  const rubric = {
    hookScore: checks.hook ? 18 : (first.length >= 12 ? 8 : 2),
    commentEaseScore: checks.easyQuestion ? (questionCount <= 1 ? 20 : 16) : 4,
    choiceTensionScore: checks.choiceTension ? (checks.genericTemplate ? 6 : 18) : 4,
    specificityScore: checks.concreteSituation ? 16 : -8,
    adTonePenalty: checks.lowAdTone ? 0 : -18,
    productFitScore: checks.productNatural ? 12 : -12,
    safetyPenalty: checks.safe ? 0 : -70,
    readabilityScore: checks.concise ? 10 : 2,
    livedInStructureScore: checks.livedInStructure ? 14 : (checks.compactRelatable ? 8 : -10),
    concreteCriteriaScore: checks.concreteCriteria ? 12 : (checks.compactRelatable ? 4 : -8),
    usefulSpecificityScore: checks.microDetail ? 18 : (checks.compactRelatable ? 8 : -12),
    saveWorthinessScore: checks.saveWorthiness ? 14 : (checks.compactRelatable ? 6 : -8),
    humanWarmthScore: checks.humanWarmth ? 8 : -4,
    shareabilityScore: checks.shareTrigger ? 12 : 0,
    memeShapeScore: checks.memeShape ? 8 : 0,
    wrongPurchaseScore: checks.wrongPurchase ? 10 : 0,
    lazyAngleScore: checks.lazyAngle ? 6 : 0,
    antiAestheticScore: checks.antiAesthetic ? 6 : 0,
    nativeSocialShapeScore: checks.nativeSocialShape ? 10 : 0,
    rankedPriorityScore: checks.rankedPriority ? 8 : 0,
    communityReplyScore: checks.imaginaryReply ? 6 : 0,
    shallowChecklistPenalty: checks.shallowChecklist ? -28 : 0,
    templatePenalty: checks.genericTemplate ? -35 : 0,
    repetitiveFallbackPenalty: checks.repetitiveFallback ? -24 : 0,
    ctaLeakPenalty: checks.ctaLeak ? -70 : 0,
    topicTitleEchoPenalty: checks.topicTitleEcho ? -42 : 0,
    abstractSetupPenalty: checks.abstractSetup ? -16 : 0,
    ambiguousCompressedSetupPenalty: checks.ambiguousCompressedSetup ? -34 : 0,
    awkwardPhrasePenalty: checks.awkwardPhrase ? -28 : 0,
    awkwardMetaphorPenalty: checks.awkwardMetaphor ? -30 : 0,
    categoryMismatchPenalty: checks.categoryMismatch ? -45 : 0,
    aiTonePenalty: checks.aiLikeTone ? -35 : 0,
    accountTokenPenalty: checks.accountTokenLeak ? -80 : 0
  };
  const reasons = [];
  if (checks.hook) reasons.push('첫 문장 후킹');
  else reasons.push('첫 문장 약함');
  if (checks.choiceTension) reasons.push('선택 갈림 신호');
  if (checks.easyQuestion) reasons.push('답하기 쉬운 질문');
  if (checks.concreteSituation) reasons.push('구체적 생활 상황');
  if (checks.lowAdTone) reasons.push('광고톤 낮음');
  else reasons.push('광고톤 감점');
  if (checks.productNatural) reasons.push('상품 연결 자연스러움');
  else reasons.push('상품 언급 과다');
  if (checks.concise) reasons.push('짧고 읽기 쉬움');
  else reasons.push('길이 감점');
  if (checks.livedInStructure) reasons.push('생활 장면 구조');
  else if (checks.compactRelatable) reasons.push('짧은 공감 포맷');
  else reasons.push('생활 장면 부족');
  if (checks.concreteCriteria) reasons.push('구체 기준 포함');
  else reasons.push('구체 기준 부족');
  if (checks.microDetail) reasons.push('생활 디테일 포함');
  else reasons.push('생활 디테일 부족');
  if (checks.saveWorthiness) reasons.push('저장 가치 있음');
  else reasons.push('저장 가치 부족');
  if (checks.humanWarmth) reasons.push('자연스러운 사람 말투');
  if (checks.shareTrigger) reasons.push('공유 유도형 상황');
  if (checks.memeShape) reasons.push('밈/카드형 장면');
  if (checks.wrongPurchase) reasons.push('실패담/후회 방지');
  if (checks.lazyAngle) reasons.push('귀찮음 기준 공감');
  if (checks.antiAesthetic) reasons.push('감성보다 동선 관점');
  if (checks.nativeSocialShape) reasons.push('플랫폼 네이티브 포맷');
  if (checks.rankedPriority) reasons.push('우선순위/랭킹 구조');
  if (checks.imaginaryReply) reasons.push('댓글 답변형 구조');
  if (checks.shallowChecklist) reasons.push('얕은 체크리스트 감점');
  if (!checks.safe) reasons.push('안전성 위험');
  if (checks.genericTemplate) reasons.push('템플릿 문장 감점');
  if (checks.repetitiveFallback) reasons.push('반복 fallback 골격 감점');
  if (checks.ctaLeak) reasons.push('본문 CTA/링크 레이어 노출 감점');
  if (checks.topicTitleEcho) reasons.push('주제 제목 복붙 문장 감점');
  if (checks.abstractSetup) reasons.push('추상적 첫 문장 감점');
  if (checks.ambiguousCompressedSetup) reasons.push('주어/목적어 빠진 압축문장 감점');
  if (checks.awkwardPhrase) reasons.push('어색한 금지 표현 감점');
  if (checks.awkwardMetaphor) reasons.push('작위적인 비유/교훈문 감점');
  if (checks.categoryMismatch) reasons.push('카테고리 생활 디테일 불일치 감점');
  if (checks.aiLikeTone) reasons.push('AI 문체 감점');
  if (checks.accountTokenLeak) reasons.push('계정 아이디 노출 감점');

  let pattern = 'empathy_prompt';
  if (checks.choiceTension) pattern = 'choice_tension';
  else if (checks.imaginaryReply) pattern = 'community_answer';
  else if (checks.nativeSocialShape) pattern = 'native_scene';
  else if (/후회|실수|사기 전|고르기 전|체크/.test(text)) pattern = 'regret_prevention';
  else if (checks.easyQuestion) pattern = 'experience_question';
  const rawScore = 12
    + rubric.hookScore
    + rubric.commentEaseScore
    + rubric.choiceTensionScore
    + rubric.specificityScore
    + rubric.productFitScore
    + rubric.readabilityScore
    + rubric.livedInStructureScore
    + rubric.concreteCriteriaScore
    + rubric.usefulSpecificityScore
    + rubric.saveWorthinessScore
    + rubric.humanWarmthScore
    + rubric.shareabilityScore
    + rubric.memeShapeScore
    + rubric.wrongPurchaseScore
    + rubric.lazyAngleScore
    + rubric.antiAestheticScore
    + rubric.nativeSocialShapeScore
    + rubric.rankedPriorityScore
    + rubric.communityReplyScore
    + rubric.shallowChecklistPenalty
    + rubric.adTonePenalty
    + rubric.safetyPenalty
    + rubric.templatePenalty
    + rubric.repetitiveFallbackPenalty
    + rubric.ctaLeakPenalty
    + rubric.topicTitleEchoPenalty
    + rubric.abstractSetupPenalty
    + rubric.ambiguousCompressedSetupPenalty
    + rubric.awkwardPhrasePenalty
    + rubric.awkwardMetaphorPenalty
    + rubric.categoryMismatchPenalty
    + rubric.aiTonePenalty
    + rubric.accountTokenPenalty;

  return {
    engagementScore: clampScore(rawScore),
    engagementPattern: pattern,
    selectionReasons: unique(reasons),
    rubric,
    checks,
    formatStyle: detectPostFormatStyle(text),
    firstSentence: first
  };
}

export function buildHumanStyleFallback(topic = {}, account = {}, products = [], options = {}) {
  const itemLabel = inferItemLabel(topic, account, products);
  const itemTopic = `${itemLabel}${topicParticle(itemLabel)}`;
  const details = pickLivingDetails(topic, account, products);
  const detail = compactDetails(details);
  const banmal = wantsBanmal(account);
  const isSelfLiving = /자취|원룸/.test(`${topic.title || ''} ${account.content_scope || ''}`);
  const seed = `${topic.id || ''} ${topic.title || ''} ${topic.angle || ''} ${account.id || ''} ${itemLabel}`;
  const intent = topicIntent(topic, account);
  const formatStyle = options.formatStyle || resolveFallbackFormatStyle(topic, account, {
    recentBodies: options.recentBodies || [],
    seed
  });
  const question = casualPromptQuestion({ itemLabel, banmal, isSelfLiving, seed });

  const intentHooks = {
    smell: banmal
      ? ['냄새 잡는다고 향 센 거부터 사면 더 애매해질 때 있음.', '냄새는 제품보다 어디서 올라오는지 못 잡으면 돈만 쓰게 됨.']
      : ['냄새 잡는다고 향 센 거부터 사면 더 애매해질 때 있어요.', '냄새는 제품보다 어디서 올라오는지 못 잡으면 돈만 쓰게 되더라고요.'],
    storage: banmal
      ? ['방 넓어지라고 정리했는데 정리템 때문에 더 좁아지는 경우 있음.', '좁은 방은 정리템 잘못 사면 큰 짐 하나 더 생기는 느낌임.']
      : ['방 넓어지라고 정리했는데 정리템 때문에 더 좁아지는 경우가 있어요.', '좁은 방은 정리템 잘못 사면 큰 짐 하나 더 생기는 느낌이에요.'],
    gift: banmal
      ? ['선물은 비싼 것보다 받자마자 안 민망한 게 오래 감.', '포장 예뻐도 둘 곳 없으면 바로 애매해짐.']
      : ['선물은 비싼 것보다 받자마자 안 민망한 게 오래 가더라고요.', '포장 예뻐도 둘 곳 없으면 바로 애매해져요.'],
    food: banmal
      ? ['먹거리는 맛보다 남았을 때 귀찮은지가 은근 큼.', '간식은 예쁜 세트보다 손에 안 묻는 쪽이 오래 감.']
      : ['먹거리는 맛보다 남았을 때 귀찮은지가 은근 크더라고요.', '간식은 예쁜 세트보다 손에 안 묻는 쪽이 오래 가요.'],
    cleaning: banmal
      ? ['청소도구가 안 보이는 데 있으면 먼지 보여도 그냥 지나치게 됨.', '청소용품은 세기보다 바로 집히는지가 이김.']
      : ['청소도구가 안 보이는 데 있으면 먼지 보여도 그냥 지나치게 되더라고요.', '청소용품은 세기보다 바로 집히는지가 이기더라고요.'],
    laundry: banmal
      ? ['빨래 냄새는 섬유향보다 말리는 자리에서 갈림.', '방 안 빨래는 향보다 바람 지나갈 틈이 먼저임.']
      : ['빨래 냄새는 섬유향보다 말리는 자리에서 갈리더라고요.', '방 안 빨래는 향보다 바람 지나갈 틈이 먼저예요.'],
    general: banmal
      ? ['이거 사기 전에 딱 하나만 보면 덜 후회함.', '좋아 보여서 샀는데 첫 주에 바로 애매해지는 기준 있음.']
      : ['이거 사기 전에 딱 하나만 보면 덜 후회하더라고요.', '좋아 보여서 샀는데 첫 주에 바로 애매해지는 기준이 있어요.']
  };
  const hook = intentHooks[intent]?.[variantIndex(`${seed} hook`, intentHooks[intent].length)] || intentHooks.general[0];

  const numberedTemplates = banmal
    ? [
      `${itemTopic} 살 때 사진만 보면 거의 망하는 듯.\n\n나는\n1. ${detail.first}\n2. ${detail.second}\n3. ${detail.third}\n이 정도는 봐야 덜 쌓이더라.\n\n${question}`,
      `${itemTopic} 처음엔 좋아 보이는데 첫 주에 바로 티 나는 거 있음.\n\n1. ${detail.first}\n2. ${detail.second}\n이거 안 맞으면 손 잘 안 감. ${detail.third}까지 맞으면 꽤 오래 가고.\n\n${question}`
    ]
    : [
      `${itemTopic} 살 때 사진만 보면 거의 실패하더라고요.\n\n저는\n1. ${detail.first}\n2. ${detail.second}\n3. ${detail.third}\n이 정도는 봐야 덜 쌓였어요.\n\n${question}`,
      `${itemTopic} 처음엔 좋아 보이는데 첫 주에 바로 티 나는 게 있어요.\n\n1. ${detail.first}\n2. ${detail.second}\n이거 안 맞으면 손이 잘 안 가요. ${detail.third}까지 맞으면 꽤 오래 가고요.\n\n${question}`
    ];

  const proseTemplates = banmal
    ? [
      `${hook}\n\n${detail.first} 애매하면 진짜 손 안 감. ${detail.second} 안 맞으면 결국 바닥이나 책상 위에 쌓이고.\n\n요즘은 ${detail.third}까지 안 맞으면 그냥 안 사게 됨. ${question}`,
      `${itemLabel}, 이거 은근 사진빨에 속기 쉬움.\n\n${detail.first} 애매하면 한 번 더 미루게 되고, ${detail.second} 맞으면 그래도 자주 쓰게 되더라.\n\n${question}`
    ]
    : [
      `${hook}\n\n${detail.first} 애매하면 진짜 손이 안 가요. ${detail.second} 안 맞으면 결국 바닥이나 책상 위에 쌓이고요.\n\n요즘은 ${detail.third}까지 안 맞으면 그냥 안 사게 되더라고요. ${question}`,
      `${itemLabel}, 이거 은근 사진빨에 속기 쉬워요.\n\n${detail.first} 애매하면 한 번 더 미루게 되고, ${detail.second} 맞으면 그래도 자주 쓰게 되더라고요.\n\n${question}`
    ];

  const comparisonTemplates = banmal
    ? [
      `${hook}\n\n${detail.first} 쪽이냐, ${detail.third} 쪽이냐에서 만족도 갈리는 듯.\n\n난 결국 나중에 덜 귀찮은 쪽으로 가게 됨. ${question}`,
      `${itemTopic} 감성파랑 동선파 여기서 갈릴 것 같음.\n\n${detail.first} 맞으면 자주 쓰고, ${detail.second} 맞으면 덜 방치하게 되더라.\n\n${question}`
    ]
    : [
      `${hook}\n\n${detail.first} 쪽이냐, ${detail.third} 쪽이냐에서 만족도가 갈리는 것 같아요.\n\n저는 결국 나중에 덜 귀찮은 쪽으로 가게 되더라고요. ${question}`,
      `${itemTopic} 감성파랑 동선파 여기서 갈릴 것 같아요.\n\n${detail.first} 맞으면 자주 쓰고, ${detail.second} 맞으면 덜 방치하게 되더라고요.\n\n${question}`
    ];

  const experienceQuestionTemplates = banmal
    ? [
      `${hook}\n\n${detail.first}, ${detail.second} 이 두 개 맞으면 오래 가는데 ${detail.third} 애매하면 생각보다 빨리 방치됨.\n\n${question}`,
      `${itemTopic} 며칠 써보면 계속 손 갈지 바로 보임.\n\n${detail.first}랑 ${detail.second} 둘 중 하나만 안 맞아도 금방 방치되더라.\n\n${question}`
    ]
    : [
      `${hook}\n\n${detail.first}, ${detail.second} 이 두 개 맞으면 오래 가는데 ${detail.third} 애매하면 생각보다 빨리 방치돼요.\n\n${question}`,
      `${itemTopic} 며칠 써보면 계속 손이 갈지 바로 보여요.\n\n${detail.first}랑 ${detail.second} 둘 중 하나만 안 맞아도 금방 방치되더라고요.\n\n${question}`
    ];

  const hotTakeTemplates = banmal
    ? [
      `${hook}\n\n광고 사진에서 안 보이는 건 결국 ${detail.first}, ${detail.second} 이런 거임.\n사고 나서 짜증나는 건 대부분 ${detail.third}에서 오고.\n\n${question}`,
      `${itemTopic} 살까 말까보다 어디서 짜증나는지가 더 중요함.\n\n${detail.first} 안 맞으면 첫날부터 거슬리고, ${detail.second} 맞으면 의외로 오래 씀.\n\n${question}`
    ]
    : [
      `${hook}\n\n광고 사진에서 안 보이는 건 결국 ${detail.first}, ${detail.second} 이런 거예요.\n사고 나서 짜증나는 건 대부분 ${detail.third}에서 오고요.\n\n${question}`,
      `${itemTopic} 살까 말까보다 어디서 짜증나는지가 더 중요하더라고요.\n\n${detail.first} 안 맞으면 첫날부터 거슬리고, ${detail.second} 맞으면 의외로 오래 써요.\n\n${question}`
    ];

  const shareTemplates = banmal
    ? [
      `${itemTopic} 사진만 보고 사려는 사람한테 보내야 됨.\n\n${detail.first} 안 맞으면 첫 주부터 손 안 가고, ${detail.second} 애매하면 결국 바닥에 쌓이더라.\n\n${question}`,
      `이거 보고 ${itemLabel} 아무거나 사려던 사람 생각남.\n\n${detail.first}, ${detail.second} 여기서 거의 갈림. ${detail.third}까지 맞으면 오래 쓰고.\n\n${question}`
    ]
    : [
      `${itemTopic} 사진만 보고 사려는 사람한테 보내고 싶어요.\n\n${detail.first} 안 맞으면 첫 주부터 손이 안 가고, ${detail.second} 애매하면 결국 바닥에 쌓이더라고요.\n\n${question}`,
      `이거 보면 ${itemLabel} 아무거나 사려던 사람 생각나요.\n\n${detail.first}, ${detail.second} 여기서 거의 갈려요. ${detail.third}까지 맞으면 오래 쓰고요.\n\n${question}`
    ];

  const wrongPurchaseTemplates = banmal
    ? [
      `${itemTopic} 샀는데 둘 자리가 없으면 그때부터 큰 짐 하나 더 생김.\n\n${detail.first}부터 보고, ${detail.second} 애매하면 그냥 안 사는 게 나을 때 많더라.\n\n${question}`,
      `${itemTopic} 잘못 사면 정리되는 게 아니라 정리할 물건이 하나 늘어남.\n\n${detail.first}랑 ${detail.third} 이거 안 맞으면 손 안 감.\n\n${question}`
    ]
    : [
      `${itemTopic} 샀는데 둘 자리가 없으면 그때부터 큰 짐 하나 더 생기더라고요.\n\n${detail.first}부터 보고, ${detail.second} 애매하면 그냥 안 사는 게 나을 때가 많아요.\n\n${question}`,
      `${itemTopic} 잘못 사면 정리되는 게 아니라 정리할 물건이 하나 늘어요.\n\n${detail.first}랑 ${detail.third} 이거 안 맞으면 손이 안 가더라고요.\n\n${question}`
    ];

  const lazyTipTemplates = banmal
    ? [
      `부지런한 사람 기준 말고 다시 넣기 귀찮은 사람 기준으로 봐야 됨.\n\n${detail.first} 애매하면 바로 방치되고, ${detail.second} 맞으면 그래도 자주 쓰게 되더라.\n\n${question}`,
      `${itemTopic} 살 때 제일 현실적인 기준은 귀찮아도 제자리로 돌아가냐인 듯.\n\n${detail.first}, ${detail.third} 둘 중 하나만 애매해도 손 안 감.\n\n${question}`
    ]
    : [
      `부지런한 사람 기준 말고 다시 넣기 귀찮은 사람 기준으로 봐야 해요.\n\n${detail.first} 애매하면 바로 방치되고, ${detail.second} 맞으면 그래도 자주 쓰게 되더라고요.\n\n${question}`,
      `${itemTopic} 살 때 제일 현실적인 기준은 귀찮아도 제자리로 돌아가냐 같아요.\n\n${detail.first}, ${detail.third} 둘 중 하나만 애매해도 손이 안 가요.\n\n${question}`
    ];

  const miniStoryTemplates = banmal
    ? [
      `방 치우려고 일어남.\n${itemLabel} 둘 자리 찾음.\n다시 의욕 사라짐.\n\n그래서 요즘은 ${detail.first}부터 봄. ${question}`,
      `처음엔 정리될 줄 알았음.\n근데 ${detail.second} 애매하니까 더 어지러워짐.\n\n${detail.third}까지 맞아야 오래 가더라. ${question}`
    ]
    : [
      `방 치우려고 일어났어요.\n${itemLabel} 둘 자리 찾다가 다시 의욕이 사라지더라고요.\n\n그래서 요즘은 ${detail.first}부터 봐요. ${question}`,
      `처음엔 정리될 줄 알았어요.\n근데 ${detail.second} 애매하니까 더 어지러워지더라고요.\n\n${detail.third}까지 맞아야 오래 가요. ${question}`
    ];

  const povSceneTemplates = banmal
    ? [
      `POV: ${itemLabel} 하나만 사면 정리 끝날 줄 알았는데\n${detail.first}에서 바로 막힘.\n\n${question}`,
      `내 상태: ${detail.second} 안 맞으면 일단 바닥에 둠.\n그리고 그게 일주일 감.\n\n${question}`
    ]
    : [
      `POV: ${itemLabel} 하나만 사면 정리 끝날 줄 알았는데\n${detail.first}에서 바로 막혀요.\n\n${question}`,
      `제 상태: ${detail.second} 안 맞으면 일단 바닥에 둬요.\n그리고 그게 일주일 가더라고요.\n\n${question}`
    ];

  const mythRealityTemplates = banmal
    ? [
      `생각: ${itemLabel} 사면 바로 깔끔해짐\n현실: ${detail.first}부터 안 맞으면 더 쌓임\n\n${question}`,
      `상상: 예쁜 거 하나 두면 정리 끝\n현실: ${detail.second} 애매하면 손 안 감\n\n${question}`
    ]
    : [
      `생각: ${itemLabel} 사면 바로 깔끔해짐\n현실: ${detail.first}부터 안 맞으면 더 쌓이더라고요.\n\n${question}`,
      `상상: 예쁜 거 하나 두면 정리 끝\n현실: ${detail.second} 애매하면 손이 안 가요.\n\n${question}`
    ];

  const rankedListTemplates = banmal
    ? [
      `${itemLabel} 볼 때 내 우선순위\n1순위 ${detail.first}\n2순위 ${detail.second}\n3순위 ${detail.third}\n\n예쁜 건 그 다음임. ${question}`,
      `${itemTopic} 먼저 보는 순서가 바뀌니까 덜 후회함.\n1. ${detail.first}\n2. ${detail.third}\n\n${detail.second}까지 맞으면 꽤 오래 가더라.`
    ]
    : [
      `${itemLabel} 볼 때 제 우선순위\n1순위 ${detail.first}\n2순위 ${detail.second}\n3순위 ${detail.third}\n\n예쁜 건 그 다음이에요. ${question}`,
      `${itemTopic} 먼저 보는 순서가 바뀌니까 덜 후회하더라고요.\n1. ${detail.first}\n2. ${detail.third}\n\n${detail.second}까지 맞으면 꽤 오래 가요.`
    ];

  const imaginaryReplyTemplates = banmal
    ? [
      `댓글에서 ${itemLabel} 뭐부터 보냐고 물어보면 난 ${detail.first}부터 봄.\n\n${detail.second} 안 맞으면 결국 안 쓰게 되더라. ${question}`,
      `누가 ${itemLabel} 아무거나 사도 되냐고 하면 일단 말림.\n${detail.first}, ${detail.third} 이거 안 맞으면 첫 주부터 거슬림.\n\n${question}`
    ]
    : [
      `댓글에서 ${itemLabel} 뭐부터 보냐고 물어보면 저는 ${detail.first}부터 봐요.\n\n${detail.second} 안 맞으면 결국 안 쓰게 되더라고요. ${question}`,
      `누가 ${itemLabel} 아무거나 사도 되냐고 하면 일단 말릴 것 같아요.\n${detail.first}, ${detail.third} 이거 안 맞으면 첫 주부터 거슬려요.\n\n${question}`
    ];

  const templatesByStyle = {
    numbered: numberedTemplates,
    prose: proseTemplates,
    comparison: comparisonTemplates,
    experience_question: experienceQuestionTemplates,
    hot_take: hotTakeTemplates,
    share: shareTemplates,
    wrong_purchase: wrongPurchaseTemplates,
    lazy_tip: lazyTipTemplates,
    mini_story: miniStoryTemplates,
    pov_scene: povSceneTemplates,
    myth_reality: mythRealityTemplates,
    ranked_list: rankedListTemplates,
    imaginary_reply: imaginaryReplyTemplates
  };
  const templates = templatesByStyle[formatStyle] || proseTemplates;
  return templates[variantIndex(seed, templates.length)];
}

export function buildChoiceTensionFallback(topic = {}, account = {}, products = [], options = {}) {
  return buildHumanStyleFallback(topic, account, products, options);
}
