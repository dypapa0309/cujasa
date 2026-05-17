import { scorePostSimilarity } from './postEngagementScoring.js';

const REPETITIVE_TEMPLATE_PATTERNS = [
  /고를\s*때\s*처음엔\s*예쁜\s*것부터\s*보이는데[\s\S]*귀찮은\s*순간이\s*기준을\s*바꾸더라고요/i,
  /다시\s*넣을\s*때\s*손이\s*덜\s*가는\s*구조처럼[\s\S]*바닥에\s*쌓이는\s*일이\s*확\s*줄어요/i,
  /예쁜\s*쪽보다\s*매일\s*쓰는\s*순간이\s*더\s*빨리\s*티\s*나/i,
  /사고\s*나서\s*제일\s*아쉬운\s*건\s*보통\s*성능보다\s*놓는\s*자리/i,
  /고를\s*때\s*(저는|나는)\s*보이는\s*깔끔함이랑\s*꺼내기\s*편한\s*쪽/i,
  /오래\s*쓰는\s*기준은\s*기능보다\s*자리에서\s*갈리/i,
  /처음엔\s*기능을\s*먼저\s*보게\s*되는데,\s*막상\s*매일\s*쓰면\s*자리가\s*먼저\s*보이/i
];

export function assessContentPatternQuality(body = '', peerBodies = []) {
  const text = String(body || '');
  const reasons = [];
  if (REPETITIVE_TEMPLATE_PATTERNS.some((pattern) => pattern.test(text))) {
    reasons.push('반복 템플릿 문장 구조');
  }
  const peerSimilarity = scorePostSimilarity(text, peerBodies.filter(Boolean));
  if (peerSimilarity.duplicateRisk) {
    reasons.push('후보/최근 글과 문장 구조 유사');
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    duplicateSimilarity: peerSimilarity.maxSimilarity,
    duplicatePenalty: peerSimilarity.penalty
  };
}
