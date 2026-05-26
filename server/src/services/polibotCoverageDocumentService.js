import { extractPolibotTextFromBuffer } from './polibotKnowledgeService.js';

const COVERAGE_TARGETS = [
  { key: 'cancer', label: '암 진단비', patterns: [/일반암\s+([^\n]+)/, /암진단(?:비)?\s+([^\n]+)/], detailPatterns: [/일반암|암\s*진단비|암진단/], excludeDetailPatterns: [/유사암(?!\s*제외)|소액암|고액암|항암|암수술|암통원/] },
  { key: 'similarCancer', label: '유사암', patterns: [/유사암\s+([^\n]+)/, /소액암\s+([^\n]+)/], detailPatterns: [/유사암|소액암/] },
  { key: 'brain', label: '뇌혈관/뇌졸중', patterns: [/뇌혈관질환\s+([^\n]+)/, /뇌졸중\s+([^\n]+)/, /뇌출혈\s+([^\n]+)/], detailPatterns: [/뇌혈관질환|뇌졸중|뇌출혈/] },
  { key: 'heart', label: '허혈성/심근경색', patterns: [/허혈성심장질환\s+([^\n]+)/, /급성심근경색증\s+([^\n]+)/], detailPatterns: [/허혈성심장질환|허혈성심질환|급성심근경색/] },
  { key: 'surgery', label: '수술비', patterns: [/질병수술비\s+([^\n]+)/, /상해수술비\s+([^\n]+)/, /암수술비\s+([^\n]+)/], detailPatterns: [/질병.*수술비|상해.*수술비|암.*수술비/] },
  { key: 'hospital', label: '입원일당', patterns: [/질병입원일당\s+([^\n]+)/, /상해입원일당\s+([^\n]+)/], detailPatterns: [/질병입원일당|상해입원일당|입원일당/] },
  { key: 'medical', label: '실손/실비', patterns: [/상해입원의료비\s+([^\n]+)/, /질병입원의료비\s+([^\n]+)/, /상해통원의료비\s+([^\n]+)/, /질병통원의료비\s+([^\n]+)/], detailPatterns: [/입원의료비|통원의료비|실손|상해\+질병/] },
  { key: 'care', label: '간병/치매', patterns: [/장기요양간병비\s+([^\n]+)/, /경증치매진단\s+([^\n]+)/, /간병인\/간호간병질병일당\s+([^\n]+)/], detailPatterns: [/장기요양|간병|치매/] },
  { key: 'death', label: '사망/후유장해', patterns: [/질병사망\s+([^\n]+)/, /상해사망\s+([^\n]+)/, /후유장해\s+([^\n]+)/], detailPatterns: [/질병사망|상해사망|후유장해|장해/] },
  { key: 'driver', label: '운전자', patterns: [/교통사고처리지원금\s+([^\n]+)/, /변호사선임비용\s+([^\n]+)/, /벌금\(대인\/스쿨존\/대물\)\s+([^\n]+)/], detailPatterns: [/교통사고처리지원금|변호사선임|벌금|운전자/] }
];

const COMPANY_PATTERN = /(삼성화재|현대해상|DB손보|DB생명|KB손보|KB라이프|메리츠화재|한화손보|한화생명|흥국화재|흥국생명|미래에셋생명|교보생명|라이나생명|라이나손보|신한라이프|신한ez손보|롯데손보|농협손보|농협생명|하나손보|하나생명|동양생명|AIA생명|ABL생명|KDB생명|푸본현대생명|메트라이프|우정사업본부)/;

function compact(value = '') {
  return String(value || '')
    .replace(/메리츠화\s+재/g, '메리츠화재')
    .replace(/미래에셋\s+생명/g, '미래에셋생명')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(text = '', patterns = []) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function parseAmountToken(value = '') {
  const text = compact(value);
  if (!text || text.startsWith('-')) return '';
  const token = text.match(/(?:\d+\s*억\s*)?(?:\d{1,3}(?:,\d{3})*|\d+)(?:\.\d+)?\s*(?:만|원)?/)?.[0] || '';
  return compact(token.replace(/원$/, ''));
}

function parseWonNumber(value = '') {
  const number = String(value || '').replace(/[^\d]/g, '');
  return number ? Number(number) : 0;
}

function parsePremiumValue(value = '') {
  const text = compact(value);
  if (!text) return '';
  if (/보험료미제공/.test(text)) return '보험료미제공';
  const won = parseWonNumber(text);
  return won ? String(won / 10000).replace(/\.0$/, '') : '';
}

function cleanProductName(value = '') {
  return compact(value)
    .replace(/\s*\(\d+\/\d+\)\s*$/g, '')
    .replace(/^[\s·ㆍ,/-]+/, '');
}

function normalizeLines(text = '') {
  return String(text || '').split(/\r?\n/).map((line) => compact(line)).filter(Boolean);
}

function extractCustomerBasics(text = '', fileName = '') {
  const normalized = compact(text);
  const profileMatch = normalized.match(/([가-힣]{2,5})\s*\((\d{1,3})세\s*,\s*(남자|여자|남성|여성)\)/);
  const titleMatch = normalized.match(/([가-힣]{2,5})\s*님의\s*(?:건강|전체|상품별|보장)/);
  const fileNameMatch = String(fileName || '').normalize('NFC').match(/([가-힣]{2,5})(?:님)?\s*(?:보장분석|현재|증권|\.pdf)/);
  const gender = profileMatch?.[3] || '';
  return {
    name: profileMatch?.[1] || titleMatch?.[1] || fileNameMatch?.[1] || '',
    age: profileMatch?.[2] || '',
    gender: /여/.test(gender) ? '여성' : /남/.test(gender) ? '남성' : ''
  };
}

function extractPolicyDetails(text = '') {
  const lines = normalizeLines(text);
  const startIndex = lines.findIndex((line) => /전체\s*계약리스트/.test(line));
  const scopedLines = startIndex >= 0 ? lines.slice(startIndex + 1) : lines;
  const endIndex = scopedLines.findIndex((line) => /상품별\s*가입현황|실효\/해지계약현황|전체\s*보장현황/.test(line));
  const activeLines = (endIndex >= 0 ? scopedLines.slice(0, endIndex) : scopedLines)
    .filter((line) => !/기준담보|권장금액|사업단|지점|^\d+\/\d+$|^--/.test(line))
    .filter((line) => !/^\d{4}[-.]\d{2}[-.]\d{2}\s+\d{1,2}:\d{2}/.test(line))
    .filter((line) => !/^\d+(?:\s+\d+)*$/.test(line));
  const blocks = [];
  let current = [];
  for (const line of activeLines) {
    if (/^\d{1,2}\s+/.test(line)) {
      if (current.length) blocks.push(current);
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current);
  const rows = [];
  const supplements = extractPolicyDetailSupplements(text);
  for (const block of blocks) {
    if (rows.length >= 12) break;
    const normalized = compact(block.join(' '));
    const match = normalized.match(/^\d{1,2}\s+(.+?)\s+(\d{4}[-.]\d{2}[-.]\d{2})\s+(?:(월납|일시납)\s+)?([0-9]+년|[0-9]+년납|0년)?\s*([0-9]+세|[0-9]+년|종신)?\s+((?:\d{1,3},)*\d{1,3}원|보험료미제공)/);
    if (!match) continue;
    const raw = compact(match[1]);
    const company = raw.match(COMPANY_PATTERN)?.[1] || '';
    const productName = cleanProductName(company ? raw.replace(company, '') : raw);
    const row = {
      company,
      productName,
      startDate: match[2].replace(/\./g, '-'),
      renewalType: '',
      premium: parsePremiumValue(match[6]),
      paymentPeriod: match[4] || '',
      maturity: match[5] || '',
      status: '유지 검토'
    };
    const supplement = findPolicySupplement(row, supplements);
    const merged = {
      ...row,
      productName: supplement?.productName && supplement.productName.length > row.productName.length ? cleanProductName(supplement.productName) : row.productName,
      premium: row.premium || supplement?.premium || '',
      paymentPeriod: supplement?.paymentPeriod || row.paymentPeriod,
      maturity: supplement?.maturity || row.maturity,
      status: row.premium === '보험료미제공' || supplement?.premium === '보험료미제공' ? '보험료 확인 필요' : row.status
    };
    if (!rows.some((item) => item.company === merged.company && item.productName === merged.productName && item.startDate === merged.startDate)) {
      rows.push(merged);
    }
  }
  return rows;
}

function extractPolicyDetailSupplements(text = '') {
  const lines = normalizeLines(text);
  const rows = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^(.+?)\s*\|\s*가입일자\s*:\s*(\d{4}[-.]\d{2}[-.]\d{2})\s*\|/);
    if (!header) continue;
    const company = compact(header[1]);
    const startDate = header[2].replace(/\./g, '-');
    const productParts = [];
    let paymentPeriod = '';
    let maturity = '';
    let premium = '';
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 12); cursor += 1) {
      const line = lines[cursor];
      if (/^.+?\s*\|\s*가입일자\s*:/.test(line) || /^--\s*\d+\s+of\s+\d+\s*--/.test(line)) break;
      if (/^\d+\s+(?:정액|실손)/.test(line)) break;
      const periodMatch = line.match(/(?:(\d+년)납)?\/(?:[^/]*\/)?(?:(\d+년)\/)?(\d+세|종신)만기/);
      if (periodMatch) {
        paymentPeriod = periodMatch[1] || periodMatch[2] || paymentPeriod;
        maturity = periodMatch[3] || maturity;
        continue;
      }
      const rangeMatch = line.match(/(\d{4}[-.]\d{2}[-.]\d{2})~(\d{4}[-.]\d{2}[-.]\d{2})\s+((?:\d{1,3},)*\d{1,3}원|보험료미제공)/);
      if (rangeMatch) {
        premium = parsePremiumValue(rangeMatch[3]);
        continue;
      }
      if (/기준담보|권장금액|사업단|지점|상품별|담보별/.test(line)) continue;
      if (/^\(\d+\/\d+\)$/.test(line)) continue;
      if (!/\d{4}[-.]\d{2}[-.]\d{2}/.test(line)) productParts.push(line);
    }
    const productName = cleanProductName(compact(productParts.join(' ')).replace(/^\/?[^/\s]{2,5}\/[^/\s]{2,5}\s*/, ''));
    if (company || productName || startDate) {
      rows.push({ company, productName, startDate, premium, paymentPeriod, maturity });
    }
  }
  return rows;
}

function findPolicySupplement(row = {}, supplements = []) {
  const normalizedProduct = compact(row.productName).replace(/\s/g, '');
  return supplements.find((item) => (
    item.startDate === row.startDate
    && (!row.company || !item.company || item.company === row.company)
  )) || supplements.find((item) => {
    const candidateProduct = compact(item.productName).replace(/\s/g, '');
    return candidateProduct && normalizedProduct && (
      candidateProduct.includes(normalizedProduct.slice(0, 12))
      || normalizedProduct.includes(candidateProduct.slice(0, 12))
    );
  });
}

function extractCoverage(text = '') {
  return Object.fromEntries(COVERAGE_TARGETS.map((target) => {
    const raw = firstMatch(text, target.patterns);
    const amount = parseAmountToken(raw);
    const detailLines = extractCoverageDetailLines(text, target);
    return [target.key, {
      amount,
      renewalType: summarizeRenewalType(detailLines),
      maturity: summarizeMaturity(detailLines),
      note: ''
    }];
  }));
}

function extractCoverageDetailLines(text = '', target = {}) {
  const patterns = target.detailPatterns || target.patterns || [];
  const excludes = target.excludeDetailPatterns || [];
  return normalizeLines(text).filter((line) => (
    patterns.some((pattern) => pattern.test(line))
    && !excludes.some((pattern) => pattern.test(line))
    && (/\d{4}[-.]\d{2}[-.]\d{2}/.test(line) || /\[(?:비)?갱신형/.test(line))
  ));
}

function summarizeRenewalType(lines = []) {
  const hasNonRenewal = lines.some((line) => /비갱신/.test(line));
  const hasRenewal = lines.some((line) => /(^|[^비])갱신형/.test(line));
  if (hasRenewal && hasNonRenewal) return '혼합(갱신/비갱신)';
  if (hasRenewal) return '갱신형';
  if (hasNonRenewal) return '비갱신형';
  return '';
}

function summarizeMaturity(lines = []) {
  const years = new Set();
  for (const line of lines) {
    const matches = [...line.matchAll(/\d{4}[-.]\d{2}[-.]\d{2}\s+(\d{4})[-.]\d{2}[-.]\d{2}/g)];
    matches.forEach((match) => years.add(match[1]));
  }
  const sortedYears = [...years].sort();
  if (sortedYears.length === 0) return '';
  if (sortedYears.length === 1) return `${sortedYears[0]}년`;
  return `${sortedYears[0]}년~${sortedYears[sortedYears.length - 1]}년`;
}

function formatPolicyPremiumLabel(premium = '') {
  const text = compact(premium);
  if (!text) return '';
  return text === '보험료미제공' ? text : `월 ${text}만원`;
}

function extractDisclosure(text = '') {
  const lines = normalizeLines(text);
  const hiraSummary = buildHiraVisitDisclosureSummary(lines);
  const normalizedText = String(text || '').normalize('NFC');
  const isCustomerCoverageDocument = /전체\s*계약|계약\s*리스트|보장\s*현황|가입\s*현황|기준\s*담보|권장\s*금액/.test(normalizedText);
  const isHiraDocument = /순번\s*병[·ㆍ\w\s]*의원[&/·ㆍ\w\s]*약국|요양급여비용|진료정보요약|건강보험\s*등\s*혜택받은\s*금액/.test(normalizedText);
  if (isCustomerCoverageDocument) {
    return {
      recent3Months: '',
      recent1Year: '',
      recent5Years: '',
      recentExam: '',
      admissionSurgery: '',
      longTreatment: '',
      longMedication: '',
      currentMedication: '',
      majorDisease: '',
      completeCure: '',
      followUp: '',
      details: ''
    };
  }
  const looksLikeCoverageBenefitLine = (line = '') => /전체\s*보장현황|상품별\s*가입현황|기준담보|권장금액|가입금액|보험료|담보|진단비|수술비|입원일당|의료비|실손|일반암|유사암|고액암|항암|뇌\/심장|뇌혈관|뇌졸중|뇌출혈|허혈성|심근경색|경증치매진단|장기요양|후유장해|운전자|교통사고|벌금|변호사선임|상해|질병/i.test(line);
  const medicalLines = lines
    .filter((line) => /고지|병력|입원|수술|투약|복용|치료|진단|검사|재검|추적|관찰|혈압|당뇨|고지혈|골절|백내장|암|심장|뇌/.test(line))
    .filter((line) => !/순번\s*병|본\s*자료는|요양급여|상품별 가입현황|전체 보장현황|기준담보|소식지|영업이슈/.test(line))
    .filter((line) => !looksLikeCoverageBenefitLine(line))
    .slice(0, 12);
  const joined = medicalLines.join(' / ');
  return {
    recent3Months: isHiraDocument ? '심평원 자료 제외 · 최근 3개월 문진 필요' : '',
    recent1Year: '',
    recent5Years: hiraSummary.recent5Years || joined,
    recentExam: [hiraSummary.recentExam, medicalLines.filter((line) => /검사|재검|추적|관찰|소견/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    admissionSurgery: [hiraSummary.admissionSurgery, medicalLines.filter((line) => /입원|수술|시술/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    longTreatment: [hiraSummary.longTreatment, medicalLines.filter((line) => /치료/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    longMedication: [hiraSummary.longMedication, medicalLines.filter((line) => /투약|복용|약/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    currentMedication: [hiraSummary.currentMedication, medicalLines.filter((line) => /투약|복용|약|혈압|당뇨|고지혈/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    majorDisease: [hiraSummary.majorDisease, medicalLines.filter((line) => /암|심장|뇌|당뇨|혈압|고지혈/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    completeCure: '',
    followUp: [hiraSummary.followUp, medicalLines.filter((line) => /추적|관찰|재검/.test(line)).join(' / ')].filter(Boolean).join(' / '),
    healthyDisclosureCheck: hiraSummary.healthyDisclosureCheck || '',
    hiraDocumentTypes: hiraSummary.documentTypes || [],
    details: [hiraSummary.details, joined].filter(Boolean).join('\n')
  };
}

function parseHiraVisitRows(lines = []) {
  return lines
    .map((line) => {
      const match = compact(line).match(/^(\d{1,3})\s+(.+?)\s+(\d+)\((\d+)\)\s+[\d,]+\s+[\d,]+\s+[\d,]+$/);
      if (!match) return null;
      const provider = compact(match[2]);
      if (!provider || /순번|본\s*자료|합계/.test(provider)) return null;
      return {
        index: Number(match[1]),
        provider,
        inpatientDays: Number(match[3] || 0),
        outpatientDays: Number(match[4] || 0)
      };
    })
    .filter(Boolean);
}

function classifyHiraDocumentTypes(lines = []) {
  const text = lines.join(' ');
  const types = [];
  const add = (type) => {
    if (type && !types.includes(type)) types.push(type);
  };
  if (/기본\s*진료\s*정보|진료정보요약|병[·ㆍ\w\s]*의원|요양기관|진료\s*내역|입원\(외래\)일수/.test(text)) add('기본진료정보');
  if (/약제\s*정보|처방\s*약|조제|투약|약국|처방전|일분|복약/.test(text)) add('약제정보');
  if (/진료비|요양급여비용|본인부담|공단부담|혜택받은\s*금액/.test(text)) add('진료비정보');
  if (/상병|질병\s*코드|KCD|주상병|부상병/.test(text)) add('상병정보');
  return types.length ? types : ['심평원자료'];
}

function maxNumberForPatterns(text = '', patterns = []) {
  let max = 0;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1] || 0);
      if (Number.isFinite(value) && value > max) max = value;
    }
  }
  return max;
}

function inferHiraMedicationDays(lines = [], pharmacyRows = []) {
  const text = lines.join(' ');
  const explicitDays = maxNumberForPatterns(text, [
    /(?:총\s*)?(?:투약|처방|복약|조제)\s*(?:일수|기간)?\s*[:：]?\s*(\d{1,3})\s*일/g,
    /(\d{1,3})\s*일분/g,
    /(\d{1,3})\s*일\s*(?:처방|투약|복용|복약|조제)/g
  ]);
  if (explicitDays) return explicitDays;
  return pharmacyRows.reduce((sum, row) => sum + Number(row.outpatientDays || 0), 0);
}

function buildHiraVisitDisclosureSummary(lines = []) {
  const rows = parseHiraVisitRows(lines);
  const documentTypes = classifyHiraDocumentTypes(lines);
  if (!rows.length) {
    const text = lines.join(' ');
    const medicationDays = inferHiraMedicationDays(lines, []);
    const treatmentCount = maxNumberForPatterns(text, [
      /(?:치료|진료|외래|통원)\s*(?:횟수|건수)?\s*[:：]?\s*(\d{1,3})\s*(?:회|건|일)/g,
      /(\d{1,3})\s*(?:회|건|일)\s*(?:치료|진료|외래|통원)/g
    ]);
    return {
      documentTypes,
      healthyDisclosureCheck: [
        `심평원 자료종류: ${documentTypes.join(', ')}`,
        treatmentCount ? `건강체 고지 체크: 치료횟수 ${treatmentCount}회${treatmentCount >= 7 ? ' · 7회 이상 치료 확인' : ''}` : '',
        medicationDays ? `건강체 고지 체크: 투약일수 ${medicationDays}일${medicationDays >= 30 ? ' · 30일 이상 투약 확인' : ''}` : ''
      ].filter(Boolean).join('\n'),
      longTreatment: treatmentCount >= 7 ? `건강체 기준 7회 이상 치료 확인: ${treatmentCount}회` : '',
      longMedication: medicationDays >= 30 ? `건강체 기준 30일 이상 투약 확인: ${medicationDays}일` : '',
      currentMedication: medicationDays ? `투약일수 ${medicationDays}일 확인` : '',
      details: [
        `심평원 자료종류: ${documentTypes.join(', ')}`,
        treatmentCount ? `치료횟수 ${treatmentCount}회` : '',
        medicationDays ? `투약일수 ${medicationDays}일` : ''
      ].filter(Boolean).join('\n')
    };
  }
  const providers = [...new Set(rows.map((row) => row.provider))];
  const pharmacyRows = rows.filter((row) => /약국/.test(row.provider));
  const medicalRows = rows.filter((row) => !/약국/.test(row.provider));
  const inpatientRows = rows.filter((row) => row.inpatientDays > 0);
  const outpatientTotal = rows.reduce((sum, row) => sum + row.outpatientDays, 0);
  const inpatientTotal = rows.reduce((sum, row) => sum + row.inpatientDays, 0);
  const treatmentCount = medicalRows.reduce((sum, row) => sum + Number(row.outpatientDays || 0), 0);
  const medicationDays = inferHiraMedicationDays(lines, pharmacyRows);
  const departmentTerms = [
    '정형외과', '내과', '가정의학과', '소아청소년과', '치과', '안과', '한방병원',
    '이비인후과', '피부과', '신경외과', '통증의학과', '산부인과', '비뇨의학과'
  ].filter((term) => providers.some((provider) => provider.includes(term)));
  const notableProviders = providers
    .filter((provider) => !/약국/.test(provider))
    .slice(0, 8);
  const pharmacyProviders = pharmacyRows.map((row) => row.provider).slice(0, 6);
  return {
    documentTypes,
    recent5Years: [
      `심평원 자료종류: ${documentTypes.join(', ')}`,
      `심평원 5년 자료 기준 의료기관/약국 이용 ${rows.length}건`,
      medicalRows.length ? `의료기관 ${medicalRows.length}건` : '',
      pharmacyRows.length ? `약국 ${pharmacyRows.length}건` : '',
      outpatientTotal ? `외래 ${outpatientTotal}일` : '',
      inpatientTotal ? `입원 ${inpatientTotal}일` : '',
      treatmentCount ? `치료횟수 ${treatmentCount}회` : '',
      medicationDays ? `투약일수 ${medicationDays}일` : ''
    ].filter(Boolean).join(' · '),
    recentExam: departmentTerms.length ? `진료과/기관명 기준 확인: ${departmentTerms.join(', ')}` : '',
    admissionSurgery: inpatientRows.length
      ? `입원일수 확인: ${inpatientRows.map((row) => `${row.provider} ${row.inpatientDays}일`).join(' / ')}`
      : '',
    longTreatment: treatmentCount >= 7 || outpatientTotal >= 10 || medicalRows.length >= 10
      ? `${treatmentCount >= 7 ? `건강체 기준 7회 이상 치료 확인: ${treatmentCount}회` : '외래 이용 다수'}${notableProviders.length ? `: ${notableProviders.join(' / ')}` : ''}`
      : '',
    longMedication: medicationDays >= 30 || pharmacyRows.length >= 3 ? `${medicationDays >= 30 ? `건강체 기준 30일 이상 투약 확인: ${medicationDays}일` : `약국 이용 ${pharmacyRows.length}건`}${pharmacyProviders.length ? `: ${pharmacyProviders.join(' / ')}` : ''}` : '',
    currentMedication: pharmacyRows.length || medicationDays ? [`약국 청구 이력 확인: ${pharmacyProviders.join(' / ')}`, medicationDays ? `투약일수 ${medicationDays}일` : ''].filter(Boolean).join(' · ') : '',
    majorDisease: departmentTerms.length ? `진료과 패턴: ${departmentTerms.join(', ')}` : '',
    followUp: rows.some((row) => /정형외과|내과|안과|한방병원/.test(row.provider))
      ? '진료과별 반복 방문 여부 상담 확인 필요'
      : '',
    healthyDisclosureCheck: [
      `심평원 자료종류: ${documentTypes.join(', ')}`,
      treatmentCount ? `건강체 고지 체크: 치료횟수 ${treatmentCount}회${treatmentCount >= 7 ? ' · 7회 이상 치료 확인' : ''}` : '',
      medicationDays ? `건강체 고지 체크: 투약일수 ${medicationDays}일${medicationDays >= 30 ? ' · 30일 이상 투약 확인' : ''}` : ''
    ].filter(Boolean).join('\n'),
    details: rows
      .slice(0, 20)
      .map((row) => `${row.provider} · 입원 ${row.inpatientDays}일 · 외래 ${row.outpatientDays}일`)
      .join('\n')
  };
}

function buildMedicalHistorySummary(disclosureDetails = {}) {
  const values = [
    disclosureDetails.recent5Years,
    disclosureDetails.healthyDisclosureCheck,
    disclosureDetails.currentMedication,
    disclosureDetails.admissionSurgery,
    disclosureDetails.recentExam,
    disclosureDetails.followUp,
    disclosureDetails.majorDisease,
    disclosureDetails.details
  ].map((value) => compact(value)).filter(Boolean);
  return [...new Set(values)].join('\n').slice(0, 4000);
}

function inferNeeds(currentCoverage = {}) {
  const needs = [];
  const amountNumber = (key) => Number(String(currentCoverage[key]?.amount || '').replace(/[^\d.]/g, '')) || 0;
  if (amountNumber('cancer') < 5000) needs.push('암');
  if (amountNumber('brain') < 2000) needs.push('뇌');
  if (amountNumber('heart') < 2000) needs.push('심장');
  if (amountNumber('surgery') < 100) needs.push('수술');
  if (!amountNumber('medical')) needs.push('실손');
  if (!amountNumber('driver')) needs.push('운전자');
  return [...new Set(needs)];
}

function buildAnalysisResult(currentCoverage = {}, policyDetails = []) {
  const needs = inferNeeds(currentCoverage);
  const premiumTotal = policyDetails.reduce((sum, item) => sum + (Number(item.premium || 0) || 0), 0);
  return {
    gaps: needs.length ? `${needs.join(', ')} 보장 보완 후보` : 'PDF 기준 주요 보장 공백은 크지 않음',
    duplicates: '상품별 중복 담보는 상담자가 최종 확인 필요',
    premiumIssue: premiumTotal ? `현재 월 보험료 약 ${Math.round(premiumTotal * 10) / 10}만원` : '',
    keepList: policyDetails.slice(0, 4).map((item) => [item.company, item.productName].filter(Boolean).join(' ')).filter(Boolean).join(' / '),
    remodelList: needs.length ? `${needs.join(', ')} 중심 보완 또는 기존 계약 리모델링 검토` : '기존 계약 유지 중심으로 보험료/중복 담보 점검',
    caution: 'PDF 자동추출 값은 증권 원문과 고지사항을 상담자가 최종 확인'
  };
}

function classifyPolibotDocument(text = '', fileName = '', values = {}) {
  const normalized = compact(text);
  const name = String(fileName || '').normalize('NFC');
  const policyCount = Array.isArray(values.existingPolicyDetails) ? values.existingPolicyDetails.length : 0;
  const coverageCount = Object.values(values.currentCoverage || {}).filter((item) => item?.amount).length;
  const hasCustomerTitle = /[가-힣]{2,5}\s*(?:님|고객)의\s*(?:건강|전체|상품별|보장)/.test(normalized);
  const hasCoverageStructure = /전체\s*보장현황|담보별\s*가입\s*현황|전체\s*계약리스트|상품별\s*가입현황/.test(normalized);
  const hasHiraStructure = /순번\s*병[·ㆍ\w\s]*의원[&/·ㆍ\w\s]*약국|요양급여비용|진료정보요약|건강보험\s*등\s*혜택받은\s*금액/.test(normalized);
  const hasSalesMaterialSignal = /GA\s*소식지|판매인\s*교육용|모집인\s*교육용|고객\s*제시\s*불가|고객제시불가|고객\s*교부.*금지|온라인\s*게시.*금지|영업\s*ISSUE|영업이슈|주간\s*이슈|주간포인트|상품\s*개요|준법감시/.test(normalized);
  const fileSuggestsCustomerCoverage = /보장분석|현재\s*2604|kb\s*버전|kb버젼/i.test(name);
  if (hasHiraStructure) {
    return {
      type: 'hira',
      label: '심평원 자료',
      customerCoverage: false,
      confidence: 'high',
      reasons: ['심평원 진료/약국 이용 표 구조 확인']
    };
  }
  if ((hasCustomerTitle && hasCoverageStructure) || (fileSuggestsCustomerCoverage && (policyCount > 0 || coverageCount >= 3))) {
    return {
      type: 'customer_coverage',
      label: '고객 보장분석',
      customerCoverage: true,
      confidence: policyCount > 0 && coverageCount >= 3 ? 'high' : 'medium',
      reasons: [
        hasCustomerTitle && '고객명 기반 보장분석 제목 확인',
        hasCoverageStructure && '전체 보장현황/계약리스트 구조 확인',
        policyCount > 0 && `기존계약 ${policyCount}개 추출`,
        coverageCount > 0 && `담보 ${coverageCount}개 추출`
      ].filter(Boolean)
    };
  }
  if (hasSalesMaterialSignal) {
    return {
      type: 'sales_material',
      label: '보험사 상품자료',
      customerCoverage: false,
      confidence: 'high',
      reasons: ['GA소식지/교육용/고객제시불가 문구 확인']
    };
  }
  return {
    type: 'unknown',
    label: '문서 유형 확인 필요',
    customerCoverage: false,
    confidence: policyCount > 0 || coverageCount >= 3 ? 'medium' : 'low',
    reasons: [
      policyCount > 0 && `기존계약 ${policyCount}개 추출`,
      coverageCount > 0 && `담보 ${coverageCount}개 추출`
    ].filter(Boolean)
  };
}

export function parsePolibotCoverageDocumentText(text = '', fileName = '') {
  const basics = extractCustomerBasics(text, fileName);
  const existingPolicyDetails = extractPolicyDetails(text);
  const currentCoverage = extractCoverage(text);
  const disclosureDetails = extractDisclosure(text);
  const needs = inferNeeds(currentCoverage);
  const totalPremium = existingPolicyDetails.reduce((sum, item) => sum + (Number(item.premium || 0) || 0), 0);
  return {
    ...basics,
    needs: needs.join(', '),
    existingPolicies: existingPolicyDetails.map((item) => [
      item.company,
      item.productName,
      formatPolicyPremiumLabel(item.premium),
      item.paymentPeriod,
      item.maturity
    ].filter(Boolean).join(' · ')).join('\n'),
    existingPolicyDetails,
    currentCoverage,
    existingMedicalPlan: currentCoverage.medical?.amount ? '있음' : '',
    existingPremium: totalPremium ? String(Math.round(totalPremium * 10) / 10) : '',
    medicalHistory: buildMedicalHistorySummary(disclosureDetails),
    disclosureDetails,
    underwritingAssessment: {
      route: Object.values(disclosureDetails).some(Boolean) ? '표준/간편 동시비교' : '표준심사 우선',
      standardPossible: '',
      burden: '',
      surcharge: '',
      simpleReview: Object.values(disclosureDetails).some(Boolean) ? '고지 상세 기준 간편심사 비교' : '',
      note: /심평원 자료 제외 · 최근 3개월 문진 필요/.test(disclosureDetails.recent3Months || '')
        ? '심평원 자료에는 최근 3개월 이력이 포함되지 않아 별도 문진 후 설계매니저 검수 필요'
        : ''
    },
    analysisResult: buildAnalysisResult(currentCoverage, existingPolicyDetails)
  };
}

function uniquePasswordCandidates(values = []) {
  return [...new Set(values
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function isPasswordError(error) {
  return error?.name === 'PasswordException' || /password/i.test(String(error?.message || ''));
}

async function extractCoverageTextWithPasswords(buffer, fileName, passwords = []) {
  const candidates = uniquePasswordCandidates(passwords);
  if (candidates.length === 0) return extractPolibotTextFromBuffer(buffer, fileName);
  let lastPasswordError = null;
  for (const password of candidates) {
    try {
      return await extractPolibotTextFromBuffer(buffer, fileName, { password });
    } catch (error) {
      if (!isPasswordError(error)) throw error;
      lastPasswordError = error;
    }
  }
  if (lastPasswordError) {
    const error = new Error('PDF 비밀번호가 올바르지 않습니다. 생년월일 6자리 또는 8자리인지 확인해주세요.');
    error.status = 422;
    error.code = 'PDF_PASSWORD_INVALID';
    throw error;
  }
  return '';
}

export async function analyzePolibotCoverageDocument({ fileName = '', base64 = '', mimeType = '', password = '', passwordCandidates = [] } = {}) {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) {
    const error = new Error('분석할 PDF 파일을 선택해 주세요.');
    error.status = 400;
    throw error;
  }
  let text = '';
  try {
    text = await extractCoverageTextWithPasswords(buffer, fileName, [password, ...passwordCandidates]);
  } catch (error) {
    if (!isPasswordError(error)) throw error;
    const next = new Error('PDF 비밀번호가 필요합니다. 생년월일 6자리 또는 8자리 비밀번호를 입력해주세요.');
    next.status = 422;
    next.code = 'PDF_PASSWORD_REQUIRED';
    throw next;
  }
  if (compact(text).length < 40) {
    const error = new Error('PDF 텍스트를 읽지 못했습니다. 스캔본이면 OCR 처리가 필요합니다.');
    error.status = 422;
    throw error;
  }
  const values = parsePolibotCoverageDocumentText(text, fileName);
  const extractedPolicyDetails = Array.isArray(values.existingPolicyDetails) ? values.existingPolicyDetails : [];
  const extractedCoverage = values.currentCoverage && typeof values.currentCoverage === 'object' ? values.currentCoverage : {};
  const document = classifyPolibotDocument(text, fileName, values);
  return {
    fileName,
    mimeType,
    document,
    values,
    confidence: {
      text: compact(text).length > 500 ? 'high' : 'medium',
      policies: extractedPolicyDetails.length ? 'high' : 'low',
      coverage: Object.values(extractedCoverage).filter((item) => item.amount).length >= 4 ? 'high' : 'medium',
      document: document.confidence
    },
    warnings: [
      document.type === 'sales_material' && '보험사 상품자료로 보입니다. 고객 보장분석 파일을 넣어주세요.',
      document.type === 'hira' && '심평원 자료는 최근 3개월 이력이 제외되므로 최근 3개월 문진 확인 후 추천 확정이 필요합니다.',
      document.type === 'unknown' && '고객 보장분석 문서인지 확인이 필요합니다.',
      extractedPolicyDetails.length === 0 && '계약리스트를 자동 추출하지 못했습니다.',
      Object.values(extractedCoverage).filter((item) => item.amount).length < 3 && '담보별 담보금액 추출이 적습니다.',
      /--\s*\d+\s+of\s+\d+\s*--/.test(text) ? '' : '페이지 구분이 없는 PDF라 일부 항목 검증이 필요합니다.'
    ].filter(Boolean),
    previewText: compact(text).slice(0, 1200)
  };
}
