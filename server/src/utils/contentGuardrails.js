const KST_OFFSET_MINUTES = 9 * 60;

const seasonalTerms = {
  winter: ['겨울', '겨울철', '한파', '혹한', '추운 겨울', '방한', '패딩', '장갑', '목도리', '핫팩', '보온', '전기장판', '온열', '크리스마스', '성탄', '연말'],
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

const domainRules = {
  pet: {
    label: '반려동물/동물',
    accountPattern: /반려|강아지|고양이|펫|동물|집사|댕댕|냥|애견|애묘|반려견|반려묘/i,
    candidatePattern: /반려|강아지|고양이|펫|동물|집사|댕댕|냥|애견|애묘|반려견|반려묘|배변|사료|하네스|목줄|산책|리드줄|펫타월|모래삽/i
  },
  food: {
    label: '일반 음식/먹방',
    accountPattern: /먹방|맛집|음식|요리|레시피|식품|푸드|먹거리|간식|디저트|카페|과자|쿠키|빵/i,
    candidatePattern: /먹방|맛집|음식|요리|레시피|식품|푸드|먹거리|간식|디저트|카페|과자|쿠키|초콜릿|젤리|빵|라면|떡볶이|냉장고/i
  },
  childcare: {
    label: '육아',
    accountPattern: /육아|아이(?!템)|아기|유아|어린이|키즈|자녀|아동|기저귀|물티슈|장난감|유모차/i,
    candidatePattern: /육아|아이(?!템)|아기|유아|어린이|키즈|자녀|아동|기저귀|물티슈|장난감|유모차|빨대컵/i
  },
  kitchen: {
    label: '주방',
    accountPattern: /주방|조리|식기|요리도구|싱크|설거지|수세미|냄비|프라이팬|도마/i,
    candidatePattern: /주방|조리|식기|요리도구|싱크|설거지|수세미|냄비|프라이팬|도마|조리대|양념통/i
  },
  cleaning: {
    label: '청소',
    accountPattern: /청소|먼지|돌돌이|물걸레|청소포|탈취|냄새|욕실\s*물기/i,
    candidatePattern: /청소|먼지|돌돌이|물걸레|청소포|탈취|냄새|욕실\s*물기|브러시/i
  },
  beauty: {
    label: '뷰티',
    accountPattern: /뷰티|화장|스킨|헤어|파우치|고데기|드라이기|립|브러쉬/i,
    candidatePattern: /뷰티|화장|스킨|헤어|파우치|고데기|드라이기|립|브러쉬|화장대/i
  },
  car: {
    label: '차량',
    accountPattern: /차량|자동차|운전|차박|트렁크|콘솔|컵홀더/i,
    candidatePattern: /차량|자동차|운전|차박|트렁크|콘솔|컵홀더|시트/i
  },
  activity: {
    label: '운동/아웃도어',
    accountPattern: /운동|헬스|홈트|러닝|캠핑|등산|요가/i,
    candidatePattern: /운동|헬스|홈트|러닝|캠핑|등산|요가|폼롤러|랜턴|요가매트/i
  },
  self_living: {
    label: '생활/자취',
    accountPattern: /자취|원룸|살림|생활|수납|정리|집기/i,
    candidatePattern: /자취|원룸|살림|생활|수납|정리|집기|현관|빨래|신발장|서랍/i
  }
};

const accountDomainPriority = ['pet', 'childcare', 'food', 'kitchen', 'cleaning', 'beauty', 'car', 'activity', 'self_living'];
const incompatibleDomains = {
  pet: new Set(['food', 'childcare', 'kitchen', 'beauty', 'car']),
  food: new Set(['pet', 'childcare', 'cleaning', 'beauty', 'car']),
  childcare: new Set(['pet', 'food', 'beauty', 'car']),
  kitchen: new Set(['pet', 'childcare', 'beauty', 'car']),
  cleaning: new Set(['pet', 'childcare', 'food', 'beauty', 'car']),
  beauty: new Set(['pet', 'childcare', 'food', 'kitchen', 'cleaning', 'car']),
  car: new Set(['pet', 'childcare', 'food', 'kitchen', 'beauty']),
  activity: new Set(['childcare', 'food', 'kitchen', 'beauty']),
  self_living: new Set()
};
const petAccountHardFoodPattern = /먹방|맛집|레시피|떡볶이|라면|디저트|카페|쿠키|초콜릿|젤리|빵/i;
const petSpecificFoodPattern = /(강아지|고양이|반려|펫|애견|애묘|사료).{0,12}(간식|쿠키|트릿|사료|푸드)|(간식|쿠키|트릿|사료|푸드).{0,12}(강아지|고양이|반려|펫|애견|애묘|사료)/i;

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
}

function includesAny(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function normalizeDomainText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function objectText(source = {}, fields = []) {
  return fields.map((field) => source?.[field]).filter(Boolean).join(' ');
}

function productDomainText(product = {}) {
  return objectText(product, ['product_name', 'name', 'category_name', 'category', 'keyword', 'product_group']);
}

function topicDomainText(topic = {}) {
  return [
    objectText(topic, ['title', 'angle', 'targetUser', 'target_user', 'reason', 'keyword', 'search_keyword']),
    ...(Array.isArray(topic?.searchKeywords) ? topic.searchKeywords : []),
    ...(Array.isArray(topic?.search_keywords) ? topic.search_keywords : [])
  ].filter(Boolean).join(' ');
}

function accountDomainText(account = {}) {
  return objectText(account, [
    'name',
    'account_handle',
    'content_scope',
    'target_audience',
    'description',
    'bio',
    'persona',
    'tone',
    'niche'
  ]);
}

function detectCandidateDomains(text = '') {
  const value = normalizeDomainText(text);
  if (!value) return [];
  return Object.entries(domainRules)
    .filter(([, rule]) => rule.candidatePattern.test(value))
    .map(([domain]) => domain);
}

function domainLabels(domains = []) {
  return domains.map((domain) => domainRules[domain]?.label || domain).join(', ');
}

export function inferAccountContentDomain(account = {}) {
  const value = normalizeDomainText(accountDomainText(account));
  if (!value) return null;
  return accountDomainPriority.find((domain) => domainRules[domain]?.accountPattern.test(value)) || null;
}

export function validateAccountDomainFit({ account = null, product = null, topic = null, text = '' } = {}) {
  const accountDomain = inferAccountContentDomain(account);
  const signals = [];
  if (!accountDomain) {
    return { allowed: true, accountDomain: null, reasons: [], signals };
  }

  const checks = [
    ['상품', productDomainText(product)],
    ['주제', topicDomainText(topic)],
    ['본문', text]
  ].filter(([, value]) => normalizeDomainText(value));
  const incompatible = incompatibleDomains[accountDomain] || new Set();
  const reasons = [];

  for (const [label, value] of checks) {
    const domains = detectCandidateDomains(value);
    if (!domains.length) continue;
    signals.push({ label, domains });
    const hasAccountDomain = domains.includes(accountDomain);
    const offDomains = domains.filter((domain) => domain !== accountDomain && incompatible.has(domain));
    const hardPetFoodMismatch = accountDomain === 'pet'
      && petAccountHardFoodPattern.test(value)
      && !petSpecificFoodPattern.test(value);
    if (hardPetFoodMismatch) {
      reasons.push(`계정 도메인 불일치(${label}): ${domainRules.pet.label} 계정에 일반 먹방/음식 표현 감지`);
      continue;
    }
    if (offDomains.length && !hasAccountDomain) {
      reasons.push(`계정 도메인 불일치(${label}): ${domainRules[accountDomain].label} 계정에 ${domainLabels(offDomains)} 후보 감지`);
    }
  }

  return {
    allowed: reasons.length === 0,
    accountDomain,
    reasons,
    signals
  };
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
  const domainFit = validateAccountDomainFit({
    account,
    ...(options.domainParts || { text: value })
  });
  if (!domainFit.allowed) reasons.push(...domainFit.reasons);

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

  return {
    allowed: reasons.length === 0,
    reasons,
    context: {
      ...context,
      accountDomain: domainFit.accountDomain,
      domainSignals: domainFit.signals
    }
  };
}

export function validateTopicCandidate(topic, account) {
  return validateGeneratedContent([
    topic?.title,
    topic?.angle,
    topic?.reason,
    topic?.targetUser,
    ...(topic?.searchKeywords || []),
    ...(topic?.search_keywords || [])
  ].filter(Boolean).join(' '), account, { domainParts: { topic } });
}

export function validateProductCandidate(product, account) {
  return validateGeneratedContent([
    product?.product_name,
    product?.category_name,
    product?.keyword
  ].filter(Boolean).join(' '), account, { domainParts: { product } });
}

export function validatePostCandidate(postBody, account, topic = null) {
  return validateGeneratedContent([
    topic?.title,
    topic?.angle,
    postBody
  ].filter(Boolean).join(' '), account, { domainParts: { topic, text: postBody } });
}
