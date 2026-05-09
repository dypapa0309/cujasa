function clean(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

const modeProfiles = {
  auto: {
    label: '자동 맞춤',
    contentTypes: ['일상형', '공감형', '문제 해결형', '체크리스트형', '질문형'],
    rules: [
      'Content mode is AUTO: choose the content type that best fits the topic, selected products, and referencePatterns.',
      'When referencePatterns are available, prioritize their structure, pacing, and voice over rigid mode templates.',
      'Mix daily, empathy, problem-solution, checklist, and question formats naturally across candidates.'
    ]
  },
  daily: {
    label: '일상형',
    contentTypes: ['일상형'],
    rules: [
      'Content mode is DAILY: start from an ordinary daily situation, not a sales pitch.',
      'Use small real-life scenes and avoid article-like explanations.'
    ]
  },
  empathy: {
    label: '공감형',
    contentTypes: ['공감형'],
    rules: [
      'Content mode is EMPATHY: first sentence must name a relatable inconvenience or feeling.',
      'Make the reader feel understood before mentioning any product use case.'
    ]
  },
  problem_solution: {
    label: '문제 해결형',
    contentTypes: ['문제 해결형'],
    rules: [
      'Content mode is PROBLEM_SOLUTION: show problem, selection criterion, and practical solution flow.',
      'Do not drift into broad lifestyle advice.'
    ]
  },
  checklist: {
    label: '체크리스트형',
    contentTypes: ['체크리스트형'],
    rules: [
      'Content mode is CHECKLIST: use concise selection points or criteria.',
      'Keep checklist short; avoid long blog-style lists.'
    ]
  },
  question: {
    label: '질문형',
    contentTypes: ['질문형'],
    rules: [
      'Content mode is QUESTION: end with a natural question that invites comments.',
      'The question must be easy to answer from personal experience.'
    ]
  },
  safe_debate: {
    label: '안전 논쟁형',
    contentTypes: ['질문형', '공감형'],
    rules: [
      'Content mode is SAFE_DEBATE: create a mild preference or situation-choice question.',
      'Allowed debate frames: taste, habit, space, budget, frequency, use-case differences.',
      'Never use insult, contempt, gender/age/job/region conflict, political conflict, or hostile polarization.'
    ]
  }
};

const commentStyleRules = {
  none: 'Do not force comment induction. A post can end naturally without a question.',
  soft_question: 'Use a soft, low-pressure question only when it fits.',
  experience_question: 'Prefer asking about the reader’s own experience.',
  choice_question: 'Prefer an A/B choice question that is safe and non-hostile.'
};

const productMentionRules = {
  none: 'Do not mention product names in the body; keep product connection implicit.',
  natural: 'Mention product categories only when they naturally solve the situation.',
  direct: 'You may mention selected product categories directly, but keep the tone non-salesy.'
};

const emojiRules = {
  none: 'Do not use emoji.',
  low: 'Use zero or one light emoji only when it fits.',
  medium: 'Use at most one emoji; never decorate every sentence.'
};

export function normalizeContentStrategy(account = {}) {
  const contentMode = modeProfiles[account.content_mode] ? account.content_mode : 'auto';
  const safeDebateEnabled = Boolean(account.safe_debate_enabled);
  const effectiveMode = contentMode === 'safe_debate' && !safeDebateEnabled ? 'question' : contentMode;
  const contentIntensity = ['soft', 'normal', 'strong'].includes(account.content_intensity) ? account.content_intensity : 'normal';
  const commentInductionStyle = commentStyleRules[account.comment_induction_style] ? account.comment_induction_style : 'soft_question';
  const productMentionStyle = productMentionRules[account.product_mention_style] ? account.product_mention_style : 'natural';
  const emojiLevel = emojiRules[account.emoji_level] ? account.emoji_level : 'low';
  return {
    contentMode,
    effectiveMode,
    contentModeLabel: modeProfiles[effectiveMode].label,
    allowedContentTypes: modeProfiles[effectiveMode].contentTypes,
    contentIntensity,
    seasonalityEnabled: account.seasonality_enabled !== false,
    commentInductionStyle,
    productMentionStyle,
    emojiLevel,
    safeDebateEnabled,
    contentStyleNote: String(account.content_style_note || '').trim()
  };
}

export function getAccountStyleProfile(account = {}) {
  const tone = clean(account.tone, '친근하고 자연스럽게');
  const targetAudience = clean(account.target_audience, '이 계정의 타겟 사용자');
  const contentScope = clean(account.content_scope, '이 계정에서 다루는 카테고리');
  const ctaStyle = clean(account.cta_style, '자연스럽게 반응을 유도');
  const strategy = normalizeContentStrategy(account);
  const toneKey = tone.replace(/\s+/g, '');
  const rules = [
    `Target audience is mandatory: write for "${targetAudience}".`,
    `Content scope is mandatory: stay inside "${contentScope}".`,
    `Structured content mode is mandatory: ${strategy.contentModeLabel}.`,
    `Allowed content types are limited to: ${strategy.allowedContentTypes.join(', ')}.`,
    `Content intensity is ${strategy.contentIntensity}; do not exceed it.`,
    strategy.seasonalityEnabled
      ? 'Use currentDateKST and seasonKST when seasonal context is natural.'
      : 'Do not force seasonal references.',
    commentStyleRules[strategy.commentInductionStyle],
    productMentionRules[strategy.productMentionStyle],
    emojiRules[strategy.emojiLevel],
    `Tone is secondary guidance only: "${tone}". Do not ignore the structured content mode.`,
    `CTA style is secondary guidance only: "${ctaStyle}".`,
    strategy.contentStyleNote
      ? `Additional note is optional guidance after structured settings: "${strategy.contentStyleNote}".`
      : 'No additional content note is provided.',
    'Natural Korean readability is more important than visibly proving the tone in every sentence.',
    'Do not become generic when tone is specific.',
    'Do not introduce categories outside contentScope just because they are common affiliate topics.',
    ...modeProfiles[strategy.effectiveMode].rules
  ];
  const examples = [];
  const bannedStyle = [
    '광고 문구처럼 과장된 표현',
    '누구에게나 맞는 일반론',
    '설정값과 무관한 평범한 구어체',
    '직접 사용했다는 허위 단정'
  ];

  if (includesAny(toneKey, ['설레', '감성'])) {
    rules.push('Use light anticipation or warm wording only when it fits the situation; do not force decorative wording.');
    examples.push('괜히 기분 좋아지는', '받는 순간 살짝 설레는', '고르는 재미가 있는', '마음에 남는');
  }

  if (includesAny(toneKey, ['후기', '리뷰'])) {
    rules.push('Use review-like observation, but avoid falsely claiming actual personal use.');
    rules.push('Prefer conditional/review-style phrasing such as "써보면", "두면", "고를 때", "후기에서 자주 보이는 포인트".');
    examples.push('써보면 먼저 느껴질 포인트', '두고 쓰기 좋은 이유', '후기에서 많이 보는 체크포인트');
  }

  if (includesAny(toneKey, ['전문', '신뢰'])) {
    rules.push('Use calm, evidence-oriented wording and avoid slang.');
    examples.push('선택 기준을 나눠보면', '체크할 부분은', '실사용 환경을 보면');
  }

  if (includesAny(toneKey, ['MZ', '엠지'])) {
    rules.push('Use concise trendy Korean, but keep it readable and not forced.');
    examples.push('요즘 이런 게 은근 편함', '딱 필요한 포인트만', '가볍게 챙기기 좋은');
  }

  return {
    targetAudience,
    contentScope,
    tone,
    ctaStyle,
    strategy,
    rules,
    preferredExpressions: examples,
    bannedStyle
  };
}

export function buildFallbackPostBody(topic, account = {}) {
  const profile = getAccountStyleProfile(account);
  const title = clean(topic?.title, profile.contentScope);
  const angle = clean(topic?.angle, '고를 때 놓치기 쉬운 포인트');
  const toneKey = profile.tone.replace(/\s+/g, '');
  const mode = profile.strategy.effectiveMode;

  if (mode === 'daily') {
    return `${title}, 일상에서 은근 자주 마주치는 상황이에요.\n\n${angle}만 잘 봐도 매번 귀찮던 부분이 조금 줄어듭니다.\n\n지금 쓰는 방식에서 뭐가 제일 불편한지 먼저 떠올려보세요.`;
  }

  if (mode === 'empathy') {
    return `${title}, 필요할 때마다 신경 쓰이면 생각보다 피곤하죠.\n\n${angle} 같은 기준을 잡아두면 고르는 시간이 훨씬 줄어듭니다.\n\n큰 변화보다 자주 불편했던 부분부터 가볍게 바꿔보면 좋아요.`;
  }

  if (mode === 'problem_solution') {
    return `${title}를 고를 때 제일 문제는 막상 써야 할 상황이 오면 기준이 헷갈린다는 점이에요.\n\n해결 기준은 간단합니다. ${angle}를 먼저 보고, 자주 쓰는 환경에 맞는지 확인해보세요.\n\n그 기준만 잡아도 불필요한 선택을 줄일 수 있습니다.`;
  }

  if (mode === 'checklist') {
    return `${title} 고를 때는 세 가지만 먼저 체크해보세요.\n\n1. 자주 쓰는 상황에 맞는지\n2. ${angle}\n3. 보관이나 관리가 부담스럽지 않은지\n\n처음 눈에 띄는 것보다 실제로 계속 쓰기 쉬운지가 더 중요합니다.`;
  }

  if (mode === 'question') {
    return `${title}, 사람마다 고르는 기준이 꽤 다르더라고요.\n\n${angle}를 먼저 보는 사람도 있고, 가격이나 보관 편의성을 더 보는 사람도 있어요.\n\n여러분은 이런 제품 고를 때 어떤 기준을 제일 먼저 보세요?`;
  }

  if (mode === 'safe_debate') {
    return `${title}, 이건 상황마다 선택이 갈릴 수밖에 없어요.\n\n${angle}를 중요하게 보는 사람도 있고, 간편함이나 가격을 먼저 보는 사람도 있죠.\n\n여러분은 실용성 쪽이에요, 아니면 편한 사용감 쪽이에요?`;
  }

  if (includesAny(toneKey, ['설레', '감성', '후기', '리뷰'])) {
    return `${title}, 고를 때 작은 기준 하나만 있어도 선택이 쉬워져요.\n\n${angle} 같은 부분을 보면 오래 두고 쓰기 좋은지 더 잘 보입니다.\n\n처음 눈에 띄는 것보다 자주 손이 갈 만한지를 먼저 체크해보세요.`;
  }

  if (includesAny(toneKey, ['전문', '신뢰'])) {
    return `${title}를 고를 때는 기준을 먼저 나누는 게 좋습니다.\n\n${angle}를 확인하면 실제 사용 환경에 맞는지 판단하기 쉽습니다.\n\n가격보다 자주 쓰는 상황에 맞는지를 먼저 보세요.`;
  }

  return `${title}, 생각보다 은근 신경 쓰이는 부분이에요.\n\n${angle}만 잘 봐도 일상이 조금 편해집니다.\n\n크게 바꾸기보다 자주 쓰는 물건부터 맞춰보면 좋아요.`;
}

function firstSentenceOf(body = '') {
  return String(body || '').split(/\n|[.!?。！？]/).map((line) => line.trim()).filter(Boolean)[0] || '';
}

export function scorePostHook(body = '') {
  const first = firstSentenceOf(body);
  const checks = {
    concreteInconvenience: /귀찮|불편|신경|피곤|번거|막상|은근|자꾸|놓치|고민|헷갈/.test(first),
    choiceTension: /갈리|취향|습관|상황|공간|예산|빈도|기준|먼저|차이|쪽/.test(first),
    regretPrevention: /후회|실수|사고 나서|사기 전|고르기 전|놓치기 쉬운|체크/.test(first),
    replyPrompt: /여러분|다들|혹시|어때|뭐가|어느 쪽|고르/.test(first)
  };
  const score = Object.values(checks).filter(Boolean).length;
  return {
    firstSentence: first,
    score,
    checks,
    strong: score >= 1 && first.length >= 12
  };
}

export function strengthenPostHook(body = '', topic = {}, account = {}) {
  const original = String(body || '').trim();
  const profile = getAccountStyleProfile(account);
  const title = clean(topic?.title, profile.contentScope);
  const angle = clean(topic?.angle, '고를 때 놓치기 쉬운 기준');
  const mode = profile.strategy.effectiveMode;
  const hooks = {
    auto: `${title}, 이건 상황마다 기준이 은근 갈리는 포인트예요.`,
    empathy: `${title}, 이거 은근 나만 불편한 줄 알았는데 생각보다 많이 겪는 상황이에요.`,
    daily: `${title}, 평소에는 별거 아닌데 막상 필요할 때마다 은근 신경 쓰이죠.`,
    problem_solution: `${title}, 사고 나서 후회하는 포인트는 보통 ${angle}에서 갈립니다.`,
    checklist: `${title}, 고르기 전에 ${angle} 하나만 놓쳐도 다시 찾게 되는 경우가 많아요.`,
    question: `${title}, 여러분은 ${angle} 쪽을 먼저 보세요, 아니면 편하게 쓰는 쪽을 먼저 보세요?`,
    safe_debate: `${title}, 이건 취향보다 사용 습관에 따라 꽤 갈리는 선택이에요.`
  };
  const hook = hooks[mode] || hooks.empathy;
  const lines = original.split('\n');
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) return hook;
  lines[firstLineIndex] = hook;
  return lines.join('\n').trim();
}

export function validatePostStyleFit(body, account = {}) {
  const profile = getAccountStyleProfile(account);
  const text = String(body || '');
  const reasons = [];
  const hostileTerms = ['한심', '극혐', '노답', '틀딱', '맘충', '남혐', '여혐', '거지', '무식', '병신', '바보', '편가르', '갈라치기', '정치', '남자들은', '여자들은'];

  if (includesAny(text, hostileTerms)) {
    reasons.push('후킹 안전장치 위반: 비하/혐오/조롱/위험 갈등 표현 포함');
  }

  const hook = scorePostHook(text);
  if (!hook.strong) reasons.push('후킹 부족: 첫 문장에 구체적 불편/선택 갈등/후회 방지/경험 질문 신호 부족');

  if (profile.strategy.effectiveMode === 'question') {
    if (!/[?？]|어때|있어|인가요|할까|고르|추천해/.test(text)) reasons.push('콘텐츠 방식 불일치: 질문형 신호 부족');
  }

  if (profile.strategy.effectiveMode === 'checklist') {
    if (!/[123]|첫째|둘째|체크|기준|포인트|먼저/.test(text)) reasons.push('콘텐츠 방식 불일치: 체크리스트형 신호 부족');
  }

  if (profile.strategy.effectiveMode === 'problem_solution') {
    if (!/불편|문제|해결|도움|편해|관리|정리/.test(text)) reasons.push('콘텐츠 방식 불일치: 문제 해결형 신호 부족');
  }

  if (profile.strategy.effectiveMode === 'daily') {
    if (!/일상|매일|집에서|생활|자주|평소|쓸 때|상황/.test(text)) reasons.push('콘텐츠 방식 불일치: 일상형 신호 부족');
  }

  if (profile.strategy.effectiveMode === 'empathy') {
    if (!/신경|귀찮|피곤|불편|공감|은근|막상|생각보다/.test(text)) reasons.push('콘텐츠 방식 불일치: 공감형 신호 부족');
  }

  return { allowed: reasons.length === 0, reasons, profile };
}
