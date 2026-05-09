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

function pickLivingDetails(topic = {}, account = {}) {
  const context = `${topic.title || ''} ${topic.angle || ''} ${account.content_scope || ''} ${account.target_audience || ''}`;
  if (/자취|원룸|집기|살림|생활/.test(context)) {
    return ['설거지 끝나고 바로 내려둘 자리', '빨래 돌리기 전 잠깐 모아둘 바구니 자리', '현관에서 나갈 때 바로 집는 물건 자리'];
  }
  if (/주방|조리|식기|수납/.test(context)) {
    return ['조리대 위에 올려도 손이 안 좁아지는지', '설거지 후 물 빠질 곳이 있는지', '자주 꺼내는 것만 앞줄에 둘 수 있는지'];
  }
  if (/욕실|화장실|샤워|물기/.test(context)) {
    return ['샤워 후 물기 닿아도 괜찮은지', '젖은 물건을 잠깐 걸 곳이 있는지', '청소할 때 한 번에 치울 수 있는지'];
  }
  if (/청소|정리|보관/.test(context)) {
    return ['청소 시작할 때 바로 꺼낼 수 있는지', '다시 넣을 때 손이 한 번 덜 가는지', '눈에 보여도 덜 어지러워 보이는지'];
  }
  return ['자주 쓰는 순간에 바로 닿는지', '둘 자리가 애매하게 남지 않는지', '관리할 때 손이 한 번 덜 가는지'];
}

function inferItemLabel(topic = {}, account = {}) {
  const text = normalizeText(sanitizeContentTitle(topic.title || account.content_scope || '생활용품', account));
  if (/집기/.test(text)) return '집기';
  if (/수납/.test(text)) return '수납용품';
  if (/주방/.test(text)) return '주방용품';
  if (/욕실/.test(text)) return '욕실용품';
  if (/청소/.test(text)) return '청소용품';
  return text.replace(/[?？!！.,]/g, '').slice(0, 18) || '생활용품';
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
  const microDetailMatches = countMatches(text, /(설거지|빨래|현관|욕실|샤워|조리대|침대\s*옆|바닥|물기|멀티탭|분리수거|쓰레기|수건|젖은|바구니|문\s*앞|싱크대|냉장고|신발장|서랍|행거|컵|수저|수세미|청소포|돌돌이|충전기|열쇠|우산)/g);
  const sensoryDetailMatches = countMatches(text, /(손이\s*(덜|잘|자주)|바로\s*(집|꺼내|닿|두)|한\s*번\s*덜|덜\s*어지|덜\s*젖|물\s*빠|먼지|냄새|미끄|좁아|쌓이|굴러다니|말릴)/g);
  const shallowChecklist = /(자주\s*쓰는지|보관이\s*쉬운지|관리(가|는)?\s*부담\s*없|실용성|사용감|가격을\s*보세요|관리하기\s*쉬운지)/.test(text)
    && microDetailMatches < 2;
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
    accountTokenLeak: inspection.accountTokenLeak,
    livedInStructure: (paragraphCount >= 3 || numberedCriteriaCount >= 2)
      && /(처음엔|막상|살아보면|매일|자주|손\s*가|먼저|저라면)/.test(text),
    concreteCriteria: numberedCriteriaCount >= 2 || /(둘 곳|모아둘 곳|말릴 곳|닦이는 곳|꺼내기|보관|물기|설거지|빨래|바닥|조리대|현관|욕실)/.test(text),
    microDetail: microDetailMatches >= 2 || (microDetailMatches >= 1 && sensoryDetailMatches >= 1),
    saveWorthiness: /(저라면|먼저|덜\s*후회|사기\s*전|시작할\s*때|처음\s*자취|체크|기준|자리부터|맞춰두|나중에|한\s*번\s*덜)/.test(text)
      && (microDetailMatches >= 1 || numberedCriteriaCount >= 2),
    humanWarmth: /(저라면|같아요|더라고요|되더라고요|덜\s*후회|살아보면|처음엔|막상|은근)/.test(text)
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
    + rubric.aiTonePenalty
    + rubric.accountTokenPenalty;

  return {
    engagementScore: clampScore(rawScore),
    engagementPattern: pattern,
    selectionReasons: unique(reasons),
    rubric,
    checks,
    firstSentence: first
  };
}

export function buildHumanStyleFallback(topic = {}, account = {}) {
  const title = sanitizeContentTitle(topic.title || account.content_scope || '생활용품 고르는 기준', account);
  const itemLabel = inferItemLabel(topic, account);
  const details = pickLivingDetails(topic, account);
  const question = /자취|원룸/.test(`${topic.title || ''} ${account.content_scope || ''} ${account.target_audience || ''}`)
    ? '처음 자취할 때 “이건 빨리 사길 잘했다” 싶은 집기, 여러분은 뭐였어요?'
    : `${itemLabel} 고를 때 제일 먼저 맞춰두길 잘했다 싶은 기준, 여러분은 뭐였어요?`;

  return `${title}, 많이 사는 것보다 “어디에 둘지”부터 정하면 덜 후회하더라고요.\n\n처음엔 큰 것부터 눈에 들어오는데, 막상 살아보면 매일 손 가는 작은 자리가 더 먼저 티 나요.\n\n저라면 큰 가구보다\n1. ${details[0]}\n2. ${details[1]}\n3. ${details[2]}\n이 세 자리부터 맞출 것 같아요.\n\n${question}`;
}

export function buildChoiceTensionFallback(topic = {}, account = {}) {
  return buildHumanStyleFallback(topic, account);
}
