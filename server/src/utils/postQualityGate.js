const REQUIRED_CHECKS = [
  ['livedInStructure', '생활 장면 구조가 약함'],
  ['concreteCriteria', '구체 기준이 부족함'],
  ['microDetail', '생활 디테일이 부족함'],
  ['saveWorthiness', '저장할 만한 기준이 부족함'],
  ['humanWarmth', '사람 말투의 온도가 부족함']
];

const BLOCKING_CHECKS = [
  ['shallowChecklist', '얕은 체크리스트 문장'],
  ['genericTemplate', '반복 템플릿 문장'],
  ['repetitiveFallback', '반복 fallback 골격'],
  ['abstractSetup', '추상적인 첫 문장'],
  ['awkwardPhrase', '어색한 금지 표현'],
  ['categoryMismatch', '카테고리와 생활 디테일 불일치'],
  ['duplicateRisk', '최근 글과 유사한 문장 구조'],
  ['aiLikeTone', 'AI식 설명 문체'],
  ['accountTokenLeak', '계정명 또는 핸들 노출']
];

export const QUALITY_GATE_SCORE = 82;

export function evaluatePostQualityGate(engagement = {}) {
  const checks = engagement.checks || {};
  const reasons = [];
  if (Number(engagement.engagementScore || 0) < QUALITY_GATE_SCORE) {
    reasons.push(`점수 ${engagement.engagementScore || 0}점으로 기준 ${QUALITY_GATE_SCORE}점 미달`);
  }
  for (const [key, label] of REQUIRED_CHECKS) {
    if (!checks[key]) reasons.push(label);
  }
  for (const [key, label] of BLOCKING_CHECKS) {
    if (checks[key]) reasons.push(label);
  }
  const passed = reasons.length === 0;
  const severity = passed ? 'pass' : (
    checks.accountTokenLeak
      || checks.genericTemplate
      || checks.repetitiveFallback
      || checks.awkwardPhrase
      || checks.categoryMismatch
      || checks.duplicateRisk
      || checks.aiLikeTone
      ? 'critical'
      : 'rewrite'
  );
  return {
    passed,
    severity,
    score: engagement.engagementScore || 0,
    threshold: QUALITY_GATE_SCORE,
    reasons,
    rewriteInstructions: buildRewriteInstructions(reasons)
  };
}

export function buildRewriteInstructions(reasons = []) {
  const instructions = [
    '계정명, 로그인 ID, Threads 핸들, @handle을 본문에 절대 넣지 않는다.',
    '링크, 댓글 링크, 구매, 최저가, 할인, 특가 표현을 쓰지 않는다.',
    '현관, 설거지, 빨래, 욕실 물기, 조리대, 침대 옆 충전기, 분리수거 봉투 같은 작은 생활 디테일을 최소 2개 넣는다.',
    '“흐름이에요”, “흐름이야”, “생활 속에서”, “고려해야”, “도움이 됩니다”, “중요합니다”를 쓰지 않는다.',
    '주방 글은 조리대, 싱크대, 설거지, 물 빠짐처럼 주방 디테일로 쓰고, 육아/선물/청소 디테일을 섞지 않는다.',
    '독자가 저장하고 싶을 만한 작은 기준을 하나 이상 남긴다.',
    '설명문이나 블로그 글처럼 쓰지 말고 짧은 Threads 말투로 쓴다.',
    '한 글 안에서 반말과 존댓말을 섞지 않는다. 계정 톤이 반말이면 반말만, 그 외에는 해요체만 쓴다.',
    '2-5문장 안에서 자연스러운 한국어로 끝낸다.'
  ];
  if (reasons.some((reason) => /AI|문체|말투/.test(reason))) {
    instructions.push('“중요합니다”, “도움이 됩니다”, “고려해야 합니다” 같은 문장을 쓰지 않는다.');
  }
  if (reasons.some((reason) => /체크리스트|구체|디테일/.test(reason))) {
    instructions.push('넓은 기준 나열 대신 실제 놓는 자리, 귀찮아지는 순간, 손이 덜 가는 동선을 쓴다.');
  }
  if (reasons.some((reason) => /반복|유사/.test(reason))) {
    instructions.push('최근 글과 같은 첫 문장, 같은 질문, 같은 1-2-3 기준을 반복하지 않고 다른 생활 장면으로 바꾼다.');
  }
  if (reasons.some((reason) => /추상/.test(reason))) {
    instructions.push('첫 문장은 “생활 속에서”, “중요합니다” 같은 추상 설명 대신 실제 상황 하나로 시작한다.');
  }
  if (reasons.some((reason) => /금지 표현|어색/.test(reason))) {
    instructions.push('“다시 두기 편한지”, “손이 덜 가는지”, “자주 꺼내기 쉬운지”, “놔둘 자리가 있는지”처럼 실제 행동으로 바꾼다.');
  }
  if (reasons.some((reason) => /카테고리|불일치/.test(reason))) {
    instructions.push('선물 글에는 육아 동선이나 주방 동선을 넣지 말고, 받는 사람/취향/바로 쓸 수 있는지 기준으로 쓴다.');
  }
  if (reasons.some((reason) => /저장/.test(reason))) {
    instructions.push('읽고 나서 바로 써먹을 수 있는 후회 방지 기준을 포함한다.');
  }
  return [...new Set(instructions)];
}
