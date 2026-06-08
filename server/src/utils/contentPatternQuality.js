import { scorePostSimilarity } from './postEngagementScoring.js';
import { findRepetitiveContentMatches } from './repetitiveContentRules.js';

export function assessContentPatternQuality(body = '', peerBodies = []) {
  const text = String(body || '');
  const reasons = [];
  const repetitiveMatches = findRepetitiveContentMatches(text);
  if (repetitiveMatches.length) {
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
    duplicateTokenOverlap: peerSimilarity.maxTokenOverlap,
    duplicateSignal: peerSimilarity.duplicateSignal,
    duplicatePenalty: peerSimilarity.penalty,
    repetitiveMatches
  };
}
