const KST_OFFSET_MINUTES = 9 * 60;

const seasonalTerms = {
  winter: ['겨울', '겨울철', '한파', '혹한', '추운 겨울', '방한', '패딩', '장갑', '목도리', '핫팩', '보온', '전기장판', '온열'],
  spring: ['봄', '봄철', '환절기', '가정의 달', '나들이', '외출', '정리', '선물', '생활 루틴'],
  summer: ['여름', '여름철', '폭염', '장마', '냉감', '선풍기', '제습', '물놀이'],
  autumn: ['가을', '가을철', '추석', '환절기', '가을맞이']
};

const sensitiveTerms = [
  '다이어트',
  '체중감량',
  '살빼',
  '살 빼',
  '가르시니아',
  '보조제',
  '건강기능식품',
  '영양제',
  '의약품',
  '다이어트 약',
  '치료',
  '예방',
  '효능',
  '효과 보장',
  '체중감량 보장'
];

const hardClaimTerms = ['100%', '무조건', '완벽', '보장', '치료', '예방'];

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
}

function includesAny(text, terms) {
  return terms.filter((term) => text.includes(term));
}

export function getContentContext(date = new Date()) {
  const kst = getKstDate(date);
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const currentDateKST = `${kst.getUTCFullYear()}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if ([12, 1, 2].includes(month)) {
    return { currentDateKST, month, seasonKST: 'winter', nearTermContext: '겨울 생활, 연말연시, 보온/실내 관리' };
  }
  if ([3, 4, 5].includes(month)) {
    return { currentDateKST, month, seasonKST: 'spring', nearTermContext: '봄/초여름, 가정의 달, 외출, 정리, 선물, 생활 루틴' };
  }
  if ([6, 7, 8].includes(month)) {
    return { currentDateKST, month, seasonKST: 'summer', nearTermContext: '여름, 장마, 냉방, 제습, 외출/휴가 준비' };
  }
  return { currentDateKST, month, seasonKST: 'autumn', nearTermContext: '가을, 환절기, 추석, 정리/선물 준비' };
}

export function getContentGuardrailContext(date = new Date()) {
  const context = getContentContext(date);
  const blockedSeasonTerms = context.seasonKST === 'winter'
    ? [...seasonalTerms.summer]
    : [...seasonalTerms.winter];
  return {
    ...context,
    allowedThemes: context.nearTermContext,
    blockedSeasonTerms,
    blockedSensitiveTerms: sensitiveTerms,
    blockedClaimTerms: hardClaimTerms,
    rules: [
      'Stay within the account content scope.',
      'Use the current Korean season/date context.',
      'Do not mention off-season themes.',
      'Do not generate diet, supplement, medicine, or guaranteed-effect content.'
    ]
  };
}

export function validateGeneratedContent(text, account = null, options = {}) {
  const value = String(text || '');
  const reasons = [];
  const context = getContentGuardrailContext(options.date);

  const seasonalHits = includesAny(value, context.blockedSeasonTerms);
  if (seasonalHits.length) reasons.push(`계절 부정합: ${[...new Set(seasonalHits)].join(', ')}`);

  const sensitiveHits = includesAny(value, sensitiveTerms);
  if (sensitiveHits.length) reasons.push(`민감/위험 카테고리: ${[...new Set(sensitiveHits)].join(', ')}`);

  const claimHits = includesAny(value, hardClaimTerms);
  if (claimHits.length) reasons.push(`금지 표현: ${[...new Set(claimHits)].join(', ')}`);

  const accountForbidden = [
    ...(Array.isArray(account?.forbidden_topics) ? account.forbidden_topics : []),
    ...(Array.isArray(account?.forbidden_words) ? account.forbidden_words : [])
  ].filter(Boolean);
  const accountHits = includesAny(value, accountForbidden);
  if (accountHits.length) reasons.push(`계정 금지어: ${[...new Set(accountHits)].join(', ')}`);

  return { allowed: reasons.length === 0, reasons, context };
}

export function validateTopicCandidate(topic, account) {
  return validateGeneratedContent([
    topic?.title,
    topic?.angle,
    topic?.reason,
    topic?.targetUser,
    ...(topic?.searchKeywords || [])
  ].filter(Boolean).join(' '), account);
}

export function validateProductCandidate(product, account) {
  return validateGeneratedContent([
    product?.product_name,
    product?.category_name,
    product?.keyword
  ].filter(Boolean).join(' '), account);
}

export function validatePostCandidate(postBody, account, topic = null) {
  return validateGeneratedContent([
    topic?.title,
    topic?.angle,
    postBody
  ].filter(Boolean).join(' '), account);
}
