import { createHash } from 'node:crypto';
import { getAccount } from './accountService.js';
import { dbGet, dbInsert, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { extractTrendPatterns, rankTrendSamples } from './trendPatternService.js';

const SOURCE_TYPES = new Set(['text_paste', 'screenshot_ocr', 'admin_seed']);
const QUALITY_STATUSES = new Set(['candidate', 'approved', 'rejected']);
const UNSAFE_FLAGS = new Set(['unsafe_conflict_frame', 'empty_text', 'source_similarity_high']);

function isMissingSchemaError(error) {
  const message = String(error?.message || '').toLowerCase();
  return ['42703', '42P01'].includes(error?.code)
    || message.includes('does not exist')
    || message.includes('schema cache')
    || message.includes('could not find');
}

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function shortText(value = '', max = 120) {
  return normalizeText(value).slice(0, max);
}

function sourceFingerprint(sample = {}) {
  const base = [
    normalizeText(sample.sourceText || sample.text || ''),
    normalizeText(sample.topicKeyword || ''),
    normalizeText(sample.sourceType || '')
  ].join('|');
  return createHash('sha256').update(base).digest('hex');
}

function patternFingerprint(pattern = {}, sourceType = '') {
  const base = [
    pattern.hookPattern,
    pattern.commentQuestion,
    pattern.tensionType,
    pattern.emotionSignal,
    pattern.reusableStructure,
    pattern.voicePattern,
    pattern.formatPattern,
    pattern.lineBreakPattern,
    pattern.listStructure,
    pattern.punctuationStyle,
    pattern.toneRegister,
    sourceType
  ].map(normalizeText).join('|');
  return createHash('sha256').update(base).digest('hex');
}

function isSafePattern(pattern = {}) {
  const flags = Array.isArray(pattern.safetyFlags) ? pattern.safetyFlags : [];
  return !flags.some((flag) => UNSAFE_FLAGS.has(flag));
}

export function sanitizeTrendPatternAsset(pattern = {}, context = {}) {
  return {
    category: shortText(context.category || pattern.topicKeyword || ''),
    target_audience_hint: shortText(context.targetAudienceHint || ''),
    hook_pattern: shortText(pattern.hookPattern, 180) || '생활 기준 질문으로 시작',
    comment_question_pattern: shortText(pattern.commentQuestion, 220) || '개인 기준을 가볍게 묻기',
    tension_type: shortText(pattern.tensionType, 60),
    emotion_signal: shortText(pattern.emotionSignal, 80),
    reusable_structure: shortText(pattern.reusableStructure, 400),
    voice_pattern: shortText(pattern.voicePattern, 220),
    format_pattern: shortText(pattern.formatPattern, 220),
    line_break_pattern: shortText(pattern.lineBreakPattern, 180),
    list_structure: shortText(pattern.listStructure, 220),
    punctuation_style: shortText(pattern.punctuationStyle, 160),
    tone_register: shortText(pattern.toneRegister, 160),
    performance_score: Math.max(0, Number(pattern.performanceScore || 0)),
    safety_flags: Array.isArray(pattern.safetyFlags) ? pattern.safetyFlags.map(shortText).slice(0, 10) : [],
    source_type: SOURCE_TYPES.has(context.sourceType) ? context.sourceType : 'text_paste',
    quality_status: QUALITY_STATUSES.has(context.qualityStatus) ? context.qualityStatus : 'candidate',
    source_fingerprint: context.sourceFingerprint || patternFingerprint(pattern, context.sourceType),
    usage_count: 0
  };
}

export function publicAssetToPromptPattern(asset = {}) {
  return {
    sourceId: `public-${asset.id || asset.source_fingerprint || 'pattern'}`,
    sourceType: asset.source_type || 'admin_seed',
    hookPattern: asset.hook_pattern || '',
    commentQuestion: asset.comment_question_pattern || '',
    tensionType: asset.tension_type || '',
    emotionSignal: asset.emotion_signal || '',
    reusableStructure: asset.reusable_structure || '',
    voicePattern: asset.voice_pattern || '',
    formatPattern: asset.format_pattern || '',
    lineBreakPattern: asset.line_break_pattern || '',
    listStructure: asset.list_structure || '',
    punctuationStyle: asset.punctuation_style || '',
    toneRegister: asset.tone_register || '',
    performanceScore: Number(asset.performance_score || 0),
    safetyFlags: Array.isArray(asset.safety_flags) ? asset.safety_flags : [],
    sourceText: ''
  };
}

function sanitizePersonalPattern(pattern = {}, context = {}) {
  return {
    sourceId: `personal-${pattern.sourceId || patternFingerprint(pattern, context.sourceType).slice(0, 12)}`,
    sourceType: SOURCE_TYPES.has(context.sourceType) ? context.sourceType : 'text_paste',
    category: shortText(context.category || pattern.topicKeyword || '', 120),
    targetAudienceHint: shortText(context.targetAudienceHint || '', 120),
    hookPattern: shortText(pattern.hookPattern, 180) || '생활 기준 질문으로 시작',
    commentQuestion: shortText(pattern.commentQuestion, 220) || '개인 기준을 가볍게 묻기',
    tensionType: shortText(pattern.tensionType, 60),
    emotionSignal: shortText(pattern.emotionSignal, 80),
    reusableStructure: shortText(pattern.reusableStructure, 400),
    voicePattern: shortText(pattern.voicePattern, 220),
    formatPattern: shortText(pattern.formatPattern, 220),
    lineBreakPattern: shortText(pattern.lineBreakPattern, 180),
    listStructure: shortText(pattern.listStructure, 220),
    punctuationStyle: shortText(pattern.punctuationStyle, 160),
    toneRegister: shortText(pattern.toneRegister, 160),
    performanceScore: Math.max(0, Number(pattern.performanceScore || 0)),
    safetyFlags: Array.isArray(pattern.safetyFlags) ? pattern.safetyFlags.map(shortText).slice(0, 10) : [],
    sourceText: ''
  };
}

async function savePersonalReferencePatterns(account, patterns = [], context = {}) {
  const existing = Array.isArray(account.personal_reference_patterns) ? account.personal_reference_patterns : [];
  const next = [
    ...patterns.filter(isSafePattern).map((pattern) => sanitizePersonalPattern(pattern, context)),
    ...existing
  ];
  const seen = new Set();
  const deduped = next.filter((pattern) => {
    const key = patternFingerprint(pattern, pattern.sourceType);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
  try {
    await dbUpdate('accounts', { id: account.id }, { personal_reference_patterns: deduped });
  } catch (error) {
    if (isMissingSchemaError(error)) {
      const nextError = new Error('인기글 학습 저장 준비가 아직 완료되지 않았습니다. 잠시 후 다시 시도해 주세요.');
      nextError.status = 503;
      nextError.code = 'TREND_REFERENCE_SCHEMA_NOT_READY';
      throw nextError;
    }
    throw error;
  }
  return deduped;
}

export async function saveAnonymousTrendPatternAssets(patterns = [], context = {}) {
  const rows = [];
  for (const pattern of patterns) {
    if (!isSafePattern(pattern)) continue;
    const row = sanitizeTrendPatternAsset(pattern, context);
    if (row.source_fingerprint) {
      const existing = await dbGet('trend_reference_patterns', { source_fingerprint: row.source_fingerprint }).catch(() => null);
      if (existing) continue;
    }
    try {
      rows.push(await dbInsert('trend_reference_patterns', row));
    } catch (error) {
      if (isMissingSchemaError(error)) {
        console.warn('[trend_reference_patterns_unavailable]', error.message);
        return rows;
      }
      throw error;
    }
  }
  return rows;
}

function splitReferenceBlocks(text = '') {
  return String(text || '')
    .split(/\n\s*---+\s*\n|\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function metricNumber(text = '', patterns = []) {
  const source = String(text || '').replace(/,/g, '');
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) return Number(match[1] || 0);
  }
  return 0;
}

function normalizeAdminSamples({ text = '', samples = [], category = '' } = {}) {
  const fromText = splitReferenceBlocks(text).map((block, index) => {
    const sourceText = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^(@|작성자|계정|url|https?:\/\/)/i.test(line))
      .join('\n')
      .trim();
    return {
      id: `admin-seed-${Date.now()}-${index}`,
      sourceText,
      topicKeyword: category,
      likes: metricNumber(block, [/좋아요\s*([0-9]+)/i, /likes?\s*([0-9]+)/i]),
      replies: metricNumber(block, [/댓글\s*([0-9]+)/i, /답글\s*([0-9]+)/i, /comments?\s*([0-9]+)/i]),
      reposts: metricNumber(block, [/공유\s*([0-9]+)/i, /reposts?\s*([0-9]+)/i]),
      views: metricNumber(block, [/조회\s*([0-9]+)/i, /views?\s*([0-9]+)/i]),
      sourceType: 'admin_seed'
    };
  });
  const normalized = [...fromText, ...(Array.isArray(samples) ? samples : [])]
    .map((sample, index) => ({
      id: sample.id || `admin-sample-${index}`,
      sourceText: normalizeText(sample.sourceText || sample.text || ''),
      topicKeyword: normalizeText(sample.topicKeyword || category || ''),
      likes: Number(sample.likes || 0),
      replies: Number(sample.replies || sample.comments || 0),
      reposts: Number(sample.reposts || 0),
      views: Number(sample.views || 0),
      sourceType: 'admin_seed'
    }))
    .filter((sample) => sample.sourceText.length >= 20);
  const seen = new Set();
  return normalized.filter((sample) => {
    const key = sourceFingerprint(sample);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyAdminDirection(pattern = {}, direction = '') {
  const cleanDirection = shortText(direction, 260);
  if (!cleanDirection) return pattern;
  return {
    ...pattern,
    reusableStructure: shortText([pattern.reusableStructure, `운영 방향: ${cleanDirection}`].filter(Boolean).join(' / '), 400),
    voicePattern: shortText([pattern.voicePattern, `방향: ${cleanDirection}`].filter(Boolean).join(' / '), 220)
  };
}

export async function createAdminTrendPatternAssets({
  text = '',
  samples = [],
  category = '',
  targetAudienceHint = '',
  direction = '',
  qualityStatus = 'candidate',
  useAi = true
} = {}) {
  const normalizedSamples = normalizeAdminSamples({ text, samples, category });
  if (normalizedSamples.length === 0) {
    const error = new Error('분석할 콘텐츠를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const rankedSamples = rankTrendSamples(normalizedSamples, { query: category, limit: 20 });
  const patterns = (await extractTrendPatterns(rankedSamples, { query: category, limit: 8, useAi }))
    .filter(isSafePattern)
    .map((pattern) => applyAdminDirection(pattern, direction));
  const rows = await saveAnonymousTrendPatternAssets(patterns, {
    category,
    targetAudienceHint,
    sourceType: 'admin_seed',
    qualityStatus: QUALITY_STATUSES.has(qualityStatus) ? qualityStatus : 'candidate'
  });
  await logActivity({
    action: 'admin_trend_patterns_created',
    level: 'info',
    message: `관리자 콘텐츠 ${normalizedSamples.length}개에서 공용 패턴 ${rows.length}개를 저장했습니다.`,
    payload: {
      category,
      targetAudienceHint,
      direction: shortText(direction, 260),
      qualityStatus,
      sampleCount: normalizedSamples.length,
      patternCount: patterns.length,
      savedCount: rows.length
    }
  });
  return {
    samples: rankedSamples,
    patterns,
    rows,
    savedCount: rows.length,
    rejectedUnsafeCount: Math.max(0, normalizedSamples.length - patterns.length)
  };
}

export async function ingestTrendReferencesForAccount(accountId, {
  samples = [],
  sourceType = 'text_paste',
  category = '',
  targetAudienceHint = '',
  useAi = true
} = {}) {
  const account = await getAccount(accountId);
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const normalizedSamples = (Array.isArray(samples) ? samples : [])
    .map((sample, index) => ({
      id: sample.id || `customer-reference-${index}`,
      sourceText: normalizeText(sample.sourceText || sample.text || ''),
      topicKeyword: normalizeText(sample.topicKeyword || category || account.content_scope || ''),
      likes: Number(sample.likes || 0),
      replies: Number(sample.replies || sample.comments || 0),
      reposts: Number(sample.reposts || 0),
      views: Number(sample.views || 0),
      sourceType
    }))
    .filter((sample) => sample.sourceText.length >= 20);

  const rankedSamples = rankTrendSamples(normalizedSamples, { query: category || account.content_scope || '', limit: 20 });
  const patterns = await extractTrendPatterns(rankedSamples, { query: category || account.content_scope || '', limit: 8, useAi });
  const safePatterns = patterns.filter(isSafePattern);
  const savedPersonalPatterns = await savePersonalReferencePatterns(account, safePatterns, {
    category: category || account.content_scope || '',
    targetAudienceHint: targetAudienceHint || account.target_audience || '',
    sourceType
  });
  let sharedPatterns = [];

  if (account.anonymous_learning_enabled) {
    sharedPatterns = await saveAnonymousTrendPatternAssets(safePatterns, {
      category: category || account.content_scope || '',
      targetAudienceHint: targetAudienceHint || account.target_audience || '',
      sourceType,
      qualityStatus: 'candidate',
      sourceFingerprint: normalizedSamples.length === 1 ? sourceFingerprint(normalizedSamples[0]) : ''
    });
  }

  await logActivity({
    account_id: account.id,
    project_id: account.project_id,
    action: 'trend_references_ingested',
    level: 'info',
    message: `인기글 레퍼런스 ${normalizedSamples.length}개에서 패턴 ${safePatterns.length}개를 추출했습니다.`,
    payload: {
      sourceType,
      anonymousLearningEnabled: Boolean(account.anonymous_learning_enabled),
      sharedPatternCount: sharedPatterns.length,
      personalPatternCount: savedPersonalPatterns.length,
      rejectedUnsafeCount: patterns.length - safePatterns.length
    }
  });

  return {
    samples: rankedSamples,
    personalPatterns: savedPersonalPatterns,
    sharedPatternCount: sharedPatterns.length,
    personalPatternCount: savedPersonalPatterns.length,
    anonymousLearningEnabled: Boolean(account.anonymous_learning_enabled)
  };
}

export async function listApprovedTrendPatternAssets({ category = '', targetAudienceHint = '', limit = 8 } = {}) {
  const rows = await dbList('trend_reference_patterns', { quality_status: 'approved' }, {
    order: 'performance_score',
    ascending: false,
    limit: Math.max(1, Number(limit || 8) * 3)
  }).catch(() => []);
  const categoryText = normalizeText(category).toLowerCase();
  const audienceText = normalizeText(targetAudienceHint).toLowerCase();
  return rows
    .filter((row) => {
      const flags = Array.isArray(row.safety_flags) ? row.safety_flags : [];
      if (flags.some((flag) => UNSAFE_FLAGS.has(flag))) return false;
      const haystack = normalizeText([row.category, row.target_audience_hint].filter(Boolean).join(' ')).toLowerCase();
      if (categoryText && haystack.includes(categoryText)) return true;
      if (audienceText && haystack.includes(audienceText)) return true;
      return !categoryText && !audienceText;
    })
    .slice(0, Math.max(1, Number(limit || 8)));
}

export async function buildReferencePatternContext(account = {}, { personalPatterns = [], limit = 5 } = {}) {
  const storedPersonal = Array.isArray(account.personal_reference_patterns) ? account.personal_reference_patterns : [];
  const personal = [
    ...(Array.isArray(personalPatterns) ? personalPatterns : []),
    ...storedPersonal
  ].filter(isSafePattern);
  const publicRows = await listApprovedTrendPatternAssets({
    category: account.content_scope || '',
    targetAudienceHint: account.target_audience || '',
    limit
  });
  const publicPatterns = publicRows.map(publicAssetToPromptPattern);
  const hasPersonal = personal.length > 0;
  const selectedPersonal = hasPersonal ? personal.slice(0, Math.ceil(limit * 0.7)) : [];
  const selectedPublic = publicPatterns.slice(0, hasPersonal ? Math.max(1, Math.floor(limit * 0.2)) : Math.ceil(limit * 0.6));
  return {
    mix: hasPersonal
      ? { personalReferences: 0.7, publicAnonymousPatterns: 0.2, safeDefault: 0.1 }
      : { personalReferences: 0, publicAnonymousPatterns: 0.6, safeDefault: 0.4 },
    patterns: [...selectedPersonal, ...selectedPublic].slice(0, limit),
    publicPatternCount: publicPatterns.length,
    personalPatternCount: personal.length
  };
}

export async function updateTrendPatternQualityStatus(id, status) {
  if (!QUALITY_STATUSES.has(status)) {
    const error = new Error('지원하지 않는 패턴 상태입니다.');
    error.status = 400;
    throw error;
  }
  const [updated] = await dbUpdate('trend_reference_patterns', { id }, { quality_status: status });
  if (!updated) {
    const error = new Error('패턴을 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  return updated;
}

export async function listTrendPatternAssets({ status = 'candidate', limit = 100 } = {}) {
  const filters = QUALITY_STATUSES.has(status) ? { quality_status: status } : {};
  return dbList('trend_reference_patterns', filters, {
    order: 'created_at',
    ascending: false,
    limit: Math.max(1, Math.min(200, Number(limit || 100)))
  }).catch(() => []);
}
