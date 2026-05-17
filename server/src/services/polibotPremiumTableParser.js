function cleanText(value = '') {
  return String(value || '')
    .normalize('NFC')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeProductKey(value = '') {
  return String(value || '').replace(/\s+/g, '');
}

export function normalizePolibotPremiumAmountText(value = '') {
  const text = cleanText(value);
  if (!text) return '';
  const won = text.match(/(?:월\s*)?\d{1,3}(?:,\d{3})+\s*원/);
  if (won?.[0]) return won[0].replace(/^월\s*/, '');
  const manwon = text.match(/(?:월\s*)?\d{1,3}(?:\.\d+)?\s*만\s*원/);
  if (manwon?.[0]) return manwon[0].replace(/^월\s*/, '').replace(/\s+/g, '');
  return '';
}

function premiumUnitFromContext(context = '') {
  const source = String(context || '');
  if (/단위\s*[:：]?\s*천\s*원|천원\s*단위/.test(source)) return '천원';
  if (/단위\s*[:：]?\s*만\s*원|만원\s*단위/.test(source)) return '만원';
  if (/단위\s*[:：]?\s*원|원\s*단위/.test(source)) return '원';
  return '';
}

function normalizePremiumByUnit(value = '', unit = '') {
  const raw = cleanText(value).replace(/,/g, '');
  const numeric = Number(raw.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  if (/원/.test(value) && !/만원|천원/.test(value)) return `${Math.round(numeric).toLocaleString('ko-KR')}원`;
  if (/만\s*원|만원/.test(value)) return `${numeric}만원`;
  if (/천\s*원|천원/.test(value)) return `${Math.round(numeric * 1000).toLocaleString('ko-KR')}원`;
  if (unit === '만원') return `${numeric}만원`;
  if (unit === '천원') return `${Math.round(numeric * 1000).toLocaleString('ko-KR')}원`;
  if (unit === '원') return `${Math.round(numeric).toLocaleString('ko-KR')}원`;
  return '';
}

function extractLineWindow(lines = [], index = 0, radius = 2) {
  return cleanText(lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1)).join('\n'));
}

function premiumHeaderColumns(line = '') {
  const source = cleanText(line);
  const columns = [];
  const pattern = /(남자|여자|남성|여성)?\s*(?:만\s*)?(\d{1,2})\s*세/g;
  for (const match of source.matchAll(pattern)) {
    columns.push({
      gender: /남/.test(match[1] || '') ? '남성' : /여/.test(match[1] || '') ? '여성' : '',
      age: match[2] || '',
      index: match.index || 0
    });
  }
  return columns;
}

function extractPremiumMatrixRows(lines = [], index = 0, productName = '') {
  const line = lines[index] || '';
  const header = lines.slice(Math.max(0, index - 2), index).find((candidate) => premiumHeaderColumns(candidate).length >= 2) || '';
  const columns = premiumHeaderColumns(header);
  if (!columns.length) return [];
  const unit = premiumUnitFromContext(extractLineWindow(lines, index, 3));
  const numericMatches = [...line.matchAll(/\b\d{1,3}(?:\.\d{1,2})?\b|\d{1,3}(?:,\d{3})+\s*원|\d{1,3}(?:\.\d+)?\s*만\s*원/g)];
  if (!numericMatches.length || numericMatches.length > columns.length + 2) return [];
  const firstAmountIndex = numericMatches[0]?.index || 0;
  const plan = cleanText(line.slice(0, firstAmountIndex)).replace(/^(?:구분|보험료|월납)\s*/, '').slice(0, 40);
  if (!plan || !/플랜|형|Plan|PLAN|기본|표준|고급|실속|프리미엄|선택/.test(plan)) return [];
  const context = extractLineWindow(lines, index, 3);
  const directProduct = productName && normalizeProductKey(context).includes(normalizeProductKey(productName));
  return numericMatches.slice(0, columns.length).map((match, columnIndex) => {
    const amount = normalizePolibotPremiumAmountText(match[0]) || normalizePremiumByUnit(match[0], unit);
    if (!amount) return null;
    const column = columns[columnIndex] || {};
    return {
      amount,
      rawText: match[0],
      age: column.age || '',
      gender: column.gender || '',
      plan,
      unit,
      context: context.slice(0, 360),
      confidence: directProduct ? 'product_premium_matrix' : 'premium_matrix',
      score: directProduct ? 96 : 86
    };
  }).filter(Boolean);
}

export function extractPolibotPremiumTableRows(text = '', productName = '') {
  const source = cleanText(text);
  if (!source) return [];
  const productKey = normalizeProductKey(productName);
  const lines = source
    .split(/\n+|(?<=원)\s+(?=\S)|(?<=만원)\s+(?=\S)/)
    .map((line) => cleanText(line))
    .filter(Boolean);
  const rows = [];
  lines.forEach((line, index) => {
    rows.push(...extractPremiumMatrixRows(lines, index, productName));
    const context = extractLineWindow(lines, index, 2);
    const unit = premiumUnitFromContext(context);
    const premiumSignal = /보험료|월납|납입보험료|합계보험료|납입|남자|여자|남성|여성|단위\s*[:：]?\s*(?:원|천원|만원)|세\b|플랜/.test(context);
    const coverageOnlyLine = /가입금액|보장금액|담보|진단비|수술비|입원비|생활비/.test(line) && !/보험료|월납|납입|합계보험료/.test(line);
    if (!premiumSignal || coverageOnlyLine) return;
    const amountMatches = [
      ...line.matchAll(/\d{1,3}(?:,\d{3})+\s*원/g),
      ...line.matchAll(/\d{1,3}(?:\.\d+)?\s*만\s*원/g),
      ...line.matchAll(/\b\d{1,3}(?:\.\d{1,2})?\b/g)
    ];
    amountMatches.forEach((match) => {
      const rawAmount = match[0];
      const prefixNearby = cleanText(line.slice(Math.max(0, (match.index || 0) - 48), match.index || 0));
      const premiumPrefix = /보험료|월납|납입|합계보험료/.test(prefixNearby);
      const coveragePrefix = /가입금액|보장금액|담보|진단비|수술비|입원비|입원일당|생활비|간병비|치료비/.test(prefixNearby);
      if (coveragePrefix && !premiumPrefix) return;
      const before = line[(match.index || 0) - 1] || '';
      const after = line[(match.index || 0) + rawAmount.length] || '';
      if (before === ',' || after === ',') return;
      const amount = normalizePolibotPremiumAmountText(rawAmount) || normalizePremiumByUnit(rawAmount, unit);
      if (!amount) return;
      const nearby = cleanText(line.slice(Math.max(0, (match.index || 0) - 80), Math.min(line.length, (match.index || 0) + rawAmount.length + 80)));
      if (/^\d{1,2}$/.test(rawAmount) && /세|년|월|회|%/.test(nearby)) return;
      const age = nearby.match(/(?:만\s*)?(\d{1,2})\s*세/)?.[1] || context.match(/(?:만\s*)?(\d{1,2})\s*세/)?.[1] || '';
      const gender = /남자|남성|\b남\b/.test(nearby) ? '남성' : /여자|여성|\b여\b/.test(nearby) ? '여성' : '';
      const plan = cleanText((nearby.match(/([A-Za-z가-힣0-9()·/-]{1,24}\s*(?:플랜|형|Plan|PLAN))/)?.[1] || '').replace(/^보험료\s*/, ''));
      const directProduct = productKey && normalizeProductKey(context).includes(productKey);
      rows.push({
        amount,
        rawText: rawAmount,
        age,
        gender,
        plan,
        unit,
        context: context.slice(0, 320),
        confidence: directProduct ? 'product_table_row' : age || gender || plan ? 'structured_table_row' : 'table_row',
        score: directProduct ? 92 : age || gender || plan ? 74 : 60
      });
    });
  });
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.amount}-${row.age}-${row.gender}-${row.plan}-${row.context}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);
}

export function extractPolibotPremiumCandidates(text = '', productName = '') {
  const source = cleanText(text);
  if (!source) return [];
  const productKey = normalizeProductKey(productName);
  const patterns = [
    /(?:보험료|월납|월\s*보험료|합계보험료|납입보험료)[^\n]{0,80}?(?:월\s*)?\d{1,3}(?:,\d{3})+\s*원/g,
    /(?:보험료|월납|월\s*보험료|합계보험료|납입보험료)[^\n]{0,80}?(?:월\s*)?\d{1,3}(?:\.\d+)?\s*만\s*원/g,
    /(?:월\s*)?\d{1,3}(?:,\d{3})+\s*원/g
  ];
  const rows = [];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const raw = match[0];
      const amount = normalizePolibotPremiumAmountText(raw);
      if (!amount) continue;
      const index = match.index || 0;
      const context = cleanText(source.slice(Math.max(0, index - 180), Math.min(source.length, index + raw.length + 220)));
      const contextKey = normalizeProductKey(context);
      const directProduct = productKey && contextKey.includes(productKey);
      const tableLike = /보험료\s*예시|월납|단위|남자|여자|40세|50세|60세/.test(context);
      rows.push({
        amount,
        rawText: raw.slice(0, 120),
        context: context.slice(0, 260),
        confidence: directProduct ? 'direct_context' : tableLike ? 'table_context' : 'nearby_amount',
        score: directProduct ? 90 : tableLike ? 62 : 46
      });
    }
  });
  extractPolibotPremiumTableRows(source, productName).forEach((row) => {
    rows.push({
      amount: row.amount,
      rawText: row.rawText,
      context: row.context,
      age: row.age,
      gender: row.gender,
      plan: row.plan,
      unit: row.unit,
      confidence: row.confidence,
      score: row.score
    });
  });
  const seen = new Set();
  return rows
    .filter((item) => {
      const key = `${item.amount}-${item.age || ''}-${item.gender || ''}-${item.plan || ''}-${item.context}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
