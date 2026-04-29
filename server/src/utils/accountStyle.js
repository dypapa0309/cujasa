function clean(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function includesAny(value, terms) {
  return terms.some((term) => value.includes(term));
}

export function getAccountStyleProfile(account = {}) {
  const tone = clean(account.tone, '친근하고 자연스럽게');
  const targetAudience = clean(account.target_audience, '이 계정의 타겟 사용자');
  const contentScope = clean(account.content_scope, '이 계정에서 다루는 카테고리');
  const ctaStyle = clean(account.cta_style, '자연스럽게 반응을 유도');
  const toneKey = tone.replace(/\s+/g, '');
  const rules = [
    `Target audience is mandatory: write for "${targetAudience}".`,
    `Content scope is mandatory: stay inside "${contentScope}".`,
    `Tone is mandatory: every topic and post must visibly feel like "${tone}".`,
    `CTA style is mandatory when a CTA is needed: "${ctaStyle}".`,
    'Do not fall back to a generic conversational tone when tone is specific.',
    'Do not introduce categories outside contentScope just because they are common affiliate topics.'
  ];
  const examples = [];
  const bannedStyle = [
    '광고 문구처럼 과장된 표현',
    '누구에게나 맞는 일반론',
    '설정값과 무관한 평범한 구어체',
    '직접 사용했다는 허위 단정'
  ];

  if (includesAny(toneKey, ['설레', '감성'])) {
    rules.push('Use light anticipation, small delight, gift-like discovery, and warm emotional wording.');
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

  if (includesAny(toneKey, ['설레', '감성', '후기', '리뷰'])) {
    return `${title}, 고를 때 은근 설레는 포인트가 있어요.\n\n${angle} 같은 기준으로 보면 받는 순간 기분 좋아질 만한지 더 잘 보이더라고요.\n\n너무 과한 것보다 오래 두고 쓰기 좋은 느낌인지 먼저 체크해보세요.`;
  }

  if (includesAny(toneKey, ['전문', '신뢰'])) {
    return `${title}를 고를 때는 기준을 먼저 나누는 게 좋습니다.\n\n${angle}를 확인하면 실제 사용 환경에 맞는지 판단하기 쉽습니다.\n\n가격보다 자주 쓰는 상황에 맞는지를 먼저 보세요.`;
  }

  return `${title}, 생각보다 은근 신경 쓰이는 부분이에요.\n\n${angle}만 잘 봐도 일상이 조금 편해집니다.\n\n크게 바꾸기보다 자주 쓰는 물건부터 맞춰보면 좋아요.`;
}

export function validatePostStyleFit(body, account = {}) {
  const profile = getAccountStyleProfile(account);
  const toneKey = profile.tone.replace(/\s+/g, '');
  const text = String(body || '');
  const reasons = [];

  if (includesAny(toneKey, ['설레', '감성'])) {
    const emotionalTerms = ['설레', '기분', '마음', '기대', '선물', '괜히', '예쁜', '발견', '만족'];
    if (!includesAny(text, emotionalTerms)) {
      reasons.push('톤 불일치: 설레는/감성 톤 신호 부족');
    }
  }

  if (includesAny(toneKey, ['후기', '리뷰'])) {
    const reviewTerms = ['써보', '두고', '고를 때', '후기', '체크포인트', '느껴', '실사용'];
    if (!includesAny(text, reviewTerms)) {
      reasons.push('톤 불일치: 후기형 관찰 문장 부족');
    }
  }

  return { allowed: reasons.length === 0, reasons, profile };
}
