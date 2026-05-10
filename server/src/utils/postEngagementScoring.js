import { inspectGeneratedPostText, sanitizeContentTitle } from './contentText.js';

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

export function scorePostSimilarity(body = '', others = []) {
  const words = contentWords(body);
  const maxSimilarity = others.reduce((max, other) => Math.max(max, jaccard(words, contentWords(other))), 0);
  const duplicateRisk = maxSimilarity >= 0.58;
  return {
    maxSimilarity,
    duplicateRisk,
    penalty: duplicateRisk ? Math.round((maxSimilarity - 0.5) * 120) : 0
  };
}

function variantIndex(seed = '', count = 1) {
  const text = String(seed || '');
  let hash = 0;
  for (const char of text) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
  return count ? hash % count : 0;
}

function topicParticle(label = '') {
  const last = String(label || '').trim().charCodeAt(String(label || '').trim().length - 1);
  if (last < 0xac00 || last > 0xd7a3) return '은';
  return ((last - 0xac00) % 28) ? '은' : '는';
}

function compactDetails(details = []) {
  const [first = '', second = '', third = ''] = details;
  return { first, second, third };
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

const AWKWARD_PHRASE_PATTERN = /흐름이에요|흐름이야|생활\s*속에서|고려해야|도움이\s*됩니다|중요합니다/;

export function detectPostFormatStyle(body = '') {
  const text = String(body || '');
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

  if (recentNumbered >= 3) return ['prose', 'comparison', 'experience_question'][variantIndex(effectiveSeed, 3)];
  if (recentNonNumbered >= 3 && ratio >= 0.25) return 'numbered';

  const bucket = variantIndex(effectiveSeed, 100);
  if (bucket < Math.round(ratio * 100)) return 'numbered';
  return ['prose', 'comparison', 'experience_question'][variantIndex(`${effectiveSeed} prose`, 3)];
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

  if (/선물|기념일|답례|축하|이벤트|감성/.test(mainContext)) return 'gift';
  if (/주방|조리|식기|싱크|조리대|설거지|수세미|냄비|프라이팬|컵|수저/.test(mainContext)) return 'kitchen';
  if (/청소|먼지|청소포|돌돌이|욕실\s*물기|물걸레|닦/.test(mainContext)) return 'cleaning';
  if (/육아|아이(?!템)|아기|기저귀|물티슈|장난감|유모차/.test(mainContext)) return 'childcare';
  if (/욕실|화장실|샤워|물기/.test(mainContext)) return 'bathroom';
  if (/음식|푸드|먹|간식|냉장|식품/.test(mainContext)) return 'food';
  if (/자취|원룸|집기/.test(mainContext)) return 'self_living';

  if (/선물|기념일|답례|축하|이벤트|감성/.test(scopeContext)) return 'gift';
  if (/주방|조리|식기/.test(scopeContext) && !/육아|아이(?!템)|아기/.test(fullContext)) return 'kitchen';
  if (/청소/.test(scopeContext)) return 'cleaning';
  if (/육아|아이(?!템)|아기/.test(scopeContext)) return 'childcare';
  if (/욕실|화장실|샤워/.test(scopeContext)) return 'bathroom';
  if (/음식|푸드|먹|간식/.test(scopeContext)) return 'food';
  if (/자취|원룸|집기|살림|생활/.test(scopeContext)) return 'self_living';
  return 'general';
}

function pickLivingDetails(topic = {}, account = {}, products = []) {
  const domain = classifyDetailDomain(topic, account, products);
  if (domain === 'childcare') {
    return ['아이 손이 닿는 낮은 자리인지', '기저귀나 물티슈를 바로 집을 수 있는지', '장난감 치울 때 통째로 옮기기 쉬운지'];
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
    return ['꺼내 먹기 쉬운지', '냉장고 자리를 많이 차지하지 않는지', '남았을 때 보관이 편한지'];
  }
  if (domain === 'self_living') {
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
  if (/선물|기념일|감성|이벤트/.test(primaryContext)) return '선물';
  if (/음식|푸드|먹/.test(primaryContext)) return '먹거리';
  if (/육아|아이(?!템)|아기/.test(primaryContext)) return '육아용품';
  const context = normalizeText(`${productContext} ${scopeContext} ${topicContext}`);
  if (/음식|푸드|먹/.test(context)) return '먹거리';
  if (/육아|아이(?!템)|아기/.test(context)) return '육아용품';
  if (/선물|기념일|감성|이벤트/.test(context)) return '선물';
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
  const microDetailMatches = countMatches(text, /(설거지|빨래|현관|욕실|샤워|조리대|침대\s*옆|바닥|물기|멀티탭|분리수거|쓰레기|수건|젖은|바구니|문\s*앞|싱크대|냉장고|신발장|서랍|행거|컵|수저|수세미|청소포|돌돌이|충전기|열쇠|우산|아이|아기|기저귀|물티슈|장난감|유모차|낮은\s*자리|받는\s*사람|포장|취향)/g);
  const sensoryDetailMatches = countMatches(text, /(손이\s*(덜|잘|자주)|바로\s*(집|꺼내|닿|두)|한\s*번\s*덜|덜\s*어지|덜\s*젖|물\s*빠|먼지|냄새|미끄|좁아|쌓이|굴러다니|말릴)/g);
  const shallowChecklist = /(자주\s*쓰는지|보관이\s*쉬운지|관리(가|는)?\s*부담\s*없|실용성|사용감|가격을\s*보세요|관리하기\s*쉬운지)/.test(text)
    && microDetailMatches < 2;
  const repetitiveFallback = /많이\s*사는\s*것보다\s*["“]?어디에\s*둘지["”]?부터|막상\s*살아보면\s*큰\s*기능보다|꺼내고\s*다시\s*두는\s*순간/.test(text);
  const awkwardPhrase = AWKWARD_PHRASE_PATTERN.test(text);
  const categoryMismatch = detectCategoryMismatch(text);
  const abstractSetup = /생활\s*속에서|고려해야|중요한\s*게\s*사실|정말\s*중요/.test(first) || awkwardPhrase;
  const checks = {
    hook: /(불편|막상|은근|갈리|후회|실수|어렵|귀찮|헷갈|고민|다들|써본|써보신|어느 쪽|vs|VS)/.test(first),
    choiceTension: /( vs |VS|아니면|쪽|갈리|취향|습관|공간|예산|빈도|기준|먼저|차이|보이는|숨기는|실용성|사용감)/.test(text),
    easyQuestion: /[?？]|여러분|다들|써본|써보신|어때|뭐가|어느 쪽|고르|추천|쪽이에요/.test(text),
    concreteSituation: /(자취|집|방|주방|욕실|수납|정리|청소|빨래|차량|사무실|아이|반려|원룸|좁은|꺼내|접이|보관|설치)/.test(text),
    lowAdTone: !/(구매|최저가|특가|할인|링크|가격|꼭 필요한|필수템|강추|대박|완벽|무조건)/.test(text),
    productNatural: productMentions <= 1 && !/(상품|제품).{0,8}(추천|구매)/.test(text),
    concise: text.length >= 35 && text.length <= 230,
    safe: !/(한심|극혐|노답|틀딱|맘충|남혐|여혐|무식|병신|정치|남자들은|여자들은|요즘 애들|아줌마|아재|지역|진보|보수|(^|[\s.,!?])거지(?=$|[\s.,!?]))/.test(text),
    genericTemplate: inspection.genericTemplate,
    aiLikeTone: inspection.aiLikeTone,
    repetitiveFallback,
    abstractSetup,
    awkwardPhrase,
    categoryMismatch,
    accountTokenLeak: inspection.accountTokenLeak,
    livedInStructure: (paragraphCount >= 3 || lineCount >= 3 || numberedCriteriaCount >= 2)
      && /(처음엔|막상|살아보면|매일|자주|손\s*가|먼저|저라면)/.test(text),
    concreteCriteria: numberedCriteriaCount >= 2 || /(둘 곳|모아둘 곳|말릴 곳|닦이는 곳|꺼내기|보관|물기|설거지|빨래|바닥|조리대|싱크대|청소포|먼지|현관|욕실|낮은\s*자리|기저귀|물티슈|장난감|유모차|받는\s*사람|포장|취향)/.test(text),
    microDetail: microDetailMatches >= 2 || (microDetailMatches >= 1 && sensoryDetailMatches >= 1),
    saveWorthiness: /(저라면|먼저|덜\s*후회|사기\s*전|시작할\s*때|처음\s*자취|체크|기준|자리부터|맞춰두|나중에|한\s*번\s*덜)/.test(text)
      && (microDetailMatches >= 1 || numberedCriteriaCount >= 2),
    humanWarmth: /(저라면|저는|나는|같아요|같아|더라고요|더라|되더라고요|덜\s*후회|살아보면|처음엔|막상|은근)/.test(text)
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
    livedInStructureScore: checks.livedInStructure ? 14 : -10,
    concreteCriteriaScore: checks.concreteCriteria ? 12 : -8,
    usefulSpecificityScore: checks.microDetail ? 18 : -12,
    saveWorthinessScore: checks.saveWorthiness ? 14 : -8,
    humanWarmthScore: checks.humanWarmth ? 8 : -4,
    shallowChecklistPenalty: checks.shallowChecklist ? -28 : 0,
    templatePenalty: checks.genericTemplate ? -35 : 0,
    repetitiveFallbackPenalty: checks.repetitiveFallback ? -24 : 0,
    abstractSetupPenalty: checks.abstractSetup ? -16 : 0,
    awkwardPhrasePenalty: checks.awkwardPhrase ? -28 : 0,
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
  else reasons.push('생활 장면 부족');
  if (checks.concreteCriteria) reasons.push('구체 기준 포함');
  else reasons.push('구체 기준 부족');
  if (checks.microDetail) reasons.push('생활 디테일 포함');
  else reasons.push('생활 디테일 부족');
  if (checks.saveWorthiness) reasons.push('저장 가치 있음');
  else reasons.push('저장 가치 부족');
  if (checks.humanWarmth) reasons.push('자연스러운 사람 말투');
  if (checks.shallowChecklist) reasons.push('얕은 체크리스트 감점');
  if (!checks.safe) reasons.push('안전성 위험');
  if (checks.genericTemplate) reasons.push('템플릿 문장 감점');
  if (checks.repetitiveFallback) reasons.push('반복 fallback 골격 감점');
  if (checks.abstractSetup) reasons.push('추상적 첫 문장 감점');
  if (checks.awkwardPhrase) reasons.push('어색한 금지 표현 감점');
  if (checks.categoryMismatch) reasons.push('카테고리 생활 디테일 불일치 감점');
  if (checks.aiLikeTone) reasons.push('AI 문체 감점');
  if (checks.accountTokenLeak) reasons.push('계정 아이디 노출 감점');

  let pattern = 'empathy_prompt';
  if (checks.choiceTension) pattern = 'choice_tension';
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
    + rubric.shallowChecklistPenalty
    + rubric.adTonePenalty
    + rubric.safetyPenalty
    + rubric.templatePenalty
    + rubric.repetitiveFallbackPenalty
    + rubric.abstractSetupPenalty
    + rubric.awkwardPhrasePenalty
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
  const formatStyle = options.formatStyle || resolveFallbackFormatStyle(topic, account, {
    recentBodies: options.recentBodies || [],
    seed
  });
  const question = banmal
    ? [
      isSelfLiving ? '처음 자취할 때 “이건 빨리 사길 잘했다” 싶은 거 뭐였어?' : `${itemLabel} 고를 때 제일 먼저 보는 기준 뭐야?`,
      `너라면 ${itemLabel} 고를 때 제일 먼저 놓는 자리부터 봐, 쓰는 순간부터 봐?`,
      isSelfLiving ? '처음 자취할 때 사고 나서 제일 먼저 불편했던 포인트 뭐였어?' : `${itemLabel} 사고 나서 제일 먼저 불편했던 포인트 뭐였어?`
    ][variantIndex(seed, 3)]
    : [
      isSelfLiving ? '처음 자취할 때 “이건 빨리 사길 잘했다” 싶은 집기, 여러분은 뭐였어요?' : `${itemLabel} 고를 때 제일 먼저 맞춰두길 잘했다 싶은 기준, 여러분은 뭐였어요?`,
      `여러분은 ${itemLabel} 고를 때 제일 먼저 놓는 자리부터 보세요, 쓰는 순간부터 보세요?`,
      isSelfLiving ? '처음 자취할 때 사고 나서 제일 먼저 불편했던 포인트, 여러분은 뭐였어요?' : `${itemLabel} 사고 나서 제일 먼저 불편했던 포인트, 여러분은 뭐였어요?`
    ][variantIndex(seed, 3)];

  const numberedTemplates = banmal
    ? [
      `${itemLabel}은 사기 전에 어디에 둘지 먼저 떠올리면 은근 덜 후회돼.\n\n나는\n1. ${detail.first}\n2. ${detail.second}\n3. ${detail.third}\n이렇게 봐.\n\n매일 쓰는 건 예쁜 모양보다 손이 덜 가는 자리가 더 오래 가더라.\n\n${question}`,
      `${itemTopic} 막상 써보면 첫인상보다 다시 두기 편한지가 더 빨리 티 나.\n\n나라면\n1. ${detail.first}\n2. ${detail.second}\n부터 먼저 보고, ${detail.third}까지 맞으면 오래 쓸 것 같아.\n\n${question}`
    ]
    : [
      `${itemLabel}은 사기 전에 어디에 둘지 먼저 떠올리면 은근 덜 후회되더라고요.\n\n저라면\n1. ${detail.first}\n2. ${detail.second}\n3. ${detail.third}\n이렇게 봐요.\n\n매일 쓰는 건 예쁜 모양보다 손이 덜 가는 자리가 더 오래 가요.\n\n${question}`,
      `${itemTopic} 막상 써보면 첫인상보다 다시 두기 편한지가 더 빨리 티 나더라고요.\n\n저라면\n1. ${detail.first}\n2. ${detail.second}\n부터 먼저 보고, ${detail.third}까지 맞으면 오래 쓸 것 같아요.\n\n${question}`
    ];

  const proseTemplates = banmal
    ? [
      `${itemLabel}은 예쁜 쪽보다 매일 쓰는 순간이 더 빨리 티 나더라.\n\n나는 ${detail.first}가 애매하면 손이 잘 안 가고, ${detail.second}가 안 맞으면 결국 밖에 쌓이더라고. 그래서 처음엔 ${detail.third}까지 같이 봐.\n\n${question}`,
      `${itemTopic} 막상 써보면 쓰고 난 다음 자리가 더 중요하더라.\n\n${detail.first}가 애매하면 한 번 더 미루게 되고, ${detail.second}가 맞으면 다시 두는 게 훨씬 편해져.\n\n${question}`
    ]
    : [
      `${itemLabel}은 예쁜 쪽보다 매일 쓰는 순간이 더 빨리 티 나더라고요.\n\n저는 ${detail.first}가 애매하면 손이 잘 안 가고, ${detail.second}가 안 맞으면 결국 밖에 쌓이더라고요. 그래서 처음엔 ${detail.third}까지 같이 봐요.\n\n${question}`,
      `${itemTopic} 막상 써보면 쓰고 난 다음 자리가 더 중요하더라고요.\n\n${detail.first}가 애매하면 한 번 더 미루게 되고, ${detail.second}가 맞으면 다시 두기가 훨씬 편해져요.\n\n${question}`
    ];

  const comparisonTemplates = banmal
    ? [
      `${itemLabel} 고를 때 나는 보이는 깔끔함이랑 꺼내기 편한 쪽이 은근 갈리더라.\n\n${detail.first}가 맞으면 자주 쓰기 좋고, ${detail.second}가 맞으면 치울 때 덜 귀찮아.\n\n나라면 먼저 다시 두기 편한 쪽부터 볼 것 같아. 둘 중 하나만 고르라면 너는 뭐부터 봐?`,
      `${itemTopic} 오래 쓰는 기준은 기능보다 자리에서 갈리는 것 같아.\n\n${detail.first}를 먼저 볼지, ${detail.third}를 먼저 볼지에 따라 만족감이 꽤 달라져.\n\n나는 나중에 한 번 덜 귀찮은 쪽부터 봐. ${question}`
    ]
    : [
      `${itemLabel} 고를 때 저는 보이는 깔끔함이랑 꺼내기 편한 쪽이 은근 갈리더라고요.\n\n${detail.first}가 맞으면 자주 쓰기 좋고, ${detail.second}가 맞으면 치울 때 덜 귀찮아요.\n\n저라면 먼저 다시 두기 편한 쪽부터 볼 것 같아요. 둘 중 하나만 고르라면 여러분은 뭐부터 보세요?`,
      `${itemTopic} 오래 쓰는 기준은 기능보다 자리에서 갈리더라고요.\n\n${detail.first}를 먼저 볼지, ${detail.third}를 먼저 볼지에 따라 만족감이 꽤 달라져요.\n\n저는 나중에 한 번 덜 귀찮은 쪽부터 봐요. ${question}`
    ];

  const experienceQuestionTemplates = banmal
    ? [
      `${itemLabel} 사고 나서 제일 아쉬운 건 보통 성능보다 놓는 자리더라.\n\n나는 ${detail.first}랑 ${detail.second}가 맞으면 오래 쓰고, ${detail.third}가 애매하면 금방 손이 안 가.\n\n${question}`,
      `${itemTopic} 처음엔 기능을 먼저 보게 되는데, 막상 매일 쓰면 자리가 먼저 보이더라.\n\n${detail.first}가 맞는지, ${detail.second}가 편한지부터 보면 나중에 한 번 덜 귀찮아.\n\n${question}`
    ]
    : [
      `${itemLabel} 사고 나서 제일 아쉬운 건 보통 성능보다 놓는 자리더라고요.\n\n저는 ${detail.first}랑 ${detail.second}가 맞으면 오래 쓰고, ${detail.third}가 애매하면 금방 손이 안 가요.\n\n${question}`,
      `${itemTopic} 처음엔 기능을 먼저 보게 되는데, 막상 매일 쓰면 자리가 먼저 보이더라고요.\n\n${detail.first}가 맞는지, ${detail.second}가 편한지부터 보면 나중에 한 번 덜 귀찮아요.\n\n${question}`
    ];

  const templatesByStyle = {
    numbered: numberedTemplates,
    prose: proseTemplates,
    comparison: comparisonTemplates,
    experience_question: experienceQuestionTemplates
  };
  const templates = templatesByStyle[formatStyle] || proseTemplates;
  return templates[variantIndex(seed, templates.length)];
}

export function buildChoiceTensionFallback(topic = {}, account = {}, products = [], options = {}) {
  return buildHumanStyleFallback(topic, account, products, options);
}
