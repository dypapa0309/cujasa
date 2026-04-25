function bigrams(input = '') {
  const s = input.replace(/\s+/g, '').toLowerCase();
  return new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
}

export function stringSimilarity(a, b) {
  const x = bigrams(a);
  const y = bigrams(b);
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter((item) => y.has(item)).length;
  return (2 * intersection) / (x.size + y.size);
}

export function isDuplicateTopic(candidate, recentTopics, threshold = 0.7) {
  const text = `${candidate.title} ${candidate.angle}`;
  const match = recentTopics.find((topic) => stringSimilarity(text, `${topic.title} ${topic.angle}`) >= threshold);
  return { duplicate: Boolean(match), match };
}
