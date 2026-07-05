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

const accountDomainRules = [
  {
    key: 'pet',
    label: '반려동물',
    pattern: /반려|강아지|고양이|펫|집사|배변|산책|리드줄|하네스|물그릇|털|모래|댕댕|냥이/i,
    conflicts: [
      {
        label: '먹방/먹거리',
        pattern: /먹방|먹마왕|먹거리|음식|푸드|식품|냉장고|소포장|나눠\s*먹|손에\s*묻|쿠키|과자|초콜릿|견과|약과|커피|컵과일|과일\s*선물|간식\s*(세트|추천|고르|먹)/i,
        allow: /반려|강아지|고양이|펫|사료|츄르|배변|산책|리드줄|하네스|물그릇|털|모래|댕댕|냥이|고양이\s*간식|강아지\s*간식|펫\s*간식|간식\s*파우치/i
      },
      {
        label: '주방 살림',
        pattern: /조리대|싱크대|설거지|수세미|냄비|프라이팬|식기|양념통|접이식\s*도마/i
      },
      {
        label: '육아',
        pattern: /육아|아기|기저귀|물티슈|유모차|장난감\s*수납|아이\s*손/i
      }
    ]
  },
  {
    key: 'food',
    label: '먹거리',
    pattern: /먹방|먹마왕|먹거리|음식|푸드|식품|간식|냉장고|소포장|쿠키|과자|초콜릿|견과|약과|커피|컵과일/i,
    conflicts: [
      {
        label: '반려동물',
        pattern: /반려|강아지|고양이|펫|집사|배변|산책|리드줄|하네스|물그릇|털|모래|댕댕|냥이/i
      },
      {
        label: '육아',
        pattern: /육아|아기|기저귀|물티슈|유모차|아이\s*손/i
      }
    ]
  },
  {
    key: 'childcare',
    label: '육아',
    pattern: /육아|아기|유아|아이(?!템)|어린이|키즈|기저귀|물티슈|유모차|장난감/i,
    conflicts: [
      {
        label: '반려동물',
        pattern: /반려|강아지|고양이|펫|집사|배변|산책|리드줄|하네스|물그릇|털|모래|댕댕|냥이/i
      },
      {
        label: '먹방/먹거리',
        pattern: /먹방|먹마왕|먹거리|음식|푸드|식품|냉장고|소포장|나눠\s*먹|손에\s*묻|쿠키|과자|초콜릿|견과|약과|커피|컵과일/i
      }
    ]
  },
  {
    key: 'kitchen',
    label: '주방',
    pattern: /주방|조리|식기|싱크|조리대|설거지|수세미|냄비|프라이팬|도마|양념통/i,
    conflicts: [
      {
        label: '반려동물',
        pattern: /반려|강아지|고양이|펫|집사|배변|산책|리드줄|하네스|물그릇|털|모래|댕댕|냥이/i
      },
      {
        label: '육아',
        pattern: /육아|아기|기저귀|물티슈|유모차|아이\s*손/i
      }
    ]
  }
];

function getKstDate(date = new Date()) {
  return new Date(date.getTime() + KST_OFFSET_MINUTES * 60 * 1000);
}

function includesAny(text, terms) {
  return terms.filter((term) => text.includes(term));
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function inferAccountContentDomain(account = {}) {
  const text = normalizeText([
    account?.content_scope,
    account?.target_audience,
    account?.tone,
    account?.name,
    account?.account_handle
  ].filter(Boolean).join(' '));
  return accountDomainRules.find((rule) => rule.pattern.test(text)) || null;
}

export function validateAccountDomainFit(value, account = {}) {
  const expected = inferAccountContentDomain(account);
  if (!expected) return { allowed: true, expectedDomain: null, conflicts: [] };

  const text = normalizeText(value);
  const conflicts = expected.conflicts
    .filter((rule) => rule.pattern.test(text) && !(rule.allow && rule.allow.test(text)))
    .map((rule) => ({ expected: expected.label, conflict: rule.label }));

  return {
    allowed: conflicts.length === 0,
    expectedDomain: expected.key,
    expectedLabel: expected.label,
    conflicts,
    reasons: conflicts.map((row) => `계정 카테고리 불일치: ${row.expected} 계정에 ${row.conflict} 소재가 섞임`)
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

  const domainFit = validateAccountDomainFit(value, account);
  if (!domainFit.allowed) reasons.push(...domainFit.reasons);

  return {
    allowed: reasons.length === 0,
    reasons,
    context: {
      ...context,
      accountDomain: domainFit.expectedDomain,
      accountDomainConflicts: domainFit.conflicts
    }
  };
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
