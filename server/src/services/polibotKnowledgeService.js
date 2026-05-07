import AdmZip from 'adm-zip';
import { PDFParse } from 'pdf-parse';
import { readFileSync } from 'node:fs';

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

const BAD_PRODUCT_PHRASE = /가이드북|자료이용|상품비교|자료모음|상품전략|금융환경|관심상품|영업이슈|보험의\s*A|상품의\s*기본|간추린|상품\s*안내|본\s*내용|예시된|따라서|고객\s*조건|보장분석|가입담보|님의\s*상품별|판매되고\s*있는|자료는\s*상품|보험이\s*어려운|알쓸신통|주요국가|기준금리|세계\s*경제뉴스|국내\s*경제뉴스|보험시장|비급여|데이터로\s*읽는|2030\s*보험|보험영업에서|반드시\s*챙겨야|사내\s*교육용|교육\s*목적|무단배포|경제뉴스|시장\s*선점|고객명|피보험자|현재\s*가입|증권|pdf|pptx|xlsx|csv|https?:/i;

const CONFIRMED_PRODUCT_HINT = /\(무\)|무배당|The|THE|Plus|PLUS|플러스|마이라이프|슬기로운|알뜰한|경영인|프리미엄|위너스|원픽|하이픽|더드림|세븐|Q|Ⅱ|Ⅲ|IV|V/i;

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

export function inferKnowledgeMonth(value = '', fallbackDate = new Date()) {
  const text = String(value || '').normalize('NFC');
  const yearMonth = text.match(/(20\d{2})[-_.년\s]*(0?[1-9]|1[0-2])/);
  if (yearMonth) return `${yearMonth[1]}-${String(yearMonth[2]).padStart(2, '0')}`;
  const compact = text.match(/(^|[^0-9])(\d{2})(0[1-9]|1[0-2])([^0-9]|$)/);
  if (compact) return `20${compact[2]}-${compact[3]}`;
  return `${fallbackDate.getFullYear()}-${String(fallbackDate.getMonth() + 1).padStart(2, '0')}`;
}

export function inferPolibotFileType(fileName = '') {
  const ext = String(fileName || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  if (['pdf', 'pptx', 'ppt', 'csv', 'txt'].includes(ext)) return ext;
  if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'image';
  return ext || 'unknown';
}

export async function extractPolibotTextFromBuffer(buffer, fileName = '') {
  const fileType = inferPolibotFileType(fileName);
  if (!buffer?.length) return '';
  if (fileType === 'csv' || fileType === 'txt') return cleanText(buffer.toString('utf8'));
  if (fileType === 'pdf') {
    const parser = new PDFParse({ data: buffer });
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
  const sourceText = cleanText([cleanFileName, text, note].filter(Boolean).join('\n'));
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
    textSnippet: cleanText(text).slice(0, 1500)
  }]);
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
    productNames: catalogItems.map((item) => item.productName).slice(0, 8),
    keywords,
    targetAudience: extractAudience(sourceText),
    cautions: extractCautions(sourceText),
    summary: summarizeText(sourceText, keywords),
    textSnippet: cleanText(text).slice(0, 1500),
    note: cleanText(note),
    size: Number(size || 0),
    uploadedAt: new Date().toISOString()
  };
}

function normalizeProductCandidateName(value = '') {
  return cleanText(value)
    .replace(/\.(pdf|pptx?|xlsx|csv|txt)$/ig, ' ')
    .replace(/상품명|구\s*분|보험료|변경월|변경일|작성기준일/gi, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/^\s*\d+(?:[,.\d]*원|\s*세|년|개월)?\s*/g, ' ')
    .replace(/^(?:남성|여성|보장|담보|합계|월납|기준|순위|일반|간편)\s*/g, ' ')
    .replace(/[{}[\]←→󰀲︙|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function productCandidateReason(name = '', sourceText = '') {
  const normalized = name.replace(/\s+/g, '');
  const companyMentions = INSURANCE_COMPANIES.filter((company) => name.includes(company) || normalized.includes(company.replace(/\s+/g, '')));
  const tokenCount = name.split(/\s+/).filter(Boolean).length;
  const suffixCount = (name.match(/보험|플랜|특약|담보|진단비|수술비|입원비|간병비/g) || []).length;
  if (!name) return 'empty';
  if (name.length < 4 || name.length > 38) return 'length';
  if (/^[가-힣A-Za-z]\s+/.test(name)) return 'broken_leading_token';
  if (companyMentions.length >= 2) return 'multiple_companies_in_candidate';
  if (suffixCount >= 2) return 'multiple_products_in_candidate';
  if (tokenCount >= 5) return 'table_row_fragment';
  if (!/(보험|플랜|특약|담보|진단비|수술비|입원비|간병비)/.test(name)) return 'no_product_suffix';
  if (GENERIC_PRODUCT_NAMES.has(normalized)) return 'generic';
  if (BAD_PRODUCT_PHRASE.test(name)) return 'document_or_training_phrase';
  if (/^\d|[,]{2,}|[?]{2,}/.test(name)) return 'broken_text';
  if (/님|고객|보장분석|현재\s*가입/.test(sourceText.slice(0, 160)) && !CONFIRMED_PRODUCT_HINT.test(name)) return 'customer_analysis_document';
  return '';
}

function rawProductCandidateTexts(text = '', fileName = '') {
  const source = cleanText(`${fileName}\n${text}`);
  const patterns = [
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
      const status = rejectReason
        ? 'excluded'
        : hasStrongHint || hasCompany ? 'confirmed' : 'auto';
      const confidence = status === 'confirmed' ? 88 : status === 'auto' ? 68 : 20;
      return {
        name,
        status,
        reason: rejectReason || (status === 'confirmed' ? '상품명 신뢰도 높음' : '자동 추출 상품명'),
        company: sourceCompanies[0] || '미분류',
        companies: sourceCompanies,
        productGroup: group,
        keywords: sourceKeywords,
        confidence
      };
    });
}

export function buildPolibotCatalogItems(knowledgeSources = []) {
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
      .filter((candidate) => ['confirmed', 'auto'].includes(candidate.status))
      .filter((candidate) => candidate.confidence >= 65)
      .map((candidate) => ({
        id: `polibot-catalog-${hashText(`${source.id || source.fileName}-${candidate.name}`)}`,
        sourceId: source.id || '',
        fileName: source.fileName || '',
        month: source.month || '',
        fileType: source.fileType || inferPolibotFileType(source.fileName),
        company: candidate.company || source.company || '미분류',
        companies: candidate.companies?.length ? candidate.companies : source.companies || [source.company].filter(Boolean),
        productName: candidate.name,
        productGroup: candidate.productGroup || source.productGroup || '종합 보장',
        coverageKeywords: candidate.keywords?.length ? candidate.keywords : source.keywords || [],
        eligibilityMemo: [
          /간편|유병자|고지/.test(`${candidate.name} ${source.textSnippet || ''}`) && '간편/고지 조건 확인',
          /어린이|태아/.test(`${candidate.name} ${source.textSnippet || ''}`) && '자녀/태아 가입 조건 확인',
          /경영인|정기/.test(`${candidate.name} ${source.textSnippet || ''}`) && '법인/경영인 목적 확인'
        ].filter(Boolean).join(' · ') || '약관/가입설계서 확인',
        cautions: source.cautions || [],
        evidenceFile: source.fileName || '',
        evidenceMonth: source.month || '',
        confidence: candidate.confidence,
        status: candidate.status
      }));
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
  return [...knowledgeSources]
    .map((item) => {
      const companies = Array.isArray(item.companies) && item.companies.length ? item.companies : [item.company].filter(Boolean);
      const companyMatch = selectedCompany && companies.includes(selectedCompany);
      const keywordHits = (item.keywords || []).filter((keyword) => needsText.includes(keyword));
      const groupHit = item.productGroup && needsText.includes(String(item.productGroup).replace('/',''));
      const score = (companyMatch ? 30 : 0) + keywordHits.length * 9 + (groupHit ? 8 : 0) + (item.month ? 3 : 0);
      return { ...item, matchScore: score, keywordHits };
    })
    .filter((item) => !selectedCompany || selectedCompany === '전체 보험사' || (item.companies || [item.company]).includes(selectedCompany))
    .sort((a, b) => b.matchScore - a.matchScore || String(b.month || '').localeCompare(String(a.month || '')))
    .slice(0, 12);
}
