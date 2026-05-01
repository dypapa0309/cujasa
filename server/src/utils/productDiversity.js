const productGroupRules = [
  { group: '꽃/화병', terms: ['꽃', '꽃다발', '화병', '유리돔', '영생화', '프리저브드', '부케', '카네이션'] },
  { group: '카드/포장', terms: ['카드', '편지', '봉투', '포장', '선물박스', '기프트백', '쇼핑백', '리본', '스티커'] },
  { group: '앨범/DIY', terms: ['앨범', '포토북', '사진', 'DIY', '만들기', '꾸미기', '스크랩북'] },
  { group: '무드등/조명', terms: ['무드등', '조명', '램프', '스탠드', '라이트', '오로라', '수면등', '취침등', 'led'] },
  { group: '키링/잡화', terms: ['키링', '열쇠고리', '파우치', '지갑', '가방', '악세사리', '액세서리'] },
  { group: '디퓨저/향', terms: ['디퓨저', '향초', '캔들', '인센스', '방향제', '향수', '룸스프레이'] },
  { group: '주방/생활', terms: ['주방', '칼', '도마', '그릇', '컵', '텀블러', '수납', '정리', '청소'] },
  { group: '식품/간식', terms: ['간식', '초콜릿', '쿠키', '과자', '견과', '사탕', '젤리', '커피', '차'] },
  { group: '인테리어소품', terms: ['소품', '오브제', '장식', '인테리어', '피규어', '저금통', '트레이'] }
];

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

export function getProductGroup(product) {
  const text = normalizeText([
    product?.product_name,
    product?.category_name,
    product?.keyword
  ].filter(Boolean).join(' '));

  for (const rule of productGroupRules) {
    if (rule.terms.some((term) => text.includes(term.toLowerCase()))) {
      return rule.group;
    }
  }
  return '기타';
}

export function enrichProductsWithDiversity(products) {
  return products.map((product) => ({
    ...product,
    product_group: getProductGroup(product)
  }));
}

function defaultSelectionItem(product, topic, index = 0) {
  return {
    productId: product.product_id,
    fitScore: Math.max(70, 90 - index * 5),
    reason: `${topic.angle || topic.title}와 자연스럽게 연결되는 ${getProductGroup(product)} 상품`,
    recommendedUse: index === 0 ? '메인 추천' : '보완 추천'
  };
}

function addCandidate(chosen, seenIds, groupCounts, candidate, strictGroupLimit, maxPerGroup) {
  const productId = String(candidate.product.product_id);
  if (seenIds.has(productId)) return false;

  const group = getProductGroup(candidate.product);
  const currentGroupCount = groupCounts.get(group) || 0;
  if (strictGroupLimit && currentGroupCount > 0) return false;
  if (!strictGroupLimit && currentGroupCount >= maxPerGroup) return false;

  chosen.push(candidate);
  seenIds.add(productId);
  groupCounts.set(group, currentGroupCount + 1);
  return true;
}

export function buildDiverseProductSelection(aiItems, products, topic, limit = 3) {
  const productById = new Map(products.map((product) => [String(product.product_id), product]));
  const aiCandidates = [];
  const seenAi = new Set();

  for (const item of aiItems || []) {
    const product = productById.get(String(item?.productId));
    if (!product || seenAi.has(String(product.product_id))) continue;
    seenAi.add(String(product.product_id));
    aiCandidates.push({ product, item });
  }

  const allCandidates = products.map((product, index) => ({
    product,
    item: defaultSelectionItem(product, topic, index)
  }));

  const chosen = [];
  const seenIds = new Set();
  const groupCounts = new Map();

  for (const candidate of aiCandidates) {
    if (chosen.length >= limit) break;
    addCandidate(chosen, seenIds, groupCounts, candidate, true, 1);
  }

  for (const candidate of allCandidates) {
    if (chosen.length >= limit) break;
    addCandidate(chosen, seenIds, groupCounts, candidate, true, 1);
  }

  for (const candidate of [...aiCandidates, ...allCandidates]) {
    if (chosen.length >= limit) break;
    addCandidate(chosen, seenIds, groupCounts, candidate, false, 2);
  }

  for (const candidate of allCandidates) {
    if (chosen.length >= limit) break;
    const productId = String(candidate.product.product_id);
    if (seenIds.has(productId)) continue;
    chosen.push(candidate);
    seenIds.add(productId);
  }

  return {
    selected: chosen.slice(0, limit),
    diversityLimited: new Set(chosen.slice(0, limit).map((candidate) => getProductGroup(candidate.product))).size < Math.min(limit, products.length)
  };
}
