const replacements = [
  [/무조건\s*해결/g, '도움이 될 수 있음'],
  [/100%\s*사라짐/g, '줄이는 데 도움이 될 수 있음'],
  [/완벽\s*해결/g, '관리하기 쉬워질 수 있음'],
  [/100%/g, '꽤'],
  [/무조건/g, '상황에 따라'],
  [/완벽/g, '조금 더 편한'],
  [/보장/g, '기대'],
  [/치료/g, '관리'],
  [/예방/g, '줄이는 데 도움']
];

const highRiskTerms = ['질병', '치료', '의학', '투자', '수익 보장', '법률', '아기 안전', '영아 안전'];

export function checkAndRewriteRisk(text) {
  let revised = text;
  replacements.forEach(([pattern, to]) => { revised = revised.replace(pattern, to); });
  const high = highRiskTerms.some((term) => revised.includes(term));
  return { riskLevel: high ? 'high' : revised !== text ? 'medium' : 'low', body: revised };
}
