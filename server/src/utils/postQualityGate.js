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
  const severity = passed ? 'pass' : (checks.accountTokenLeak || checks.genericTemplate || checks.aiLikeTone ? 'critical' : 'rewrite');
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
    '독자가 저장하고 싶을 만한 작은 기준을 하나 이상 남긴다.',
    '설명문이나 블로그 글처럼 쓰지 말고 짧은 Threads 말투로 쓴다.',
    '2-5문장 안에서 자연스러운 한국어로 끝낸다.'
  ];
  if (reasons.some((reason) => /AI|문체|말투/.test(reason))) {
    instructions.push('“중요합니다”, “도움이 됩니다”, “고려해야 합니다” 같은 문장을 쓰지 않는다.');
  }
  if (reasons.some((reason) => /체크리스트|구체|디테일/.test(reason))) {
    instructions.push('넓은 기준 나열 대신 실제 놓는 자리, 귀찮아지는 순간, 손이 덜 가는 동선을 쓴다.');
  }
  if (reasons.some((reason) => /저장/.test(reason))) {
    instructions.push('읽고 나서 바로 써먹을 수 있는 후회 방지 기준을 포함한다.');
  }
  return [...new Set(instructions)];
}
