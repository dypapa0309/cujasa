import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { dbGet, dbInsert, dbList, dbUpdate, safeLogActivity, supabase } from './supabaseService.js';
import {
  buildPolibotCatalogItems,
  extractPolibotCoverageCodes,
  extractPolibotKeywords,
  extractPolibotTextFromBuffer,
  inferPolibotFileType,
  normalizePolibotKnowledgeSource
} from './polibotKnowledgeService.js';
import { extractPolibotOcrText } from './polibotKnowledgeOcrService.js';

const PARSER_VERSION = 'polibot-parser-v1';
const EXTRACTOR_VERSION = 'polibot-extractor-v1';
const CLASSIFIER_VERSION = 'polibot-classifier-v1';
const GLOBAL_USER_ID = '00000000-0000-0000-0000-000000000000';
const VALID_SCOPES = new Set(['global', 'user']);
const VALID_SOURCE_CHANNELS = new Set(['local_ingest', 'web_upload', 'admin_upload', 'kakao_txt']);
const INSURANCE_SIGNAL = /보험|보장|담보|보험료|암|뇌|심장|실손|실비|진단비|수술|입원|통원|간병|치매|운전자|고지|면책|감액|부담보|갱신|비갱신|환급|납입|만기|가입|상해|질병|사망|후유장해/;
const KAKAO_TIME_PREFIX = /^\[?[^,\]\n]{1,30}\]?\s*(?:오전|오후)?\s*\d{1,2}:\d{2}/;
const OFFICIAL_SOURCE_SIGNAL = /상품비교|가입설계|보험료|현황|약관|요약서|제안서|보장분석|담보|플랜/i;
const LOW_TRUST_SOURCE_CHANNELS = new Set(['kakao_txt']);
const VALID_KNOWLEDGE_STATUSES = new Set(['recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict']);
const SEARCHABLE_CODE_STATUSES = new Set(['recommendable', 'review_needed', 'conflict']);
const OCR_IMAGE_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};
const MAX_OCR_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_STORAGE_UPLOAD_BYTES = 24 * 1024 * 1024;
const POLIBOT_STORAGE_BUCKET = process.env.POLIBOT_STORAGE_BUCKET || 'polibot-knowledge';
const CODE_SEARCH_CACHE_TTL_MS = 60 * 1000;
const IMPORTED_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
const codeSearchCache = new Map();
let importedSourceCache = null;

function now() {
  return new Date().toISOString();
}

function sha256(value = '') {
  return createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function normalizeScope(scope = 'user') {
  return VALID_SCOPES.has(scope) ? scope : 'user';
}

function normalizeSourceChannel(sourceChannel = 'web_upload') {
  return VALID_SOURCE_CHANNELS.has(sourceChannel) ? sourceChannel : 'web_upload';
}

function assertScopeUser(scope, userId) {
  if (scope === 'user' && !userId) {
    const error = new Error('사용자 범위 자료에는 userId가 필요해요.');
    error.status = 400;
    throw error;
  }
}

function sourceUserId(scope, userId) {
  return scope === 'global' ? null : userId;
}

function dedupeUserId(scope, userId) {
  return scope === 'global' ? GLOBAL_USER_ID : userId;
}

function sanitizeStorageName(fileName = 'source') {
  return String(fileName || 'source')
    .normalize('NFKD')
    .replace(/[^\w.\-가-힣]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'source';
}

function parseSupabaseStoragePath(storagePath = '') {
  const value = String(storagePath || '').trim();
  if (!value.startsWith('supabase://')) return null;
  const withoutScheme = value.replace(/^supabase:\/\//, '');
  const slashIndex = withoutScheme.indexOf('/');
  if (slashIndex <= 0) return null;
  return {
    bucket: withoutScheme.slice(0, slashIndex),
    objectPath: withoutScheme.slice(slashIndex + 1)
  };
}

async function uploadOriginalToStorage({ file, scope, userId, fileHash }) {
  if (!supabase || !file?.base64 || file?.storagePath) return file?.storagePath || '';
  const buffer = Buffer.from(String(file.base64), 'base64');
  if (!buffer.length || buffer.length > MAX_STORAGE_UPLOAD_BYTES) return '';
  const hash = fileHash || sha256Buffer(buffer);
  const fileName = sanitizeStorageName(file.fileName || file.name || `source-${hash.slice(0, 12)}`);
  const scopedUserId = scope === 'global' ? 'global' : userId;
  const objectPath = [
    scope,
    scopedUserId || 'unknown-user',
    new Date().toISOString().slice(0, 10),
    `${hash.slice(0, 16)}-${fileName}`
  ].join('/');
  const contentType = file.mimeType || (String(file.type || '').includes('/') ? file.type : '') || 'application/octet-stream';
  const { error } = await supabase.storage
    .from(POLIBOT_STORAGE_BUCKET)
    .upload(objectPath, buffer, {
      contentType,
      upsert: false
    });
  if (error) {
    await safeLogActivity({
      user_id: userId || null,
      action: 'polibot_storage_upload_failed',
      level: 'warn',
      message: `POLIBOT 원본 저장 실패: ${fileName}`,
      payload: { bucket: POLIBOT_STORAGE_BUCKET, objectPath, error: error.message || String(error) }
    });
    return '';
  }
  return `supabase://${POLIBOT_STORAGE_BUCKET}/${objectPath}`;
}

function redactedInsuranceText(text = '') {
  return String(text || '')
    .replace(/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/g, '[전화번호]')
    .replace(/\b\d{6}[-\s]?[1-4]\d{6}\b/g, '[민감번호]')
    .replace(/\b(?:19|20)\d{2}[.\-/년\s]?\d{1,2}[.\-/월\s]?\d{1,2}일?\b/g, '[생년월일/날짜]')
    .replace(/\b\d{2,4}[-\s]?\d{3,4}[-\s]?\d{4,6}\b/g, '[번호]')
    .replace(/\b\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4,8}\b/g, '[계좌/번호]')
    .replace(/([가-힣]{2,4})(?:\s*(?:고객|님|씨))/g, '[이름]')
    .replace(/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{0,40}(?:구|군|시|동|읍|면|로|길)\s*\d{0,4}/g, '[주소]');
}

function privacyRiskScore(text = '') {
  let score = 0;
  if (/\b01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}\b/.test(text)) score += 3;
  if (/\b\d{6}[-\s]?[1-4]\d{6}\b/.test(text)) score += 5;
  if (/\b(?:19|20)\d{2}[.\-/년\s]?\d{1,2}[.\-/월\s]?\d{1,2}일?\b/.test(text)) score += 2;
  if (/(?:계좌|카드|은행|입금|출금)[^\n]{0,20}\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4,8}/.test(text)) score += 4;
  if (/(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[^\n,]{0,40}(?:구|군|시|동|읍|면|로|길)/.test(text)) score += 2;
  return score;
}

function privacyRiskLevel(score = 0) {
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  if (score > 0) return 'low';
  return 'none';
}

function insuranceRelevanceScore(text = '') {
  const keywords = extractPolibotKeywords(text);
  return Math.min(100, keywords.length * 12 + (INSURANCE_SIGNAL.test(text) ? 25 : 0));
}

function parseKnowledgeMonth(month = '') {
  const match = String(month || '').match(/(20\d{2})[-.년\s]?\s*(0?[1-9]|1[0-2])?/);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNumber = Number(match[2] || 1);
  return Number.isFinite(year) ? { year, month: monthNumber } : null;
}

function sourceFreshnessScore(month = '') {
  const parsed = parseKnowledgeMonth(month);
  if (!parsed) return 4;
  const current = new Date();
  const ageMonths = Math.max(0, (current.getFullYear() - parsed.year) * 12 + (current.getMonth() + 1 - parsed.month));
  if (ageMonths <= 1) return 16;
  if (ageMonths <= 3) return 13;
  if (ageMonths <= 6) return 10;
  if (ageMonths <= 12) return 6;
  return 2;
}

function sourceTrustScore(sourceChannel = 'web_upload') {
  if (sourceChannel === 'admin_upload') return 18;
  if (sourceChannel === 'local_ingest') return 15;
  if (sourceChannel === 'web_upload') return 10;
  if (sourceChannel === 'kakao_txt') return 3;
  return 6;
}

function sourceQualityMetadata({ sourceChannel, fileName, month, normalizedSource, rawText, status } = {}) {
  const text = `${fileName || ''}\n${rawText || ''}`;
  const companies = Array.isArray(normalizedSource?.companies) ? normalizedSource.companies : [];
  const productNames = Array.isArray(normalizedSource?.productNames) ? normalizedSource.productNames : [];
  let score = 35;
  const reasons = [];
  const trust = sourceTrustScore(sourceChannel);
  const freshness = sourceFreshnessScore(month);
  score += trust + freshness;
  if (sourceChannel === 'admin_upload' || sourceChannel === 'local_ingest') reasons.push('운영 자료');
  if (sourceChannel === 'kakao_txt') reasons.push('상담 대화 자료');
  if (OFFICIAL_SOURCE_SIGNAL.test(text)) {
    score += 12;
    reasons.push('상품/보험료 자료 맥락');
  }
  if (companies.length > 0) {
    score += 8;
    reasons.push('보험사 확인');
  }
  if (productNames.length > 0) {
    score += 10;
    reasons.push('상품명 후보 확인');
  }
  if (status === 'ocr_needed') {
    score -= 30;
    reasons.push('OCR 필요');
  }
  if (status === 'privacy_risk') {
    score -= 45;
    reasons.push('개인정보 위험');
  }
  if (LOW_TRUST_SOURCE_CHANNELS.has(sourceChannel)) score -= 12;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 78 ? 'high' : score >= 58 ? 'medium' : score >= 38 ? 'low' : 'blocked';
  return {
    score,
    level,
    reasons: reasons.length ? reasons : ['기본 자료']
  };
}

function splitKakaoChunks(text = '') {
  const groups = [];
  let current = [];
  String(text || '').split(/\r?\n/).forEach((line) => {
    const clean = line.trim();
    if (!clean) return;
    if (KAKAO_TIME_PREFIX.test(clean) && current.length >= 8) {
      groups.push(current.join('\n'));
      current = [];
    }
    current.push(clean);
  });
  if (current.length) groups.push(current.join('\n'));
  return groups;
}

function detectSourceChannel(file = {}, text = '', fallback = 'web_upload') {
  const fileName = String(file.fileName || file.name || '').toLowerCase();
  if (fallback === 'web_upload' && /\.txt$/.test(fileName) && KAKAO_TIME_PREFIX.test(String(text || '').split(/\r?\n/).find(Boolean) || '')) {
    return 'kakao_txt';
  }
  return fallback;
}

async function prepareIngestFile(file = {}) {
  const fileName = String(file?.fileName || file?.name || '').trim();
  const inferredType = inferPolibotFileType(fileName);
  const fileType = inferredType !== 'unknown' ? inferredType : file?.type || 'unknown';
  let text = String(file?.text || file?.memo || '').trim();
  if (!text && file?.base64 && fileType !== 'image') {
    try {
      text = await extractPolibotTextFromBuffer(Buffer.from(String(file.base64), 'base64'), fileName);
    } catch {
      text = '';
    }
  }
  const fileHash = file?.fileHash || sha256([
    fileName,
    file?.size || 0,
    file?.base64 || text || ''
  ].join('\n'));
  return {
    ...file,
    fileName,
    name: file?.name || fileName,
    type: fileType,
    mimeType: file?.mimeType || (String(file?.type || '').includes('/') ? file.type : ''),
    text,
    fileHash
  };
}

function splitTextChunks(text = '', sourceChannel = 'web_upload') {
  const clean = String(text || '').replace(/\r/g, '\n').trim();
  if (!clean) return [];
  const rawChunks = sourceChannel === 'kakao_txt'
    ? splitKakaoChunks(clean)
    : clean
      .split(/\n{2,}|(?=.{700,1200}(?:\n|$))/g)
      .map((item) => item.trim())
      .filter(Boolean);
  const chunks = rawChunks.flatMap((chunk) => {
    if (chunk.length <= 1400) return [chunk];
    const parts = [];
    for (let index = 0; index < chunk.length; index += 1000) {
      parts.push(chunk.slice(index, index + 1200));
    }
    return parts;
  });
  return chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length >= 8)
    .filter((chunk, index, all) => all.indexOf(chunk) === index)
    .slice(0, 80);
}

function sourceStatus({ fileType = '', text = '', normalizedSource = {} } = {}) {
  if (privacyRiskScore(text) >= 3) return 'privacy_risk';
  if (fileType === 'hwp') return 'review_needed';
  const cleanText = String(text || normalizedSource.textSnippet || '').trim();
  if (fileType === 'image' && !cleanText) return 'ocr_needed';
  if (['pdf', 'ppt', 'pptx'].includes(fileType) && cleanText.length < 20) return 'ocr_needed';
  const catalogItems = Array.isArray(normalizedSource.catalogItems) ? normalizedSource.catalogItems : [];
  if (catalogItems.some((item) => ['confirmed', 'auto'].includes(item.status))) return 'recommendable';
  if (!INSURANCE_SIGNAL.test(`${text} ${normalizedSource.fileName || ''}`)) return 'excluded';
  return 'review_needed';
}

function mimeTypeFromFileName(fileName = '') {
  return OCR_IMAGE_MIME_TYPES[extname(String(fileName || '').toLowerCase())] || '';
}

async function resolveOcrInput(source = {}) {
  const fileType = source.file_type || inferPolibotFileType(source.file_name || '');
  if (fileType !== 'image') {
    const error = new Error(fileType === 'pdf'
      ? '스캔 PDF OCR은 페이지 이미지 변환 연결 후 실행할 수 있어요. 현재는 이미지 OCR부터 지원합니다.'
      : '현재 OCR 실행은 이미지 파일부터 지원합니다.');
    error.status = 400;
    throw error;
  }
  const storagePath = String(source.storage_path || '').trim();
  if (!storagePath) {
    const error = new Error('OCR 원본 파일 경로가 없어 실행할 수 없어요. Storage 저장 경로를 먼저 연결해 주세요.');
    error.status = 400;
    throw error;
  }
  const supabaseStorage = parseSupabaseStoragePath(storagePath);
  if (supabaseStorage) {
    if (!supabase) {
      const error = new Error('Supabase Storage 연결 설정이 없어 OCR 원본을 내려받을 수 없어요.');
      error.status = 503;
      throw error;
    }
    const { data, error: downloadError } = await supabase.storage
      .from(supabaseStorage.bucket)
      .download(supabaseStorage.objectPath);
    if (downloadError) {
      const error = new Error(`OCR 원본 다운로드 실패: ${downloadError.message || downloadError}`);
      error.status = 502;
      throw error;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > MAX_OCR_IMAGE_BYTES) {
      const error = new Error('OCR 이미지가 너무 큽니다. 18MB 이하 이미지로 나눠서 처리해 주세요.');
      error.status = 413;
      throw error;
    }
    const mimeType = data.type || mimeTypeFromFileName(source.file_name || supabaseStorage.objectPath);
    if (!mimeType || !mimeType.startsWith('image/')) {
      const error = new Error('지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 파일을 사용해 주세요.');
      error.status = 400;
      throw error;
    }
    return {
      base64: buffer.toString('base64'),
      mimeType,
      bytes: buffer.length
    };
  }
  const fileStat = await stat(storagePath);
  if (fileStat.size > MAX_OCR_IMAGE_BYTES) {
    const error = new Error('OCR 이미지가 너무 큽니다. 18MB 이하 이미지로 나눠서 처리해 주세요.');
    error.status = 413;
    throw error;
  }
  const buffer = await readFile(storagePath);
  const mimeType = mimeTypeFromFileName(source.file_name || storagePath);
  if (!mimeType) {
    const error = new Error('지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP 파일을 사용해 주세요.');
    error.status = 400;
    throw error;
  }
  return {
    base64: buffer.toString('base64'),
    mimeType,
    bytes: fileStat.size
  };
}

function catalogStatus(item = {}) {
  if (item.status === 'excluded') return 'excluded';
  if (['confirmed', 'auto'].includes(item.status)) return 'recommendable';
  return 'review_needed';
}

function catalogScore(item = {}) {
  const base = Number(item.confidence || 0);
  const completeness = item.completeness === '충분' ? 15 : item.completeness === '보통' ? 8 : 0;
  return Math.max(0, Math.min(100, Math.round(base + completeness)));
}

function catalogRowFromItem({ item, sourceRow, jobId, scope, userId }) {
  const score = catalogScore(item);
  return {
    ingest_job_id: jobId || null,
    source_id: sourceRow.id,
    user_id: sourceUserId(scope, userId),
    scope,
    status: catalogStatus(item),
    company: item.company || '미분류',
    product_name: item.productName || '상품명 미확인',
    product_group: item.productGroup || '종합 보장',
    coverage_keywords: item.coverageKeywords || [],
    premium_example: item.premiumExample || '',
    age_range: item.ageRange || '',
    payment_term: item.paymentTerm || '',
    renewal_type: item.renewalType || '',
    disclosure_memo: item.disclosureMemo || '',
    reduction_memo: item.reductionMemo || '',
    target_audience: item.targetAudience || [],
    excluded_audience: item.excludedAudience || [],
    completeness: item.completeness || '',
    auto_confirm_score: score,
    confidence_score: Number(item.confidence || score || 0),
    effective_month: item.evidenceMonth || sourceRow.month || '',
    evidence: {
      sourceId: sourceRow.id,
      fileName: sourceRow.file_name,
      month: sourceRow.month,
      status: item.status || ''
    },
    metadata: {
      legacyId: item.id || '',
      cautionMemo: item.cautionMemo || '',
      premiumConfidence: item.premiumConfidence || '',
      premiumCandidates: item.premiumCandidates || [],
      premiumTableRows: item.premiumTableRows || [],
      coverageDetails: item.coverageDetails || [],
      coverageTableRows: item.coverageTableRows || [],
      conditionDetails: item.conditionDetails || {},
      conditionRules: item.conditionRules || item.conditionDetails?.conditionRules || {},
      linkedBenefitGroups: item.linkedBenefitGroups || [],
      evidenceAnchors: item.evidenceAnchors || [],
      analysisQuality: {
        premiumCandidateCount: Array.isArray(item.premiumCandidates) ? item.premiumCandidates.length : 0,
        premiumTableRowCount: Array.isArray(item.premiumTableRows) ? item.premiumTableRows.length : 0,
        coverageDetailCount: Array.isArray(item.coverageDetails) ? item.coverageDetails.length : 0,
        coverageTableRowCount: Array.isArray(item.coverageTableRows) ? item.coverageTableRows.length : 0,
        linkedBenefitGroupCount: Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.length : 0,
        hasConditionDetails: Boolean(item.conditionDetails && Object.values(item.conditionDetails).some(Boolean))
      }
    },
    parser_version: PARSER_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    classifier_version: CLASSIFIER_VERSION
  };
}

function normalizeComparableValue(value = '') {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[~〜]/g, '-')
    .trim();
}

function catalogConflictReasons(row = {}, existingRows = []) {
  const fields = [
    ['premium_example', '보험료'],
    ['age_range', '가입연령'],
    ['renewal_type', '갱신 여부']
  ];
  const reasons = [];
  existingRows.forEach((existing) => {
    fields.forEach(([key, label]) => {
      const nextValue = normalizeComparableValue(row[key]);
      const existingValue = normalizeComparableValue(existing[key]);
      if (!nextValue || !existingValue || nextValue === existingValue) return;
      reasons.push(`${label} 충돌: ${existing[key]} / ${row[key]}`);
    });
  });
  return [...new Set(reasons)].slice(0, 6);
}

async function findCatalogConflicts({ scope, userId, row }) {
  if (!row.company || !row.product_name || row.company === '미분류' || row.product_name === '상품명 미확인') return [];
  const filters = {
    scope,
    user_id: scope === 'global' ? null : userId,
    company: row.company,
    product_name: row.product_name
  };
  const existingRows = await dbList('polibot_catalog_items', filters, { order: 'created_at', ascending: false, limit: 20 }).catch(() => []);
  return catalogConflictReasons(row, existingRows);
}

function sourceFromDb(row = {}, catalogItems = []) {
  const normalized = row.normalized_source && typeof row.normalized_source === 'object' ? row.normalized_source : {};
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const recommendationEligible = metadata.recommendationEligible !== false
    && !['privacy_risk', 'ocr_needed', 'excluded', 'conflict'].includes(row.status);
  return {
    ...normalized,
    id: row.id,
    fileName: row.file_name || normalized.fileName || '',
    month: row.month || normalized.month || '',
    fileType: row.file_type || normalized.fileType || '',
    companies: Array.isArray(row.companies) ? row.companies : normalized.companies || [],
    company: row.company || normalized.company || '미분류',
    productGroup: row.product_group || normalized.productGroup || '',
    keywords: Array.isArray(row.keywords) ? row.keywords : normalized.keywords || [],
    productNames: Array.isArray(row.product_names) ? row.product_names : normalized.productNames || [],
    textSnippet: row.text_snippet || normalized.textSnippet || '',
    redactedSnippet: row.redacted_snippet || '',
    catalogItems: catalogItems.length ? catalogItems : normalized.catalogItems || [],
    dbSourceId: row.id,
    scope: row.scope,
    sourceChannel: row.source_channel,
    knowledgeStatus: row.status,
    recommendationEligible,
    privacyRiskScore: metadata.privacyRiskScore || 0,
    privacyRiskLevel: metadata.privacyRiskLevel || 'none',
    evidenceQualityScore: Number(metadata.evidenceQualityScore || 0),
    evidenceQualityLevel: metadata.evidenceQualityLevel || '',
    evidenceQualityReasons: Array.isArray(metadata.evidenceQualityReasons) ? metadata.evidenceQualityReasons : []
  };
}

function normalizeCatalogRow(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const productName = cleanCatalogProductName(row.product_name || '', row.company);
  const coverageKeywords = row.coverage_keywords || [];
  const status = isCatalogNonProductName(productName, row.company)
    ? 'excluded'
    : row.status === 'recommendable' ? 'confirmed' : row.status === 'excluded' || row.status === 'conflict' ? 'excluded' : 'review';
  return {
    id: row.id,
    sourceId: row.source_id || '',
    company: row.company || '미분류',
    productName,
    productGroup: inferCatalogProductGroup({ productName, productGroup: row.product_group, coverageTags: coverageKeywords }),
    coverageKeywords,
    premiumExample: row.premium_example || '',
    premiumCandidates: metadata.premiumCandidates || [],
    premiumTableRows: metadata.premiumTableRows || [],
    coverageDetails: metadata.coverageDetails || [],
    coverageTableRows: metadata.coverageTableRows || [],
    conditionDetails: metadata.conditionDetails || {},
    conditionRules: metadata.conditionRules || metadata.conditionDetails?.conditionRules || {},
    linkedBenefitGroups: metadata.linkedBenefitGroups || [],
    evidenceAnchors: metadata.evidenceAnchors || [],
    ageRange: row.age_range || '',
    paymentTerm: row.payment_term || '',
    renewalType: row.renewal_type || '',
    disclosureMemo: row.disclosure_memo || '',
    reductionMemo: row.reduction_memo || '',
    targetAudience: row.target_audience || [],
    excludedAudience: row.excluded_audience || [],
    completeness: row.completeness || '',
    confidence: row.confidence_score || row.auto_confirm_score || 0,
    status,
    evidenceFile: row.evidence?.fileName || '',
    evidenceMonth: row.effective_month || '',
    conflictReasons: Array.isArray(row.metadata?.conflictReasons) ? row.metadata.conflictReasons : []
  };
}

function normalizeImportedCatalogStatus(status = '') {
  const value = String(status || '').trim().toLowerCase();
  if (['verified', 'approved', 'recommendable', 'confirmed', 'auto'].includes(value)) return 'confirmed';
  if (['excluded', 'rejected', 'hidden'].includes(value)) return 'excluded';
  return 'review';
}

function importedReviewStatusFromPolibotStatus(status = '') {
  const value = normalizeReviewStatus(status || 'review_needed');
  if (value === 'recommendable') return 'confirmed';
  if (value === 'excluded') return 'excluded';
  if (value === 'conflict') return 'needs_review';
  return 'needs_review';
}

function polibotStatusFromImportedStatus(status = '') {
  const value = normalizeImportedCatalogStatus(status);
  if (value === 'confirmed') return 'recommendable';
  if (value === 'excluded') return 'excluded';
  return 'review_needed';
}

function cleanCatalogProductName(value = '', company = '') {
  const companyText = String(company || '').replace(/\s+/g, '');
  const companyPattern = companyText
    ? new RegExp(`^${companyText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i')
    : null;
  return String(value || '')
    .normalize('NFC')
    .replace(/^(?:월호|실효|정상)\s+/g, '')
    .replace(/^(?:대상\s*상품|추천\s*상품|상품명)\s*[:：]\s*/i, '')
    .replace(/^[▶①-⑳⓵-⓾\-\s·:]+/g, '')
    .replace(/\s+/g, ' ')
    .replace(companyPattern || /^$/, '')
    .trim();
}

function inferCatalogProductGroup({ productName = '', productGroup = '', itemType = '', coverageTags = [] } = {}) {
  const text = [productName, productGroup, itemType, ...(Array.isArray(coverageTags) ? coverageTags : [])].join(' ');
  if (/운전자|자동차|교통/.test(text)) return '운전자/상해';
  if (/치매|간병|요양|장기요양/.test(text)) return '치매/간병';
  if (/간편|유병|고지|355|335|333/.test(text)) return '간편/유병자';
  if (/종신|사망|정기보험|상속/.test(text)) return '사망/종신';
  if (/연금|노후|은퇴/.test(text)) return '연금/저축';
  if (/실손|실비|의료비|통원/.test(text)) return '실손/의료비';
  if (/뇌|심장|순환계|혈관|허혈|급성심근/.test(text)) return '뇌/심장';
  if (/암|항암|표적|카티|CAR|유방암|갑상선/.test(text)) return '암';
  if (/수술|입원|상해|골절|후유장해/.test(text)) return '수술/입원/상해';
  if (/어린이|자녀|태아|키즈/.test(text)) return '어린이/자녀';
  return productGroup || itemType || '종합 보장';
}

function isCatalogNonProductName(productName = '', company = '') {
  const name = cleanCatalogProductName(productName);
  if (!name || name.length < 3) return true;
  const compact = name.replace(/\s+/g, '');
  const companyCompact = String(company || '').replace(/\s+/g, '');
  if (companyCompact && (compact === companyCompact || compact === companyCompact.replace(/생명|화재|손해보험|손보/g, ''))) return true;
  if (/보험금\s*청구|보험금\s*서류|보험금\/해약환급금|보전\s*서류|고객센터|헬프데스크|전화\s*문의|필수\s*서류|유의사항|판매\s*원칙|금융소비자|개인정보|신용정보|청약|환전|해외송금|서비스|수수료|기준금리|시가총액|총\s*자산|가입고객|자료\s*:|보상하는|금리|계약\s*대출|확인서|외화보험상품|보험차익|보험\s*가입\s*기간|하였으며|보장\s*한도|보험\s*한도|보험\s*소식/i.test(name)) return true;
  if (/비교|현황|전략상품|소식지?|간추린|가이드|자료|안내|기준|목록|요약|플랜\s*비교|일부상품\s*제외|대응\s*방안|제안하세요|제안가능|저렴|운영담보|동일|확대|축소/i.test(name)) return true;
  if (/선택받는\s*이유|신청\s*및\s*취소|관한\s*사항|유의\s*사항|주요\s*내용|상품\s*특징|판매\s*포인트|이용\s*방법|청구\s*방법|예시|Case\s*\d+/i.test(name)) return true;
  if (/^대\s+|^[가-힣]\.\s|^[①-⑳]\s/.test(name)) return true;
  if (/란\s|이란|으로\s*인하여|하고\s*있는|할\s*수\s*있는|되어\s*있는|확인\s*필요|계약심사|연령제한|소외되고|고령자|유병력자|고객|피보험자|청약자|가입하는|보장하는|지급하는/i.test(name)) return true;
  if (name.length > 42 && !/(?:보험|플랜|특약|담보)$/.test(name)) return true;
  if (/^(?:보험료|보장|담보|합계|구분|대상|조건|정상|실효|월호)$/.test(name)) return true;
  if (!/(보험|플랜|특약|담보|진단비|수술비|입원비|간병|치매|연금|종신|상해|실손|암|운전자)/.test(name)) return true;
  return false;
}

function importedCatalogNameKind(productName = '', company = '') {
  const name = cleanCatalogProductName(productName, company);
  if (isCatalogNonProductName(name, company)) return 'document';
  if (/특약|담보|진단비|수술비|입원비|입원일당|생활비|간병비|치료비/.test(name) && !/보험/.test(name)) return 'rider';
  if (/플랜/.test(name) && !/보험/.test(name)) return 'plan';
  if (/보험|종신|연금|운전자|치매|간병|실손|암/.test(name)) return 'product';
  return 'plan';
}

function isImportedCatalogProductLike(row = {}) {
  const productName = cleanCatalogProductName(row.product_name || '', row.company);
  const kind = importedCatalogNameKind(productName, row.company);
  return ['product', 'plan'].includes(kind);
}

function importedCoverageKeywords(value = []) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list
    .flatMap((item) => typeof item === 'string' ? item.split(/[,\s/]+/) : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  )].slice(0, 12);
}

function formatImportedPremium(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${Math.round(amount).toLocaleString('ko-KR')}원`;
}

function importedPremiumMatchScore(row = {}, premium = {}, productName = '', productGroup = '') {
  let score = 0;
  const label = String(premium.label || '');
  const premiumProduct = cleanCatalogProductName(premium.product_name || '', premium.company);
  if (premium.company && row.company && premium.company !== row.company) return 0;
  const nameKind = importedCatalogNameKind(productName, row.company);
  if (nameKind === 'document') return 0;
  const exactCatalog = premium.catalog_item_id && premium.catalog_item_id === row.id;
  const productMatched = premiumProduct && (productName.includes(premiumProduct) || premiumProduct.includes(productName));
  const groupMatched = productGroup && label && polibotTextGroupMatch(label, productGroup);
  const nameMatched = productName && label && polibotTextGroupMatch(label, productName);
  if (!exactCatalog && !productMatched && !groupMatched && !nameMatched) return 0;
  if (premium.catalog_item_id && premium.catalog_item_id === row.id) score += 120;
  if (premium.company && premium.company === row.company) score += 20;
  if (premium.document_id && row.document_id && premium.document_id === row.document_id) score += 28;
  if (nameKind === 'product') score += 18;
  if (nameKind === 'plan') score += 8;
  if (nameKind === 'rider') score -= 12;
  if (productMatched) score += 80;
  if (groupMatched) score += 24;
  if (nameMatched) score += 18;
  if (Number.isFinite(Number(premium.source_page)) && Number.isFinite(Number(row.source_page))) {
    const diff = Math.abs(Number(premium.source_page) - Number(row.source_page));
    if (diff === 0) score += 24;
    else if (diff <= 2) score += 12;
    else if (diff > 6) score -= 16;
  }
  return score;
}

function polibotTextGroupMatch(left = '', right = '') {
  const text = `${left} ${right}`;
  const groups = [
    /간편|유병|고지|355|335|333/,
    /암|항암|유방암|갑상선/,
    /치매|간병|요양|장기요양/,
    /종신|사망|상속/,
    /연금|노후|은퇴/,
    /뇌|심장|혈관|허혈|심근/,
    /실손|실비|의료비/,
    /운전자|교통|자동차/,
    /수술|입원|상해/
  ];
  const compactLeft = String(left || '').replace(/\s+/g, '');
  const compactRight = String(right || '').replace(/\s+/g, '');
  return groups.some((pattern) => pattern.test(left) && pattern.test(right))
    || (compactRight.length >= 4 && compactLeft.includes(compactRight))
    || (compactLeft.length >= 4 && compactRight.includes(compactLeft));
}

function documentPages(doc = {}) {
  const pages = doc.document_data?.pages;
  return Array.isArray(pages) ? pages : [];
}

function compactProductText(value = '') {
  return String(value || '').replace(/\s+/g, '').replace(/[()（）\[\]{}·ㆍ\-_]/g, '').toLowerCase();
}

function productPageEvidence(doc = {}, productName = '') {
  const compactName = compactProductText(productName);
  if (!compactName || compactName.length < 4) return [];
  doc.__productPageEvidenceCache = doc.__productPageEvidenceCache || new Map();
  if (doc.__productPageEvidenceCache.has(compactName)) return doc.__productPageEvidenceCache.get(compactName);
  const evidence = documentPages(doc)
    .map((page) => {
      const rawText = String(page.raw_text || '');
      const compactRaw = compactProductText(rawText);
      const direct = rawText.includes(productName) || compactRaw.includes(compactName);
      const partial = compactName.length >= 10 && compactRaw.includes(compactName.slice(0, Math.min(12, compactName.length)));
      return direct || partial ? {
        page: Number(page.page),
        rawText: rawText.slice(0, 1200),
        products: Array.isArray(page.products) ? page.products : [],
        coverage: Array.isArray(page.coverage) ? page.coverage : []
      } : null;
    })
    .filter((item) => item && Number.isFinite(item.page));
  doc.__productPageEvidenceCache.set(compactName, evidence);
  return evidence;
}

function pageEvidencePremiumBoost(premium = {}, pageEvidence = []) {
  const premiumPage = Number(premium.source_page);
  if (!Number.isFinite(premiumPage) || !pageEvidence.length) return { score: 0, reason: '' };
  const distances = pageEvidence.map((item) => Math.abs(Number(item.page) - premiumPage));
  const minDistance = Math.min(...distances);
  if (minDistance === 0) return { score: 80, reason: 'raw_page_product_match' };
  if (minDistance === 1) return { score: 58, reason: 'adjacent_raw_page_product_match' };
  if (minDistance <= 2) return { score: 38, reason: 'near_raw_page_product_match' };
  return { score: 0, reason: '' };
}

function importedEvidenceText(pageEvidence = [], fallback = '') {
  return [fallback, ...pageEvidence.map((item) => item.rawText || '')].join('\n');
}

function importedEvidenceAgeRange(text = '') {
  const source = String(text || '');
  const explicit = source.match(/(?:가입\s*연령|가입나이|보험\s*나이|연령)[^\d]{0,20}((?:만\s*)?\d{1,2}\s*세?\s*(?:~|-|부터|이상)\s*(?:만\s*)?\d{1,2}\s*세?)/);
  if (explicit?.[1]) return explicit[1].replace(/\s+/g, ' ').trim();
  const range = source.match(/(?:만\s*)?(\d{1,2})\s*세\s*(?:~|-)\s*(?:만\s*)?(\d{1,2})\s*세/);
  if (range) return `${range[1]}~${range[2]}세`;
  return '';
}

function importedEvidencePaymentTerm(text = '') {
  return String(text || '').match(/\d{1,2}\s*년\s*납|전기납|일시납|월납|연납/)?.[0] || '';
}

function importedEvidenceRenewalType(text = '') {
  const source = String(text || '');
  if (/비갱신/.test(source)) return '비갱신';
  if (/갱신형|갱신/.test(source)) return '갱신';
  return '';
}

function matchedImportedPremiumRows(row = {}, premiumRows = [], productName = '', productGroup = '', doc = {}) {
  const pageEvidence = productPageEvidence(doc, productName);
  return premiumRows
    .map((premium) => {
      const baseScore = importedPremiumMatchScore(row, premium, productName, productGroup);
      const pageBoost = pageEvidencePremiumBoost(premium, pageEvidence);
      const sameDocument = premium.document_id && row.document_id && premium.document_id === row.document_id;
      const matchScore = sameDocument ? Math.max(baseScore, pageBoost.score) : baseScore;
      return {
        ...premium,
        matchScore,
        matchReason: pageBoost.reason || (baseScore ? 'catalog_context' : '')
      };
    })
    .filter((premium) => premium.matchScore >= 58)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6);
}

function importedCatalogItemFromRow(row = {}, premiumRows = [], doc = {}) {
  const confidence = Math.round(Math.max(Number(row.confidence || 0), Number(row.value_confidence || 0)) * 100);
  const productName = cleanCatalogProductName(row.product_name || '', row.company);
  const pageEvidence = productPageEvidence(doc, productName);
  const evidenceText = importedEvidenceText(pageEvidence, row.source_excerpt || '');
  const pageCoverageKeywords = [...new Set(pageEvidence.flatMap((item) => item.coverage || []))];
  const coverageKeywords = [...new Set([
    ...importedCoverageKeywords(row.coverage_tags),
    ...pageCoverageKeywords
  ].filter(Boolean))].slice(0, 12);
  const productGroup = inferCatalogProductGroup({ productName, productGroup: row.product_group, itemType: row.item_type, coverageTags: coverageKeywords });
  const matchedPremiums = matchedImportedPremiumRows(row, premiumRows, productName, productGroup, doc);
  const matchedPremium = matchedPremiums[0];
  const premium = row.premium || matchedPremium?.premium || 0;
  const evidenceAgeRange = importedEvidenceAgeRange(evidenceText);
  const evidencePaymentTerm = importedEvidencePaymentTerm(evidenceText);
  const evidenceRenewalType = importedEvidenceRenewalType(evidenceText);
  const hasCoreValues = row.product_name && row.company && (row.min_age || row.max_age || evidenceAgeRange || premium || row.renewal_type || evidenceRenewalType);
  const status = isCatalogNonProductName(productName, row.company) ? 'excluded' : normalizeImportedCatalogStatus(row.review_status);
  const premiumExamples = matchedPremiums.map((item) => ({
    premium: formatImportedPremium(item.premium),
    rawPremium: item.premium,
    age: item.age || '',
    gender: item.gender || '',
    label: item.label || '',
      sourcePage: item.source_page || '',
      confidence: item.catalog_item_id === row.id ? 'catalog_item' : 'document_match',
      matchScore: item.matchScore,
      matchReason: item.matchReason || ''
  })).filter((item) => item.premium);
  const premiumTableRows = premiumExamples.map((item) => ({
    amount: item.premium,
    age: item.age,
    gender: item.gender,
    label: item.label,
    sourcePage: item.sourcePage,
    confidence: item.confidence,
    score: item.matchScore
  }));
  const coverageDetails = coverageKeywords.map((keyword) => ({
    category: inferCatalogProductGroup({ productName, productGroup, coverageTags: [keyword] }),
    title: keyword,
    amount: '',
    company: row.company || '',
    productName,
    excerpt: row.source_excerpt || '',
    confidence: 'catalog_tag'
  }));
  const hasExactPremium = Boolean(row.premium) || matchedPremiums.some((item) => item.catalog_item_id === row.id);
  const hasRawSamePagePremium = matchedPremiums.some((item) => item.matchReason === 'raw_page_product_match' && Number(item.matchScore || 0) >= 80);
  const hasDocumentPremium = premiumTableRows.length > 0;
  const hasCoverage = coverageDetails.length > 0;
  const linkScore = Math.min(100, 35 + (hasDocumentPremium ? 25 : 0) + Math.min(25, coverageDetails.length * 5) + (row.min_age || row.max_age || row.renewal_type ? 15 : 0) + (hasExactPremium || hasRawSamePagePremium ? 15 : 0));
  const linkConfidence = (hasExactPremium || hasRawSamePagePremium) && hasCoverage
    ? 'strong'
    : hasDocumentPremium && hasCoverage ? 'usable' : 'weak';
  const linkedBenefitGroups = [{
    key: `${row.id}-catalog`,
    productName,
    plan: row.product_group || productGroup || '공통',
    premiums: premiumTableRows.map((premiumRow) => ({
      amount: premiumRow.amount,
      age: premiumRow.age,
      gender: premiumRow.gender,
      label: premiumRow.label,
      confidence: premiumRow.confidence
    })),
    coverages: coverageDetails,
    conditions: {
      ageRange: row.min_age || row.max_age ? `${row.min_age || ''}~${row.max_age || ''}세` : evidenceAgeRange,
      paymentTerm: evidencePaymentTerm,
      renewalType: row.renewal_type || evidenceRenewalType,
      disclosureMemo: row.source_excerpt || pageEvidence[0]?.rawText || '',
      reductionMemo: '',
      conditionRules: {}
    },
    sourceSections: row.source_excerpt ? [{ title: productName, sectionType: 'product', excerpt: row.source_excerpt }] : [],
    linkedSummary: [
      row.product_group || productGroup,
      premiumTableRows[0]?.amount && `보험료 ${premiumTableRows[0].amount}`,
      coverageDetails.length && `담보 ${coverageDetails.length}개`,
      (row.min_age || row.max_age || evidenceAgeRange) && `가입연령 ${row.min_age || evidenceAgeRange ? '' : ''}${row.min_age || row.max_age ? `${row.min_age || ''}~${row.max_age || ''}세` : evidenceAgeRange}`,
      row.renewal_type || evidenceRenewalType
    ].filter(Boolean).join(' · '),
    linkScore,
    linkConfidence
  }];
  return {
    id: `imported-catalog-${row.id}`,
    sourceId: row.document_id ? `imported-doc-${row.document_id}` : '',
    company: row.company || '미분류',
    productName,
    productGroup,
    coverageKeywords,
    premiumExample: formatImportedPremium(premium),
    premiumConfidence: row.premium ? 'exact' : matchedPremium?.catalog_item_id === row.id ? 'catalog_item' : matchedPremium ? 'document_match' : 'none',
    premiumExamples,
    premiumTableRows,
    ageRange: row.min_age || row.max_age ? `${row.min_age || ''}~${row.max_age || ''}세` : evidenceAgeRange,
    paymentTerm: evidencePaymentTerm,
    renewalType: row.renewal_type || evidenceRenewalType,
    disclosureMemo: row.source_excerpt || pageEvidence[0]?.rawText || '',
    reductionMemo: '',
    coverageDetails,
    coverageTableRows: coverageDetails,
    linkedBenefitGroups,
    conditionRules: {
      ageRules: row.min_age || row.max_age ? [`${row.min_age || ''}~${row.max_age || ''}세`] : [evidenceAgeRange].filter(Boolean),
      paymentTerms: [evidencePaymentTerm].filter(Boolean),
      underwritingTypes: /간편|유병|고지|무심사|무고지|표준/.test(`${row.product_name || ''} ${row.product_group || ''} ${row.source_excerpt || ''}`)
        ? [...new Set([
          /간편|유병|고지/.test(`${row.product_name || ''} ${row.product_group || ''} ${row.source_excerpt || ''}`) && '간편/유병자',
          /무심사|무고지/.test(`${row.product_name || ''} ${row.product_group || ''} ${row.source_excerpt || ''}`) && '무심사/무고지',
          /표준/.test(`${row.product_name || ''} ${row.product_group || ''} ${row.source_excerpt || ''}`) && '표준심사'
        ].filter(Boolean))]
        : [],
      waitingPeriods: /면책|감액|부담보|보장\s*개시/.test(row.source_excerpt || '') ? [row.source_excerpt] : []
    },
    targetAudience: [row.customer_type].filter(Boolean),
    excludedAudience: [],
    completeness: hasCoreValues ? '충분' : '보통',
    confidence: confidence || (status === 'confirmed' ? 90 : 70),
    status,
    evidenceFile: row.source_filename || '',
    evidenceMonth: row.effective_month || '',
    conflictReasons: []
  };
}

function importedPremiumReferences(doc = {}, premiumRows = []) {
  return premiumRows
    .filter((row) => row.document_id === doc.id && row.premium)
    .map((row) => {
      const productName = cleanCatalogProductName(row.product_name || '', row.company);
      return {
        id: `imported-premium-${row.id}`,
        documentId: row.document_id || '',
        catalogItemId: row.catalog_item_id || '',
        company: row.company || '',
        productName,
        premium: formatImportedPremium(row.premium),
        rawPremium: row.premium,
        age: row.age || '',
        gender: row.gender || '',
        label: row.label || '',
        sourcePage: row.source_page || '',
        confidence: row.catalog_item_id ? 'catalog_item' : productName ? 'product_name' : 'document_reference',
        linkStatus: row.catalog_item_id ? 'linked' : productName ? 'product_named' : 'unlinked_document_table'
      };
    })
    .filter((item) => item.premium)
    .slice(0, 40);
}

function importedDocumentAnalysis(doc = {}, items = [], premiumReferences = []) {
  const coverageDetails = items.flatMap((item) => (item.coverageDetails?.length ? item.coverageDetails : (item.coverageKeywords || []).map((keyword) => ({
    category: inferCatalogProductGroup({ productName: item.productName, productGroup: item.productGroup, coverageTags: [keyword] }),
    title: keyword,
    amount: '',
    company: item.company || '',
    productName: item.productName || '',
    excerpt: item.disclosureMemo || ''
  })))).slice(0, 80);
  const premiumTableRows = [
    ...items.flatMap((item) => item.premiumTableRows || []),
    ...premiumReferences.map((item) => ({
      amount: item.premium,
      age: item.age || '',
      gender: item.gender || '',
      label: item.label || '',
      sourcePage: item.sourcePage || '',
      confidence: item.confidence || 'document_reference'
    }))
  ].slice(0, 120);
  const linkedBenefitGroups = items.flatMap((item) => item.linkedBenefitGroups || []).slice(0, 80);
  const conditionDetails = {
    ageRanges: [...new Set(items.map((item) => item.ageRange).filter(Boolean))].slice(0, 12),
    renewalTypes: [...new Set(items.map((item) => item.renewalType).filter(Boolean))].slice(0, 8),
    disclosureMemos: [...new Set(items.map((item) => item.disclosureMemo).filter(Boolean))].slice(0, 12),
    underwritingTypes: [...new Set(items.flatMap((item) => item.conditionRules?.underwritingTypes || []))].slice(0, 8),
    waitingPeriods: [...new Set(items.flatMap((item) => item.conditionRules?.waitingPeriods || []))].slice(0, 8)
  };
  return {
    premiumCandidates: premiumReferences,
    premiumTableRows,
    coverageDetails,
    coverageTableRows: coverageDetails.filter((item) => item.confidence === 'catalog_tag' || item.confidence === 'coverage_table_row'),
    conditionDetails,
    linkedBenefitGroups,
    analysisQuality: {
      premiumCandidateCount: premiumReferences.length,
      premiumTableRowCount: premiumTableRows.length,
      linkedPremiumCount: premiumReferences.filter((item) => item.linkStatus === 'linked').length,
      coverageDetailCount: coverageDetails.length,
      coverageTableRowCount: coverageDetails.length,
      linkedBenefitGroupCount: linkedBenefitGroups.length,
      strongLinkedBenefitGroupCount: linkedBenefitGroups.filter((item) => item.linkConfidence === 'strong').length,
      productCandidateCount: items.length,
      hasConditionDetails: Boolean(conditionDetails.ageRanges.length || conditionDetails.renewalTypes.length || conditionDetails.disclosureMemos.length || conditionDetails.underwritingTypes.length)
    },
    source: doc.filename || ''
  };
}

function importedSourceFromDocument(doc = {}, catalogRows = [], premiumRows = []) {
  const items = catalogRows.map((row) => importedCatalogItemFromRow(row, premiumRows, doc))
    .filter((item) => item.productName);
  const premiumReferences = importedPremiumReferences(doc, premiumRows);
  const documentAnalysis = importedDocumentAnalysis(doc, items, premiumReferences);
  const companies = [...new Set(items.map((item) => item.company).filter((item) => item && item !== '미분류'))].slice(0, 12);
  const productGroups = [...new Set(items.map((item) => item.productGroup).filter(Boolean))].slice(0, 8);
  const keywords = [...new Set(items.flatMap((item) => item.coverageKeywords || []))].slice(0, 20);
  return {
    id: `imported-doc-${doc.id}`,
    dbSourceId: `imported-doc-${doc.id}`,
    fileName: doc.filename || '',
    month: doc.year_month || items.find((item) => item.evidenceMonth)?.evidenceMonth || '',
    fileType: inferPolibotFileType(doc.filename || ''),
    companies,
    company: companies[0] || '미분류',
    productGroup: productGroups[0] || '종합 보장',
    keywords,
    productNames: [...new Set(items.map((item) => item.productName).filter(Boolean))].slice(0, 30),
    textSnippet: String(doc.filename || '').slice(0, 400),
    redactedSnippet: '',
    catalogItems: items,
    premiumReferences,
    documentAnalysis,
    premiumTableRows: documentAnalysis.premiumTableRows,
    coverageDetails: documentAnalysis.coverageDetails,
    coverageTableRows: documentAnalysis.coverageTableRows,
    conditionDetails: documentAnalysis.conditionDetails,
    linkedBenefitGroups: documentAnalysis.linkedBenefitGroups,
    scope: 'global',
    sourceChannel: 'local_ingest',
    knowledgeStatus: items.some((item) => item.status === 'confirmed') ? 'recommendable' : 'review_needed',
    recommendationEligible: items.some((item) => item.status === 'confirmed'),
    privacyRiskScore: 0,
    privacyRiskLevel: 'none',
    evidenceQualityScore: items.some((item) => item.status === 'confirmed') ? 86 : 68,
    evidenceQualityLevel: 'imported_catalog',
    evidenceQualityReasons: ['추출 카탈로그 DB에서 불러온 검증 자료'],
    uploadedAt: doc.created_at || '',
    sourceSystem: 'polibot_core'
  };
}

async function listImportedPolibotSources() {
  if (importedSourceCache && Date.now() - importedSourceCache.createdAt < IMPORTED_SOURCE_CACHE_TTL_MS) {
    return importedSourceCache.value;
  }
  const catalogRows = await listImportedCatalogRows({ limit: 1200, includeExcerpt: false }).catch(() => []);
  if (!catalogRows.length) return [];
  const catalogByDocument = catalogRows.reduce((acc, row) => {
    const sourceKey = row.document_id || `${row.effective_month || ''}-${row.source_filename || ''}` || row.id;
    acc[sourceKey] = acc[sourceKey] || [];
    acc[sourceKey].push(row);
    return acc;
  }, {});
  const value = Object.entries(catalogByDocument)
    .map(([sourceKey, rows]) => {
      const first = rows[0] || {};
      return importedSourceFromDocument({
        id: sourceKey,
        filename: first.source_filename || `catalog-${sourceKey}`,
        year_month: first.effective_month || '',
        created_at: first.updated_at || '',
        document_data: null
      }, rows, []);
    })
    .filter((source) => source.catalogItems.length > 0)
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  importedSourceCache = { createdAt: Date.now(), value };
  return value;
}

async function listImportedCatalogRows({ limit = 5000, includeExcerpt = true } = {}) {
  const rowLimit = Math.max(1, Math.min(5000, Number(limit || 5000)));
  const select = [
    'id',
    'document_id',
    'product_name',
    'company',
    'product_group',
    'item_type',
    'customer_type',
    'coverage_tags',
    'min_age',
    'max_age',
    'premium',
    'renewal_type',
    'effective_month',
    'source_filename',
    includeExcerpt ? 'source_excerpt' : '',
    'source_page',
    'confidence',
    'value_confidence',
    'review_status',
    'updated_at'
  ].filter(Boolean).join(',');
  if (!supabase) {
    return dbList('catalog_items', {}, {
      select,
      order: 'updated_at',
      ascending: false,
      limit: rowLimit
    }).catch(() => []);
  }
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; from < rowLimit; from += pageSize) {
    const { data, error } = await supabase
      .from('catalog_items')
      .select(select)
      .order('updated_at', { ascending: false })
      .range(from, Math.min(rowLimit, from + pageSize) - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

function rawCatalogRowForReview(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: row.id,
    sourceId: row.source_id || '',
    scope: row.scope,
    userId: row.user_id || '',
    status: row.status || 'review_needed',
    company: row.company || '미분류',
    productName: row.product_name || '',
    productGroup: row.product_group || '',
    coverageKeywords: row.coverage_keywords || [],
    premiumExample: row.premium_example || '',
    ageRange: row.age_range || '',
    paymentTerm: row.payment_term || '',
    renewalType: row.renewal_type || '',
    completeness: row.completeness || '',
    autoConfirmScore: row.auto_confirm_score || 0,
    confidenceScore: row.confidence_score || 0,
    effectiveMonth: row.effective_month || '',
    evidence: row.evidence || {},
    conflictReasons: Array.isArray(metadata.conflictReasons) ? metadata.conflictReasons : [],
    reviewNote: metadata.reviewNote || '',
    reviewedAt: metadata.reviewedAt || '',
    reviewerId: metadata.reviewerId || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function importedCatalogRowForReview(item = {}) {
  const premiumRows = item.premiumExamples || item.premiumTableRows || [];
  return {
    id: item.id,
    sourceId: item.sourceId || '',
    scope: 'global',
    userId: '',
    status: polibotStatusFromImportedStatus(item.status),
    importedStatus: item.status || '',
    sourceSystem: item.sourceSystem || 'polibot_core',
    imported: true,
    readOnly: false,
    company: item.company || '미분류',
    productName: item.productName || '',
    productGroup: item.productGroup || '',
    coverageKeywords: item.coverageKeywords || [],
    coverageDetails: item.coverageDetails || [],
    premiumExample: item.premiumExample || '',
    premiumExamples: premiumRows.slice(0, 8),
    premiumConfidence: item.premiumConfidence || '',
    ageRange: item.ageRange || '',
    paymentTerm: item.paymentTerm || '',
    renewalType: item.renewalType || '',
    completeness: item.completeness || '',
    autoConfirmScore: item.confidence || 0,
    confidenceScore: item.confidence || 0,
    effectiveMonth: item.evidenceMonth || '',
    evidence: {
      fileName: item.evidenceFile || '',
      excerpt: item.disclosureMemo || ''
    },
    evidenceFile: item.evidenceFile || '',
    conflictReasons: item.conflictReasons || [],
    linkedBenefitGroups: item.linkedBenefitGroups || [],
    linkConfidence: item.linkedBenefitGroups?.[0]?.linkConfidence || '',
    linkScore: item.linkedBenefitGroups?.[0]?.linkScore || 0,
    reviewNote: '',
    reviewedAt: '',
    reviewerId: '',
    createdAt: '',
    updatedAt: ''
  };
}

function sourceRowForReview(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    id: row.id,
    scope: row.scope,
    userId: row.user_id || '',
    status: row.status || 'review_needed',
    sourceChannel: row.source_channel || '',
    fileName: row.file_name || '',
    fileType: row.file_type || '',
    fileSize: row.file_size || 0,
    month: row.month || '',
    company: row.company || '미분류',
    companies: row.companies || [],
    productGroup: row.product_group || '',
    keywords: row.keywords || [],
    productNames: row.product_names || [],
    textSnippet: row.redacted_snippet || row.text_snippet || '',
    privacyRiskScore: metadata.privacyRiskScore || 0,
    privacyRiskLevel: metadata.privacyRiskLevel || 'none',
    evidenceQualityScore: metadata.evidenceQualityScore || 0,
    evidenceQualityLevel: metadata.evidenceQualityLevel || '',
    evidenceQualityReasons: metadata.evidenceQualityReasons || [],
    ocrStatus: metadata.ocrStatus || '',
    ocrAttempts: Number(metadata.ocrAttempts || 0),
    ocrLastError: metadata.ocrLastError || '',
    ocrModel: metadata.ocrModel || '',
    ocrCompletedAt: metadata.ocrCompletedAt || '',
    recommendationEligible: metadata.recommendationEligible !== false,
    reviewNote: metadata.reviewNote || '',
    reviewedAt: metadata.reviewedAt || '',
    reviewerId: metadata.reviewerId || '',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || ''
  };
}

function importedSourceRowForReview(source = {}) {
  const analysisQuality = source.documentAnalysis?.analysisQuality || {};
  return {
    id: source.id,
    scope: 'global',
    userId: '',
    status: source.knowledgeStatus === 'recommendable' ? 'recommendable' : 'review_needed',
    importedStatus: source.knowledgeStatus || '',
    sourceSystem: source.sourceSystem || 'polibot_core',
    imported: true,
    readOnly: true,
    sourceChannel: source.sourceChannel || 'local_ingest',
    fileName: source.fileName || '',
    fileType: source.fileType || '',
    fileSize: source.fileSize || 0,
    month: source.month || '',
    company: source.company || '미분류',
    companies: source.companies || [],
    productGroup: source.productGroup || '',
    keywords: source.keywords || [],
    productNames: source.productNames || [],
    textSnippet: source.textSnippet || '',
    privacyRiskScore: source.privacyRiskScore || 0,
    privacyRiskLevel: source.privacyRiskLevel || 'none',
    evidenceQualityScore: source.evidenceQualityScore || 0,
    evidenceQualityLevel: source.evidenceQualityLevel || '',
    evidenceQualityReasons: source.evidenceQualityReasons || [],
    recommendationEligible: source.recommendationEligible !== false,
    analysisQuality,
    catalogItemCount: source.catalogItems?.length || 0,
    premiumTableRowCount: analysisQuality.premiumTableRowCount || source.premiumTableRows?.length || 0,
    coverageDetailCount: analysisQuality.coverageDetailCount || source.coverageDetails?.length || 0,
    linkedBenefitGroupCount: analysisQuality.linkedBenefitGroupCount || source.linkedBenefitGroups?.length || 0,
    storagePath: '',
    reviewNote: '',
    createdAt: source.uploadedAt || '',
    updatedAt: source.uploadedAt || ''
  };
}

function countStatuses(rows = []) {
  return rows.reduce((acc, row) => {
    const status = row.status || 'unknown';
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function normalizeReviewStatus(status = '') {
  const next = String(status || '').trim();
  if (!VALID_KNOWLEDGE_STATUSES.has(next)) {
    const error = new Error('지원하지 않는 POLIBOT 자료 상태입니다.');
    error.status = 400;
    throw error;
  }
  return next;
}

async function findDuplicateSource({ scope, userId, fileHash, textHash }) {
  const scopedUserId = dedupeUserId(scope, userId);
  if (fileHash) {
    const existing = await dbGet('polibot_knowledge_sources', {
      scope,
      user_id: scope === 'global' ? null : scopedUserId,
      file_hash: fileHash
    });
    if (existing) return existing;
  }
  if (textHash) {
    const existing = await dbGet('polibot_knowledge_sources', {
      scope,
      user_id: scope === 'global' ? null : scopedUserId,
      text_hash: textHash
    });
    if (existing) return existing;
  }
  return null;
}

async function findDuplicateChunk({ scope, userId, chunkHash }) {
  if (!chunkHash) return null;
  return dbGet('polibot_knowledge_chunks', {
    scope,
    user_id: scope === 'global' ? null : userId,
    chunk_hash: chunkHash
  });
}

async function createJob({ userId, scope, sourceChannel, sourceLabel, dryRun }) {
  return dbInsert('polibot_ingest_jobs', {
    user_id: sourceUserId(scope, userId),
    scope,
    source_channel: sourceChannel,
    status: dryRun ? 'completed' : 'processing',
    source_label: sourceLabel || '',
    dry_run: Boolean(dryRun),
    started_at: now(),
    parser_version: PARSER_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    classifier_version: CLASSIFIER_VERSION
  });
}

async function finishJob(job, patch = {}) {
  if (!job?.id) return null;
  return dbUpdate('polibot_ingest_jobs', { id: job.id }, {
    ...patch,
    finished_at: now()
  });
}

async function insertSourceRecord({ userId, scope, sourceChannel, job, file, normalizedSource, rawText, fileHash, textHash }) {
  const fileType = file.type || normalizedSource.fileType || inferPolibotFileType(file.fileName || file.name);
  const riskScore = privacyRiskScore(rawText);
  const status = sourceStatus({ fileType, text: rawText, normalizedSource });
  const quality = sourceQualityMetadata({
    sourceChannel,
    fileName: normalizedSource.fileName || file.fileName || file.name || '',
    month: normalizedSource.month || '',
    normalizedSource,
    rawText,
    status
  });
  return dbInsert('polibot_knowledge_sources', {
    ingest_job_id: job?.id || null,
    user_id: sourceUserId(scope, userId),
    scope,
    source_channel: sourceChannel,
    status,
    file_name: normalizedSource.fileName || file.fileName || file.name || '자료',
    file_type: fileType,
    file_size: Number(file.size || normalizedSource.size || 0),
    file_hash: fileHash,
    text_hash: textHash || null,
    storage_path: file.storagePath || '',
    month: normalizedSource.month || '',
    company: normalizedSource.company || '미분류',
    companies: normalizedSource.companies || [],
    product_group: normalizedSource.productGroup || '',
    keywords: normalizedSource.keywords || [],
    product_names: normalizedSource.productNames || [],
    normalized_source: normalizedSource,
    text_snippet: normalizedSource.textSnippet || '',
    redacted_snippet: redactedInsuranceText(normalizedSource.textSnippet || rawText).slice(0, 1500),
    metadata: {
      note: normalizedSource.note || '',
      originalId: normalizedSource.id || '',
      privacyRiskScore: riskScore,
      privacyRiskLevel: privacyRiskLevel(riskScore),
      recommendationEligible: status !== 'privacy_risk' && status !== 'ocr_needed' && status !== 'excluded' && status !== 'conflict',
      evidenceQualityScore: quality.score,
      evidenceQualityLevel: quality.level,
      evidenceQualityReasons: quality.reasons,
      ocrStatus: status === 'ocr_needed' ? 'queued' : ''
    },
    parser_version: PARSER_VERSION,
    extractor_version: EXTRACTOR_VERSION,
    classifier_version: CLASSIFIER_VERSION
  });
}

async function insertChunks({ userId, scope, sourceRow, job, rawText, sourceChannel }) {
  const chunks = splitTextChunks(rawText || sourceRow.text_snippet || '', sourceChannel);
  const inserted = [];
  const skipped = [];
  for (const [index, content] of chunks.entries()) {
    const relevance = insuranceRelevanceScore(content);
    if (relevance <= 0 && sourceChannel !== 'kakao_txt') {
      skipped.push({ index, reason: 'not_insurance_related' });
      continue;
    }
    const chunkHash = sha256(content);
    const duplicate = await findDuplicateChunk({ scope, userId, chunkHash });
    if (duplicate) {
      skipped.push({ index, reason: 'duplicate_chunk', sourceId: duplicate.source_id || '' });
      continue;
    }
    const riskScore = privacyRiskScore(content);
    inserted.push(await dbInsert('polibot_knowledge_chunks', {
      source_id: sourceRow.id,
      ingest_job_id: job?.id || null,
      user_id: sourceUserId(scope, userId),
      scope,
      status: riskScore >= 3 ? 'privacy_risk' : relevance >= 35 ? 'recommendable' : 'review_needed',
      chunk_index: index,
      chunk_type: sourceChannel === 'kakao_txt' ? 'conversation' : 'text',
      chunk_hash: chunkHash,
      content,
      redacted_content: redactedInsuranceText(content),
      insurance_relevance_score: relevance,
      keywords: extractPolibotKeywords(content),
      metadata: {
        parserVersion: PARSER_VERSION,
        privacyRiskScore: riskScore,
        privacyRiskLevel: privacyRiskLevel(riskScore)
      }
    }));
  }
  return { inserted, skipped };
}

async function insertCatalogItems({ userId, scope, sourceRow, job, normalizedSource }) {
  if (sourceRow.status === 'privacy_risk' || sourceRow.status === 'ocr_needed' || sourceRow.status === 'excluded' || sourceRow.status === 'conflict') {
    return [];
  }
  const items = Array.isArray(normalizedSource.catalogItems) && normalizedSource.catalogItems.length
    ? normalizedSource.catalogItems
    : buildPolibotCatalogItems([normalizedSource], { includeReview: true });
  const inserted = [];
  for (const item of items.slice(0, 40)) {
    if (!item.productName) continue;
    const baseRow = catalogRowFromItem({
      item,
      sourceRow,
      jobId: job?.id,
      scope,
      userId
    });
    const conflicts = await findCatalogConflicts({ scope, userId, row: baseRow });
    const row = conflicts.length
      ? {
        ...baseRow,
        status: 'conflict',
        metadata: {
          ...baseRow.metadata,
          conflictReasons: conflicts,
          conflictDetectedAt: now()
        }
      }
      : baseRow;
    inserted.push(await dbInsert('polibot_catalog_items', row));
  }
  return inserted;
}

async function insertConversationInsight({ userId, scope, sourceRow, job, rawText, sourceChannel }) {
  if (sourceChannel !== 'kakao_txt') return null;
  const keywords = extractPolibotKeywords(rawText);
  const redacted = redactedInsuranceText(rawText);
  const riskScore = privacyRiskScore(rawText);
  return dbInsert('polibot_conversation_insights', {
    source_id: sourceRow.id,
    ingest_job_id: job?.id || null,
    user_id: sourceUserId(scope, userId),
    scope,
    status: riskScore >= 3 ? 'privacy_risk' : 'review_needed',
    insight_type: 'consultation',
    needs: keywords.filter((keyword) => /암|뇌|심장|실손|실비|진단비|입원|수술|간병|치매|운전자/.test(keyword)).slice(0, 8),
    existing_insurance: /기존|현재|가입/.test(rawText) ? '상담 내 기존 보험 언급' : '',
    target_premium: rawText.match(/(?:목표|예산|희망)\s*(?:월\s*)?(\d{1,3})\s*만/)?.[1] || '',
    current_premium: rawText.match(/(?:현재|기존|납입)\s*(?:월\s*)?(\d{1,3})\s*만/)?.[1] || '',
    existing_medical_plan: /실손|실비/.test(rawText) ? (/없|미가입/.test(rawText) ? '없음' : '확인 필요') : '',
    medical_history: /고지|병력|수술|입원|투약|치료/.test(rawText) ? '확인 필요' : '',
    questions: [...new Set((rawText.match(/[^.!?\n]{4,80}\?/g) || []).map((item) => item.trim()))].slice(0, 8),
    recommendation_hints: keywords.slice(0, 8),
    summary: redacted.slice(0, 500),
    redacted_summary: redacted.slice(0, 500),
    metadata: {
      keywordCount: keywords.length,
      privacyRiskScore: riskScore,
      privacyRiskLevel: privacyRiskLevel(riskScore)
    }
  });
}

export async function ingestPolibotKnowledge({
  userId = '',
  scope = 'user',
  sourceChannel = 'web_upload',
  sourceLabel = '',
  files = [],
  month = '',
  note = '',
  dryRun = false
} = {}) {
  const normalizedScope = normalizeScope(scope);
  const normalizedChannel = normalizeSourceChannel(sourceChannel);
  assertScopeUser(normalizedScope, userId);
  const selectedFiles = Array.isArray(files) ? files : [];
  const job = await createJob({
    userId,
    scope: normalizedScope,
    sourceChannel: normalizedChannel,
    sourceLabel,
    dryRun
  });
  const summary = {
    total: selectedFiles.length,
    insertedSources: 0,
    duplicateSources: 0,
    insertedChunks: 0,
    skippedChunks: 0,
    insertedCatalogItems: 0,
    insertedConversationInsights: 0,
    duplicateChunks: 0,
    failed: 0,
    dryRun: Boolean(dryRun)
  };
  const sources = [];
  const errors = [];
  try {
    for (const [index, file] of selectedFiles.entries()) {
      const preparedFile = await prepareIngestFile({
        ...file,
        fileName: file?.fileName || file?.name || `자료 ${index + 1}`
      });
      const fileName = preparedFile.fileName || `자료 ${index + 1}`;
      const rawText = preparedFile.text;
      const fileHash = preparedFile.fileHash;
      const textHash = rawText ? sha256(rawText) : '';
      const fileSourceChannel = detectSourceChannel(preparedFile, rawText, normalizedChannel);
      try {
        const duplicate = await findDuplicateSource({
          scope: normalizedScope,
          userId,
          fileHash,
          textHash
        });
        if (duplicate) {
          summary.duplicateSources += 1;
          sources.push(sourceFromDb(duplicate));
          continue;
        }
        const storagePath = await uploadOriginalToStorage({
          file: preparedFile,
          scope: normalizedScope,
          userId,
          fileHash
        });
        if (storagePath) preparedFile.storagePath = storagePath;
        const normalizedSource = normalizePolibotKnowledgeSource({
          fileName,
          text: rawText,
          month,
          note,
          size: preparedFile.size || 0,
          type: preparedFile.type || inferPolibotFileType(fileName)
        });
        if (dryRun) {
          const chunks = splitTextChunks(rawText || normalizedSource.textSnippet || '', fileSourceChannel);
          summary.insertedSources += 1;
          summary.insertedChunks += chunks.filter((chunk) => insuranceRelevanceScore(chunk) > 0).length;
          summary.insertedCatalogItems += (normalizedSource.catalogItems || []).length;
          summary.insertedConversationInsights += fileSourceChannel === 'kakao_txt' ? 1 : 0;
          sources.push(normalizedSource);
          continue;
        }
        const sourceRow = await insertSourceRecord({
          userId,
          scope: normalizedScope,
          sourceChannel: fileSourceChannel,
          job,
          file: preparedFile,
          normalizedSource,
          rawText,
          fileHash,
          textHash
        });
        const chunkResult = await insertChunks({
          userId,
          scope: normalizedScope,
          sourceRow,
          job,
          rawText: rawText || normalizedSource.textSnippet || '',
          sourceChannel: fileSourceChannel
        });
        const catalogRows = await insertCatalogItems({
          userId,
          scope: normalizedScope,
          sourceRow,
          job,
          normalizedSource
        });
        const conversationInsight = await insertConversationInsight({
          userId,
          scope: normalizedScope,
          sourceRow,
          job,
          rawText,
          sourceChannel: fileSourceChannel
        });
        summary.insertedSources += 1;
        summary.insertedChunks += chunkResult.inserted.length;
        summary.skippedChunks += chunkResult.skipped.length;
        summary.duplicateChunks += chunkResult.skipped.filter((item) => item.reason === 'duplicate_chunk').length;
        summary.insertedCatalogItems += catalogRows.length;
        summary.insertedConversationInsights += conversationInsight ? 1 : 0;
        sources.push(sourceFromDb(sourceRow, catalogRows.map(normalizeCatalogRow)));
      } catch (error) {
        summary.failed += 1;
        errors.push({ fileName, error: error.message || String(error) });
      }
    }
    await finishJob(job, {
      status: summary.failed > 0 && summary.insertedSources === 0 ? 'failed' : 'completed',
      summary: { ...summary, errors }
    });
    await safeLogActivity({
      user_id: userId || null,
      action: 'polibot_knowledge_ingest_completed',
      level: summary.failed > 0 ? 'warn' : 'info',
      message: `${normalizedScope}/${normalizedChannel} ${summary.insertedSources}개 저장, ${summary.duplicateSources}개 중복`,
      payload: { ...summary, scope: normalizedScope, sourceChannel: normalizedChannel, jobId: job?.id }
    });
    if (!dryRun && (summary.insertedSources > 0 || summary.insertedChunks > 0 || summary.insertedCatalogItems > 0)) {
      clearPolibotCodeSearchCache(normalizedScope === 'global' ? '' : userId);
    }
    return {
      job: { ...job, summary },
      summary,
      sources,
      errors
    };
  } catch (error) {
    await finishJob(job, {
      status: 'failed',
      error_message: error.message || String(error),
      summary: { ...summary, errors }
    });
    throw error;
  }
}

export async function listPolibotDbKnowledgeSources(userId = '') {
  const globalSources = await dbList('polibot_knowledge_sources', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 500 }).catch(() => []);
  const userSources = userId
    ? await dbList('polibot_knowledge_sources', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 500 }).catch(() => [])
    : [];
  const importedSources = await listImportedPolibotSources();
  const sourceRows = [...globalSources, ...userSources];
  const catalogRows = [
    ...await dbList('polibot_catalog_items', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    ...(userId ? await dbList('polibot_catalog_items', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [])
  ];
  const catalogBySource = catalogRows.reduce((acc, row) => {
    if (!row.source_id) return acc;
    acc[row.source_id] = acc[row.source_id] || [];
    acc[row.source_id].push(normalizeCatalogRow(row));
    return acc;
  }, {});
  return sourceRows
    .map((row) => sourceFromDb(row, catalogBySource[row.id] || []))
    .concat(importedSources)
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
}

function normalizeSearchText(value = '') {
  return String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function codeSearchTerms(query = '') {
  return normalizeSearchText(query)
    .split(/[,\s+/]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function codeSearchScore(candidate = {}, { query = '', company = '', coverage = '' } = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = codeSearchTerms(query);
  const code = String(candidate.code || '');
  const context = candidate.searchText || normalizeSearchText(candidate.context || '');
  let score = Number(candidate.confidence || 0);
  if (normalizedQuery && code === normalizedQuery) score += 90;
  if (normalizedQuery && code.includes(normalizedQuery) && code !== normalizedQuery) score += 35;
  terms.forEach((term) => {
    if (term && context.includes(term)) score += 16;
  });
  if (company && (candidate.companies || []).includes(company)) score += 30;
  if (coverage && (candidate.coverageKeywords || []).some((keyword) => keyword.includes(coverage) || coverage.includes(keyword))) score += 28;
  if (candidate.status === 'recommendable') score += 18;
  if (candidate.status === 'conflict') score -= 10;
  if (candidate.sourceStatus === 'privacy_risk') score -= 80;
  if (candidate.sourceStatus === 'ocr_needed') score -= 40;
  score += Math.min(12, Math.round(Number(candidate.evidenceQualityScore || 0) / 10));
  return score;
}

function candidateMatchesSearch(candidate = {}, params = {}) {
  const { query = '', company = '', coverage = '' } = params;
  const normalizedQuery = normalizeSearchText(query);
  const terms = codeSearchTerms(query);
  const haystack = candidate.searchText || '';
  if (company && !(candidate.companies || []).includes(company)) return false;
  if (coverage && !(candidate.coverageKeywords || []).some((keyword) => keyword.includes(coverage) || coverage.includes(keyword))) return false;
  if (!normalizedQuery) return true;
  if (candidate.code === normalizedQuery) return true;
  return terms.every((term) => haystack.includes(term));
}

function normalizeCodeCandidate({ item, source, chunk, catalog } = {}) {
  const sourceMetadata = source?.metadata && typeof source.metadata === 'object' ? source.metadata : {};
  const sourceCompanies = Array.isArray(source?.companies) ? source.companies : [];
  const itemCompanies = Array.isArray(item?.companies) ? item.companies : [];
  const catalogCompany = catalog?.company || '';
  const companies = [...new Set([...itemCompanies, ...sourceCompanies, catalogCompany].filter(Boolean))].slice(0, 8);
  const coverageKeywords = [...new Set([
    ...(Array.isArray(item?.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(chunk?.keywords) ? chunk.keywords : []),
    ...(Array.isArray(catalog?.coverage_keywords) ? catalog.coverage_keywords : [])
  ].filter(Boolean))].slice(0, 10);
  const candidate = {
    code: String(item?.code || '').trim(),
    company: companies[0] || source?.company || '미분류',
    companies,
    coverageKeywords,
    context: item?.context || chunk?.redacted_content || chunk?.content || source?.redacted_snippet || source?.text_snippet || '',
    fileName: source?.file_name || source?.normalized_source?.fileName || '',
    sourceId: source?.id || chunk?.source_id || '',
    chunkId: chunk?.id || '',
    catalogItemId: catalog?.id || '',
    month: source?.month || catalog?.effective_month || '',
    status: catalog?.status || chunk?.status || source?.status || 'review_needed',
    sourceStatus: source?.status || '',
    scope: source?.scope || chunk?.scope || catalog?.scope || '',
    confidence: Number(item?.confidence || catalog?.confidence_score || 0),
    evidenceQualityScore: Number(sourceMetadata.evidenceQualityScore || 0)
  };
  return {
    ...candidate,
    searchText: normalizeSearchText([
      candidate.code,
      candidate.context,
      candidate.fileName,
      candidate.company,
      ...candidate.companies,
      ...candidate.coverageKeywords
    ].join(' '))
  };
}

function codeSearchCacheKey(userId = '') {
  return userId || 'global';
}

function clearPolibotCodeSearchCache(userId = '') {
  if (!userId) {
    codeSearchCache.clear();
    return;
  }
  codeSearchCache.delete(codeSearchCacheKey(userId));
}

async function loadPolibotCodeSearchCandidates(userId = '') {
  const key = codeSearchCacheKey(userId);
  const cached = codeSearchCache.get(key);
  if (cached && Date.now() - cached.createdAt < CODE_SEARCH_CACHE_TTL_MS) return cached.value;
  const [globalSources, userSources, globalChunks, userChunks, globalCatalog, userCatalog] = await Promise.all([
    dbList('polibot_knowledge_sources', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_sources', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [],
    dbList('polibot_knowledge_chunks', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_chunks', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []) : [],
    dbList('polibot_catalog_items', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []),
    userId ? dbList('polibot_catalog_items', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []) : []
  ]);
  const sources = [...globalSources, ...userSources];
  const chunks = [...globalChunks, ...userChunks].filter((chunk) => SEARCHABLE_CODE_STATUSES.has(chunk.status));
  const catalogItems = [...globalCatalog, ...userCatalog].filter((item) => SEARCHABLE_CODE_STATUSES.has(item.status));
  const sourceById = Object.fromEntries(sources.map((source) => [source.id, source]));
  const catalogBySource = catalogItems.reduce((acc, item) => {
    if (!item.source_id) return acc;
    acc[item.source_id] = acc[item.source_id] || [];
    acc[item.source_id].push(item);
    return acc;
  }, {});
  const candidates = [];
  sources.forEach((source) => {
    const normalized = source.normalized_source && typeof source.normalized_source === 'object' ? source.normalized_source : {};
    (normalized.codeCandidates || []).forEach((item) => {
      candidates.push(normalizeCodeCandidate({ item, source, catalog: catalogBySource[source.id]?.[0] }));
    });
  });
  chunks.forEach((chunk) => {
    const source = sourceById[chunk.source_id] || {};
    const extracted = extractPolibotCoverageCodes({
      text: chunk.redacted_content || chunk.content || '',
      fileName: source.file_name || '',
      companies: source.companies || [],
      keywords: chunk.keywords || []
    });
    extracted.forEach((item) => {
      candidates.push(normalizeCodeCandidate({ item, source, chunk, catalog: catalogBySource[chunk.source_id]?.[0] }));
    });
  });
  const value = candidates.filter((candidate) => candidate.code);
  codeSearchCache.set(key, { createdAt: Date.now(), value });
  return value;
}

export async function searchPolibotCodeCandidates(userId = '', { query = '', company = '', coverage = '', limit = 30 } = {}) {
  const selectedLimit = Math.max(1, Math.min(Number(limit || 30), 80));
  const candidates = await loadPolibotCodeSearchCandidates(userId);
  return candidates
    .filter((candidate) => candidateMatchesSearch(candidate, { query, company, coverage }))
    .map((candidate) => ({
      ...candidate,
      score: codeSearchScore(candidate, { query, company, coverage })
    }))
    .sort((a, b) => b.score - a.score || String(b.month || '').localeCompare(String(a.month || '')))
    .filter((candidate, index, all) => all.findIndex((row) => row.code === candidate.code && row.sourceId === candidate.sourceId && row.context === candidate.context) === index)
    .slice(0, selectedLimit);
}

export async function getPolibotDbKnowledgeSummary(userId = '') {
  const [globalSources, userSources, globalCatalog, userCatalog, globalChunks, userChunks, globalInsights, userInsights, jobs, importedSources] = await Promise.all([
    dbList('polibot_knowledge_sources', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_sources', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [],
    dbList('polibot_catalog_items', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []),
    userId ? dbList('polibot_catalog_items', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []) : [],
    dbList('polibot_knowledge_chunks', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_chunks', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []) : [],
    dbList('polibot_conversation_insights', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    userId ? dbList('polibot_conversation_insights', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [],
    dbList('polibot_ingest_jobs', {}, { order: 'created_at', ascending: false, limit: 20 }).catch(() => []),
    listImportedPolibotSources()
  ]);
  const sources = [...globalSources, ...userSources];
  const importedCatalogItems = importedSources.flatMap((source) => source.catalogItems || []);
  const catalogItems = [...globalCatalog, ...userCatalog];
  const allCatalogItems = [
    ...catalogItems.map(normalizeCatalogRow),
    ...importedCatalogItems
  ];
  const chunks = [...globalChunks, ...userChunks];
  const insights = [...globalInsights, ...userInsights];
  const countBy = (items = [], key) => items.reduce((acc, item) => {
    const value = item?.[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const topValues = (items = [], key, limit = 5) => Object.entries(countBy(items, key))
    .filter(([name]) => name && name !== 'unknown' && name !== '미분류')
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
  const months = [...sources.map((source) => source.month), ...importedSources.map((source) => source.month)].filter(Boolean).sort().reverse();
  const latestJob = jobs.find((job) => job.scope === 'global' || (userId && job.user_id === userId)) || null;
  return {
    totalSources: sources.length + importedSources.length,
    globalSources: globalSources.length,
    userSources: userSources.length,
    importedSources: importedSources.length,
    statusCounts: countBy(sources, 'status'),
    sourceChannelCounts: {
      ...countBy(sources, 'source_channel'),
      ...(importedSources.length ? { local_ingest: importedSources.length } : {})
    },
    recommendableSources: sources.filter((source) => source.status === 'recommendable').length,
    reviewNeededSources: sources.filter((source) => source.status === 'review_needed').length,
    excludedSources: sources.filter((source) => source.status === 'excluded').length,
    ocrNeededSources: sources.filter((source) => source.status === 'ocr_needed').length,
    privacyRiskSources: sources.filter((source) => source.status === 'privacy_risk').length,
    conflictSources: sources.filter((source) => source.status === 'conflict').length,
    highQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) >= 78).length,
    mediumQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) >= 58 && Number(source.metadata?.evidenceQualityScore || 0) < 78).length,
    lowQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) > 0 && Number(source.metadata?.evidenceQualityScore || 0) < 58).length,
    catalogItems: catalogItems.length + importedCatalogItems.length,
    importedCatalogItems: importedCatalogItems.length,
    recommendableCatalogItems: catalogItems.filter((item) => item.status === 'recommendable').length + importedCatalogItems.filter((item) => item.status === 'confirmed').length,
    reviewNeededCatalogItems: catalogItems.filter((item) => item.status === 'review_needed').length + importedCatalogItems.filter((item) => item.status === 'review').length,
    excludedCatalogItems: catalogItems.filter((item) => item.status === 'excluded').length + importedCatalogItems.filter((item) => item.status === 'excluded').length,
    conflictCatalogItems: catalogItems.filter((item) => item.status === 'conflict').length,
    chunks: chunks.length,
    recommendableChunks: chunks.filter((chunk) => chunk.status === 'recommendable').length,
    conversationInsights: insights.length,
    latestMonth: months[0] || '',
    companies: topValues(allCatalogItems, 'company'),
    productGroups: topValues(allCatalogItems, 'productGroup'),
    latestJob: latestJob ? {
      id: latestJob.id,
      scope: latestJob.scope,
      sourceChannel: latestJob.source_channel,
      status: latestJob.status,
      sourceLabel: latestJob.source_label || '',
      summary: latestJob.summary || null,
      createdAt: latestJob.created_at || ''
    } : null
  };
}

export async function listPolibotKnowledgeReviewQueue({ status = 'all', scope = 'all', limit = 120 } = {}) {
  const selectedStatus = String(status || 'all');
  const selectedScope = ['global', 'user'].includes(scope) ? scope : 'all';
  const maxRows = Math.min(Math.max(Number(limit || 120), 20), 500);
  const [sourceRows, catalogRows, jobs, feedbackRows, importedSources] = await Promise.all([
    dbList('polibot_knowledge_sources', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    dbList('polibot_catalog_items', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []),
    dbList('polibot_ingest_jobs', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 20 }).catch(() => []),
    dbList('polibot_recommendation_feedback', {}, { order: 'created_at', ascending: false, limit: 80 }).catch(() => []),
    selectedScope === 'user' ? [] : listImportedPolibotSources()
  ]);
  const importedCatalogItems = importedSources.flatMap((source) => source.catalogItems || []);
  const importedSourceRows = selectedScope === 'user' ? [] : importedSources.map(importedSourceRowForReview);
  const importedCatalogRows = selectedScope === 'user' ? [] : importedCatalogItems.map(importedCatalogRowForReview);
  const importedLatestMonth = importedSources.map((source) => source.month).filter(Boolean).sort().reverse()[0] || '';
  const statusFilter = selectedStatus === 'all' ? null : selectedStatus;
  const filteredSources = sourceRows
    .map(sourceRowForReview)
    .concat(importedSourceRows)
    .filter((row) => !statusFilter || row.status === statusFilter)
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, maxRows);
  const filteredCatalogItems = catalogRows
    .map(rawCatalogRowForReview)
    .concat(importedCatalogRows)
    .filter((row) => !statusFilter || row.status === statusFilter)
    .sort((a, b) => String(b.effectiveMonth || '').localeCompare(String(a.effectiveMonth || '')) || Number(b.confidenceScore || 0) - Number(a.confidenceScore || 0))
    .slice(0, maxRows);
  return {
    filters: { status: selectedStatus, scope: selectedScope, limit: maxRows },
    summary: {
      sources: sourceRows.length + importedSourceRows.length,
      catalogItems: catalogRows.length + importedCatalogRows.length,
      importedSources: importedSources.length,
      importedCatalogItems: importedCatalogItems.length,
      latestMonth: importedLatestMonth || sourceRows.map((row) => row.month).filter(Boolean).sort().reverse()[0] || '',
      sourceStatusCounts: countStatuses(sourceRows.map(sourceRowForReview).concat(importedSourceRows)),
      catalogStatusCounts: countStatuses(catalogRows.map(rawCatalogRowForReview).concat(importedCatalogRows)),
      feedbackCounts: countStatuses(feedbackRows.map((row) => ({ status: row.rating }))),
      feedbackNeedsReview: feedbackRows.filter((row) => row.routed_to_review).length
    },
    sources: filteredSources,
    catalogItems: filteredCatalogItems,
    recentJobs: jobs.map((job) => ({
      id: job.id,
      scope: job.scope,
      sourceChannel: job.source_channel,
      status: job.status,
      sourceLabel: job.source_label || '',
      dryRun: Boolean(job.dry_run),
      summary: job.summary || {},
      errorMessage: job.error_message || '',
      createdAt: job.created_at || '',
      finishedAt: job.finished_at || ''
    })),
    feedback: feedbackRows.slice(0, Math.min(maxRows, 80)).map((row) => ({
      id: row.id,
      userId: row.user_id || '',
      recommendationId: row.recommendation_id || '',
      customerId: row.customer_id || '',
      rating: row.rating || '',
      reason: row.reason || '',
      memo: row.memo || '',
      routedToReview: Boolean(row.routed_to_review),
      recommendationName: row.recommendation_snapshot?.name || '',
      recommendationType: row.recommendation_snapshot?.type || '',
      recommendationScore: row.recommendation_snapshot?.score || 0,
      learningFlags: row.recommendation_snapshot?.learningSignal?.reasonFlags || [],
      recommendationSnapshot: row.recommendation_snapshot || {},
      productNames: (row.recommendation_snapshot?.catalogItems || [])
        .map((item) => [item.company, item.productName].filter(Boolean).join(' '))
        .filter(Boolean)
        .slice(0, 4),
      usedSourceIds: row.knowledge_snapshot?.usedSourceIds || row.knowledge_snapshot?.usedSources?.map((source) => source.sourceId).filter(Boolean) || [],
      knowledgeSnapshot: row.knowledge_snapshot || {},
      createdAt: row.created_at || ''
    }))
  };
}

export async function runPolibotSourceOcr(id, { reviewerId = '' } = {}) {
  const row = await dbGet('polibot_knowledge_sources', { id });
  if (!row) {
    const error = new Error('POLIBOT OCR 자료를 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  const scope = normalizeScope(row.scope || 'user');
  const userId = row.user_id || '';
  const sourceChannel = normalizeSourceChannel(row.source_channel || 'web_upload');
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const attempts = Number(metadata.ocrAttempts || 0) + 1;
  const job = await createJob({
    userId,
    scope,
    sourceChannel,
    sourceLabel: `OCR: ${row.file_name || id}`,
    dryRun: false
  });

  const failOcr = async (error) => {
    const errorMessage = error?.message || String(error);
    const [updated] = await dbUpdate('polibot_knowledge_sources', { id }, {
      status: 'ocr_needed',
      metadata: {
        ...metadata,
        ocrStatus: 'failed',
        ocrAttempts: attempts,
        ocrLastError: errorMessage,
        ocrFailedAt: now(),
        reviewerId: String(reviewerId || '').trim()
      }
    });
    await finishJob(job, {
      status: 'failed',
      error_message: errorMessage,
      summary: {
        sourceId: id,
        fileName: row.file_name || '',
        ocrAttempts: attempts,
        error: errorMessage
      }
    });
    await safeLogActivity({
      user_id: userId || null,
      action: 'polibot_ocr_failed',
      level: 'warn',
      message: `POLIBOT OCR 실패: ${row.file_name || id}`,
      payload: { sourceId: id, jobId: job?.id, error: errorMessage }
    });
    return {
      source: sourceRowForReview(updated || { ...row, status: 'ocr_needed', metadata: { ...metadata, ocrStatus: 'failed', ocrAttempts: attempts, ocrLastError: errorMessage } }),
      summary: { status: 'failed', error: errorMessage }
    };
  };

  try {
    const input = await resolveOcrInput(row);
    const ocr = await extractPolibotOcrText({
      fileName: row.file_name || '',
      mimeType: input.mimeType,
      base64: input.base64
    });
    const rawText = String(ocr.text || '').trim();
    if (!rawText || rawText.length < 8) {
      return failOcr(new Error('OCR 결과 텍스트가 비어 있습니다.'));
    }

    const normalizedSource = normalizePolibotKnowledgeSource({
      fileName: row.file_name || '',
      text: rawText,
      month: row.month || '',
      note: metadata.note || '',
      size: row.file_size || input.bytes || 0,
      type: row.file_type || 'image'
    });
    const nextStatus = sourceStatus({ fileType: row.file_type || 'image', text: rawText, normalizedSource });
    const riskScore = privacyRiskScore(rawText);
    const quality = sourceQualityMetadata({
      sourceChannel,
      fileName: row.file_name || '',
      month: normalizedSource.month || row.month || '',
      normalizedSource,
      rawText,
      status: nextStatus
    });
    const [updatedSource] = await dbUpdate('polibot_knowledge_sources', { id }, {
      status: nextStatus,
      text_hash: sha256(rawText),
      month: normalizedSource.month || row.month || '',
      company: normalizedSource.company || row.company || '미분류',
      companies: normalizedSource.companies || row.companies || [],
      product_group: normalizedSource.productGroup || row.product_group || '',
      keywords: normalizedSource.keywords || [],
      product_names: normalizedSource.productNames || [],
      normalized_source: normalizedSource,
      text_snippet: normalizedSource.textSnippet || rawText.slice(0, 1500),
      redacted_snippet: redactedInsuranceText(normalizedSource.textSnippet || rawText).slice(0, 1500),
      metadata: {
        ...metadata,
        privacyRiskScore: riskScore,
        privacyRiskLevel: privacyRiskLevel(riskScore),
        recommendationEligible: nextStatus !== 'privacy_risk' && nextStatus !== 'ocr_needed' && nextStatus !== 'excluded' && nextStatus !== 'conflict',
        evidenceQualityScore: quality.score,
        evidenceQualityLevel: quality.level,
        evidenceQualityReasons: quality.reasons,
        ocrStatus: 'completed',
        ocrAttempts: attempts,
        ocrLastError: '',
        ocrModel: ocr.model || '',
        ocrUsage: ocr.usage || null,
        ocrCompletedAt: now(),
        reviewerId: String(reviewerId || '').trim()
      }
    });
    const sourceRow = updatedSource || { ...row, status: nextStatus, normalized_source: normalizedSource };
    const chunkResult = await insertChunks({
      userId,
      scope,
      sourceRow,
      job,
      rawText,
      sourceChannel
    });
    const catalogRows = await insertCatalogItems({
      userId,
      scope,
      sourceRow,
      job,
      normalizedSource
    });
    const summary = {
      sourceId: id,
      fileName: row.file_name || '',
      ocrStatus: 'completed',
      insertedChunks: chunkResult.inserted.length,
      skippedChunks: chunkResult.skipped.length,
      insertedCatalogItems: catalogRows.length,
      model: ocr.model || '',
      usage: ocr.usage || null
    };
    await finishJob(job, { status: 'completed', summary });
    await safeLogActivity({
      user_id: userId || null,
      action: 'polibot_ocr_completed',
      level: 'info',
      message: `POLIBOT OCR 완료: ${row.file_name || id}`,
      payload: { ...summary, jobId: job?.id }
    });
    return {
      source: sourceRowForReview(sourceRow),
      summary,
      catalogItems: catalogRows.map(rawCatalogRowForReview)
    };
  } catch (error) {
    return failOcr(error);
  }
}

export async function updatePolibotCatalogItemReview(id, { status, reviewNote = '', reviewerId = '' } = {}) {
  if (String(id || '').startsWith('imported-catalog-')) {
    const importedId = Number(String(id).replace(/^imported-catalog-/, ''));
    if (!Number.isFinite(importedId)) {
      const error = new Error('POLIBOT 이관 상품 후보 ID가 올바르지 않습니다.');
      error.status = 400;
      throw error;
    }
    const reviewStatus = importedReviewStatusFromPolibotStatus(status);
    const [updated] = await dbUpdate('catalog_items', { id: importedId }, {
      review_status: reviewStatus
    });
    importedSourceCache = null;
    if (!updated) {
      const error = new Error('POLIBOT 이관 상품 후보를 찾지 못했습니다.');
      error.status = 404;
      throw error;
    }
    return importedCatalogRowForReview(importedCatalogItemFromRow(updated, [], {}));
  }
  const row = await dbGet('polibot_catalog_items', { id });
  if (!row) {
    const error = new Error('POLIBOT 상품 후보를 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  const nextStatus = normalizeReviewStatus(status || row.status);
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const [updated] = await dbUpdate('polibot_catalog_items', { id }, {
    status: nextStatus,
    metadata: {
      ...metadata,
      reviewNote: String(reviewNote || '').trim(),
      reviewerId: String(reviewerId || '').trim(),
      reviewedAt: now()
    }
  });
  return rawCatalogRowForReview(updated || row);
}

export async function updatePolibotKnowledgeSourceReview(id, { status, reviewNote = '', reviewerId = '' } = {}) {
  const row = await dbGet('polibot_knowledge_sources', { id });
  if (!row) {
    const error = new Error('POLIBOT 자료를 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  const nextStatus = normalizeReviewStatus(status || row.status);
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  const recommendationEligible = nextStatus === 'recommendable' || nextStatus === 'review_needed';
  const [updated] = await dbUpdate('polibot_knowledge_sources', { id }, {
    status: nextStatus,
    metadata: {
      ...metadata,
      recommendationEligible,
      reviewNote: String(reviewNote || '').trim(),
      reviewerId: String(reviewerId || '').trim(),
      reviewedAt: now()
    }
  });
  return sourceRowForReview(updated || row);
}

function premiumCatalogLinkCandidates(premium = {}, catalogRows = []) {
  return catalogRows
    .filter((row) => row.document_id && premium.document_id && row.document_id === premium.document_id)
    .filter((row) => !premium.company || !row.company || row.company === premium.company)
    .filter((row) => isImportedCatalogProductLike(row) || premium.catalog_item_id === row.id)
    .map((row) => {
      const productName = cleanCatalogProductName(row.product_name || '', row.company);
      const coverageKeywords = importedCoverageKeywords(row.coverage_tags);
      const productGroup = inferCatalogProductGroup({
        productName,
        productGroup: row.product_group,
        itemType: row.item_type,
        coverageTags: coverageKeywords
      });
      const score = importedPremiumMatchScore(row, premium, productName, productGroup);
      const premiumProduct = cleanCatalogProductName(premium.product_name || '', premium.company);
      const directProductMatch = premiumProduct && (productName.includes(premiumProduct) || premiumProduct.includes(productName));
      const samePage = Number.isFinite(Number(premium.source_page))
        && Number.isFinite(Number(row.source_page))
        && Number(premium.source_page) === Number(row.source_page);
      return {
        row,
        score,
        directProductMatch,
        samePage,
        productName,
        productGroup
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

function premiumSectionCandidates(premium = {}, catalogRows = []) {
  const premiumPage = Number(premium.source_page);
  return catalogRows
    .filter((row) => row.document_id && premium.document_id && row.document_id === premium.document_id)
    .filter((row) => !premium.company || !row.company || row.company === premium.company)
    .filter((row) => isImportedCatalogProductLike(row))
    .map((row) => {
      const productName = cleanCatalogProductName(row.product_name || '', row.company);
      const coverageKeywords = importedCoverageKeywords(row.coverage_tags);
      const productGroup = inferCatalogProductGroup({
        productName,
        productGroup: row.product_group,
        itemType: row.item_type,
        coverageTags: coverageKeywords
      });
      const rowPage = Number(row.source_page);
      const hasPages = Number.isFinite(premiumPage) && Number.isFinite(rowPage);
      const pageDistance = hasPages ? Math.abs(premiumPage - rowPage) : 99;
      const beforeOrSamePage = hasPages && rowPage <= premiumPage;
      let score = 0;
      if (premium.company && row.company === premium.company) score += 28;
      if (beforeOrSamePage) score += 24;
      if (pageDistance === 0) score += 32;
      else if (pageDistance === 1) score += 24;
      else if (pageDistance <= 3) score += 14;
      else if (pageDistance <= 6) score += 6;
      else score -= 24;
      if (polibotTextGroupMatch(premium.label || '', productGroup)) score += 16;
      if (coverageKeywords.length) score += Math.min(14, coverageKeywords.length * 2);
      const kind = importedCatalogNameKind(productName, row.company);
      if (kind === 'product') score += 14;
      if (kind === 'plan') score += 8;
      if (kind === 'rider') score -= 10;
      if (row.min_age || row.max_age) score += 5;
      return {
        catalogItemId: row.id,
        productName,
        company: row.company || '',
        productGroup,
        sourcePage: row.source_page || '',
        pageDistance: hasPages ? pageDistance : null,
        score,
        linkConfidence: score >= 82 ? 'strong_section_candidate' : score >= 58 ? 'section_candidate' : 'weak_section_candidate'
      };
    })
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function shouldLinkPremiumToCatalog(best, second) {
  if (!best) return false;
  if (best.directProductMatch && best.score >= 90) return true;
  if (best.samePage && best.score >= 100 && (!second || best.score - second.score >= 18)) return true;
  return false;
}

export async function backfillImportedPremiumCatalogLinks({ dryRun = true, limit = 5000 } = {}) {
  const [catalogRows, premiumRows] = await Promise.all([
    listImportedCatalogRows(),
    dbList('premium_examples', {}, {
      select: 'id,document_id,catalog_item_id,company,product_name,premium,age,gender,label,source_page',
      order: 'created_at',
      ascending: false,
      limit: Math.min(Math.max(Number(limit || 5000), 100), 10000)
    }).catch(() => [])
  ]);
  const unlinkedPremiums = premiumRows.filter((row) => !row.catalog_item_id && row.document_id && row.premium);
  const updates = [];
  const skipped = [];
  for (const premium of unlinkedPremiums) {
    const candidates = premiumCatalogLinkCandidates(premium, catalogRows);
    const [best, second] = candidates;
    if (!shouldLinkPremiumToCatalog(best, second)) {
      skipped.push({
        id: premium.id,
        documentId: premium.document_id,
        company: premium.company || '',
        premium: premium.premium,
        reason: best ? `ambiguous:${best.score}${second ? `/${second.score}` : ''}` : 'no_candidate'
      });
      continue;
    }
    const patch = {
      catalog_item_id: best.row.id,
      product_name: premium.product_name || best.productName,
      company: premium.company || best.row.company || ''
    };
    updates.push({
      id: premium.id,
      patch,
      match: {
        catalogItemId: best.row.id,
        company: best.row.company,
        productName: best.productName,
        productGroup: best.productGroup,
        score: best.score
      }
    });
    if (!dryRun) {
      await dbUpdate('premium_examples', { id: premium.id }, patch);
    }
  }
  if (!dryRun && updates.length) importedSourceCache = null;
  return {
    dryRun: Boolean(dryRun),
    catalogRows: catalogRows.length,
    premiumRows: premiumRows.length,
    unlinkedPremiums: unlinkedPremiums.length,
    linked: updates.length,
    skipped: skipped.length,
    updates: updates.slice(0, 80),
    skippedSamples: skipped.slice(0, 80)
  };
}

export async function analyzeImportedPolibotExtractionGaps({ limit = 5000 } = {}) {
  const [docs, catalogRows, premiumRows] = await Promise.all([
    dbList('parsed_documents', {}, {
      select: 'id,filename,year_month,created_at,document_data',
      order: 'created_at',
      ascending: false,
      limit: 1000
    }).catch(() => []),
    listImportedCatalogRows(),
    dbList('premium_examples', {}, {
      select: 'id,document_id,catalog_item_id,company,product_name,premium,age,gender,label,source_page',
      order: 'created_at',
      ascending: false,
      limit: Math.min(Math.max(Number(limit || 5000), 100), 10000)
    }).catch(() => [])
  ]);
  const docMap = new Map(docs.map((doc) => [doc.id, {
    id: doc.id,
    fileName: doc.filename || '',
    month: doc.year_month || '',
    catalogRows: 0,
    confirmedRows: 0,
    productRows: 0,
    riderRows: 0,
    documentRows: 0,
    withCoverage: 0,
    withAge: 0,
    withRenewal: 0,
    withPremium: 0,
    linkedBenefitGroups: 0,
    strongLinkedBenefitGroups: 0,
    usableLinkedBenefitGroups: 0,
    weakLinkedBenefitGroups: 0,
    linkedGroupGaps: [],
    premiumRows: 0,
    linkedPremiumRows: 0,
    namedPremiumRows: 0,
    unlinkedPremiumRows: 0,
    coverageGaps: [],
    conditionGaps: [],
    premiumGaps: [],
    analysisPriority: 0
  }]));
  catalogRows.forEach((row) => {
    const doc = docMap.get(row.document_id);
    if (!doc) return;
    const productName = cleanCatalogProductName(row.product_name || '', row.company);
    const coverageKeywords = importedCoverageKeywords(row.coverage_tags);
    const productGroup = inferCatalogProductGroup({ productName, productGroup: row.product_group, itemType: row.item_type, coverageTags: coverageKeywords });
    const kind = isCatalogNonProductName(productName, row.company)
      ? 'document'
      : /특약|담보|진단비|수술비|입원비|생활비|간병비/.test(productName) && !/보험/.test(productName) ? 'rider' : 'product';
    const importedItem = importedCatalogItemFromRow(row, premiumRows, docs.find((item) => item.id === row.document_id) || {});
    const linkedGroups = Array.isArray(importedItem.linkedBenefitGroups) ? importedItem.linkedBenefitGroups : [];
    const strongGroups = linkedGroups.filter((group) => group.linkConfidence === 'strong').length;
    const usableGroups = linkedGroups.filter((group) => group.linkConfidence === 'usable').length;
    const weakGroups = linkedGroups.filter((group) => group.linkConfidence === 'weak').length;
    doc.catalogRows += 1;
    if (normalizeImportedCatalogStatus(row.review_status) === 'confirmed') doc.confirmedRows += 1;
    if (kind === 'product') doc.productRows += 1;
    if (kind === 'rider') doc.riderRows += 1;
    if (kind === 'document') doc.documentRows += 1;
    if (coverageKeywords.length || (importedItem.coverageKeywords || []).length || (importedItem.coverageDetails || []).length) doc.withCoverage += 1;
    else doc.coverageGaps.push({ id: row.id, company: row.company || '', productName, productGroup, sourcePage: row.source_page || '' });
    if (row.min_age || row.max_age || importedItem.ageRange) doc.withAge += 1;
    else doc.conditionGaps.push({ id: row.id, type: 'age', company: row.company || '', productName, sourcePage: row.source_page || '' });
    if (row.renewal_type || importedItem.renewalType) doc.withRenewal += 1;
    else doc.conditionGaps.push({ id: row.id, type: 'renewal', company: row.company || '', productName, sourcePage: row.source_page || '' });
    if (row.premium) doc.withPremium += 1;
    doc.linkedBenefitGroups += linkedGroups.length;
    doc.strongLinkedBenefitGroups += strongGroups;
    doc.usableLinkedBenefitGroups += usableGroups;
    doc.weakLinkedBenefitGroups += weakGroups;
    if (!linkedGroups.length || linkedGroups.every((group) => group.linkConfidence === 'weak')) {
      doc.linkedGroupGaps.push({
        id: row.id,
        company: row.company || '',
        productName,
        productGroup,
        sourcePage: row.source_page || '',
        reason: !linkedGroups.length ? 'no_linked_group' : 'weak_linked_group'
      });
    }
  });
  premiumRows.filter((row) => row.premium).forEach((premium) => {
    const doc = docMap.get(premium.document_id);
    if (!doc) return;
    doc.premiumRows += 1;
    if (premium.catalog_item_id) doc.linkedPremiumRows += 1;
    if (premium.product_name) doc.namedPremiumRows += 1;
    if (!premium.catalog_item_id) {
      doc.unlinkedPremiumRows += 1;
      const candidates = premiumCatalogLinkCandidates(premium, catalogRows).slice(0, 3);
      const sectionCandidates = premiumSectionCandidates(premium, catalogRows);
      doc.premiumGaps.push({
        id: premium.id,
        company: premium.company || '',
        premium: premium.premium,
        age: premium.age || '',
        gender: premium.gender || '',
        label: String(premium.label || '').slice(0, 120),
        sourcePage: premium.source_page || '',
        bestCandidates: candidates.map((item) => ({
          catalogItemId: item.row.id,
          productName: item.productName,
          company: item.row.company || '',
          sourcePage: item.row.source_page || '',
          score: item.score,
          reason: item.directProductMatch ? 'direct_product' : item.samePage ? 'same_page' : 'context'
        })),
        sectionCandidates
      });
    }
  });
  const docsReport = [...docMap.values()].map((doc) => {
    const missingCoverage = Math.max(0, doc.catalogRows - doc.withCoverage);
    const missingAge = Math.max(0, doc.catalogRows - doc.withAge);
    const missingRenewal = Math.max(0, doc.catalogRows - doc.withRenewal);
    const unlinkedPremiums = doc.unlinkedPremiumRows;
    const weakLinkedGroups = Math.max(0, doc.catalogRows - doc.strongLinkedBenefitGroups - doc.usableLinkedBenefitGroups);
    const priority = unlinkedPremiums * 4 + missingCoverage + Math.round(missingAge * 0.6) + Math.round(missingRenewal * 0.4) + Math.round(weakLinkedGroups * 0.8);
    return {
      ...doc,
      coverageGaps: doc.coverageGaps.slice(0, 10),
      conditionGaps: doc.conditionGaps.slice(0, 12),
      premiumGaps: doc.premiumGaps.slice(0, 12),
      linkedGroupGaps: doc.linkedGroupGaps.slice(0, 12),
      missingCoverage,
      missingAge,
      missingRenewal,
      weakLinkedGroups,
      analysisPriority: priority,
      recommendedAction: unlinkedPremiums
        ? '보험료표 섹션/상품명 재분석 우선'
        : weakLinkedGroups > doc.catalogRows * 0.5 ? '보험료-담보-조건 연결 재분석 우선'
        : missingCoverage > doc.catalogRows * 0.4 ? '보장 세부항목 재분석 우선'
          : missingAge || missingRenewal ? '가입조건/갱신조건 재분석'
            : '상태 양호'
    };
  }).sort((a, b) => b.analysisPriority - a.analysisPriority);
  const totals = docsReport.reduce((acc, doc) => {
    acc.catalogRows += doc.catalogRows;
    acc.premiumRows += doc.premiumRows;
    acc.linkedPremiumRows += doc.linkedPremiumRows;
    acc.unlinkedPremiumRows += doc.unlinkedPremiumRows;
    acc.missingCoverage += doc.missingCoverage;
    acc.missingAge += doc.missingAge;
    acc.missingRenewal += doc.missingRenewal;
    acc.linkedBenefitGroups += doc.linkedBenefitGroups;
    acc.strongLinkedBenefitGroups += doc.strongLinkedBenefitGroups;
    acc.usableLinkedBenefitGroups += doc.usableLinkedBenefitGroups;
    acc.weakLinkedBenefitGroups += doc.weakLinkedBenefitGroups;
    acc.weakLinkedGroups += doc.weakLinkedGroups;
    if (!doc.catalogRows) acc.docsWithoutCatalog += 1;
    if (!doc.premiumRows) acc.docsWithoutPremium += 1;
    return acc;
  }, {
    documents: docsReport.length,
    catalogRows: 0,
    premiumRows: 0,
    linkedPremiumRows: 0,
    unlinkedPremiumRows: 0,
    missingCoverage: 0,
    missingAge: 0,
    missingRenewal: 0,
    linkedBenefitGroups: 0,
    strongLinkedBenefitGroups: 0,
    usableLinkedBenefitGroups: 0,
    weakLinkedBenefitGroups: 0,
    weakLinkedGroups: 0,
    docsWithoutCatalog: 0,
    docsWithoutPremium: 0
  });
  return {
    generatedAt: now(),
    totals,
    priorityDocuments: docsReport.slice(0, 20),
    healthyDocuments: docsReport.filter((doc) => doc.recommendedAction === '상태 양호').slice(0, 20)
  };
}
