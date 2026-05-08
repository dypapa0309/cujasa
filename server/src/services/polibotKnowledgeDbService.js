import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { dbGet, dbInsert, dbList, dbUpdate, safeLogActivity, supabase } from './supabaseService.js';
import {
  buildPolibotCatalogItems,
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
      premiumConfidence: item.premiumConfidence || ''
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
  return {
    id: row.id,
    sourceId: row.source_id || '',
    company: row.company || '미분류',
    productName: row.product_name || '',
    productGroup: row.product_group || '종합 보장',
    coverageKeywords: row.coverage_keywords || [],
    premiumExample: row.premium_example || '',
    ageRange: row.age_range || '',
    paymentTerm: row.payment_term || '',
    renewalType: row.renewal_type || '',
    disclosureMemo: row.disclosure_memo || '',
    reductionMemo: row.reduction_memo || '',
    targetAudience: row.target_audience || [],
    excludedAudience: row.excluded_audience || [],
    completeness: row.completeness || '',
    confidence: row.confidence_score || row.auto_confirm_score || 0,
    status: row.status === 'recommendable' ? 'confirmed' : row.status === 'excluded' || row.status === 'conflict' ? 'excluded' : 'review',
    evidenceFile: row.evidence?.fileName || '',
    evidenceMonth: row.effective_month || '',
    conflictReasons: Array.isArray(row.metadata?.conflictReasons) ? row.metadata.conflictReasons : []
  };
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
    text_hash: textHash,
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
  const sourceRows = [...globalSources, ...userSources];
  if (!sourceRows.length) return [];
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
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
}

export async function getPolibotDbKnowledgeSummary(userId = '') {
  const [globalSources, userSources, globalCatalog, userCatalog, globalChunks, userChunks, globalInsights, userInsights, jobs] = await Promise.all([
    dbList('polibot_knowledge_sources', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_sources', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [],
    dbList('polibot_catalog_items', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []),
    userId ? dbList('polibot_catalog_items', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []) : [],
    dbList('polibot_knowledge_chunks', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []),
    userId ? dbList('polibot_knowledge_chunks', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 3000 }).catch(() => []) : [],
    dbList('polibot_conversation_insights', { scope: 'global' }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    userId ? dbList('polibot_conversation_insights', { scope: 'user', user_id: userId }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []) : [],
    dbList('polibot_ingest_jobs', {}, { order: 'created_at', ascending: false, limit: 20 }).catch(() => [])
  ]);
  const sources = [...globalSources, ...userSources];
  const catalogItems = [...globalCatalog, ...userCatalog];
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
  const months = sources.map((source) => source.month).filter(Boolean).sort().reverse();
  const latestJob = jobs.find((job) => job.scope === 'global' || (userId && job.user_id === userId)) || null;
  return {
    totalSources: sources.length,
    globalSources: globalSources.length,
    userSources: userSources.length,
    statusCounts: countBy(sources, 'status'),
    sourceChannelCounts: countBy(sources, 'source_channel'),
    recommendableSources: sources.filter((source) => source.status === 'recommendable').length,
    reviewNeededSources: sources.filter((source) => source.status === 'review_needed').length,
    excludedSources: sources.filter((source) => source.status === 'excluded').length,
    ocrNeededSources: sources.filter((source) => source.status === 'ocr_needed').length,
    privacyRiskSources: sources.filter((source) => source.status === 'privacy_risk').length,
    conflictSources: sources.filter((source) => source.status === 'conflict').length,
    highQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) >= 78).length,
    mediumQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) >= 58 && Number(source.metadata?.evidenceQualityScore || 0) < 78).length,
    lowQualitySources: sources.filter((source) => Number(source.metadata?.evidenceQualityScore || 0) > 0 && Number(source.metadata?.evidenceQualityScore || 0) < 58).length,
    catalogItems: catalogItems.length,
    recommendableCatalogItems: catalogItems.filter((item) => item.status === 'recommendable').length,
    reviewNeededCatalogItems: catalogItems.filter((item) => item.status === 'review_needed').length,
    excludedCatalogItems: catalogItems.filter((item) => item.status === 'excluded').length,
    conflictCatalogItems: catalogItems.filter((item) => item.status === 'conflict').length,
    chunks: chunks.length,
    recommendableChunks: chunks.filter((chunk) => chunk.status === 'recommendable').length,
    conversationInsights: insights.length,
    latestMonth: months[0] || '',
    companies: topValues(catalogItems, 'company'),
    productGroups: topValues(catalogItems, 'product_group'),
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
  const [sourceRows, catalogRows, jobs, feedbackRows] = await Promise.all([
    dbList('polibot_knowledge_sources', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 1000 }).catch(() => []),
    dbList('polibot_catalog_items', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 2000 }).catch(() => []),
    dbList('polibot_ingest_jobs', selectedScope === 'all' ? {} : { scope: selectedScope }, { order: 'created_at', ascending: false, limit: 20 }).catch(() => []),
    dbList('polibot_recommendation_feedback', {}, { order: 'created_at', ascending: false, limit: 80 }).catch(() => [])
  ]);
  const statusFilter = selectedStatus === 'all' ? null : selectedStatus;
  const filteredSources = sourceRows
    .filter((row) => !statusFilter || row.status === statusFilter)
    .slice(0, maxRows)
    .map(sourceRowForReview);
  const filteredCatalogItems = catalogRows
    .filter((row) => !statusFilter || row.status === statusFilter)
    .slice(0, maxRows)
    .map(rawCatalogRowForReview);
  return {
    filters: { status: selectedStatus, scope: selectedScope, limit: maxRows },
    summary: {
      sources: sourceRows.length,
      catalogItems: catalogRows.length,
      sourceStatusCounts: countStatuses(sourceRows),
      catalogStatusCounts: countStatuses(catalogRows),
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
