import { sanitizeContentTitle } from './contentText.js';

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

export function scorePostEngagement(body = '', { products = [] } = {}) {
  const text = String(body || '').trim();
  const first = firstSentenceOf(text);
  const productNames = products.map((product) => String(product.product_name || product.name || '').trim()).filter(Boolean);
  const productMentions = productNames.reduce((sum, name) => sum + (name && text.includes(name) ? 1 : 0), 0);
  const questionCount = countMatches(text, /[?？]/g);
  const checks = {
    hook: /(불편|막상|은근|갈리|후회|실수|어렵|귀찮|헷갈|고민|다들|써본|써보신|어느 쪽|vs|VS)/.test(first),
    choiceTension: /( vs |VS|아니면|쪽|갈리|취향|습관|공간|예산|빈도|기준|먼저|차이|보이는|숨기는|실용성|사용감)/.test(text),
    easyQuestion: /[?？]|여러분|다들|써본|써보신|어때|뭐가|어느 쪽|고르|추천|쪽이에요/.test(text),
    concreteSituation: /(자취|집|방|주방|욕실|수납|정리|청소|빨래|차량|사무실|아이|반려|원룸|좁은|꺼내|접이|보관|설치)/.test(text),
    lowAdTone: !/(구매|최저가|특가|할인|링크|가격|꼭 필요한|필수템|강추|대박|완벽|무조건)/.test(text),
    productNatural: productMentions <= 1 && !/(상품|제품).{0,8}(추천|구매)/.test(text),
    concise: text.length >= 35 && text.length <= 230,
    safe: !/(한심|극혐|노답|틀딱|맘충|남혐|여혐|거지|무식|병신|정치|남자들은|여자들은|요즘 애들|아줌마|아재|지역|진보|보수)/.test(text)
  };
  const rubric = {
    hookScore: checks.hook ? 18 : (first.length >= 12 ? 8 : 2),
    commentEaseScore: checks.easyQuestion ? (questionCount <= 1 ? 20 : 16) : 4,
    choiceTensionScore: checks.choiceTension ? 18 : 4,
    specificityScore: checks.concreteSituation ? 16 : 5,
    adTonePenalty: checks.lowAdTone ? 0 : -18,
    productFitScore: checks.productNatural ? 12 : -12,
    safetyPenalty: checks.safe ? 0 : -70,
    readabilityScore: checks.concise ? 10 : 2
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
  if (!checks.safe) reasons.push('안전성 위험');

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
    + rubric.adTonePenalty
    + rubric.safetyPenalty;

  return {
    engagementScore: clampScore(rawScore),
    engagementPattern: pattern,
    selectionReasons: unique(reasons),
    rubric,
    checks,
    firstSentence: first
  };
}

export function buildChoiceTensionFallback(topic = {}, account = {}) {
  const title = sanitizeContentTitle(topic.title || account.content_scope || '생활용품 고르는 기준', account);
  const angle = String(topic.angle || '사용 기준').trim();
  return `${title} 고를 때 처음엔 다 비슷해 보이는데, 막상 쓰면 ${angle}에서 차이가 나요.\n\n자주 쓰는 사람은 관리 쉬운 쪽을 보고, 가끔 쓰는 사람은 보관이 편한 쪽을 더 보더라고요.\n\n여러분은 이런 거 고를 때 관리 쉬운 쪽이에요, 보관 편한 쪽이에요?`;
}
