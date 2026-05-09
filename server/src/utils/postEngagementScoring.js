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
    return ['설거지 후 바로 둘 곳', '빨래 잠깐 모아둘 곳', '바닥 물기 덜 밟는 곳'];
  }
  if (/주방|조리|식기|수납/.test(context)) {
    return ['조리대 위에 바로 둘 곳', '설거지 후 말릴 곳', '자주 꺼내는 것만 모아둘 곳'];
  }
  if (/욕실|화장실|샤워|물기/.test(context)) {
    return ['물기 바로 닦이는 곳', '젖은 물건 잠깐 둘 곳', '청소할 때 걸리적거리지 않는 곳'];
  }
  if (/청소|정리|보관/.test(context)) {
    return ['꺼내기 쉬운 자리', '다시 넣기 쉬운 구조', '눈에 덜 어지러운 보관 방식'];
  }
  return ['자주 쓰는 상황에 맞는지', '둘 자리가 애매하지 않은지', '관리할 때 손이 덜 가는지'];
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
    concreteCriteria: numberedCriteriaCount >= 2 || /(둘 곳|모아둘 곳|말릴 곳|닦이는 곳|꺼내기|보관|물기|설거지|빨래|바닥|조리대)/.test(text)
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
    ? '자취 시작할 때 제일 먼저 사길 잘했다 싶은 집기, 여러분은 뭐였어요?'
    : `${itemLabel} 고를 때 제일 먼저 맞춰두길 잘했다 싶은 기준, 여러분은 뭐였어요?`;

  return `${title}에서 제일 애매한 게 “작은데 자주 쓰는 것”이더라고요.\n\n처음엔 눈에 크게 보이는 것부터 사게 되는데, 막상 살아보면 매일 손 가는 자리가 더 체감돼요.\n\n저라면 큰 것보다\n1. ${details[0]}\n2. ${details[1]}\n3. ${details[2]}\n이 세 군데부터 먼저 맞출 것 같아요.\n\n${question}`;
}

export function buildChoiceTensionFallback(topic = {}, account = {}) {
  return buildHumanStyleFallback(topic, account);
}
