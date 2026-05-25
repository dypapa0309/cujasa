import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import { readFileSync } from 'node:fs';
import {
  extractPolibotPremiumCandidates,
  extractPolibotPremiumTableRows
} from './polibotPremiumTableParser.js';

const INSURANCE_COMPANIES = [
  '삼성화재', '현대해상', 'KB손해보험', 'DB손해보험', '메리츠화재', '메리츠', '한화손해보험',
  '롯데손해보험', '흥국화재', 'NH농협손해보험', 'AIA', '메트라이프', '라이나', '교보생명',
  '한화생명', '삼성생명', 'DB생명', '동양생명', '신한라이프', '미래에셋생명', '글로벌금융판매', '인카금융서비스'
];

const COVERAGE_KEYWORDS = [
  '암', '유사암', '뇌', '심장', '질병', '상해', '수술', '입원', '통원', '실손', '실비',
  '간병', '치매', '운전자', '어린이', '태아', '정기보험', '종신보험', '납입면제', '고지', '유병자',
  '후유장해', '골절', '화상', '배상책임', '진단비', '생활비', '환급률'
];

const PRODUCT_GROUP_RULES = [
  ['운전자', /운전자|자동차|교통사고/],
  ['암/질병', /암|유사암|질병|진단비/],
  ['3대 질병', /3대|뇌|심장|급성심근|허혈|뇌혈관/],
  ['간병/치매', /간병|치매|요양/],
  ['실손', /실손|실비|통원|입원/],
  ['어린이/태아', /어린이|태아|자녀/],
  ['종신/정기', /종신|정기보험|사망|경영인/]
];

const GENERIC_PRODUCT_NAMES = new Set([
  '생명보험', '손해보험', '보험상품', '보장성보험', '보장성 보험', '종신보험', '정기보험',
  '건강보험', '암보험', '실손보험', '실비보험', '치매보험', '연금보험', '변액보험',
  '저축성보험', '장기종합보험', '어린이보험', '태아보험', '간편건강보험'
]);

const BAD_PRODUCT_PHRASE = /가이드북|자료이용|상품비교|자료모음|상품전략|금융환경|관심상품|영업이슈|보험의\s*A|상품의\s*기본|간추린|상품\s*안내|본\s*내용|예시된|따라서|고객\s*조건|보장분석|가입담보|님의\s*상품별|판매되고\s*있는|자료는\s*상품|보험이\s*어려운|알쓸신통|주요국가|기준금리|세계\s*경제뉴스|국내\s*경제뉴스|보험시장|비급여|데이터로\s*읽는|2030\s*보험|보험영업에서|반드시\s*챙겨야|사내\s*교육용|교육\s*목적|무단배포|경제뉴스|시장\s*선점|고객명|피보험자|현재\s*가입|증권|저는\s*보험|아참|받아봤고\s*보험|어떤\s*것들을\s*담보|생명\s*[·ㆍ]\s*손해보험|영업에서\s*반드시|카톡|대화|pdf|pptx|xlsx|csv|https?:/i;

const CONFIRMED_PRODUCT_HINT = /\(무\)|무배당|The|THE|Plus|PLUS|플러스|마이라이프|슬기로운|알뜰한|경영인|프리미엄|위너스|원픽|하이픽|더드림|세븐|Q|Ⅱ|Ⅲ|IV|V/i;

const GENERIC_CATEGORY_PAIR = /^(?:생명|손해|장기|보장성|저축성|일반|건강|질병|상해)\s*[·ㆍ/]\s*(?:생명|손해|장기|보장성|저축성|일반|건강|질병|상해)\s*보험$/;

const AUTO_CONFIRM_SCORE_THRESHOLD = 70;

const PRODUCT_COMPANY_ALIASES = [
  ['삼성화재', '삼성화재'],
  ['현대해상', '현대해상'],
  ['KB손해보험', 'KB손해보험'],
  ['KB손보', 'KB손해보험'],
  ['DB손해보험', 'DB손해보험'],
  ['DB손보', 'DB손해보험'],
  ['메리츠화재', '메리츠화재'],
  ['메리츠', '메리츠화재'],
  ['한화손해보험', '한화손해보험'],
  ['한화손보', '한화손해보험'],
  ['롯데손해보험', '롯데손해보험'],
  ['롯데손보', '롯데손해보험'],
  ['NH농협손해보험', 'NH농협손해보험'],
  ['농협손보', 'NH농협손해보험'],
  ['하나손보', '하나손해보험'],
  ['흥국화재', '흥국화재'],
  ['교보생명', '교보생명'],
  ['한화생명', '한화생명'],
  ['삼성생명', '삼성생명'],
  ['DB생명', 'DB생명'],
  ['동양생명', '동양생명'],
  ['신한라이프', '신한라이프'],
  ['미래에셋생명', '미래에셋생명'],
  ['메트라이프', '메트라이프'],
  ['라이나', '라이나']
];

const STRONG_PRODUCT_NAME_SIGNAL = /\(무\)|무배당|The|THE|Plus|PLUS|플러스|마이라이프|슬기로운|알뜰한|경영인|프리미엄|위너스|원픽|하이픽|더드림|The드림|굿앤굿|NEW|더스타트|건강쑥쑥|굿스타트|닥터플러스|원더풀/i;
const PRODUCT_EVIDENCE_FILE_SIGNAL = /상품비교|비교|가입설계|상품요약|현황|보험료|가이드북/i;
const GENERIC_AUTO_CONFIRM_NAME = /^(?:단기납\s*)?(?:종신보험|정기보험|운전자\s*보험|치매\s*간병보험|태아\s*\/\s*어린이\s*보험|반려동물보험|공시이율\s*종신보험|변액종신보험|CI\(GI\)\s*종신보험)$/;
const BAD_AUTO_CONFIRM_NAME = /또는 보험|그리고 최근들어 보험|유사한 보험|회사 생명보험|가입금액|보장내용|표준형|기본형|료미제공|대질병진단비|다른 자동차|가족생활배상책임담보|종기\s*가입|받아봤고 보험|저는 보험|아참/i;
const COVERAGE_CODE_CONTEXT_SIGNAL = /코드|담보|보장|특약|진단비|수술비|입원비|보험료|암|뇌|심장|질병|상해|실손|실비|간병|치매|운전자|골절|화상|후유장해|배상책임/;
const EXPLICIT_CODE_SIGNAL = /코드|담보\s*번호|보장\s*번호|특약\s*번호|번\s*(?:담보|보장|특약)/;

const COVERAGE_DETAIL_RULES = [
  ['유사암', '암', /유사암|소액암|갑상선암|기타피부암|제자리암|경계성종양/],
  ['고액암', '암', /고액암|특정고액암|백혈병|뇌암|골수암/],
  ['특정암', '암', /특정암|남성암|여성암|유방암|전립선암|대장암|폐암|위암|간암/],
  ['재진단암', '암', /재진단암|재발암|전이암|계속암|두번째암|2차암/],
  ['일반암', '암', /일반암|암\s*진단비|암진단비/],
  ['항암약물', '암', /항암약물|항암\s*약물|약물치료/],
  ['항암치료', '암', /항암|표적|면역|방사선|카티|CAR/],
  ['뇌출혈', '뇌/심장', /뇌출혈/],
  ['뇌경색', '뇌/심장', /뇌경색/],
  ['뇌졸중', '뇌/심장', /뇌졸중/],
  ['뇌혈관', '뇌/심장', /뇌혈관/],
  ['급성심근경색', '뇌/심장', /급성심근|심근경색/],
  ['협심증', '뇌/심장', /협심증/],
  ['심장수술', '뇌/심장', /심장\s*수술|관상동맥|스텐트|심장판막/],
  ['허혈성심장', '뇌/심장', /허혈|심장/],
  ['N대질병수술', '의료비/수술입원', /\d+\s*대\s*질병\s*수술|대질병수술|특정질병수술/],
  ['종수술', '의료비/수술입원', /종\s*수술|1종|2종|3종|4종|5종/],
  ['질병수술', '의료비/수술입원', /질병\s*수술|질병수술|수술비/],
  ['상해수술', '상해', /상해\s*수술|상해수술/],
  ['중환자실입원', '의료비/수술입원', /중환자실|ICU/],
  ['간병인사용', '간병/치매', /간병인|간호간병|간병인\s*사용/],
  ['입원일당', '의료비/수술입원', /입원|입원일당|입원비/],
  ['통원/실손', '의료비/수술입원', /통원|실손|실비|의료비/],
  ['간병', '간병/치매', /간병|요양|장기요양|생활비/],
  ['치매', '간병/치매', /치매|인지/],
  ['사고처리지원금', '운전자', /교통사고처리지원금|사고처리지원금|형사합의/],
  ['운전자벌금', '운전자', /벌금/],
  ['변호사선임비', '운전자', /변호사|변호사선임/],
  ['자동차부상치료비', '운전자', /자동차부상|부상치료비|교통상해/],
  ['운전자비용', '운전자', /운전자|자동차/],
  ['후유장해', '상해', /후유장해|장해/],
  ['골절/화상', '상해', /골절|화상/],
  ['배상책임', '상해', /배상책임|가족생활배상|일상생활배상/]
];

function cleanText(value = '') {
  return String(value || '')
    .normalize('NFC')
    .replace(/\u0000/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeJsonSeed() {
  try {
    const raw = readFileSync(new URL('../data/polibotSeedKnowledge.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hashText(text = '') {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function normalizeProductKey(value = '') {
  return String(value || '').replace(/\s+/g, '');
}

function inferCompanyFromProductName(productName = '') {
  const normalized = normalizeProductKey(productName);
  const match = PRODUCT_COMPANY_ALIASES.find(([alias]) => {
    const aliasKey = normalizeProductKey(alias);
    return productName.includes(alias) || normalized.includes(aliasKey);
  });
  return match?.[1] || '';
}

export function inferKnowledgeMonth(value = '', fallbackDate = new Date()) {
  const text = String(value || '').normalize('NFC');
  const yearMonth = text.match(/(20\d{2})[-_.년\s]*(0?[1-9]|1[0-2])/);
  const maxYear = fallbackDate.getFullYear() + 1;
  const validYear = (year) => year >= 2020 && year <= maxYear;
  if (yearMonth && validYear(Number(yearMonth[1]))) return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;
  const shortYearMonth = text.match(/(^|[^0-9])(\d{2})[._년\s]+(0?[1-9]|1[0-2])(?:월)?([^0-9]|$)/);
  if (shortYearMonth && validYear(Number(`20${shortYearMonth[2]}`))) return `20${shortYearMonth[2]}-${String(shortYearMonth[3]).padStart(2, '0')}`;
  const compact = text.match(/(^|[^0-9])(\d{2})(0[1-9]|1[0-2])([^0-9]|$)/);
  if (compact && validYear(Number(`20${compact[2]}`))) return `20${compact[2]}-${compact[3]}`;
  return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
}

export function inferPolibotFileType(fileName = '') {
  const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['pdf', 'pptx', 'ppt', 'docx', 'xlsx', 'xls', 'csv', 'txt'].includes(ext)) return ext;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  return ext || 'unknown';
}

function decodeOfficeXml(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractXlsxCellText(cellXml = '', sharedStrings = []) {
  const type = cellXml.match(/\st="([^"]+)"/)?.[1] || '';
  const value = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || '';
  if (type === 's') return sharedStrings[Number(value)] || '';
  if (type === 'inlineStr') {
    return decodeOfficeXml([...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((match) => match[1]).join(' '));
  }
  return decodeOfficeXml(value);
}

function extractXlsxTextFromBuffer(buffer) {
  const zip = new AdmZip(buffer);
  const sharedStringsXml = zip.getEntry('xl/sharedStrings.xml')?.getData().toString('utf8') || '';
  const sharedStrings = [...sharedStringsXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)]
    .map((match) => decodeOfficeXml([...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((textMatch) => textMatch[1]).join(' ')));
  const sheetTexts = zip.getEntries()
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName))
    .map((entry) => {
      const xml = entry.getData().toString('utf8');
      return [...xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)]
        .map((rowMatch) => [...rowMatch[1].matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/g)]
          .map((cellMatch) => extractXlsxCellText(cellMatch[0], sharedStrings))
          .map((cell) => cleanText(cell))
          .filter(Boolean)
          .join('\t'))
        .filter(Boolean)
        .join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
  return cleanText(sheetTexts);
}

export async function extractPolibotTextFromBuffer(buffer, fileName = '', options = {}) {
  const fileType = inferPolibotFileType(fileName);
  if (!buffer?.length) return '';
  if (fileType === 'csv' || fileType === 'txt') return cleanText(buffer.toString('utf8'));
  if (fileType === 'pdf') {
    const parser = new PDFParse({ data: buffer, ...(options.password ? { password: options.password } : {}) });
    try {
      const result = await parser.getText();
      return cleanText(result.text || '');
    } finally {
      await parser.destroy();
    }
  }
  if (fileType === 'pptx') {
    const zip = new AdmZip(buffer);
    const text = zip.getEntries()
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry.entryName))
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n')
      .replace(/<a:t[^>]*>/g, ' ')
      .replace(/<\/a:t>/g, ' ')
      .replace(/<[^>]+>/g, ' ');
    return cleanText(text);
  }
  if (fileType === 'docx') {
    const zip = new AdmZip(buffer);
    const text = zip.getEntries()
      .filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.entryName))
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n')
      .replace(/<w:t[^>]*>/g, ' ')
      .replace(/<\/w:t>/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    return cleanText(text);
  }
  if (fileType === 'xlsx') {
    return extractXlsxTextFromBuffer(buffer);
  }
  return '';
}

export function extractPolibotKeywords(text = '') {
  const source = String(text || '').normalize('NFC');
  return COVERAGE_KEYWORDS.filter((keyword) => source.includes(keyword)).slice(0, 18);
}

export function inferPolibotCompanies(text = '') {
  const source = String(text || '').normalize('NFC');
  return INSURANCE_COMPANIES.filter((company) => source.includes(company))
    .map((company) => company === '메리츠' ? '메리츠화재' : company)
    .filter((company, index, all) => all.indexOf(company) === index);
}

export function inferPolibotProductGroup(text = '') {
  const source = String(text || '').normalize('NFC');
  const match = PRODUCT_GROUP_RULES.find(([, pattern]) => pattern.test(source));
  return match?.[0] || '종합 보장';
}

function normalizeCodeValue(value = '') {
  return String(value || '').replace(/^0+(?=\d)/, '');
}

function codeLooksLikeDateOrAmount(code = '', context = '') {
  const numeric = Number(code);
  if (!Number.isFinite(numeric) || numeric <= 0) return true;
  if (/^(?:19|20)\d{2}$/.test(code)) return true;
  if (/^\d{4}$/.test(code) && !EXPLICIT_CODE_SIGNAL.test(context)) return true;
  if (numeric > 999 && !EXPLICIT_CODE_SIGNAL.test(context)) return true;
  const index = context.indexOf(code);
  const nearby = index >= 0 ? context.slice(Math.max(0, index - 4), index + code.length + 6) : context;
  return /(?:년|월|일|세|원|만원|억원|회차|개월|년납|월납|%|％)/.test(nearby);
}

function codeContext(text = '', index = 0, length = 0) {
  const source = cleanText(text);
  return source.slice(Math.max(0, index - 80), Math.min(source.length, index + length + 100));
}

function coverageKeywordsFromContext(context = '') {
  return COVERAGE_KEYWORDS
    .filter((keyword) => context.includes(keyword))
    .slice(0, 8);
}

export function extractPolibotCoverageCodes({ text = '', fileName = '', companies = [], keywords = [] } = {}) {
  const source = cleanText(`${fileName}\n${String(text || '').slice(0, 180000)}`);
  if (!source) return [];
  const found = [];
  const patterns = [
    /(?:코드|담보\s*번호|보장\s*번호|특약\s*번호)\s*[:：#]?\s*([0-9]{1,4})/g,
    /([0-9]{1,4})\s*번\s*(?:담보|보장|특약|회사|코드)?/g,
    /(?:담보|보장|특약)\s*([0-9]{1,4})\s*(?:번|코드)?/g,
    /(^|[^0-9])([0-9]{1,4})(?=[^0-9]|$)/g
  ];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      const rawCode = match[2] || match[1] || '';
      const code = normalizeCodeValue(rawCode);
      const rawIndex = match.index + String(match[0] || '').indexOf(rawCode);
      const context = codeContext(source, rawIndex, rawCode.length);
      const explicit = EXPLICIT_CODE_SIGNAL.test(context);
      if (codeLooksLikeDateOrAmount(code, context)) continue;
      if (!explicit && !COVERAGE_CODE_CONTEXT_SIGNAL.test(context)) continue;
      const contextCompanies = inferPolibotCompanies(context);
      const contextKeywords = coverageKeywordsFromContext(context);
      found.push({
        code,
        context,
        companies: [...new Set([...(companies || []), ...contextCompanies])].slice(0, 6),
        coverageKeywords: [...new Set([...(keywords || []), ...contextKeywords])].slice(0, 8),
        confidence: Math.min(100, 45 + (explicit ? 30 : 0) + contextKeywords.length * 4 + contextCompanies.length * 3)
      });
    }
  });
  return found
    .filter((item, index, all) => all.findIndex((row) => row.code === item.code && row.context === item.context) === index)
    .sort((a, b) => b.confidence - a.confidence || a.code.localeCompare(b.code, 'ko'))
    .slice(0, 80);
}

function extractProductNames(text = '', fileName = '') {
  return buildPolibotProductCandidates({ text, fileName })
    .filter((item) => ['confirmed', 'auto'].includes(item.status))
    .map((item) => item.name)
    .slice(0, 8);
}

function extractAudience(text = '') {
  const source = String(text || '');
  const audience = [];
  if (/유병자|고지|간편/.test(source)) audience.push('유병자/간편고지');
  if (/어린이|태아|자녀/.test(source)) audience.push('자녀/태아');
  if (/경영인|대표|법인/.test(source)) audience.push('경영인/법인');
  if (/실손|실비/.test(source)) audience.push('실손 점검 고객');
  if (/암|뇌|심장|3대/.test(source)) audience.push('3대 질병 보강 고객');
  return audience.slice(0, 5);
}

function firstMatch(text = '', patterns = []) {
  const source = String(text || '').normalize('NFC');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match?.[0]) return cleanText(match[0]).slice(0, 90);
  }
  return '';
}

function snippetByKeywords(text = '', patterns = []) {
  const source = cleanText(text);
  if (!source) return '';
  const sentences = source
    .split(/(?<=[.!?。]|다\.|요\.)\s+|\n+| {2,}/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 6 && item.length <= 140);
  const found = sentences.find((sentence) => patterns.some((pattern) => pattern.test(sentence)));
  return found || '';
}

function extractAgeRange(text = '') {
  return firstMatch(text, [
    /(?:만\s*)?\d{1,2}\s*세\s*(?:부터|이상)\s*(?:만\s*)?\d{1,2}\s*세\s*(?:까지|이하)?/,
    /(?:만\s*)?\d{1,2}\s*세\s*[~-]\s*(?:만\s*)?\d{1,2}\s*세/,
    /(?:만\s*)?\d{1,2}\s*세\s*(?:부터|이상|까지|이하)/
  ]);
}

function extractPaymentTerm(text = '') {
  return firstMatch(text, [
    /\d{1,2}\s*년\s*납(?:입)?(?:\s*[~/]\s*\d{1,2}\s*년\s*만기)?/,
    /\d{1,2}\s*년\s*만기/,
    /전기납|일시납|월납|연납|납입\s*기간\s*[:：]?\s*[가-힣0-9\s~/.-]{2,30}/
  ]);
}

function extractPremiumExample(text = '') {
  const value = firstMatch(text, [
    /월\s*\d{1,3}(?:,\d{3})+\s*원/,
    /월\s*\d{1,3}(?:\.\d+)?\s*만\s*원/,
    /보험료\s*[:：]\s*(?:월\s*)?\d{1,3}(?:,\d{3})+\s*원/,
    /보험료\s*[:：]\s*(?:월\s*)?\d{1,3}(?:\.\d+)?\s*만\s*원/
  ]);
  if (/비교|자료|표|현황|예시|기준/.test(value) && !/\d{1,3}(?:,\d{3})+\s*원|\d{1,3}(?:\.\d+)?\s*만\s*원/.test(value)) return '';
  return value;
}

function extractLineWindow(lines = [], index = 0, radius = 2) {
  return cleanText(lines.slice(Math.max(0, index - radius), Math.min(lines.length, index + radius + 1)).join('\n'));
}

function extractPremiumTableRows(text = '', productName = '') {
  return extractPolibotPremiumTableRows(text, productName);
}

function extractPremiumCandidates(text = '', productName = '') {
  return extractPolibotPremiumCandidates(text, productName);
}

function extractRefundRate(text = '') {
  return firstMatch(text, [
    /환급률\s*[:：]?\s*\d{1,3}(?:\.\d+)?\s*%/,
    /\d{1,3}(?:\.\d+)?\s*%\s*(?:환급|해지환급)/
  ]);
}

function extractRenewalType(text = '') {
  const source = String(text || '');
  if (/비갱신/.test(source)) return '비갱신';
  if (/갱신형|갱신/.test(source)) return '갱신';
  return '';
}

function extractDisclosureMemo(text = '') {
  return snippetByKeywords(text, [/고지|유병자|간편|병력|투약|수술|입원|부담보/]).slice(0, 120);
}

function extractReductionMemo(text = '') {
  return snippetByKeywords(text, [/감액|면책|부담보|보장\s*개시|대기\s*기간|인수\s*제한/]).slice(0, 120);
}

function extractExcludedAudience(text = '') {
  const sentence = snippetByKeywords(text, [/가입\s*불가|제외|인수\s*거절|제한|부담보|고지\s*필요/]);
  return sentence ? [sentence.slice(0, 90)] : [];
}

function coverageCategory(value = '') {
  const fine = coverageFineCategory(value);
  if (fine.major) return fine.major;
  if (/암|항암|유사암|표적|카티|CAR/.test(value)) return '암';
  if (/뇌|심장|허혈|심근|순환계|혈관/.test(value)) return '뇌/심장';
  if (/수술|입원|통원|의료비|실손|실비/.test(value)) return '의료비/수술입원';
  if (/간병|요양|치매/.test(value)) return '간병/치매';
  if (/운전자|자동차|교통|벌금|변호사/.test(value)) return '운전자';
  if (/상해|골절|후유장해|화상/.test(value)) return '상해';
  return '기타 보장';
}

function coverageFineCategory(value = '') {
  const text = cleanText(value);
  const matched = COVERAGE_DETAIL_RULES.find(([, , pattern]) => pattern.test(text));
  if (!matched) return { category: '기타 보장', major: '', code: 'etc' };
  return {
    category: matched[0],
    major: matched[1],
    code: matched[0].replace(/[^가-힣A-Za-z0-9]/g, '_').toLowerCase()
  };
}

function evidenceAnchor({ sourceId = '', fileName = '', month = '', text = '', excerpt = '', label = '', rowIndex = null } = {}) {
  const source = cleanText(text);
  const target = cleanText(excerpt || label);
  const index = target ? source.indexOf(target.slice(0, Math.min(40, target.length))) : -1;
  const start = index >= 0 ? index : 0;
  const context = source
    ? cleanText(source.slice(Math.max(0, start - 90), Math.min(source.length, start + Math.max(target.length, 80) + 140))).slice(0, 320)
    : target.slice(0, 220);
  return {
    sourceId,
    fileName,
    month,
    rowIndex: Number.isFinite(Number(rowIndex)) ? Number(rowIndex) : null,
    charStart: index >= 0 ? index : null,
    charEnd: index >= 0 ? index + target.length : null,
    excerpt: context
  };
}

function normalizeCoverageEvidence(row = {}, sourceMeta = {}) {
  const sourceText = `${row.title || ''} ${row.category || ''}`;
  const fine = coverageFineCategory(sourceText);
  return {
    ...row,
    category: row.category || fine.major || fine.category,
    fineCategory: fine.category,
    coverageCode: fine.code,
    evidenceAnchor: evidenceAnchor({
      ...sourceMeta,
      excerpt: row.excerpt || row.context || `${row.title || ''} ${row.amount || ''}`.trim()
    })
  };
}

function extractCoverageTableRows(text = '') {
  const source = cleanText(text);
  if (!source) return [];
  const lines = source
    .split(/\n+|(?<=만원)\s+(?=\S)|(?<=억원)\s+(?=\S)|(?<=원)\s+(?=\S)/)
    .map((line) => cleanText(line))
    .filter((line) => line.length >= 5 && line.length <= 260);
  const rows = [];
  const isPremiumWonAmount = (lineValue = '', amountValue = '', contextValue = '') => {
    if (!/원/.test(amountValue) || /만원|천만원|억원/.test(amountValue)) return false;
    const combined = `${lineValue} ${contextValue}`;
    return /보험료|월납|납입보험료|합계보험료|월\s*\d{1,3}(?:,\d{3})+\s*원/.test(combined)
      && !/가입금액|보장금액/.test(combined);
  };
  lines.forEach((line, index) => {
    if (!/암|유사암|뇌|심장|허혈|심근|질병|상해|수술|입원|통원|간병|치매|운전자|교통사고|사고처리|벌금|변호사|자동차부상|진단비|생활비|후유장해|골절|담보|특약|가입금액/.test(line)) return;
    const amounts = [...line.matchAll(/\d{1,4}(?:,\d{3})?\s*(?:만원|천만원|억원)|\d{1,3}(?:,\d{3})+\s*원/g)];
    const context = extractLineWindow(lines, index, 1);
    const coverageTitle = cleanText(line
      .replace(/\d{1,4}(?:,\d{3})?\s*(?:만원|천만원|억원)|\d{1,3}(?:,\d{3})+\s*원/g, ' ')
      .replace(/가입금액|보장금액|보험료|월납|남자|여자|남성|여성|단위\s*[:：]?\s*\S+/g, ' ')
      .replace(/\s+/g, ' ')).slice(0, 80);
    if (!amounts.length) {
      rows.push({
        category: coverageCategory(line),
        title: coverageTitle || line.slice(0, 70),
        amount: '',
        context: context.slice(0, 280),
        confidence: 'coverage_keyword_row'
      });
      return;
    }
    amounts.forEach((match) => {
      if (isPremiumWonAmount(line, match[0], context)) return;
      rows.push({
        category: coverageCategory(line),
        title: coverageTitle || cleanText(line.slice(0, match.index || 70)).slice(0, 80),
        amount: cleanText(match[0]),
        context: context.slice(0, 280),
        confidence: /가입금액|보장금액|담보|특약/.test(context) ? 'coverage_table_row' : 'coverage_amount_row'
      });
    });
  });
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.category}-${row.title}-${row.amount}-${row.context}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 32);
}

function extractCoverageDetails(text = '') {
  const source = cleanText(text);
  if (!source) return [];
  const directPairs = [];
  const pairPattern = /([가-힣A-Za-z0-9·()/-][가-힣A-Za-z0-9·()/-\s]{0,34}?(?:암|뇌혈관|뇌|심장|허혈|심근|질병|상해|수술|입원|통원|간병|치매|운전자|진단비|생활비|후유장해|골절|특약|담보)[가-힣A-Za-z0-9·()/-\s]{0,18}?)\s*(\d{1,4}(?:,\d{3})?\s*(?:만원|천만원|억원)|\d{1,3}(?:,\d{3})+\s*원)/g;
  for (const match of source.matchAll(pairPattern)) {
    const title = cleanText(match[1])
      .replace(/^.*?[,.]\s*/, '')
      .replace(/^\d+\s*/, '')
      .replace(/^(?:담보|보장)?\s*(?:가입금액|보장금액)\s*/g, '')
      .replace(/^(?:담보|보장|가입금액|보장금액)\s*/g, '')
      .replace(/^(?:담보|보장)\s*(?:가입금액|보장금액)\s*/g, '');
    const amount = cleanText(match[2]);
    if (!title || !amount) continue;
    if (/원/.test(amount) && !/만원|천만원|억원/.test(amount) && /보험료|월납|납입보험료|합계보험료/.test(cleanText(match[0]))) continue;
    directPairs.push({
      category: coverageCategory(title),
      title: title.slice(0, 70),
      amount,
      excerpt: cleanText(match[0]).slice(0, 160),
      confidence: 'amount_pair'
    });
  }
  const pieces = source
    .split(/\n+|(?<=원)\s+|(?<=만원)\s+|(?<=세)\s+/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 5 && item.length <= 180)
    .filter((item) => /암|뇌|심장|질병|상해|수술|입원|통원|실손|실비|간병|치매|운전자|교통사고|사고처리|벌금|변호사|자동차부상|진단비|생활비|후유장해|골절|담보|특약/.test(item));
  const seen = new Set();
  return [...directPairs, ...extractCoverageTableRows(source).map((row) => ({
    category: row.category,
    title: row.title,
    amount: row.amount,
    excerpt: row.context,
    confidence: row.confidence
  })), ...pieces.map((line) => {
    const amount = line.match(/\d{1,3}(?:,\d{3})*\s*(?:만\s*)?원|\d{1,4}\s*만원|\d{1,4}\s*천만원|\d{1,2}\s*억원/)?.[0] || '';
    if (/원/.test(amount) && !/만원|천만원|억원/.test(amount) && /보험료|월납|납입보험료|합계보험료/.test(line) && !/가입금액|보장금액/.test(line)) return null;
    const category = coverageCategory(line);
    return {
      category,
      title: cleanText(line.replace(/\d{1,3}(?:,\d{3})*\s*(?:만\s*)?원|\d{1,4}\s*만원|\d{1,4}\s*천만원|\d{1,2}\s*억원/g, '')).slice(0, 70),
      amount,
      excerpt: line.slice(0, 160),
      confidence: amount ? 'line_amount' : 'keyword_line'
    };
  }).filter(Boolean)].filter((item) => {
    const key = `${item.category}-${item.title}-${item.amount}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 16);
}

function extractConditionRules(text = '') {
  const source = cleanText(text);
  if (!source) return {};
  const ageRules = [...source.matchAll(/(?:가입\s*연령|가입나이|보험\s*나이|연령)\s*[:：]?\s*((?:만\s*)?\d{1,2}\s*세(?:\s*(?:부터|이상|[~-])\s*(?:만\s*)?\d{1,2}\s*세(?:까지|이하)?)?)/g)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean)
    .slice(0, 8);
  const paymentTerms = [...source.matchAll(/(?:납입\s*기간|납기|보험료\s*납입)\s*[:：]?\s*([가-힣0-9\s~/.-]{2,40}(?:년납|년\s*납|전기납|일시납|월납|연납))/g)]
    .map((match) => cleanText(match[1]))
    .filter(Boolean)
    .slice(0, 8);
  const underwritingTypes = [
    /간편|간편고지|유병자|325|335|355|3\.2\.5|3\.3\.5|3\.5\.5/.test(source) && '간편/유병자',
    /무심사|무고지/.test(source) && '무심사/무고지',
    /표준체|일반심사|일반고지/.test(source) && '표준심사',
    /부담보/.test(source) && '부담보 가능성',
    /인수\s*거절|가입\s*불가/.test(source) && '가입 제한/거절 문구'
  ].filter(Boolean);
  const waitingPeriods = [...source.matchAll(/(?:면책|감액|보장\s*개시|대기\s*기간)[^\n.]{0,80}/g)]
    .map((match) => cleanText(match[0]))
    .filter(Boolean)
    .slice(0, 8);
  return {
    ageRules,
    paymentTerms,
    underwritingTypes,
    waitingPeriods
  };
}

function extractConditionDetails(text = '') {
  const source = cleanText(text);
  const conditionRules = extractConditionRules(source);
  return {
    ageRange: extractAgeRange(source),
    paymentTerm: extractPaymentTerm(source),
    renewalType: extractRenewalType(source),
    disclosureMemo: extractDisclosureMemo(source),
    reductionMemo: extractReductionMemo(source),
    excludedAudience: extractExcludedAudience(source),
    refundRate: extractRefundRate(source),
    conditionRules
  };
}

function extractDocumentSections(text = '') {
  const source = cleanText(text);
  if (!source) return [];
  const lines = source.split(/\n+/).map((line) => cleanText(line)).filter(Boolean);
  const sections = [];
  let current = { title: '문서 개요', lines: [] };
  const push = () => {
    const body = cleanText(current.lines.join('\n'));
    if (!body) return;
    sections.push({
      title: current.title,
      sectionType: /보험료|월납|납입/.test(`${current.title} ${body}`) ? 'premium'
        : /담보|보장|가입금액|진단비|수술비|입원비/.test(`${current.title} ${body}`) ? 'coverage'
          : /가입|연령|고지|면책|감액|인수|부담보/.test(`${current.title} ${body}`) ? 'condition'
            : /상품|플랜|특약/.test(`${current.title} ${body}`) ? 'product' : 'general',
      excerpt: body.slice(0, 600)
    });
  };
  lines.forEach((line) => {
    const heading = line.length <= 48 && /^(?:\d+[.)]\s*)?(?:상품|보험료|월납|가입|담보|보장|플랜|특약|유의|고지|심사|인수|면책|감액|해지|환급)/.test(line);
    if (heading && current.lines.length) {
      push();
      current = { title: line, lines: [] };
    } else {
      current.lines.push(line);
    }
  });
  push();
  return sections.slice(0, 24);
}

function planKey(value = '') {
  return normalizeProductKey(value || '공통');
}

function extractPlanFromText(value = '') {
  const text = cleanText(value);
  const match = cleanText(text.match(/([가-힣A-Za-z0-9()·/-]{0,18}(?:플랜|Plan|PLAN|기본형|표준형|고급형|실속형|프리미엄형|선택형))/)?.[1] || '');
  if (!match || /갱신형|비갱신형|보험료|담보|보장|가입금액|보장금액|가입연령|납입/.test(match)) return '';
  return match;
}

function buildLinkedBenefitGroups({
  productName = '',
  premiumTableRows = [],
  premiumCandidates = [],
  coverageDetails = [],
  coverageTableRows = [],
  conditionDetails = {},
  documentSections = []
} = {}) {
  const groups = new Map();
  const ensureGroup = (keyValue = '공통', plan = '') => {
    const key = planKey(keyValue || plan || '공통');
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        productName,
        plan: plan || keyValue || '공통',
        premiums: [],
        coverages: [],
        conditions: {
          ageRange: conditionDetails.ageRange || '',
          paymentTerm: conditionDetails.paymentTerm || '',
          renewalType: conditionDetails.renewalType || '',
          disclosureMemo: conditionDetails.disclosureMemo || '',
          reductionMemo: conditionDetails.reductionMemo || '',
          refundRate: conditionDetails.refundRate || '',
          conditionRules: conditionDetails.conditionRules || {}
        },
        sourceSections: [],
        linkConfidence: 'weak'
      });
    }
    return groups.get(key);
  };

  [...premiumTableRows, ...premiumCandidates].forEach((premium) => {
    const plan = premium.plan || extractPlanFromText(`${premium.label || ''} ${premium.context || ''}`) || '공통';
    const group = ensureGroup(plan, plan);
    group.premiums.push({
      amount: premium.amount || premium.premium || '',
      age: premium.age || '',
      gender: premium.gender || '',
      plan,
      label: premium.label || '',
      confidence: premium.confidence || '',
      context: premium.context || ''
    });
  });

  const coverageRows = [...coverageDetails, ...coverageTableRows];
  coverageRows.forEach((coverage) => {
    const plan = extractPlanFromText(`${coverage.title || ''} ${coverage.excerpt || ''} ${coverage.context || ''}`);
    const targetGroups = plan
      ? [ensureGroup(plan, plan)]
      : groups.size ? [...groups.values()] : [ensureGroup('공통', '공통')];
    targetGroups.forEach((group) => {
      const fine = coverageFineCategory(`${coverage.title || ''} ${coverage.excerpt || coverage.context || ''}`);
      group.coverages.push({
        category: coverage.category || coverageCategory(coverage.title || ''),
        fineCategory: coverage.fineCategory || fine.category,
        coverageCode: coverage.coverageCode || fine.code,
        title: coverage.title || '',
        amount: coverage.amount || '',
        confidence: coverage.confidence || '',
        excerpt: coverage.excerpt || coverage.context || '',
        evidenceAnchor: coverage.evidenceAnchor || null
      });
    });
  });

  documentSections.forEach((section) => {
    if (!['premium', 'coverage', 'condition', 'product'].includes(section.sectionType)) return;
    const plan = extractPlanFromText(`${section.title || ''} ${section.excerpt || ''}`);
    const targetGroups = plan ? [ensureGroup(plan, plan)] : [...groups.values()].slice(0, 4);
    targetGroups.forEach((group) => {
      group.sourceSections.push({
        title: section.title,
        sectionType: section.sectionType,
        excerpt: section.excerpt
      });
    });
  });

  if (!groups.size && coverageRows.length) ensureGroup('공통', '공통');
  return [...groups.values()].map((group) => {
    const uniqueCoverage = new Map();
    group.coverages.forEach((coverage) => {
      const key = `${coverage.category}-${coverage.title}-${coverage.amount}`;
      if (!uniqueCoverage.has(key)) uniqueCoverage.set(key, coverage);
    });
    const genderedPremiumKeys = new Set(group.premiums
      .filter((premium) => premium.gender)
      .flatMap((premium) => [
        `${premium.amount}-${premium.age}-${premium.plan}`,
        `${premium.amount}-${premium.plan}`
      ]));
    const uniquePremium = new Map();
    group.premiums.forEach((premium) => {
      if (!premium.gender && (genderedPremiumKeys.has(`${premium.amount}-${premium.age}-${premium.plan}`) || genderedPremiumKeys.has(`${premium.amount}-${premium.plan}`))) return;
      const key = `${premium.amount}-${premium.age}-${premium.gender}-${premium.plan}`;
      if (!uniquePremium.has(key)) uniquePremium.set(key, premium);
    });
    const coverages = [...uniqueCoverage.values()]
      .filter((coverage) => coverage.amount || !/^(?:담보|담보\s*가입금액|보장|가입금액|보장금액)$/.test(coverage.title || ''))
      .slice(0, 24);
    const premiums = [...uniquePremium.values()].slice(0, 12);
    const hasCondition = Boolean(group.conditions.ageRange || group.conditions.paymentTerm || group.conditions.renewalType || group.conditions.conditionRules?.underwritingTypes?.length);
    const score = Math.min(100, 25 + (premiums.length ? 25 : 0) + Math.min(30, coverages.length * 5) + (hasCondition ? 15 : 0) + (group.plan !== '공통' ? 5 : 0));
    return {
      ...group,
      premiums,
      coverages,
      sourceSections: group.sourceSections.slice(0, 6),
      linkedSummary: [
        group.plan && `플랜 ${group.plan}`,
        premiums[0]?.amount && `보험료 ${premiums[0].amount}`,
        coverages.length && `담보 ${coverages.length}개`,
        group.conditions.ageRange && `가입연령 ${group.conditions.ageRange}`,
        group.conditions.renewalType
      ].filter(Boolean).join(' · '),
      linkScore: score,
      linkConfidence: score >= 82 ? 'strong' : score >= 62 ? 'usable' : 'weak'
    };
  }).sort((a, b) => b.linkScore - a.linkScore).slice(0, 12);
}

function buildPolibotDocumentAnalysis({ text = '', fileName = '', productCandidates = [] } = {}) {
  const source = cleanText(`${fileName}\n${text}`);
  const sourceMeta = { fileName, month: inferKnowledgeMonth(source), text: source };
  const premiumCandidates = extractPremiumCandidates(source);
  const premiumTableRows = extractPremiumTableRows(source);
  const coverageDetails = extractCoverageDetails(source).map((row, index) => normalizeCoverageEvidence(row, { ...sourceMeta, rowIndex: index }));
  const coverageTableRows = extractCoverageTableRows(source).map((row, index) => normalizeCoverageEvidence(row, { ...sourceMeta, rowIndex: index }));
  const conditionDetails = extractConditionDetails(source);
  const documentSections = extractDocumentSections(source);
  const linkedBenefitGroups = buildLinkedBenefitGroups({
    premiumTableRows,
    premiumCandidates,
    coverageDetails,
    coverageTableRows,
    conditionDetails,
    documentSections
  });
  return {
    premiumCandidates,
    premiumTableRows,
    coverageDetails,
    coverageTableRows,
    conditionDetails,
    documentSections,
    linkedBenefitGroups,
    analysisQuality: {
      premiumCandidateCount: premiumCandidates.length,
      premiumTableRowCount: premiumTableRows.length,
      coverageDetailCount: coverageDetails.length,
      coverageTableRowCount: coverageTableRows.length,
      sectionCount: documentSections.length,
      linkedBenefitGroupCount: linkedBenefitGroups.length,
      strongLinkedBenefitGroupCount: linkedBenefitGroups.filter((item) => item.linkConfidence === 'strong').length,
      productCandidateCount: productCandidates.length,
      hasConditionDetails: Boolean(conditionDetails.ageRange || conditionDetails.paymentTerm || conditionDetails.renewalType || conditionDetails.disclosureMemo || conditionDetails.conditionRules?.underwritingTypes?.length)
    }
  };
}

function catalogCompleteness(item = {}) {
  const checks = [
    item.productName,
    item.company && item.company !== '미분류',
    item.productGroup,
    Array.isArray(item.coverageKeywords) && item.coverageKeywords.length > 0,
    item.ageRange,
    item.paymentTerm,
    item.renewalType,
    item.disclosureMemo,
    item.cautionMemo || (Array.isArray(item.cautions) && item.cautions.length > 0),
    Array.isArray(item.coverageDetails) && item.coverageDetails.length > 0,
    Array.isArray(item.premiumTableRows) && item.premiumTableRows.length > 0,
    item.conditionRules && Object.values(item.conditionRules).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value))
  ];
  const score = checks.filter(Boolean).length;
  if (score >= 8) return '충분';
  if (score >= 4) return '보통';
  return '부족';
}

function extractCautions(text = '') {
  const source = String(text || '');
  const cautions = [];
  if (/갱신/.test(source)) cautions.push('갱신 조건 확인');
  if (/감액|면책|부담보/.test(source)) cautions.push('감액/면책/부담보 확인');
  if (/고지|유병자/.test(source)) cautions.push('고지사항 확인');
  if (/중복|실손/.test(source)) cautions.push('중복 가입 여부 확인');
  if (/해지|환급률/.test(source)) cautions.push('해지환급률 확인');
  return cautions.slice(0, 5);
}

function candidateContext(text = '', candidateName = '') {
  const source = cleanText(text);
  const name = cleanText(candidateName);
  if (!source || !name) return source.slice(0, 1000);
  const index = source.indexOf(name);
  if (index < 0) return source.slice(0, 1000);
  const start = Math.max(0, index - 420);
  const end = Math.min(source.length, index + name.length + 720);
  return cleanText(source.slice(start, end));
}

function summarizeText(text = '', keywords = []) {
  const source = cleanText(text);
  if (!source) return keywords.length ? `${keywords.slice(0, 5).join(', ')} 중심 자료` : '원문 텍스트 미추출';
  const sentences = source
    .split(/(?<=[.!?。]|다\.|요\.)\s+|\n+/)
    .map((item) => cleanText(item))
    .filter((item) => item.length >= 12)
    .filter((item) => keywords.length === 0 || keywords.some((keyword) => item.includes(keyword)));
  return (sentences[0] || source.slice(0, 180)).slice(0, 260);
}

export function normalizePolibotKnowledgeSource({ fileName = '', text = '', month = '', note = '', size = 0, type = '' } = {}) {
  const cleanFileName = cleanText(fileName) || '자료';
  const limitedText = String(text || '').slice(0, 250000);
  const sourceText = cleanText([cleanFileName, limitedText, note].filter(Boolean).join('\n'));
  const companies = inferPolibotCompanies(sourceText);
  const keywords = extractPolibotKeywords(sourceText);
  const productGroup = inferPolibotProductGroup(sourceText);
  const productCandidates = buildPolibotProductCandidates({
    text: sourceText,
    fileName: cleanFileName,
    companies,
    productGroup,
    keywords
  });
  const catalogItems = buildPolibotCatalogItems([{
    fileName: cleanFileName,
    month: inferKnowledgeMonth(month || sourceText),
    fileType: type || inferPolibotFileType(cleanFileName),
    companies,
    company: companies[0] || '미분류',
    productGroup,
    keywords,
    cautions: extractCautions(sourceText),
    productCandidates,
    textSnippet: cleanText(limitedText).slice(0, 1500)
  }]);
  const documentAnalysis = buildPolibotDocumentAnalysis({
    text: sourceText,
    fileName: cleanFileName,
    productCandidates
  });
  return {
    id: `polibot-knowledge-${hashText(`${cleanFileName}-${month}-${sourceText.slice(0, 120)}`)}`,
    fileName: cleanFileName,
    month: inferKnowledgeMonth(month || sourceText),
    fileType: type || inferPolibotFileType(cleanFileName),
    companies,
    company: companies[0] || '미분류',
    productGroup,
    productCandidates,
    catalogItems,
    documentAnalysis,
    premiumCandidates: documentAnalysis.premiumCandidates,
    premiumTableRows: documentAnalysis.premiumTableRows,
    coverageDetails: documentAnalysis.coverageDetails,
    coverageTableRows: documentAnalysis.coverageTableRows,
    conditionDetails: documentAnalysis.conditionDetails,
    documentSections: documentAnalysis.documentSections,
    linkedBenefitGroups: documentAnalysis.linkedBenefitGroups,
    productNames: catalogItems.map((item) => item.productName).slice(0, 8),
    codeCandidates: extractPolibotCoverageCodes({
      text: sourceText,
      fileName: cleanFileName,
      companies,
      keywords
    }),
    keywords,
    targetAudience: extractAudience(sourceText),
    cautions: extractCautions(sourceText),
    summary: summarizeText(sourceText, keywords),
    textSnippet: cleanText(limitedText).slice(0, 1500),
    note: cleanText(note),
    size: Number(size || 0),
    uploadedAt: new Date().toISOString()
  };
}

function normalizeProductCandidateName(value = '') {
  return cleanText(value)
    .replace(/\.(pdf|pptx?|docx|xlsx|csv|txt)$/ig, ' ')
    .replace(/^(?:qa\d*|debug\d*|test\d*|persona\d*|suite\d*|monthly-change)[-_][A-Za-z0-9]+[-_]/ig, ' ')
    .replace(/^20\d{2}[-_.]\d{1,2}[-_.]/g, ' ')
    .replace(/^20\d{2}년\s*\d{1,2}월\s*/g, ' ')
    .replace(/^(?:pdf|pptx?|docx|xlsx|csv|txt)\s+/ig, ' ')
    .replace(/상품명|구\s*분|보험료|변경월|변경일|작성기준일/gi, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/^\s*\d+(?:[,.\d]*원|\s*세|년|개월)?\s*/g, ' ')
    .replace(/^(?:원|만원|천원|억원)\s*/g, ' ')
    .replace(/^(?:남성|여성|보장|담보|합계|월납|기준|순위|일반|간편)\s*/g, ' ')
    .replace(/[{}[\]←→󰀲︙|]+/g, ' ')
    .replace(/^무\)/g, '(무)')
    .replace(/\s무\)/g, ' (무)')
    .replace(/\s+/g, ' ')
    .replace(/(보험|플랜|특약|담보|진단비|수술비|입원비|간병비)\s+\1$/g, '$1')
    .trim();
}

function productCandidateReason(name = '', sourceText = '') {
  const normalized = name.replace(/\s+/g, '');
  const companyMentions = INSURANCE_COMPANIES
    .filter((company) => name.includes(company) || normalized.includes(company.replace(/\s+/g, '')))
    .filter((company, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.includes(company)));
  const tokenCount = name.split(/\s+/).filter(Boolean).length;
  const suffixCount = (name.match(/보험|플랜|특약|담보|진단비|수술비|입원비|간병비/g) || []).length;
  if (!name) return 'empty';
  if (/^(?:qa\d*|debug\d*|test\d*|persona\d*|suite\d*|monthly-change)[-_]/i.test(name)) return 'file_name_prefix';
  if (name.length < 4 || name.length > 38) return 'length';
  if (/^[가-힣A-Za-z]\s+/.test(name)) return 'broken_leading_token';
  if (companyMentions.length >= 2) return 'multiple_companies_in_candidate';
  if (suffixCount >= 2) return 'multiple_products_in_candidate';
  if (tokenCount >= 5) return 'table_row_fragment';
  if (/^(?:원|만원|천원|억원|가입금액|보장금액)|가입금액|보장금액/.test(name)) return 'table_amount_fragment';
  if (!/(보험|플랜|특약|담보|진단비|수술비|입원비|간병비)/.test(name)) return 'no_product_suffix';
  if (GENERIC_CATEGORY_PAIR.test(name)) return 'generic_category';
  if (GENERIC_PRODUCT_NAMES.has(normalized)) return 'generic';
  if (BAD_PRODUCT_PHRASE.test(name)) return 'document_or_training_phrase';
  if (/에서|으로|라고|같은|있는|읽는|챙겨야|자료|데이터/.test(name)) return 'sentence_fragment';
  if (/^\d|[,]{2,}|[?]{2,}/.test(name)) return 'broken_text';
  if (/님|고객|보장분석|현재\s*가입/.test(sourceText.slice(0, 160)) && !CONFIRMED_PRODUCT_HINT.test(name)) return 'customer_analysis_document';
  return '';
}

function rawProductCandidateTexts(text = '', fileName = '') {
  const source = cleanText(`${fileName}\n${text}`);
  const patterns = [
    /(?:상품명|대상\s*상품|추천\s*상품)\s*[:：]?\s*([^\n]{2,60}?(?:보험|플랜))/g,
    /([가-힣A-Za-z0-9][가-힣A-Za-z0-9\s·()/-]{2,35}(?:보험|플랜|특약|담보))/g,
    /([가-힣A-Za-z0-9][가-힣A-Za-z0-9\s·()/-]{2,35}(?:진단비|수술비|입원비|간병비))/g
  ];
  const values = [];
  patterns.forEach((pattern) => {
    for (const match of source.matchAll(pattern)) {
      values.push(match[1]);
      if (values.length >= 40) break;
    }
  });
  return values;
}

export function buildPolibotProductCandidates({ text = '', fileName = '', companies = [], productGroup = '', keywords = [] } = {}) {
  const sourceText = cleanText(text);
  const sourceCompanies = companies.length ? companies : inferPolibotCompanies(`${fileName}\n${sourceText}`);
  const sourceKeywords = keywords.length ? keywords : extractPolibotKeywords(sourceText);
  const group = productGroup || inferPolibotProductGroup(sourceText);
  const seen = new Set();
  return rawProductCandidateTexts(sourceText, fileName)
    .map(normalizeProductCandidateName)
    .filter(Boolean)
    .filter((name) => {
      const key = name.replace(/\s+/g, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24)
    .map((name) => {
      const rejectReason = productCandidateReason(name, sourceText);
      const hasCompany = sourceCompanies.some((company) => sourceText.includes(company));
      const hasStrongHint = CONFIRMED_PRODUCT_HINT.test(name);
      const hasCompanyInName = sourceCompanies.some((company) => name.includes(company));
      const hasCleanProductShape = hasStrongHint || (hasCompanyInName && /(보험|플랜)$/.test(name));
      const status = rejectReason
        ? 'excluded'
        : hasCleanProductShape ? 'auto' : hasCompany ? 'review' : 'review';
      const confidence = status === 'auto' ? 72 : status === 'review' ? 48 : 20;
      return {
        name,
        status,
        reason: rejectReason || (status === 'auto' ? '자동 추출 상품명 - 관리자 확정 필요' : '검수 필요 상품명'),
        company: sourceCompanies[0] || '미분류',
        companies: sourceCompanies,
        productGroup: group,
        keywords: sourceKeywords,
        confidence
      };
    });
}

function reviewKey(item = {}) {
  return `${item.sourceId || ''}:${item.productName || item.name || ''}`;
}

function applyCatalogReview(item = {}, reviews = {}) {
  const review = reviews[item.id] || reviews[reviewKey(item)];
  if (!review || typeof review !== 'object') return item;
  const status = ['confirmed', 'auto', 'review', 'excluded'].includes(review.status) ? review.status : item.status;
  return {
    ...item,
    productName: cleanText(review.productName || item.productName),
    company: cleanText(review.company || item.company) || item.company,
    productGroup: cleanText(review.productGroup || item.productGroup) || item.productGroup,
    coverageKeywords: Array.isArray(review.coverageKeywords) ? review.coverageKeywords.filter(Boolean) : item.coverageKeywords,
    ageRange: cleanText(review.ageRange || item.ageRange),
    paymentTerm: cleanText(review.paymentTerm || item.paymentTerm),
    renewalType: cleanText(review.renewalType || item.renewalType),
    disclosureMemo: cleanText(review.disclosureMemo || item.disclosureMemo),
    reductionMemo: cleanText(review.reductionMemo || item.reductionMemo),
    premiumExample: cleanText(review.premiumExample || item.premiumExample),
    refundRate: cleanText(review.refundRate || item.refundRate),
    targetAudience: Array.isArray(review.targetAudience) ? review.targetAudience.filter(Boolean) : item.targetAudience,
    excludedAudience: Array.isArray(review.excludedAudience) ? review.excludedAudience.filter(Boolean) : item.excludedAudience,
    cautionMemo: cleanText(review.cautionMemo || item.cautionMemo),
    status,
    confidence: status === 'confirmed' ? 95 : status === 'auto' ? Math.max(Number(item.confidence || 0), 72) : status === 'review' ? 48 : 10,
    reviewReason: cleanText(review.reason || ''),
    reviewedAt: review.reviewedAt || item.reviewedAt || ''
  };
}

function scorePolibotAutoConfirmation(item = {}, occurrenceMap = {}) {
  if (!['auto', 'review'].includes(item.status)) return 0;
  const productName = cleanText(item.productName);
  if (!productName || item.fileType === 'image') return 0;

  let score = item.status === 'auto' ? 25 : 8;
  if (item.completeness === '충분') score += 15;
  if (item.completeness === '보통') score += 8;
  const hasCompanyInName = Boolean(inferCompanyFromProductName(productName));
  const hasStrongSignal = STRONG_PRODUCT_NAME_SIGNAL.test(productName);
  if (hasCompanyInName) score += 25;
  if (hasCompanyInName && /(보험|플랜)$/.test(productName)) score += 3;
  if (hasStrongSignal) score += 20;
  if (item.status === 'auto' && hasStrongSignal) score += 2;
  if (PRODUCT_EVIDENCE_FILE_SIGNAL.test(`${item.fileName || ''} ${item.evidenceFile || ''}`)) score += 8;
  if (item.ageRange) score += 7;
  if (item.paymentTerm) score += 7;
  if (item.premiumExample) score += 7;
  if ((occurrenceMap[normalizeProductKey(productName)] || 0) >= 2) score += 10;

  const tokenCount = productName.split(/\s+/).filter(Boolean).length;
  if (productName.length > 32) score -= 20;
  if (tokenCount >= 5) score -= 18;
  if (/^\d|\d+개|\d+\s/.test(productName)) score -= 12;
  if (GENERIC_AUTO_CONFIRM_NAME.test(productName)) score -= 25;
  if (BAD_AUTO_CONFIRM_NAME.test(productName)) score -= 35;

  return score;
}

function applyAutoConfirmation(item = {}, occurrenceMap = {}) {
  const autoConfirmationScore = scorePolibotAutoConfirmation(item, occurrenceMap);
  if (autoConfirmationScore < AUTO_CONFIRM_SCORE_THRESHOLD) {
    return { ...item, autoConfirmationScore };
  }
  return {
    ...item,
    status: 'confirmed',
    confidence: Math.max(Number(item.confidence || 0), 88),
    autoConfirmed: true,
    autoConfirmationScore,
    reviewReason: item.reviewReason || '근거점수 기준 자동 확정'
  };
}

export function buildPolibotCatalogItems(knowledgeSources = [], options = {}) {
  const includeReview = Boolean(options.includeReview);
  const reviews = options.reviews && typeof options.reviews === 'object' ? options.reviews : {};
  const occurrenceMap = knowledgeSources.reduce((acc, source) => {
    const candidates = Array.isArray(source.productCandidates) && source.productCandidates.length
      ? source.productCandidates
      : buildPolibotProductCandidates({
        text: [source.textSnippet, source.summary, ...(Array.isArray(source.productNames) ? source.productNames : [])].filter(Boolean).join('\n'),
        fileName: source.fileName,
        companies: source.companies || [source.company].filter(Boolean),
        productGroup: source.productGroup,
        keywords: source.keywords || []
      });
    candidates.forEach((candidate) => {
      const key = normalizeProductKey(candidate.name);
      if (key) acc[key] = (acc[key] || 0) + 1;
    });
    return acc;
  }, {});
  return knowledgeSources.flatMap((source) => {
    const candidates = Array.isArray(source.productCandidates) && source.productCandidates.length
      ? source.productCandidates
      : buildPolibotProductCandidates({
        text: [source.textSnippet, source.summary, ...(Array.isArray(source.productNames) ? source.productNames : [])].filter(Boolean).join('\n'),
        fileName: source.fileName,
        companies: source.companies || [source.company].filter(Boolean),
        productGroup: source.productGroup,
        keywords: source.keywords || []
      });
    return candidates
      .filter((candidate) => ['confirmed', 'auto', 'review', 'excluded'].includes(candidate.status))
      .map((candidate) => {
        const sourceContext = [source.textSnippet, source.summary, source.note].filter(Boolean).join('\n');
        const context = [
          candidate.name,
          candidateContext(sourceContext, candidate.name),
          source.fileName
        ].filter(Boolean).join('\n');
        const premiumCandidates = extractPremiumCandidates(context, candidate.name);
        const premiumTableRows = extractPremiumTableRows(context, candidate.name);
        const sourceMeta = {
          sourceId: source.id || '',
          fileName: source.fileName || '',
          month: source.month || '',
          text: context
        };
        const coverageDetails = extractCoverageDetails(context).map((row, index) => normalizeCoverageEvidence(row, { ...sourceMeta, rowIndex: index }));
        const coverageTableRows = extractCoverageTableRows(context).map((row, index) => normalizeCoverageEvidence(row, { ...sourceMeta, rowIndex: index }));
        const conditionDetails = extractConditionDetails(context);
        const linkedBenefitGroups = buildLinkedBenefitGroups({
          productName: candidate.name,
          premiumTableRows,
          premiumCandidates,
          coverageDetails,
          coverageTableRows,
          conditionDetails,
          documentSections: extractDocumentSections(context)
        });
        const inferredCompany = inferCompanyFromProductName(candidate.name);
        const candidateCompanies = candidate.companies?.length ? candidate.companies : source.companies || [source.company].filter(Boolean);
        const companies = inferredCompany
          ? [inferredCompany, ...candidateCompanies.filter((company) => company !== inferredCompany)]
          : candidateCompanies;
        const baseItem = {
        id: `polibot-catalog-${hashText(`${source.id || source.fileName}-${candidate.name}`)}`,
        sourceId: source.id || '',
        fileName: source.fileName || '',
        month: source.month || '',
        fileType: source.fileType || inferPolibotFileType(source.fileName),
        company: inferredCompany || candidate.company || source.company || '미분류',
        companies,
        productName: candidate.name,
        productGroup: candidate.productGroup || source.productGroup || '종합 보장',
        coverageKeywords: candidate.keywords?.length ? candidate.keywords : source.keywords || [],
        eligibilityMemo: [
          /간편|유병자|고지/.test(`${candidate.name} ${source.textSnippet || ''}`) && '간편/고지 조건 확인',
          /어린이|태아/.test(`${candidate.name} ${source.textSnippet || ''}`) && '자녀/태아 가입 조건 확인',
          /경영인|정기/.test(`${candidate.name} ${source.textSnippet || ''}`) && '법인/경영인 목적 확인'
        ].filter(Boolean).join(' · ') || '약관/가입설계서 확인',
        ageRange: conditionDetails.ageRange,
        paymentTerm: conditionDetails.paymentTerm,
        renewalType: conditionDetails.renewalType,
        disclosureMemo: conditionDetails.disclosureMemo,
        reductionMemo: conditionDetails.reductionMemo,
        premiumExample: premiumCandidates[0]?.amount || extractPremiumExample(context),
        premiumCandidates,
        premiumTableRows,
        premiumConfidence: premiumCandidates[0]?.confidence || (extractPremiumExample(context) ? 'confirmed' : 'none'),
        refundRate: conditionDetails.refundRate,
        coverageDetails,
        coverageTableRows,
        conditionDetails,
        conditionRules: conditionDetails.conditionRules || {},
        linkedBenefitGroups,
        evidenceAnchors: [
          evidenceAnchor({ ...sourceMeta, excerpt: candidate.name, label: '상품명' }),
          ...coverageDetails.slice(0, 6).map((row) => row.evidenceAnchor).filter(Boolean)
        ],
        targetAudience: source.targetAudience || extractAudience(context),
        excludedAudience: conditionDetails.excludedAudience,
        cautionMemo: extractCautions(context).join(' · '),
        cautions: source.cautions || extractCautions(context),
        evidenceFile: source.fileName || '',
        evidenceMonth: source.month || '',
        confidence: candidate.confidence,
        status: candidate.status
        };
        const reviewed = applyCatalogReview(baseItem, reviews);
        const completed = {
          ...reviewed,
          completeness: catalogCompleteness(reviewed)
        };
        return applyAutoConfirmation(completed, occurrenceMap);
      })
      .filter((item) => includeReview
        ? ['confirmed', 'auto', 'review', 'excluded'].includes(item.status)
        : item.status === 'confirmed' && Number(item.confidence || 0) >= 80);
  });
}

export async function normalizePolibotKnowledgeItems({ files = [], month = '', note = '' } = {}) {
  const items = [];
  for (const [index, file] of (Array.isArray(files) ? files : []).entries()) {
    const fileName = String(file?.name || file?.fileName || '').trim();
    let text = String(file?.text || file?.memo || '').trim();
    if (!text && file?.base64) {
      try {
        text = await extractPolibotTextFromBuffer(Buffer.from(String(file.base64), 'base64'), fileName);
      } catch {
        text = '';
      }
    }
    if (!fileName && !text && !note) continue;
    const source = normalizePolibotKnowledgeSource({
      fileName: fileName || `자료 ${index + 1}`,
      text,
      month,
      note,
      size: file?.size || 0,
      type: inferPolibotFileType(fileName)
    });
    items.push(source);
  }
  if (items.length === 0 && note) {
    items.push(normalizePolibotKnowledgeSource({ fileName: '월별 메모', text: note, month, note, type: 'memo' }));
  }
  return items.slice(0, 80);
}

export function polibotSeedKnowledgeSources() {
  const seed = safeJsonSeed();
  if (seed.length) return seed;
  return [];
}

export function buildPolibotCatalog(knowledgeSources = []) {
  const companies = [...new Set(
    knowledgeSources
      .flatMap((item) => Array.isArray(item.companies) && item.companies.length ? item.companies : [item.company])
      .filter((company) => company && company !== '미분류')
  )].sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set(knowledgeSources.map((item) => item.productGroup).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const months = [...new Set(knowledgeSources.map((item) => item.month).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  return { companies, productGroups, months };
}

export function rankPolibotEvidence(knowledgeSources = [], profile = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  const needsText = needs.join(' ');
  const selectedCompany = String(profile.company || '').trim();
  const diseaseNeeds = needs.some((need) => /암|뇌|심장|수술|입원|실손|실비|질병|간병|치매/.test(need));
  return [...knowledgeSources]
    .map((item) => {
      const companies = Array.isArray(item.companies) && item.companies.length ? item.companies : [item.company].filter(Boolean);
      const companyMatch = selectedCompany && companies.includes(selectedCompany);
      const keywordHits = (item.keywords || []).filter((keyword) => needsText.includes(keyword));
      const groupHit = item.productGroup && needsText.includes(String(item.productGroup).replace('/',''));
      const qualityScore = Number(item.evidenceQualityScore || 0);
      const qualityBonus = qualityScore ? Math.min(14, Math.round(qualityScore / 8)) : 0;
      const lowTrustPenalty = item.sourceChannel === 'kakao_txt' ? 14 : 0;
      const privacyPenalty = item.knowledgeStatus === 'privacy_risk' ? 80 : 0;
      const ocrPenalty = item.knowledgeStatus === 'ocr_needed' ? 40 : 0;
      const driverMismatchPenalty = diseaseNeeds && /운전자/.test(String(item.productGroup || '')) && !needsText.includes('운전자') ? 18 : 0;
      const score = (companyMatch ? 30 : 0)
        + keywordHits.length * 9
        + (groupHit ? 8 : 0)
        + (item.month ? 3 : 0)
        + qualityBonus
        - lowTrustPenalty
        - privacyPenalty
        - ocrPenalty
        - driverMismatchPenalty;
      return { ...item, matchScore: score, keywordHits };
    })
    .filter((item) => !selectedCompany || selectedCompany === '전체 보험사' || (item.companies || [item.company]).includes(selectedCompany))
    .sort((a, b) => b.matchScore - a.matchScore || String(b.month || '').localeCompare(String(a.month || '')))
    .slice(0, 40);
}
