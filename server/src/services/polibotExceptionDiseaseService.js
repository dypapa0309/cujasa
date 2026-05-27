const COMPANY_ALIASES = [
  ['AIG', 'AIG손해보험'],
  ['DB손보', 'DB손해보험'],
  ['DB생명', 'DB생명'],
  ['KB손보', 'KB손해보험'],
  ['KB손해보험', 'KB손해보험'],
  ['KB라이프', 'KB라이프'],
  ['농협손보', 'NH농협손해보험'],
  ['농협생명', 'NH농협생명'],
  ['롯데손보', '롯데손해보험'],
  ['메리츠', '메리츠화재'],
  ['삼성화재', '삼성화재'],
  ['하나손보', '하나손해보험'],
  ['한화손보', '한화손해보험'],
  ['흥국화재', '흥국화재'],
  ['흥국생명', '흥국생명'],
  ['ABL', 'ABL생명'],
  ['교보생명', '교보생명'],
  ['라이나', '라이나생명'],
  ['미래에셋', '미래에셋생명'],
  ['농협생명', 'NH농협생명'],
  ['신한라이프', '신한라이프'],
  ['푸본현대', '푸본현대생명'],
  ['한화생명', '한화생명'],
  ['흥국생명', '흥국생명']
];

const KCD_CHAPTERS = [
  ['A', '감염성/기생충성 질환'],
  ['B', '감염성/기생충성 질환'],
  ['C', '악성신생물/암'],
  ['D', '신생물/혈액질환'],
  ['E', '내분비/영양/대사질환'],
  ['F', '정신/행동장애'],
  ['G', '신경계 질환'],
  ['H', '눈/귀 질환'],
  ['I', '순환계 질환'],
  ['J', '호흡계 질환'],
  ['K', '소화계 질환'],
  ['L', '피부/피하조직 질환'],
  ['M', '근골격계/결합조직 질환'],
  ['N', '비뇨생식계 질환'],
  ['O', '임신/출산 관련 질환'],
  ['P', '출생전후기 질환'],
  ['Q', '선천기형/염색체이상'],
  ['R', '증상/검사 이상소견'],
  ['S', '손상/중독/외인 결과'],
  ['T', '손상/중독/외인 결과'],
  ['U', '특수목적 코드'],
  ['V', '외인/교통사고'],
  ['W', '외인/사고'],
  ['X', '외인/사고'],
  ['Y', '외인/사고'],
  ['Z', '건강상태/보건서비스 접촉']
];

const DISEASE_CATEGORY_RULES = [
  ['암/종양', /암|악성|신생물|종양|림프종|백혈병|용종|폴립|낭종|혈관종|지방종|근종|선종/],
  ['심뇌혈관', /심근|협심|심장|부정맥|심부전|뇌경색|뇌출혈|뇌졸중|뇌혈관|혈전|순환계/],
  ['만성질환', /고혈압|당뇨|고지혈|지질|갑상선|통풍|신부전|간경화|천식/],
  ['근골격/상해', /골절|염좌|탈구|디스크|관절|인대|힘줄|척추|무릎|어깨|발목|손상|타박|상처|화상|무지외반|수근관|손목터널/],
  ['소화기', /위염|장염|식중독|담석|담낭|간염|치질|탈장|췌장|대장|항문|소화/],
  ['호흡기', /감기|인두염|편도염|기관지|폐렴|비염|부비동|인플루엔자|천식|호흡/],
  ['비뇨/생식', /방광|신우신염|전립선|난소|자궁|질염|고환|요로|생식|유방/],
  ['눈/귀', /결막|각막|백내장|녹내장|망막|안검|눈|귀|중이염|외이|청력/],
  ['피부', /피부|두드러기|사마귀|무좀|백선|습진|농가진|모낭|여드름/],
  ['감염성', /감염|콜레라|장티푸스|수두|홍역|풍진|대상포진|결핵|바이러스|세균|패혈증/]
];

function cleanText(value = '') {
  return String(value || '')
    .normalize('NFC')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeKcdCode(value = '') {
  const raw = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  const match = raw.match(/^([A-Z])(\d{2})(?:\.?([0-9A-Z]{1,2}))?$/);
  if (!match) return '';
  return `${match[1]}${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

function inferCompany(fileName = '', text = '') {
  const normalizedFileName = String(fileName || '').normalize('NFC');
  const fileNameMatch = COMPANY_ALIASES.find(([alias]) => normalizedFileName.includes(alias))?.[1];
  if (fileNameMatch) return fileNameMatch;
  const source = `${fileName}\n${text}`.normalize('NFC');
  return COMPANY_ALIASES.find(([alias]) => source.includes(alias))?.[1] || '';
}

function inferCarrierType(fileName = '', text = '') {
  const source = `${fileName}\n${text}`.normalize('NFC');
  if (/손보|손해|화재/.test(source)) return 'nonlife';
  if (/생보|생명|라이프/.test(source)) return 'life';
  return '';
}

function inferDocumentTopic(fileName = '', text = '') {
  const source = `${fileName}\n${String(text || '').slice(0, 3000)}`;
  if (/경증예외|예외질환|경미질환|경미한 질환/.test(source)) return 'exception_disease';
  if (/주요질병|인수기준|질병심사/.test(source)) return 'underwriting_disease_rule';
  return 'underwriting_reference';
}

function inferDisclosureTypes(text = '') {
  const source = String(text || '').normalize('NFC');
  const found = new Set();
  for (const match of source.matchAll(/\b([35])[.·ㆍ]?\s*(\d{1,2})[.·ㆍ]?\s*(\d{1,2})(?:[.·ㆍ]?\s*(\d{1,2}))?\b/g)) {
    const parts = [match[1], match[2], match[3], match[4]].filter(Boolean);
    found.add(parts.join('.'));
  }
  for (const match of source.matchAll(/\b(305|311|315|325|333|335|345|355|365|385|3105|31010|5105|51010)\b/g)) {
    const value = match[1];
    if (value === '3105') found.add('3.10.5');
    else if (value === '31010') found.add('3.10.10');
    else if (value === '5105') found.add('5.10.5');
    else if (value === '51010') found.add('5.10.10');
    else found.add(value.split('').join('.'));
  }
  return [...found].slice(0, 20);
}

function kcdChapter(code = '') {
  const letter = normalizeKcdCode(code).slice(0, 1);
  return KCD_CHAPTERS.find(([key]) => key === letter)?.[1] || '';
}

function diseaseCategory(name = '', code = '') {
  const byCode = kcdChapter(code);
  const byName = DISEASE_CATEGORY_RULES.find(([, pattern]) => pattern.test(name))?.[0] || '';
  return byName || byCode || '기타 질환';
}

function parseAdmissionDays(text = '') {
  const matches = [...String(text || '').matchAll(/(\d{1,3})\s*일\s*(?:이내|내)?/g)]
    .map((match) => Number(match[1]))
    .filter(Number.isFinite);
  return matches.length ? Math.max(...matches) : null;
}

function parseWaitingPeriod(text = '') {
  const source = String(text || '');
  const immediate = /즉시\s*인수|즉시가능|즉시\s*가능/.test(source);
  const months = source.match(/(\d{1,2})\s*개월\s*(?:초과|경과|이후)?/);
  const years = source.match(/(\d{1,2})\s*년\s*(?:초과|경과|이후)?/);
  if (immediate) return { value: 0, unit: 'none', label: '즉시인수' };
  if (months) return { value: Number(months[1]), unit: 'month', label: `${months[1]}개월` };
  if (years) return { value: Number(years[1]), unit: 'year', label: `${years[1]}년` };
  return null;
}

function eligibilityLevel(condition = '') {
  const text = String(condition || '');
  const hasAccept = /즉시\s*인수|즉시가능|청약가능|인수\s*가능|(?:^|[\s,])(?:O|Y|○|Ｏ)(?:$|[\s,()])/.test(text);
  const hasReview = /심사|의적|서류|부담보|담보제한|검토|문의|●|△/.test(text);
  const hasReject = /거절|불가|가입\s*제한|(?:^|[\s,])(?:X|N|×|Ｘ)(?:$|[\s,()])/.test(text);
  if (/즉시\s*인수|즉시가능/.test(text)) return hasReview || hasReject ? 'conditional_immediate' : 'immediate_accept';
  if (hasReview) return 'review_or_conditional';
  if (hasAccept && hasReject) return 'mixed_by_coverage';
  if (hasAccept) return 'acceptable';
  if (hasReject) return 'restricted';
  return 'unknown';
}

function isHeaderOrNoise(line = '') {
  return !line
    || /^[-–—]+$/.test(line)
    || /^-- \d+ of \d+ --$/.test(line)
    || /^(?:NO|No|순번|코드|KCD|kcd|대분류|구 분|질병명|※|□|●|★|Ex\))/.test(line)
    || /판매인 교육용|준법감시|무단|자료|가이드|유의사항|적용상품|예외질환개수/.test(line);
}

function splitNameAndCondition(rest = '') {
  const source = cleanText(rest);
  const conditionPattern = /\s(?:즉시\s*인수|즉시가능|즉시|청약가능|조건충족|완치\s*후|수술시|통원만가능|입원만|입원\s*\d|수술\s*\d|\d{1,3}\s*일\s*(?:이내|내)?|\d{1,2}\s*개월|\d{1,2}\s*년|[OX○×●YNＯＸ△](?:\s|$|\(|,|단)|거절|불가|부담보|의적|심사|검토|담보제한)/;
  const match = source.match(conditionPattern);
  if (!match || match.index < 1) return { diseaseName: source, conditionText: '' };
  return {
    diseaseName: source.slice(0, match.index).trim(),
    conditionText: source.slice(match.index).trim()
  };
}

function normalizeDiseaseName(value = '') {
  return cleanText(value)
    .replace(/^[.)\-\s]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function makeRecord({
  source = {},
  line = '',
  kcdCode = '',
  diseaseName = '',
  conditionText = '',
  rowNumber = 0,
  parser = ''
} = {}) {
  const normalizedCode = normalizeKcdCode(kcdCode);
  const name = normalizeDiseaseName(diseaseName);
  if (!name || name.length < 2) return null;
  if (/^(?:질병명|진단명|한글진단명|대표질병코드명|고지유형별|입원기간|인수여부)$/.test(name)) return null;
  const condition = cleanText(conditionText || line);
  return {
    id: [
      source.company || 'unknown',
      source.carrierType || 'unknown',
      normalizedCode || 'no-kcd',
      name,
      rowNumber
    ].join('|'),
    company: source.company || '',
    carrierType: source.carrierType || '',
    sourceFileName: source.fileName || '',
    sourceZip: source.sourceZip || '',
    documentTopic: source.documentTopic || '',
    disclosureTypes: source.disclosureTypes || [],
    kcdCode: normalizedCode,
    rawKcdCode: kcdCode || '',
    kcdChapter: kcdChapter(normalizedCode),
    diseaseName: name,
    aliases: name.split(/\s*,\s*|\/|·/).map((item) => cleanText(item)).filter((item) => item && item !== name).slice(0, 8),
    diseaseCategory: diseaseCategory(name, normalizedCode),
    eligibilityLevel: eligibilityLevel(condition),
    conditionText: condition.slice(0, 500),
    admissionDayLimit: parseAdmissionDays(condition),
    waitingPeriod: parseWaitingPeriod(condition),
    hasSurgeryLimit: /수술/.test(condition),
    hasAdmissionLimit: /입원/.test(condition),
    requiresReview: /심사|의적|서류|부담보|담보제한|검토|문의|●/.test(condition),
    rawLine: cleanText(line).slice(0, 800),
    rowNumber,
    parser
  };
}

function parseCodedDiseaseRows(lines = [], source = {}) {
  const rows = [];
  lines.forEach((line, index) => {
    const value = cleanText(line);
    if (isHeaderOrNoise(value)) return;
    const match = value.match(/^(?:\d{1,5}\s+)?([A-Z]\d{2}(?:\.?\d{1,2})?)\s+(.+)$/i);
    if (!match) return;
    const { diseaseName, conditionText } = splitNameAndCondition(match[2]);
    const record = makeRecord({
      source,
      line: value,
      kcdCode: match[1],
      diseaseName,
      conditionText,
      rowNumber: index + 1,
      parser: 'coded-row'
    });
    if (record) rows.push(record);
  });
  return rows;
}

function parseNonCodedDiseaseRows(lines = [], source = {}) {
  const rows = [];
  lines.forEach((line, index) => {
    const value = cleanText(line);
    if (isHeaderOrNoise(value)) return;
    const match = value.match(/^\d{1,5}\s+(.+?)\s+(입원\s*,\s*수술|입원|수술|통원)\s+([0-9,\s]+|[-])\s+(.+)$/);
    if (!match) return;
    const diseaseName = match[1];
    const conditionText = [match[2], match[3], match[4]].filter(Boolean).join(' ');
    const record = makeRecord({
      source,
      line: value,
      diseaseName,
      conditionText,
      rowNumber: index + 1,
      parser: 'uncoded-treatment-row'
    });
    if (record) rows.push(record);
  });
  return rows;
}

function looksLikeTableDiseaseName(name = '') {
  const value = cleanText(name);
  return value.length >= 2
    && value.length <= 90
    && /[가-힣]/.test(value)
    && !/^[*·ㆍ☞ㅁoO0-9()[\]\s-]/.test(value)
    && !/[?:]/.test(value)
    && !/[ＯＸ△○×●]\s*$/.test(value)
    && !/자료|상품|가이드|고지|알릴|질문|조건|예외질환|경우|해당|기준|리스트|가능|불가|인수|심사|담보|치료종결|치료기간|치료내용|다음날|여부|특별승인/.test(value);
}

function parseConditionTableRows(lines = [], source = {}) {
  const rows = [];
  lines.forEach((line, index) => {
    const value = cleanText(line);
    if (isHeaderOrNoise(value)) return;
    if (/^[A-Z]\d{2}/i.test(value) || /^\d{1,5}\s+[A-Z]\d{2}/i.test(value)) return;
    if (!/(즉시|조건충족|완치\s*후|인수|불가|거절|부담보|의적|서류|담보제한|[OX○×●ＯＸ△]\s|[0-9]{1,3}\s*일\s*(?:이내|내)|[0-9]{1,2}\s*개월|[0-9]{1,2}\s*년)/.test(value)) return;
    const { diseaseName, conditionText } = splitNameAndCondition(value);
    if (!conditionText || !looksLikeTableDiseaseName(diseaseName)) return;
    const record = makeRecord({
      source,
      line: value,
      diseaseName,
      conditionText,
      rowNumber: index + 1,
      parser: 'condition-table-row'
    });
    if (record) rows.push(record);
  });
  return rows;
}

function dedupeRecords(records = []) {
  const seen = new Map();
  for (const record of records) {
    const key = [
      record.company,
      record.carrierType,
      record.kcdCode || '',
      record.diseaseName,
      record.conditionText
    ].join('|');
    if (!seen.has(key)) {
      seen.set(key, record);
      continue;
    }
    const current = seen.get(key);
    if ((record.rawLine || '').length > (current.rawLine || '').length) seen.set(key, { ...current, ...record });
  }
  return [...seen.values()].map((record, index) => ({ ...record, id: `polibot-exception-disease-${index + 1}` }));
}

export function normalizePolibotExceptionDiseaseSource({
  fileName = '',
  sourceZip = '',
  text = '',
  size = 0,
  fileType = ''
} = {}) {
  const cleanFileName = cleanText(fileName);
  const cleanSourceText = cleanText(text);
  return {
    fileName: cleanFileName,
    sourceZip,
    size,
    fileType,
    company: inferCompany(cleanFileName, cleanSourceText),
    carrierType: inferCarrierType(`${sourceZip} ${cleanFileName}`, cleanSourceText),
    documentTopic: inferDocumentTopic(cleanFileName, cleanSourceText),
    disclosureTypes: inferDisclosureTypes(`${cleanFileName}\n${cleanSourceText.slice(0, 12000)}`),
    textLength: cleanSourceText.length
  };
}

export function extractPolibotExceptionDiseases({ source = {}, text = '' } = {}) {
  const lines = cleanText(text).split(/\r?\n/).map(cleanText).filter(Boolean);
  return dedupeRecords([
    ...parseCodedDiseaseRows(lines, source),
    ...parseNonCodedDiseaseRows(lines, source),
    ...parseConditionTableRows(lines, source)
  ]);
}

export function summarizePolibotExceptionDiseases(sources = [], diseases = []) {
  const byCompany = {};
  const byCategory = {};
  const byEligibility = {};
  const byCarrierType = {};
  for (const item of diseases) {
    byCompany[item.company || '미분류'] = (byCompany[item.company || '미분류'] || 0) + 1;
    byCategory[item.diseaseCategory || '기타'] = (byCategory[item.diseaseCategory || '기타'] || 0) + 1;
    byEligibility[item.eligibilityLevel || 'unknown'] = (byEligibility[item.eligibilityLevel || 'unknown'] || 0) + 1;
    byCarrierType[item.carrierType || 'unknown'] = (byCarrierType[item.carrierType || 'unknown'] || 0) + 1;
  }
  return {
    sourceCount: sources.length,
    diseaseCount: diseases.length,
    codedDiseaseCount: diseases.filter((item) => item.kcdCode).length,
    uncodedDiseaseCount: diseases.filter((item) => !item.kcdCode).length,
    companies: Object.keys(byCompany).sort((a, b) => a.localeCompare(b, 'ko')),
    byCarrierType,
    byCompany,
    byCategory,
    byEligibility
  };
}
