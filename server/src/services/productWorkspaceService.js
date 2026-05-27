import { PRODUCTS, productById } from '../config/products.js';
import AdmZip from 'adm-zip';
import { readFileSync } from 'node:fs';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { productServiceClosedInProduction } from '../utils/productAvailability.js';
import {
  buildPolibotCatalog,
  buildPolibotCatalogItems,
  inferPolibotFileType,
  normalizePolibotKnowledgeItems,
  polibotSeedKnowledgeSources,
  rankPolibotEvidence
} from './polibotKnowledgeService.js';
import {
  getImportedPolibotCatalogReadiness,
  ingestPolibotKnowledge,
  isNoisyPolibotCodeCandidate,
  listPolibotDbKnowledgeSources,
  searchPolibotCodeCandidates
} from './polibotKnowledgeDbService.js';

const ALLOWED_PRODUCTS = new Set(['dexor', 'spread', 'polibot', 'infludex', 'auvibot', 'sublog']);
const DEFAULT_USAGE_LIMIT = 5;
const UNLIMITED_TEST_EMAILS = new Set(['test1@test.com']);
const UNLIMITED_USAGE_LIMIT = 999999;
const DEXOR_SCORE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const INFLUDEX_GRADE_ORDER = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const DEXOR_CATEGORIES = ['자동', '맛집', '뷰티', '육아', '생활/리빙', '가전', '건강', '패션', '여행', '기타'];
const DEXOR_INDUSTRY_KEYWORDS = {
  food: ['맛집', '식당', '카페', '메뉴', '예약', '방문', '후기', '점심', '저녁', '디저트'],
  beauty: ['뷰티', '피부', '화장품', '관리', '시술', '헤어', '네일', '메이크업', '후기'],
  travel: ['여행', '숙소', '호텔', '코스', '가볼만한곳', '예약', '일정', '방문', '후기'],
  living: ['리빙', '인테리어', '살림', '가구', '주방', '생활', '정리', '후기'],
  parenting: ['육아', '아이', '아기', '키즈', '교육', '놀이', '엄마', '가족', '후기'],
  it: ['IT', '앱', '서비스', '기기', '노트북', '모바일', '설치', '리뷰', '사용기'],
  fashion: ['패션', '코디', '의류', '신발', '가방', '스타일', '착용', '후기'],
  pet: ['반려동물', '강아지', '고양이', '펫', '간식', '용품', '동물병원', '후기']
};
const DEXOR_INDUSTRY_LABELS = {
  food: '맛집',
  beauty: '뷰티',
  travel: '여행',
  living: '리빙',
  parenting: '육아',
  it: 'IT',
  fashion: '패션',
  pet: '반려동물'
};
const DEXOR_KEYWORD_STOPWORDS = new Set([
  '그리고', '하지만', '있는', '없는', '해서', '하는', '하면', '이번', '오늘', '내일', '정말', '너무', '같은',
  '블로그', '네이버', '후기', '리뷰', '추천', '방문', '사용', '직접', '콘텐츠', '포스팅', '좋은', '많이'
]);
const DEXOR_DAILY_VISITOR_MINIMUMS = { s: 500, a: 200, b: 80 };
DEXOR_INDUSTRY_KEYWORDS.auto = [...new Set(Object.values(DEXOR_INDUSTRY_KEYWORDS).flat())];
DEXOR_INDUSTRY_LABELS.auto = '자동';
const POLIBOT_RECOMMEND_TIMING_WARN_MS = Math.max(1000, Number(process.env.POLIBOT_RECOMMEND_TIMING_WARN_MS || 15000));
let POLIBOT_EXCEPTION_DISEASE_DATA = null;

const EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY = {
  totalSources: 0,
  globalSources: 0,
  userSources: 0,
  importedSources: 0,
  statusCounts: {},
  sourceChannelCounts: {},
  recommendableSources: 0,
  reviewNeededSources: 0,
  excludedSources: 0,
  ocrNeededSources: 0,
  privacyRiskSources: 0,
  conflictSources: 0,
  highQualitySources: 0,
  mediumQualitySources: 0,
  lowQualitySources: 0,
  catalogItems: 0,
  importedCatalogItems: 0,
  recommendableCatalogItems: 0,
  reviewNeededCatalogItems: 0,
  excludedCatalogItems: 0,
  conflictCatalogItems: 0,
  chunks: 0,
  recommendableChunks: 0,
  conversationInsights: 0,
  latestMonth: '',
  companies: [],
  productGroups: [],
  latestJob: null
};

function now() {
  return new Date().toISOString();
}

function hashText(text = '') {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function polibotExceptionDiseaseData() {
  if (POLIBOT_EXCEPTION_DISEASE_DATA) return POLIBOT_EXCEPTION_DISEASE_DATA;
  try {
    const raw = readFileSync(new URL('../data/polibotExceptionDiseases.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(raw);
    POLIBOT_EXCEPTION_DISEASE_DATA = {
      summary: parsed.summary || {},
      diseases: Array.isArray(parsed.diseases) ? parsed.diseases : []
    };
  } catch {
    POLIBOT_EXCEPTION_DISEASE_DATA = { summary: {}, diseases: [] };
  }
  return POLIBOT_EXCEPTION_DISEASE_DATA;
}

function normalizePolibotKcdCode(value = '') {
  const match = String(value || '').toUpperCase().trim().match(/^([A-Z])(\d{2})(?:\.?([0-9A-Z]{1,2}))?$/);
  if (!match) return '';
  return `${match[1]}${match[2]}${match[3] ? `.${match[3]}` : ''}`;
}

function polibotKcdBase(code = '') {
  return normalizePolibotKcdCode(code).match(/^[A-Z]\d{2}/)?.[0] || '';
}

function polibotExceptionDiseaseTerms(profile = {}) {
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const hiraCodes = Array.isArray(disclosure.hiraDiseaseCodes) ? disclosure.hiraDiseaseCodes : [];
  const text = [
    profile.medicalHistory,
    disclosure.medicationRiskReview,
    disclosure.currentMedication,
    disclosure.majorDisease,
    disclosure.details
  ].filter(Boolean).join(' ');
  const terms = [
    ...hiraCodes.flatMap((item) => [item.name, item.context]),
    ...[...text.matchAll(/상병코드\s*[:：]?\s*[A-Z]\d{2}(?:\.?[0-9A-Z]{1,2})?\s*([가-힣A-Za-z0-9\s·ㆍ()/-]{2,40})/gi)].map((match) => match[1])
  ];
  return [...new Set(terms
    .flatMap((term) => String(term || '').split(/\s*\/\s*|,|·|ㆍ/))
    .map((term) => term.replace(/투약일수|투약\s*분류|지속투약|심사\s*필요|상병코드|주상병|부상병/gi, '').trim())
    .filter((term) => /[가-힣A-Za-z]/.test(term) && term.length >= 2 && term.length <= 40))]
    .slice(0, 30);
}

function polibotProfileKcdCodes(profile = {}) {
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const fromHira = Array.isArray(disclosure.hiraDiseaseCodes) ? disclosure.hiraDiseaseCodes.map((item) => item.code) : [];
  const fromActual = Array.isArray(profile.actualCodes)
    ? profile.actualCodes.filter((item) => item.kind === 'KCD').map((item) => item.code)
    : [];
  const text = [
    profile.medicalHistory,
    disclosure.medicationRiskReview,
    disclosure.details
  ].filter(Boolean).join(' ');
  const fromText = [...text.matchAll(/\b([A-Z]\d{2}(?:\.?[0-9A-Z]{1,2})?)\b/gi)].map((match) => match[1]);
  return [...new Set([...fromHira, ...fromActual, ...fromText].map(normalizePolibotKcdCode).filter(Boolean))].slice(0, 30);
}

function dexorScoreLabel(score) {
  if (score >= 90) return 'S';
  if (score >= 70) return 'A';
  if (score >= 60) return 'B';
  if (score >= 40) return 'C';
  return 'D';
}

function dexorScoreComment(score) {
  if (score >= 90) return '우선 추천';
  if (score >= 70) return '추천';
  if (score >= 60) return '검토';
  if (score >= 40) return '추가 확인';
  return '비추천';
}

function dexorDecisionFromGrade(grade) {
  if (grade === 'S') return '바로 섭외 추천';
  if (grade === 'A') return '섭외 가능';
  if (grade === 'B') return '조건부 섭외';
  if (grade === 'C') return '우선순위 낮음';
  return '섭외 비추천';
}

function dexorClamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function dexorHash(input = '') {
  return [...String(input)].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 9973, 7);
}

function dexorParseBlogUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  let match = trimmed.match(/[?&]blogId=([a-zA-Z0-9._-]+).*?[?&]logNo=([0-9]+)/i)
    || trimmed.match(/[?&]logNo=([0-9]+).*?[?&]blogId=([a-zA-Z0-9._-]+)/i);
  if (match && /blogId=/i.test(match[0]) && /logNo=/i.test(match[0])) {
    return /[?&]blogId=/i.test(match[0])
      ? { blogId: match[1], logNo: match[2] }
      : { blogId: match[2], logNo: match[1] };
  }
  match = trimmed.match(/(?:https?:\/\/)?(?:m\.)?blog\.naver\.com\/([a-zA-Z0-9._-]+)(?:\/([0-9]+))?/i);
  if (match) return { blogId: match[1], logNo: match[2] || null };
  return null;
}

function dexorNormalizeBlogUrl(raw) {
  const parsed = dexorParseBlogUrl(raw);
  if (!parsed) return null;
  return parsed.logNo
    ? `https://blog.naver.com/${parsed.blogId}/${parsed.logNo}`
    : `https://blog.naver.com/${parsed.blogId}`;
}

function dexorGetBlogId(url) {
  return dexorParseBlogUrl(dexorNormalizeBlogUrl(url) || url)?.blogId || null;
}

function dexorStripHtml(input = '') {
  return String(input).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function dexorHtmlDecode(input = '') {
  return String(input)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCharCode(Number.parseInt(code, 10)));
}

function dexorExtractXmlTag(xml = '', tag = '') {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml).match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return dexorStripHtml(dexorHtmlDecode(match?.[1] || ''));
}

function dexorNormalizeCampaign(input = {}) {
  const industry = DEXOR_INDUSTRY_LABELS[input.industry] ? input.industry : 'auto';
  const rawKeyword = String(input.keyword || '').trim();
  const keyword = (rawKeyword || (industry === 'auto' ? '' : DEXOR_INDUSTRY_LABELS[industry])).slice(0, 40);
  return { industry, industryLabel: DEXOR_INDUSTRY_LABELS[industry], keyword, keywordProvided: rawKeyword.length > 0 };
}

function dexorWeightedTopicScore(text, words) {
  const source = String(text || '').toLowerCase();
  return words.reduce((sum, word) => sum + (source.includes(String(word).toLowerCase()) ? 1 : 0), 0);
}

function dexorTextIncludesAnyTerm(text, terms) {
  const source = String(text || '').toLowerCase();
  return terms.some((term) => {
    const value = String(term || '').trim().toLowerCase();
    return value.length >= 2 && source.includes(value);
  });
}

function dexorKeywordTerms(campaign) {
  const industryWords = DEXOR_INDUSTRY_KEYWORDS[campaign.industry] || [];
  const keywordParts = String(campaign.keyword || '').split(/[\s,/·|]+/).filter((word) => word.length >= 2);
  return [...new Set([...industryWords, campaign.keyword, ...keywordParts].filter(Boolean))];
}

function dexorKeywordSearchTerms(campaign) {
  const keyword = String(campaign.keyword || '').trim();
  const keywordParts = keyword.split(/[\s,/·|]+/).filter((word) => word.length >= 2);
  const defaultIndustryKeyword = !campaign.keywordProvided || keyword === DEXOR_INDUSTRY_LABELS[campaign.industry];
  const industryWords = defaultIndustryKeyword
    ? (DEXOR_INDUSTRY_KEYWORDS[campaign.industry] || []).filter((word) => !['후기', '리뷰'].includes(word))
    : [];
  return [...new Set([keyword, ...keywordParts, ...industryWords].filter((word) => String(word).trim().length >= 2))];
}

function dexorExtractCandidateKeywords(posts, campaign, limit = 2) {
  const campaignTerms = new Set(dexorKeywordTerms(campaign).map((word) => String(word).toLowerCase()));
  const counts = new Map();
  posts.forEach((post, index) => {
    const weight = Math.max(1, 6 - index);
    const tokens = String(`${post.title || ''} ${post.description || ''}`).match(/[가-힣A-Za-z0-9]{2,}/g) || [];
    tokens.forEach((token) => {
      const normalized = token.toLowerCase();
      if (DEXOR_KEYWORD_STOPWORDS.has(normalized) || campaignTerms.has(normalized)) return;
      if (/^\d+$/.test(normalized)) return;
      counts.set(normalized, (counts.get(normalized) || 0) + weight);
    });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
    .slice(0, limit)
    .map(([keyword, weight]) => ({ keyword, weight }));
}

function dexorEstimateDailyVisitorSignal(posts, seed) {
  if (!posts.length) return null;
  const engagementAverage = posts.reduce((sum, post) => sum + post.comments * 3 + post.likes, 0) / posts.length;
  const recencyBoost = posts.filter((post) => post.daysAgo <= 7).length * 25;
  const estimatedAverage = Math.round(dexorClamp(engagementAverage * 8 + recencyBoost + (seed % 90), 20, 900));
  return {
    status: 'estimated',
    label: '공개 반응 기반 추정',
    estimatedAverage,
    estimatedMin: Math.max(10, Math.round(estimatedAverage * 0.55)),
    estimatedMax: Math.round(estimatedAverage * 1.45),
    minimums: DEXOR_DAILY_VISITOR_MINIMUMS
  };
}

function dexorCategoryToIndustry(category = '') {
  const normalized = normalizeDexorCategory(category);
  if (normalized === '맛집') return 'food';
  if (normalized === '뷰티') return 'beauty';
  if (normalized === '육아') return 'parenting';
  if (normalized === '패션') return 'fashion';
  if (normalized === '여행') return 'travel';
  if (['생활/리빙', '가전', '건강'].includes(normalized)) return 'living';
  return 'auto';
}

async function dexorCollectPublicBlogSignals(url, mode, campaign) {
  const blogId = dexorGetBlogId(url);
  if (!blogId) throw new Error('유효한 네이버 블로그 ID를 찾지 못했습니다.');

  const response = await fetch(`https://rss.blog.naver.com/${encodeURIComponent(blogId)}.xml`, {
    signal: AbortSignal.timeout(4500),
    headers: { 'User-Agent': 'DEXOR exposure analysis bot' }
  });
  if (!response.ok) throw new Error(`네이버 RSS 접근 실패 (${response.status})`);
  const xml = await response.text();
  const rawItems = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((match) => match[1])
    .slice(0, mode === 'deep' ? 30 : 12);
  if (rawItems.length === 0) throw new Error('분석 가능한 공개 RSS 글이 없습니다.');
  const seed = dexorHash(`${url}:${mode}:${campaign.industry}:${campaign.keyword}`);
  const industryWords = DEXOR_INDUSTRY_KEYWORDS[campaign.industry] || [];
  const posts = rawItems.map((item, index) => {
    const title = dexorExtractXmlTag(item, 'title');
    const description = dexorExtractXmlTag(item, 'description');
    const body = `${title} ${description}`;
    const pubDateText = dexorExtractXmlTag(item, 'pubDate');
    const pubDate = pubDateText ? new Date(pubDateText) : null;
    const daysAgo = pubDate && !Number.isNaN(pubDate.getTime())
      ? Math.max(0, Math.floor((Date.now() - pubDate.getTime()) / (1000 * 60 * 60 * 24)))
      : index * 7;
    const adSignals = ['제공', '협찬', '광고', '체험단', '원고료', '소정의'].filter((word) => body.includes(word));
    return {
      title: title || `${campaign.keyword} 공개 글 ${index + 1}`,
      description,
      daysAgo,
      topicHits: dexorWeightedTopicScore(body, [...industryWords, campaign.keyword]),
      hasExperience: ['방문', '사용', '먹어', '다녀', '직접', '후기', '느꼈'].some((word) => body.includes(word)),
      adSignals: adSignals.length ? adSignals : ['공개 글'],
      comments: 2 + ((seed + index) % 16),
      likes: 5 + ((seed + index * 7) % 45)
    };
  });
  return {
    sourceStatus: 'public-rss',
    subscriberSignal: 30 + (seed % 65),
    dailyVisitorSignal: dexorEstimateDailyVisitorSignal(posts, seed),
    topCompetitorStrength: 42 + (dexorHash(`${campaign.keyword}:competition`) % 49),
    posts
  };
}

async function dexorAnalyzeExposurePotential(url, mode = 'quick', campaignInput = {}) {
  const campaign = dexorNormalizeCampaign(campaignInput);
  const seed = dexorHash(`${url}:${mode}:${campaign.industry}:${campaign.keyword}`);
  const signals = await dexorCollectPublicBlogSignals(url, mode, campaign);
  const dailyVisitorSignal = signals.dailyVisitorSignal;
  const latestPostDays = Math.min(...signals.posts.map((post) => post.daysAgo));
  const recentPostCount = signals.posts.filter((post) => post.daysAgo <= 30).length;
  const adPostCount = signals.posts.filter((post) => post.adSignals.some((signal) => ['제공', '협찬', '광고'].includes(signal))).length;
  const adRatio = Math.round((adPostCount / signals.posts.length) * 100);
  const industryWords = dexorKeywordTerms(campaign);
  const recentTenPosts = signals.posts.slice(0, 10);
  const recentFivePosts = signals.posts.slice(0, 5);
  const searchTerms = dexorKeywordSearchTerms(campaign);
  const recentFiveKeywordHitPosts = recentFivePosts
    .map((post, index) => ({
      index: index + 1,
      title: post.title,
      matched: dexorTextIncludesAnyTerm(`${post.title || ''} ${post.description || ''}`, searchTerms)
    }))
    .filter((post) => post.matched);
  const recentKeywordHitPosts = recentTenPosts
    .map((post, index) => ({
      index: index + 1,
      title: post.title,
      matched: dexorTextIncludesAnyTerm(`${post.title || ''} ${post.description || ''}`, searchTerms)
    }))
    .filter((post) => post.matched);
  const recentKeywordCoverage = signals.posts.length
    ? Math.round((recentKeywordHitPosts.length / Math.min(10, signals.posts.length)) * 100)
    : 0;
  const recentKeywordCheck = {
    status: recentKeywordHitPosts.length > 0 ? 'passed' : 'failed',
    label: recentKeywordHitPosts.length > 0 ? '최근 10개 내 키워드 콘텐츠 확인' : '최근 10개 내 키워드 콘텐츠 없음',
    coverage: recentKeywordCoverage,
    matchedCount: recentKeywordHitPosts.length,
    recentFiveMatchedCount: recentFiveKeywordHitPosts.length,
    checkedCount: Math.min(10, signals.posts.length),
    recentFiveCheckedCount: Math.min(5, signals.posts.length),
    terms: searchTerms,
    matchedTitles: recentKeywordHitPosts.slice(0, 3).map((post) => post.title),
    recentFiveMatchedTitles: recentFiveKeywordHitPosts.slice(0, 3).map((post) => post.title)
  };
  const derivedKeywords = dexorExtractCandidateKeywords(recentFivePosts, campaign, 2);
  const derivedKeywordBonus = Math.min(8, derivedKeywords.reduce((sum, item) => sum + item.weight, 0) / 4);
  const topicHits = signals.posts.reduce((sum, post) => sum + post.topicHits + dexorWeightedTopicScore(post.title, industryWords), 0);
  const maxTopicHits = signals.posts.length * 5;
  const topicFit = Math.round(dexorClamp((topicHits / maxTopicHits) * 100));
  const activityFit = Math.round(dexorClamp((recentPostCount / Math.min(signals.posts.length, mode === 'deep' ? 16 : 8)) * 100));
  const experienceFit = Math.round((signals.posts.filter((post) => post.hasExperience).length / signals.posts.length) * 100);
  const engagementFit = Math.round(dexorClamp((signals.posts.reduce((sum, post) => sum + post.comments + post.likes / 4, 0) / signals.posts.length) * 3));
  const keywordCompetition = signals.topCompetitorStrength;
  const competitorSimilarity = Math.round(dexorClamp((topicFit * 0.45) + (activityFit * 0.25) + (experienceFit * 0.2) + (engagementFit * 0.1) - Math.max(0, keywordCompetition - 70) * 0.35));
  const cRankFit = Math.round(dexorClamp(topicFit * 0.42 + activityFit * 0.28 + engagementFit * 0.18 + signals.subscriberSignal * 0.12));
  const diaFit = Math.round(dexorClamp(experienceFit * 0.36 + topicFit * 0.28 + (100 - adRatio) * 0.16 + activityFit * 0.12 + competitorSimilarity * 0.08));
  const riskFlags = [];
  let riskPenalty = 0;
  let gradeCap = null;

  if (latestPostDays > 45) {
    riskFlags.push('최근 활동 약함');
    riskPenalty += 14;
  }
  if (adRatio >= 65) {
    riskFlags.push('대가성 콘텐츠 비중 높음');
    riskPenalty += 10;
  }
  if (topicFit < 35) {
    riskFlags.push('캠페인 주제 적합도 낮음');
    riskPenalty += 10;
  }
  if (recentKeywordCheck.status === 'failed') {
    riskFlags.push('최근 10개 내 키워드 콘텐츠 없음');
    riskPenalty += 10;
  } else if (recentKeywordCheck.recentFiveMatchedCount === 0) {
    riskFlags.push('최근 5개 내 세부키워드 노출 없음');
    riskPenalty += 7;
  } else if (recentKeywordCheck.matchedCount === 1 && signals.posts.length >= 8) {
    riskFlags.push('최근 키워드 콘텐츠 빈도 낮음');
    riskPenalty += 4;
  }
  if (!dailyVisitorSignal) {
    riskFlags.push('일방문자수 실측 미확인');
    riskPenalty += 2;
  } else if ((dailyVisitorSignal.estimatedAverage || 0) < DEXOR_DAILY_VISITOR_MINIMUMS.b) {
    riskFlags.push('일방문자수 기준 미달');
    riskPenalty += 8;
  } else if ((dailyVisitorSignal.estimatedAverage || 0) < DEXOR_DAILY_VISITOR_MINIMUMS.a) {
    riskFlags.push('일방문자수 낮음');
    riskPenalty += 6;
  } else if ((dailyVisitorSignal.estimatedAverage || 0) < DEXOR_DAILY_VISITOR_MINIMUMS.s) {
    riskFlags.push('S랭크 방문자 기준 미달');
    riskPenalty += 3;
  }
  if (keywordCompetition >= 82 && competitorSimilarity < 68) {
    riskFlags.push('키워드 경쟁 강도 높음');
    riskPenalty += 6;
  }

  const rssScore = cRankFit * 0.36 + diaFit * 0.34 + competitorSimilarity * 0.2 + (100 - keywordCompetition) * 0.1;
  const exposureScore = Math.round(dexorClamp(rssScore + recentKeywordCoverage * 0.05 + derivedKeywordBonus - riskPenalty));
  const dailyVisitorAverage = dailyVisitorSignal?.estimatedAverage || 0;
  const strongRecentTopicExposure = topicFit >= 35
    && (recentKeywordCheck.recentFiveMatchedCount >= 3 || recentKeywordCheck.matchedCount >= 5);
  const severeExposureRisk = Boolean(latestPostDays > 45
    || adRatio >= 65
    || topicFit < 25
    || (dailyVisitorSignal && dailyVisitorAverage < DEXOR_DAILY_VISITOR_MINIMUMS.b));
  const exposureSignal = {
    status: strongRecentTopicExposure && !severeExposureRisk ? 'strong' : 'normal',
    label: strongRecentTopicExposure && !severeExposureRisk ? '최근 주제 노출 강함' : '종합 점수 기준',
    recentFiveMatchedCount: recentKeywordCheck.recentFiveMatchedCount,
    matchedCount: recentKeywordCheck.matchedCount,
    severeExposureRisk
  };
  const scoreGrade = dexorScoreLabel(exposureScore);
  const grade = exposureSignal.status === 'strong' && !gradeCap ? 'S' : dexorMinGrade(scoreGrade, gradeCap);
  const campaignScope = campaign.keyword ? `${campaign.industryLabel}·${campaign.keyword}` : `${campaign.industryLabel} 전체`;
  const reasons = [
    `${campaignScope} 맥락에서 최근 ${recentPostCount}개 글이 공개 신호로 확인되어 노출 가능성을 추정했습니다.`,
    `블로그 최근 글 기준 주제 적합도 ${topicFit}점, 문서 적합도 ${diaFit}점으로 블로그 전체 흐름을 보조 반영했습니다.`,
    `${recentKeywordCheck.label}: 최근 ${recentKeywordCheck.checkedCount}개 중 ${recentKeywordCheck.matchedCount}개, 최근 5개 중 ${recentKeywordCheck.recentFiveMatchedCount}개가 "${campaign.keyword || campaign.industryLabel}" 관련 표현을 포함했습니다.`,
    derivedKeywords.length
      ? `최근 5개 글에서 보조 검토 키워드로 ${derivedKeywords.map((item) => item.keyword).join(', ')}를 추렸습니다.`
      : '최근 5개 글에서 뚜렷한 보조 검토 키워드는 추출되지 않았습니다.',
    keywordCompetition >= 75
      ? `입력 키워드의 경쟁 강도가 ${keywordCompetition}점으로 높아 상위 노출은 보수적으로 봐야 합니다.`
      : `입력 키워드 경쟁 강도가 ${keywordCompetition}점으로 과열 구간은 아닙니다.`
  ];

  return {
    id: `result_${Date.now()}_${seed}`,
    url,
    mode,
    score: exposureScore,
    grade,
    decision: dexorDecisionFromGrade(grade),
    adRatio,
    recentActivity: latestPostDays <= 7 ? '매우 활발' : latestPostDays <= 30 ? '활발' : latestPostDays <= 60 ? '주의' : '비활성',
    category: campaign.industryLabel,
    riskFlags,
    reasons,
    breakdown: {
      exposureScore,
      cRankFit,
      diaFit,
      topicFit,
      keywordCompetition,
      competitorSimilarity,
      activityFit,
      riskPenalty,
      campaign,
      recentPostCount,
      latestPostDays,
      recentKeywordCheck,
      derivedKeywords,
      dailyVisitorSignal,
      exposureSignal,
      sourceStatus: signals.sourceStatus,
      recommendation: ['S', 'A'].includes(grade) ? '체험 후기형 원고' : grade === 'B' ? '롱테일 키워드 후기' : '브랜드 인지도 보조 캠페인'
    },
    recentPosts: signals.posts.slice(0, 5).map((post) => ({
      title: post.title,
      adSignals: post.adSignals,
      comments: post.comments,
      daysAgo: post.daysAgo
    }))
  };
}

function dexorGradeRank(grade = '') {
  return { S: 5, A: 4, B: 3, C: 2, D: 1 }[grade] || 0;
}

function dexorMinGrade(...grades) {
  return grades.filter(Boolean).sort((a, b) => dexorGradeRank(a) - dexorGradeRank(b))[0] || 'D';
}

function normalizeLegacyDexorIndex(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/초급|준최\s*1|준최\s*2|low|beginner/i.test(text)) return '초급';
  if (/중급|준최\s*3|준최\s*4|mid|middle/i.test(text)) return '중급';
  if (/고급|최적|준최\s*5|high|advanced/i.test(text)) return '고급';
  return text.slice(0, 20);
}

function formatDexorDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function parseDexorRecentDate(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  let match = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }
  match = text.match(/(\d{1,2})\s*일\s*전/);
  if (match) {
    const date = new Date();
    date.setDate(date.getDate() - Number(match[1]));
    return formatDexorDate(date);
  }
  match = text.match(/(\d{1,2})\s*주\s*전/);
  if (match) {
    const date = new Date();
    date.setDate(date.getDate() - (Number(match[1]) * 7));
    return formatDexorDate(date);
  }
  match = text.match(/(\d{1,2})\s*개월\s*전/);
  if (match) {
    const date = new Date();
    date.setMonth(date.getMonth() - Number(match[1]));
    return formatDexorDate(date);
  }
  return '';
}

function parseDexorExposureRank(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const explicit = text.match(/(?:상위|순위|rank|top)?\s*(\d{1,3})\s*(?:위|등|rank)?/i);
  if (!explicit) return null;
  const rank = Number(explicit[1]);
  return Number.isFinite(rank) && rank > 0 ? rank : null;
}

function parseDexorKeywordCount(value = '') {
  const text = String(value || '').trim();
  if (!text) return 0;
  const explicit = text.match(/(\d{1,2})\s*(?:개\s*)?(?:키워드|keyword|kw)/i);
  if (explicit) return Number(explicit[1]) || 0;
  if (/키워드|keyword|kw/i.test(text)) {
    return text.split(/[|/·,;]/).map((item) => item.trim()).filter(Boolean).length;
  }
  return 0;
}

function dexorRankScore(rank) {
  if (!rank) return 0;
  if (rank <= 3) return 100;
  if (rank <= 5) return 90;
  if (rank <= 10) return 78;
  if (rank <= 20) return 58;
  if (rank <= 30) return 38;
  return 15;
}

function dexorRecencyScoreFromDays(daysSinceRecent) {
  if (daysSinceRecent === null || daysSinceRecent === undefined) return 45;
  if (daysSinceRecent <= 30) return 100;
  if (daysSinceRecent <= 90) return 70;
  if (daysSinceRecent <= 180) return 42;
  return 18;
}

function dexorContentQualitySignal(candidate = {}) {
  const text = [
    candidate.blogName,
    candidate.candidateCategory,
    candidate.qualityMemo,
    candidate.adMemo
  ].filter(Boolean).join(' ');
  let score = 50;
  if (/실사용|실방문|후기|리뷰|사진|동영상|영수증|상세|정보성|체험/i.test(text)) score += 12;
  if (/전문|비교|가격|사이즈|착용|장단점|팁|과정/i.test(text)) score += 8;
  if (/광고|협찬|스폰서|상업|체험단/i.test(text)) score -= 12;
  if (/복붙|누락|저품질|반복|도배|AI|자동/i.test(text)) score -= 18;
  if (candidate.reactionEstimate && Number(candidate.reactionEstimate) >= 30) score += 6;
  if (candidate.visitEstimate && Number(candidate.visitEstimate) >= 3000) score += 6;
  return Math.max(10, Math.min(100, score));
}

function dexorExposureSignal({ candidate = {}, targetCategory = '기타', candidateCategory = '미입력', daysSinceRecent = null } = {}) {
  const rank = parseDexorExposureRank(candidate.searchRank || candidate.exposureRank);
  const keywordCount = Number(candidate.exposureKeywordCount || 0);
  const hasRank = Boolean(rank);
  const rankScore = hasRank ? dexorRankScore(rank) : 0;
  const diversityScore = Math.min(100, Math.round((keywordCount / 3) * 100));
  const recencyScore = dexorRecencyScoreFromDays(daysSinceRecent);
  const categoryScore = targetCategory === '기타' || candidateCategory === '미입력'
    ? 55
    : candidateCategory === targetCategory ? 100 : 35;
  const score = hasRank
    ? Math.round(rankScore * 0.55 + diversityScore * 0.15 + recencyScore * 0.2 + categoryScore * 0.1)
    : 0;
  const status = !hasRank ? 'no-data' : score >= 82 ? 'strong' : score >= 64 ? 'proven' : score >= 45 ? 'weak' : 'low';
  const bonus = status === 'strong' ? 10 : status === 'proven' ? 6 : status === 'weak' ? 1 : status === 'low' ? -5 : -3;
  return {
    status,
    score,
    rank,
    keywordCount,
    bonus,
    label: hasRank ? `${rank}위권` : '확인 전'
  };
}

function dexorDataConfidence({ candidate = {}, daysSinceRecent = null, hasParsedMetrics = false, exposureSignal = null, contentQualityScore = 50 } = {}) {
  const hasSearchProof = exposureSignal && ['strong', 'proven'].includes(exposureSignal.status);
  if (candidate.recentPostAt && hasParsedMetrics) {
    return {
      level: '높음',
      score: 84,
      sourceLabel: '업로드 지표 기반',
      reason: '최근글일, 조회/방문, 반응 지표가 함께 입력되어 계산 근거가 비교적 안정적입니다.'
    };
  }
  if (hasSearchProof && contentQualityScore >= 55) {
    return {
      level: exposureSignal.status === 'strong' && contentQualityScore >= 65 ? '높음' : '보통',
      score: exposureSignal.status === 'strong' ? 76 : 66,
      sourceLabel: '검색 결과 기반',
      reason: '최근글일이 직접 입력되지 않아도 실제 검색 노출과 콘텐츠 신호가 확인되어 기본 신뢰도를 보정했습니다.'
    };
  }
  if (candidate.recentPostAt || hasParsedMetrics) {
    return {
      level: '보통',
      score: 62,
      sourceLabel: '일부 지표 기반',
      reason: '일부 지표만 입력되어 URL 패턴 추정값을 함께 사용했습니다.'
    };
  }
  return {
    level: '낮음',
    score: 38,
    sourceLabel: 'URL 기반 추정',
    reason: 'URL 외 검증 지표가 없어 후보 선별용 추정값 비중이 큽니다.'
  };
}

function strengthenDexorResult({ score, scoreLabel, candidate, daysSinceRecent, targetCategory, candidateCategory, exposureSignal, contentQualityScore = 50, riskFlags = [] }) {
  const hasParsedMetrics = Boolean(candidate.recentPostAt || candidate.visitEstimate || candidate.reactionEstimate);
  const dataConfidence = dexorDataConfidence({ candidate, daysSinceRecent, hasParsedMetrics, exposureSignal, contentQualityScore });
  const legacyIndex = normalizeLegacyDexorIndex(candidate.legacyIndex);
  const verificationFlags = [];
  let scorePenalty = 0;
  let gradeCap = null;

  if (scoreLabel === 'S' && dataConfidence.level !== '높음') {
    gradeCap = 'A';
  }
  if (dataConfidence.level === '낮음') {
    verificationFlags.push('데이터 신뢰도 낮음');
    const hasUsefulExposure = exposureSignal && ['strong', 'proven'].includes(exposureSignal.status);
    scorePenalty += hasUsefulExposure ? 6 : 14;
    gradeCap = dexorMinGrade(gradeCap, hasUsefulExposure ? 'A' : 'B');
  } else if (dataConfidence.level === '보통') {
    verificationFlags.push('추정 데이터 포함');
    scorePenalty += 6;
  }
  if (!exposureSignal || exposureSignal.status === 'no-data') {
    verificationFlags.push('최근 상위노출 검증 미완료');
    if (scoreLabel === 'S') gradeCap = dexorMinGrade(gradeCap, 'A');
  } else if (exposureSignal.status === 'low') {
    verificationFlags.push('상위노출 약함');
    scorePenalty += 5;
    gradeCap = dexorMinGrade(gradeCap, 'B');
  } else if (exposureSignal.status === 'weak') {
    verificationFlags.push('상위노출 보통');
    if (scoreLabel === 'S') gradeCap = dexorMinGrade(gradeCap, 'A');
  }
  if (legacyIndex === '초급' && ['S', 'A'].includes(scoreLabel)) {
    verificationFlags.push('기존 지수 초급 대비 DEXOR 고득점');
    scorePenalty += 10;
    gradeCap = dexorMinGrade(gradeCap, 'B');
  } else if (legacyIndex === '중급' && scoreLabel === 'S') {
    verificationFlags.push('기존 지수 중급 대비 DEXOR S등급');
    scorePenalty += 5;
    gradeCap = dexorMinGrade(gradeCap, 'A');
  }
  if (candidate.adMemo) {
    verificationFlags.push('광고/협찬 메모 확인');
  }
  if (daysSinceRecent !== null && daysSinceRecent > 60) {
    verificationFlags.push('최근 활동 확인 필요');
    scorePenalty += 6;
  }
  if (targetCategory !== '기타' && candidateCategory !== '미입력' && candidateCategory !== targetCategory) {
    verificationFlags.push('캠페인 카테고리 불일치');
    scorePenalty += 5;
  }
  if (contentQualityScore < 40) {
    verificationFlags.push('콘텐츠 품질 위험');
    scorePenalty += 8;
    gradeCap = dexorMinGrade(gradeCap, 'B');
  } else if (contentQualityScore < 55) {
    scorePenalty += 3;
  }
  riskFlags.forEach((flag) => verificationFlags.push(flag));

  const strengthenedScore = Math.max(20, Math.min(98, Math.round(score - scorePenalty)));
  const scoreGrade = dexorScoreLabel(strengthenedScore);
  const strengthenedGrade = dexorMinGrade(scoreGrade, gradeCap || scoreLabel);
  return {
    originalScore: score,
    originalGrade: scoreLabel,
    strengthenedScore,
    strengthenedGrade,
    strengthenedDecision: dexorScoreComment(strengthenedScore),
    dataConfidence,
    legacyIndex,
    verificationFlags: [...new Set(verificationFlags)],
    searchValidation: {
      status: exposureSignal?.status || 'no-data',
      score: exposureSignal?.score || 0,
      rank: exposureSignal?.rank || null,
      keywordCount: exposureSignal?.keywordCount || 0,
      label: exposureSignal?.label || '확인 전'
    },
    gradeStatus: strengthenedGrade === scoreLabel ? '유지' : `${scoreLabel} → ${strengthenedGrade}`
  };
}

function infludexGradeFromScore(score) {
  if (score >= 85) return 'S';
  if (score >= 72) return 'A';
  if (score >= 58) return 'B';
  if (score >= 42) return 'C';
  return 'D';
}

function infludexDecisionFromScore(score) {
  if (score >= 85) return '우선 추천';
  if (score >= 72) return '추천';
  if (score >= 58) return '검토';
  if (score >= 42) return '추가 확인';
  return '비추천';
}

function infludexGradeRank(grade = '') {
  return { S: 5, A: 4, B: 3, C: 2, D: 1 }[grade] || 0;
}

function infludexMinGrade(...grades) {
  return grades.filter(Boolean).sort((a, b) => infludexGradeRank(a) - infludexGradeRank(b))[0] || 'D';
}

function scoreRange(value, ranges = []) {
  for (const [threshold, score] of ranges) {
    if (value >= threshold) return score;
  }
  return 0;
}

function normalizeInfludexText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function htmlEntityDecode(value = '') {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractHtmlMetaContent(html = '', patterns = []) {
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return htmlEntityDecode(match[1]);
  }
  return '';
}

function inferInfludexCategoryFromProfile(profile = {}) {
  const text = normalizeInfludexText([profile.displayName, profile.bio, profile.description].filter(Boolean).join(' '));
  if (!text) return '';
  const categories = [
    ['맛집', /맛집|먹방|푸드|음식|요리|카페|디저트|mukbang|food|cafe/],
    ['뷰티', /뷰티|화장품|스킨케어|메이크업|코스메틱|beauty|makeup|cosmetic/],
    ['육아', /육아|맘|엄마|아기|아이|키즈|베이비|mom|baby|kids/],
    ['패션', /패션|옷|코디|룩북|fashion|style|ootd/],
    ['여행', /여행|호텔|숙소|캠핑|travel|trip|hotel/],
    ['생활/리빙', /리빙|살림|집밥|인테리어|생활|홈|living|home/],
    ['반려동물', /강아지|고양이|반려|댕댕|냥|pet|dog|cat/],
    ['건강', /운동|헬스|필라테스|요가|다이어트|건강|fitness|health|pilates|yoga/],
    ['마케팅/브랜딩', /마케팅|브랜딩|브랜드|콘텐츠|marketing|branding|creator/],
    ['부업/수익화', /부업|수익|n잡|재테크|머니|money|sidejob/]
  ];
  return categories.find(([, pattern]) => pattern.test(text))?.[0] || '';
}

function instagramHandleFromCandidate(candidate = {}) {
  const fromHandle = String(candidate.handle || '').replace(/^@/, '').trim();
  if (fromHandle) return fromHandle;
  return String(candidate.url || '').match(/instagram\.com\/([^/?#]+)/i)?.[1] || '';
}

function parseInstagramCount(value = '') {
  const text = String(value || '').replace(/,/g, '').trim();
  const followerMatch = text.match(/([\d.]+)\s*([kKmM]|만|천|억)?\s*(?:Followers?|팔로워)/i)
    || text.match(/(?:Followers?|팔로워)\s*([\d.]+)\s*([kKmM]|만|천|억)?/i);
  if (!followerMatch) return null;
  return parseNumberLike(`${followerMatch[1]}${followerMatch[2] || ''}`);
}

function instagramEnrichmentEnabled() {
  if (process.env.INFLUDEX_PROFILE_ENRICHMENT === 'false') return false;
  if (process.env.NODE_ENV === 'test' && process.env.INFLUDEX_PROFILE_ENRICHMENT !== 'true') return false;
  return typeof fetch === 'function';
}

function infludexApifyToken() {
  return String(process.env.APIFY_API_TOKEN || process.env.INFLUDEX_APIFY_API_TOKEN || '').trim();
}

function firstValue(source = {}, keys = []) {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function apifyPostTimestamp(post = {}) {
  const value = firstValue(post, ['timestamp', 'takenAt', 'takenAtTimestamp', 'date', 'createdAt']);
  if (!value) return '';
  if (typeof value === 'number') return new Date(value * (value < 10_000_000_000 ? 1000 : 1)).toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function apifyPostViewCount(post = {}) {
  const value = parseNumberLike(firstValue(post, ['videoViewCount', 'videoPlayCount', 'viewsCount', 'viewCount', 'views', 'playCount', 'plays']));
  return Number.isFinite(value) ? value : null;
}

function apifyPostIsReel(post = {}) {
  const productType = String(firstValue(post, ['productType', 'product_type', 'mediaProductType']) || '').toLowerCase();
  const mediaType = String(firstValue(post, ['type', 'mediaType', '__typename']) || '').toLowerCase();
  const url = String(firstValue(post, ['url', 'shortCodeUrl', 'displayUrl']) || '').toLowerCase();
  const caption = String(firstValue(post, ['caption', 'text']) || '').toLowerCase();
  if (/reels?|clips?/.test(productType) || /reels?|clips?/.test(mediaType) || /\/reel\//.test(url)) return true;
  return /reels?|릴스/.test(caption) && apifyPostViewCount(post) !== null;
}

function normalizeApifyInstagramProfile(item = {}) {
  const nested = item.profile && typeof item.profile === 'object' ? item.profile : {};
  const source = { ...nested, ...item };
  const username = String(firstValue(source, ['username', 'userName', 'handle', 'id']) || '').replace(/^@/, '');
  const displayName = String(firstValue(source, ['fullName', 'full_name', 'name', 'displayName']) || '').trim();
  const bio = String(firstValue(source, ['biography', 'bio', 'description']) || '').trim();
  const followerCount = parseNumberLike(firstValue(source, ['followersCount', 'followers', 'followerCount', 'followedByCount']));
  const postsCount = parseNumberLike(firstValue(source, ['postsCount', 'posts', 'mediaCount']));
  const latestPosts = [
    ...(Array.isArray(source.latestPosts) ? source.latestPosts : []),
    ...(Array.isArray(source.posts) ? source.posts : []),
    ...(Array.isArray(source.latestIgtvVideos) ? source.latestIgtvVideos : [])
  ].filter((post) => post && typeof post === 'object').slice(0, 24);
  const recentReels = latestPosts.filter(apifyPostIsReel).slice(0, 5);
  const metricPosts = recentReels.length ? recentReels : latestPosts.filter((post) => apifyPostViewCount(post) !== null).slice(0, 5);
  const sumMetric = (keys = []) => metricPosts.reduce((sum, post) => {
    const value = parseNumberLike(firstValue(post, keys));
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
  const avgLikes = metricPosts.length ? Math.round(sumMetric(['likesCount', 'likes', 'likes_count']) / metricPosts.length) : null;
  const avgComments = metricPosts.length ? Math.round(sumMetric(['commentsCount', 'comments', 'comments_count']) / metricPosts.length) : null;
  const avgReelsViews = metricPosts.length ? Math.round(metricPosts.reduce((sum, post) => sum + (apifyPostViewCount(post) || 0), 0) / metricPosts.length) : null;
  const latestTimestamp = (metricPosts.length ? metricPosts : latestPosts).map(apifyPostTimestamp).filter(Boolean).find(Boolean) || '';
  const profile = {
    handle: username,
    displayName,
    bio,
    description: bio || displayName,
    followerCount,
    postsCount,
    avgLikes,
    avgComments,
    avgReelsViews: avgReelsViews && avgReelsViews > 0 ? avgReelsViews : null,
    recentReelsCount: recentReels.length,
    recentReelsMetricSource: recentReels.length ? 'recent_reels' : metricPosts.length ? 'recent_video_posts' : '',
    recentPostAt: latestTimestamp,
    category: inferInfludexCategoryFromProfile({ displayName, bio, description: bio }),
    enrichmentStatus: 'apify_profile'
  };
  return Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== null && value !== ''));
}

async function fetchInfludexProfilesFromApify(candidates = []) {
  const token = infludexApifyToken();
  if (!token || !instagramEnrichmentEnabled()) return new Map();
  const handles = candidates.map(instagramHandleFromCandidate).filter(Boolean);
  if (!handles.length) return new Map();
  const actorId = encodeURIComponent(process.env.INFLUDEX_APIFY_ACTOR || 'apify/instagram-profile-scraper').replace('%2F', '~');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(10_000, Number(process.env.INFLUDEX_APIFY_TIMEOUT_MS || 120_000)));
  try {
    const response = await fetch(`https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&clean=true`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usernames: [...new Set(handles)] })
    });
    if (!response.ok) return new Map(handles.map((handle) => [handle, { enrichmentStatus: `apify_http_${response.status}` }]));
    const items = await response.json();
    const profiles = new Map();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const profile = normalizeApifyInstagramProfile(item);
      if (profile.handle) profiles.set(profile.handle, profile);
    });
    return profiles;
  } catch (error) {
    return new Map(handles.map((handle) => [handle, { enrichmentStatus: error?.name === 'AbortError' ? 'apify_timeout' : 'apify_failed' }]));
  } finally {
    clearTimeout(timeout);
  }
}

function shouldEnrichInfludexCandidate(candidate = {}) {
  const handle = instagramHandleFromCandidate(candidate);
  if (!handle) return false;
  const hasFollowers = Number(candidate.followerCount || 0) > 0;
  const hasProfileText = Boolean(candidate.category || candidate.displayName || candidate.bio || candidate.description);
  return !hasFollowers || !hasProfileText;
}

async function fetchInfludexInstagramProfile(candidate = {}) {
  if (!instagramEnrichmentEnabled() || !shouldEnrichInfludexCandidate(candidate)) return {};
  const handle = instagramHandleFromCandidate(candidate);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  try {
    const response = await fetch(`https://www.instagram.com/${encodeURIComponent(handle)}/`, {
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
      }
    });
    if (!response.ok) return { enrichmentStatus: `http_${response.status}` };
    const html = await response.text();
    const description = extractHtmlMetaContent(html, [
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i
    ]);
    const title = extractHtmlMetaContent(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([^<]+)<\/title>/i
    ]);
    const biography = htmlEntityDecode(html.match(/"biography"\s*:\s*"([^"]*)"/)?.[1] || '').replace(/\\n/g, '\n');
    const displayName = title.replace(/\s*\(@[^)]*\).*$/i, '').replace(/\s*•\s*Instagram.*$/i, '').trim();
    const followerCount = parseInstagramCount(description);
    const hasMeaningfulProfile = Boolean(description || biography || followerCount || (displayName && displayName !== 'Instagram'));
    if (!hasMeaningfulProfile) return { enrichmentStatus: 'no_public_profile_meta' };
    const profile = {
      displayName: displayName === 'Instagram' ? '' : displayName,
      bio: biography,
      description,
      followerCount,
      category: inferInfludexCategoryFromProfile({ displayName, bio: biography, description }),
      enrichmentStatus: 'public_profile'
    };
    return Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== null && value !== ''));
  } catch (error) {
    return { enrichmentStatus: error?.name === 'AbortError' ? 'timeout' : 'failed' };
  } finally {
    clearTimeout(timeout);
  }
}

async function enrichInfludexCandidates(candidates = []) {
  const enriched = [];
  const apifyProfiles = await fetchInfludexProfilesFromApify(candidates.filter(shouldEnrichInfludexCandidate));
  const concurrency = 4;
  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const profiles = await Promise.all(batch.map((candidate) => {
      const handle = instagramHandleFromCandidate(candidate);
      const apifyProfile = apifyProfiles.get(handle);
      if (apifyProfile && apifyProfile.enrichmentStatus === 'apify_profile') return apifyProfile;
      return fetchInfludexInstagramProfile(candidate).then((profile) => (
        profile.enrichmentStatus ? profile : (apifyProfile || profile)
      ));
    }));
    profiles.forEach((profile, batchIndex) => {
      const candidate = batch[batchIndex] || {};
      enriched.push({
        ...candidate,
        handle: candidate.handle || profile.handle || '',
        displayName: candidate.displayName || profile.displayName || '',
        description: candidate.description || profile.description || profile.displayName || '',
        bio: candidate.bio || profile.bio || '',
        category: candidate.category || profile.category || '',
        followerCount: candidate.followerCount ?? profile.followerCount ?? null,
        avgLikes: candidate.avgLikes ?? profile.avgLikes ?? null,
        avgComments: candidate.avgComments ?? profile.avgComments ?? null,
        avgReelsViews: candidate.avgReelsViews ?? profile.avgReelsViews ?? null,
        recentReelsCount: candidate.recentReelsCount ?? profile.recentReelsCount ?? null,
        recentReelsMetricSource: candidate.recentReelsMetricSource || profile.recentReelsMetricSource || '',
        recentPostAt: candidate.recentPostAt || profile.recentPostAt || '',
        postsCount: candidate.postsCount ?? profile.postsCount ?? null,
        enrichmentStatus: profile.enrichmentStatus || candidate.enrichmentStatus || ''
      });
    });
  }
  return enriched;
}

function infludexCategorySignal(candidate = {}) {
  const target = normalizeInfludexText(candidate.targetCategory || candidate.campaignCategory || '');
  const category = normalizeInfludexText(candidate.category || '');
  const text = normalizeInfludexText([
    candidate.category,
    candidate.displayName,
    candidate.description,
    candidate.bio,
    candidate.contactMemo
  ].filter(Boolean).join(' '));
  if (!target) return { status: category ? 'category-present' : 'missing', score: category ? 20 : 0, label: candidate.category || '' };
  if (!category && !text) return { status: 'missing', score: 0, penalty: 8, gradeCap: 'B', label: '카테고리 확인 필요' };
  if ((category && (target.includes(category) || category.includes(target))) || text.includes(target)) {
    return { status: 'match', score: 24, label: candidate.targetCategory || candidate.campaignCategory };
  }
  return { status: 'mismatch', score: 4, penalty: 14, gradeCap: 'B', label: '캠페인 카테고리 불일치' };
}

function infludexDataConfidence(candidate = {}, metrics = {}) {
  let confidence = 0;
  if (candidate.url || candidate.handle) confidence += 15;
  if (candidate.category) confidence += 15;
  if (metrics.followers > 0) confidence += 16;
  if (metrics.likes > 0) confidence += 13;
  if (metrics.comments > 0) confidence += 13;
  if (metrics.reelsViews > 0) confidence += 12;
  if (candidate.recentPostAt) confidence += 12;
  if (candidate.displayName || candidate.description || candidate.bio) confidence += 6;
  if (candidate.targetCategory || candidate.campaignCategory) confidence += 6;
  return Math.max(0, Math.min(100, confidence));
}

function infludexQualitySignal({ followers = 0, likes = 0, comments = 0, reelsViews = 0, engagementRate = 0, reelsViewRate = 0, commentShare = 0, daysSinceRecent = null, adMemo = '' } = {}) {
  const riskFlags = [];
  let penalty = 0;
  let gradeCap = '';

  if (followers >= 30000 && engagementRate < 0.5) {
    riskFlags.push('follower_reaction_mismatch');
    penalty += 12;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  } else if (followers >= 10000 && engagementRate < 0.8) {
    riskFlags.push('low_engagement_for_size');
    penalty += 7;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  }

  if (engagementRate >= 20) {
    riskFlags.push('suspicious_high_engagement');
    penalty += 14;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  } else if (engagementRate >= 12) {
    riskFlags.push('high_engagement_review');
    penalty += 5;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'A');
  }

  if (likes >= 100 && comments === 0) {
    riskFlags.push('comments_missing_for_likes');
    penalty += 8;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  } else if (likes >= 300 && commentShare < 0.5) {
    riskFlags.push('low_comment_depth');
    penalty += 5;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'A');
  }

  if (reelsViews > 0 && likes > reelsViews) {
    riskFlags.push('invalid_reels_views');
    penalty += 10;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  } else if (followers >= 10000 && reelsViewRate < 3) {
    riskFlags.push('low_reels_views_for_size');
    penalty += 10;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  } else if (followers >= 10000 && reelsViewRate < 8) {
    riskFlags.push('weak_reels_view_rate');
    penalty += 6;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  }

  if (daysSinceRecent === null) {
    riskFlags.push('recent_post_missing');
    penalty += 6;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  } else if (daysSinceRecent > 90) {
    riskFlags.push('inactive_over_90d');
    penalty += 14;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  } else if (daysSinceRecent > 60) {
    riskFlags.push('inactive_over_60d');
    penalty += 8;
    gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  }

  if (adMemo) {
    const memo = String(adMemo || '');
    const heavyAd = /광고\s*많|협찬\s*많|공구|판매|상업|ad\s*많|광고과다/i.test(memo);
    riskFlags.push(heavyAd ? 'heavy_ad_risk' : 'ad_memo_present');
    penalty += heavyAd ? 16 : 8;
    gradeCap = infludexMinGrade(gradeCap || 'S', heavyAd ? 'B' : 'A');
  }

  return { riskFlags, penalty, gradeCap };
}

function analyzeInfludexCandidate(candidate = {}) {
  const followers = Math.max(0, Number(candidate.followerCount || 0));
  const likes = Math.max(0, Number(candidate.avgLikes || 0));
  const comments = Math.max(0, Number(candidate.avgComments || 0));
  const reelsViews = Math.max(0, Number(candidate.avgReelsViews || candidate.reelsViews || 0));
  const hasScoringData = followers > 0 && (reelsViews > 0 || likes > 0 || comments > 0);
  const engagementRate = followers > 0 ? ((likes + comments) / followers) * 100 : 0;
  const reelsViewRate = followers > 0 ? (reelsViews / followers) * 100 : 0;
  const commentShare = likes + comments > 0 ? (comments / (likes + comments)) * 100 : 0;
  const recentTime = candidate.recentPostAt ? new Date(String(candidate.recentPostAt).replace(/[./]/g, '-')).getTime() : 0;
  const daysSinceRecent = recentTime ? Math.floor((Date.now() - recentTime) / (24 * 60 * 60 * 1000)) : null;
  const hasAdRisk = Boolean(candidate.adMemo);
  const dataConfidence = infludexDataConfidence(candidate, { followers, likes, comments, reelsViews });
  const riskFlags = [
    !candidate.category ? 'category_missing' : '',
    !followers ? 'followers_missing' : '',
    !reelsViews ? 'reels_views_missing' : '',
    engagementRate <= 0 ? 'engagement_missing' : '',
    hasAdRisk ? 'ad_memo_present' : ''
  ].filter(Boolean);

  if (!hasScoringData) {
    return {
      followers,
      likes,
      comments,
      reelsViews,
      engagementRate: 0,
      reelsViewRate: 0,
      commentShare: 0,
      daysSinceRecent,
      score: null,
      grade: null,
      analysisStatus: 'data_missing',
      scoreBreakdown: {},
      gradeReason: [
        candidate.category ? `추정 카테고리 ${candidate.category}` : '카테고리 보강 필요',
        !followers ? '팔로워 수 필요' : `팔로워 ${followers.toLocaleString('ko-KR')}`,
        !reelsViews ? '최근 5개 릴스 평균 조회수 필요' : `최근 5개 릴스 평균 조회수 ${reelsViews.toLocaleString('ko-KR')}`,
        likes + comments <= 0 ? '좋아요/댓글 평균 필요' : '반응 지표 확인됨',
        daysSinceRecent === null ? '최근 게시일 필요' : daysSinceRecent <= 30 ? '최근 활동 양호' : '최근 활동 확인 필요'
      ],
      dataConfidence,
      decision: '추가 확인',
      riskFlags
    };
  }

  const categorySignal = infludexCategorySignal(candidate);
  const categoryFitScore = categorySignal.score;
  const engagementScore = scoreRange(engagementRate, [[6, 30], [3.5, 25], [2, 20], [1, 13], [0.5, 7]]);
  const reelsViewScore = scoreRange(reelsViewRate, [[80, 6], [50, 5], [25, 4], [10, 2], [3, 1]]);
  const commentScore = scoreRange(commentShare, [[8, 15], [5, 12], [2, 8], [0.5, 4]]);
  const followerScore = scoreRange(followers, [[100000, 15], [30000, 13], [10000, 10], [3000, 7], [1000, 4]]);
  const freshnessScore = daysSinceRecent === null ? 0 : daysSinceRecent <= 10 ? 10 : daysSinceRecent <= 30 ? 7 : daysSinceRecent <= 60 ? 3 : 0;
  const adPenalty = hasAdRisk ? 10 : 0;
  const reelsMissingPenalty = reelsViews ? 0 : 8;
  const qualitySignal = infludexQualitySignal({ followers, likes, comments, reelsViews, engagementRate, reelsViewRate, commentShare, daysSinceRecent, adMemo: candidate.adMemo });
  let gradeCap = qualitySignal.gradeCap || '';
  if (categorySignal.gradeCap) gradeCap = infludexMinGrade(gradeCap || 'S', categorySignal.gradeCap);
  if (!reelsViews) gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  if (dataConfidence < 55) gradeCap = infludexMinGrade(gradeCap || 'S', 'C');
  else if (dataConfidence < 75) gradeCap = infludexMinGrade(gradeCap || 'S', 'B');
  else if (dataConfidence < 88) gradeCap = infludexMinGrade(gradeCap || 'S', 'A');

  const rawScore = Math.max(0, Math.min(100, Math.round(categoryFitScore + engagementScore + reelsViewScore + commentScore + followerScore + freshnessScore - adPenalty - reelsMissingPenalty)));
  const scorePenalty = (categorySignal.penalty || 0) + qualitySignal.penalty + (dataConfidence < 75 ? 6 : 0);
  const score = Math.max(0, Math.min(98, Math.round(rawScore - scorePenalty)));
  const scoreGrade = infludexGradeFromScore(score);
  const grade = infludexMinGrade(scoreGrade, gradeCap || scoreGrade);
  const gradeReason = [
    categorySignal.status === 'match' ? `카테고리 적합` : categoryFitScore ? `카테고리 ${candidate.category}` : '카테고리 미입력',
    followers ? `팔로워 ${followers.toLocaleString('ko-KR')}` : '팔로워 미입력',
    reelsViews ? `최근 5개 릴스 평균 조회수 ${reelsViews.toLocaleString('ko-KR')}` : '최근 5개 릴스 평균 조회수 미입력',
    engagementRate ? `반응률 ${engagementRate.toFixed(2)}%` : '반응 지표 미입력',
    commentShare ? `댓글 비중 ${commentShare.toFixed(1)}%` : '댓글 지표 미입력',
    daysSinceRecent === null ? '최근 게시일 미입력' : daysSinceRecent <= 30 ? '최근 활동 양호' : '최근 활동 확인 필요',
    hasAdRisk ? '광고/협찬 메모 감점' : '광고성 메모 없음'
  ];

  return {
    followers,
    likes,
    comments,
    reelsViews,
    engagementRate: Number(engagementRate.toFixed(2)),
    reelsViewRate: Number(reelsViewRate.toFixed(1)),
    commentShare: Number(commentShare.toFixed(1)),
    daysSinceRecent,
    score,
    grade,
    originalScore: rawScore,
    originalGrade: infludexGradeFromScore(rawScore),
    finalScore: score,
    finalGrade: grade,
    decision: infludexDecisionFromScore(score),
    dataConfidence,
    analysisStatus: 'scored',
    scoreBreakdown: {
      categoryFitScore,
      engagementScore,
      reelsViewScore,
      commentScore,
      followerScore,
      freshnessScore,
      adPenalty,
      reelsMissingPenalty,
      qualityPenalty: qualitySignal.penalty,
      confidencePenalty: dataConfidence < 75 ? 6 : 0,
      categoryPenalty: categorySignal.penalty || 0
    },
    gradeReason,
    riskFlags: [...new Set([...riskFlags, !reelsViews ? 'reels_views_missing' : '', ...qualitySignal.riskFlags, categorySignal.status === 'mismatch' ? 'category_mismatch' : ''].filter(Boolean))],
    categorySignal,
    gradeStatus: grade === infludexGradeFromScore(rawScore) ? '유지' : `${infludexGradeFromScore(rawScore)} → ${grade}`
  };
}

function parseUrls(input = '') {
  return String(input)
    .split(/[\s,\n\r]+/)
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url, index, all) => all.indexOf(url) === index)
    .slice(0, 500);
}

function splitCandidateLine(line = '') {
  const cells = [];
  let current = '';
  let quoted = false;
  for (const char of String(line)) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if ((char === ',' || char === '\t') && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseNumberLike(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const compact = raw.replace(/,/g, '').replace(/\s+/g, '').toLowerCase();
  const multiplier = /억/.test(compact) ? 100000000
    : /만/.test(compact) ? 10000
      : /천/.test(compact) ? 1000
        : /[\d.]m/.test(compact) ? 1000000
          : /[\d.]k/.test(compact) ? 1000
            : 1;
  const number = Number(compact.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? number * multiplier : null;
}

function normalizeDexorCategory(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/자동|auto/i.test(text)) return '기타';
  return DEXOR_CATEGORIES.find((category) => text.includes(category) || category.includes(text)) || text;
}

function deriveBlogNameFromUrl(url = '') {
  try {
    const parsed = new URL(String(url || '').trim());
    if (/blog\.naver\.com$/i.test(parsed.hostname)) {
      const blogId = parsed.pathname.split('/').filter(Boolean)[0] || '';
      return blogId ? `네이버:${blogId}` : '';
    }
    const hostname = parsed.hostname.replace(/^www\./i, '');
    const firstPath = parsed.pathname.split('/').filter(Boolean)[0] || '';
    return firstPath ? `${hostname}/${firstPath}` : hostname;
  } catch {
    return '';
  }
}

function parseCandidateRows(input = '', fileName = '') {
  const rows = String(input || '')
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];
  rows.forEach((line, index) => {
    const cells = splitCandidateLine(line);
    const joined = cells.join(' ');
    if (index === 0 && /url|주소|블로그|blog/i.test(joined) && !/^https?:\/\//i.test(cells[0] || '')) return;
    const url = cells.find((cell) => /^https?:\/\//i.test(cell)) || '';
    if (!url) return;
    const metaCells = cells.filter((cell) => cell !== url);
    const recentPostAt = metaCells.map(parseDexorRecentDate).find(Boolean) || '';
    const rankCell = metaCells.find((cell) => /(상위|순위|노출|rank|top|\d{1,3}\s*위)/i.test(cell)) || '';
    const keywordCell = metaCells.find((cell) => /키워드|keyword|kw/i.test(cell)) || '';
    const metricCells = metaCells.filter((cell) => cell !== rankCell && cell !== keywordCell);
    const numbers = metricCells.map(parseNumberLike).filter((value) => value !== null);
    const categoryCell = metaCells.find((cell) => DEXOR_CATEGORIES.some((category) => String(cell || '').includes(category))) || '';
    const blogName = metaCells.find((cell) => cell && cell !== recentPostAt && cell !== categoryCell && cell !== rankCell && cell !== keywordCell && parseNumberLike(cell) === null && !/광고|협찬|체험단|스폰서/i.test(cell)) || deriveBlogNameFromUrl(url);
    const adMemo = metaCells.find((cell) => /광고|협찬|체험단|스폰서|상업/i.test(cell)) || '';
    const legacyIndex = metaCells.find((cell) => /초급|중급|고급|최적|준최\s*\d|low|mid|high|beginner|advanced/i.test(cell)) || '';
    const qualityMemo = metaCells.find((cell) => /실사용|실방문|후기|리뷰|사진|동영상|영수증|상세|정보성|복붙|누락|저품질|반복|도배|AI|자동/i.test(cell)) || '';
    candidates.push({
      id: `dexor-${hashText(`${url}-${index}`)}`,
      url,
      source: fileName ? 'file-or-manual' : 'manual',
      blogName,
      candidateCategory: normalizeDexorCategory(categoryCell),
      legacyIndex: normalizeLegacyDexorIndex(legacyIndex),
      recentPostAt,
      visitEstimate: numbers[0] ?? null,
      reactionEstimate: numbers[1] ?? null,
      searchRank: rankCell ? parseDexorExposureRank(rankCell) : null,
      exposureKeywordCount: keywordCell ? parseDexorKeywordCount(keywordCell) : 0,
      qualityMemo,
      adMemo,
      createdAt: now()
    });
  });
  return candidates.filter((item, index, all) => all.findIndex((row) => row.url === item.url) === index).slice(0, 500);
}

function normalizeUsage(settings = {}, productId) {
  if (settings.unlimitedUsage === true) {
    return {
      limit: UNLIMITED_USAGE_LIMIT,
      used: 0,
      remaining: UNLIMITED_USAGE_LIMIT,
      unlimited: true
    };
  }
  const usageRoot = settings.usage && typeof settings.usage === 'object' ? settings.usage : {};
  const raw = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
  const limit = Number.isFinite(Number(raw.limit)) ? Math.max(0, Number(raw.limit)) : DEFAULT_USAGE_LIMIT;
  const used = Number.isFinite(Number(raw.used)) ? Math.max(0, Number(raw.used)) : 0;
  return {
    limit,
    used,
    remaining: Math.max(0, limit - used)
  };
}

function grantHasUnlimitedUsage(grant = {}, user = null) {
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const email = String(user?.email || '').trim().toLowerCase();
  return settings.unlimitedUsage === true
    || grant.unlimitedUsage === true
    || UNLIMITED_TEST_EMAILS.has(email);
}

function withUsage(workspace = {}, settings = {}, productId) {
  return {
    ...workspace,
    usage: normalizeUsage(settings, productId)
  };
}

function productUsageFromGrant(grant = {}, productId = '') {
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  return normalizeUsage({ ...settings, unlimitedUsage: grantHasUnlimitedUsage(grant) }, productId);
}

function workspaceFromGrant(grant = {}) {
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  return settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
}

function actionForLockedProduct(product = {}) {
  return {
    health: product.status === 'preparing' || productServiceClosedInProduction(product.id) ? 'maintenance' : 'locked',
    summary: product.status === 'preparing' || productServiceClosedInProduction(product.id)
      ? '서비스 안정화 후 열릴 예정이에요.'
      : '시작하면 이 제품의 작업 메뉴가 열려요.',
    nextAction: product.status === 'preparing' || productServiceClosedInProduction(product.id) ? '준비중' : `${product.name} 시작하기`,
    actionKey: product.id
  };
}

function summarizeCujasaProduct({ product, grant, accounts = [], queue = [] } = {}) {
  const activeAccounts = accounts.filter((account) => account?.status !== 'archived');
  const selectedAccount = activeAccounts[0] || null;
  const scheduled = queue.filter((row) => row.status === 'scheduled').length;
  const posted = queue.filter((row) => row.status === 'posted').length;
  const needsReview = queue.filter((row) => ['failed', 'retry', 'manual_required', 'skipped'].includes(row.status)).length;
  const hasThreads = Boolean(selectedAccount?.has_threads_access_token)
    && (!selectedAccount?.threads_token_status || selectedAccount.threads_token_status === 'connected');
  const hasCoupang = Boolean(selectedAccount?.coupang_access_key && selectedAccount?.coupang_secret_key && selectedAccount?.coupang_partner_id);
  let health = 'ready';
  let summary = `${scheduled}개 예약 · ${posted}개 완료`;
  let nextAction = '포스팅 현황 보기';
  let actionKey = 'posts';

  if (activeAccounts.length === 0) {
    health = 'needs_setup';
    summary = 'Threads 계정을 먼저 연결해야 자동화가 시작돼요.';
    nextAction = 'CUJASA 설정 열기';
    actionKey = 'settings';
  } else if (!hasThreads || !hasCoupang) {
    health = 'needs_setup';
    summary = !hasThreads ? 'Threads 연결이 필요해요.' : '쿠팡 API 설정이 필요해요.';
    nextAction = '설정 확인';
    actionKey = 'settings';
  } else if (needsReview > 0) {
    health = 'needs_attention';
    summary = `${needsReview}개 포스팅 확인이 필요해요.`;
    nextAction = '포스팅 현황 보기';
    actionKey = 'posts';
  } else if (scheduled === 0) {
    health = 'empty';
    summary = '오늘 예약된 포스팅이 없어요.';
    nextAction = '자동화 실행';
    actionKey = 'run';
  }

  return {
    productId: product.id,
    name: product.name,
    description: product.description,
    granted: Boolean(grant),
    status: grant?.status || 'active',
    health,
    summary,
    nextAction,
    actionKey,
    usage: null,
    metrics: { accounts: activeAccounts.length, scheduled, posted, needsReview }
  };
}

function summarizeDexorProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates.length : 0;
  const results = Array.isArray(workspace.analysisResults) ? workspace.analysisResults.length : 0;
  if (results > 0) {
    return { health: 'ready', summary: `${results}개 후보 분석 결과가 준비됐어요.`, nextAction: '후보 다운로드', actionKey: 'dexor-download', usage };
  }
  if (candidates > 0) {
    return { health: usage.remaining <= 0 ? 'needs_attention' : 'needs_setup', summary: `${candidates}개 후보가 분석 대기 중이에요.`, nextAction: usage.remaining <= 0 ? '크레딧 충전' : '등급 분석', actionKey: usage.remaining <= 0 ? 'billing' : 'dexor-grade', usage };
  }
  return { health: 'empty', summary: '블로그 후보를 업로드하면 등급 분석을 시작할 수 있어요.', nextAction: '후보 업로드', actionKey: 'dexor-upload', usage };
}

function summarizeSpreadProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : (workspace.campaignDraft ? [workspace.campaignDraft] : []);
  const selected = campaigns[0] || {};
  if (selected.submissionReview || workspace.submissionReview) return { health: 'ready', summary: '제출물 검수 결과가 준비됐어요.', nextAction: '제출물 검수', actionKey: 'spread-review', usage };
  if (Array.isArray(selected.applicants || workspace.applicants) && (selected.applicants || workspace.applicants).length > 0) return { health: 'needs_setup', summary: '참여자 선정 다음 단계가 남아 있어요.', nextAction: '제출물 검수', actionKey: 'spread-review', usage };
  if (campaigns.length > 0) return { health: 'needs_setup', summary: `${campaigns.length}개 캠페인이 운영 대기 중이에요.`, nextAction: '참여자 선정', actionKey: 'spread-applicants', usage };
  return { health: 'empty', summary: '캠페인 초안을 만들면 운영 흐름이 시작돼요.', nextAction: '캠페인 추천', actionKey: 'spread-campaign', usage };
}

function summarizePolibotProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const recommendationCount = Array.isArray(workspace.recommendations) ? workspace.recommendations.length : 0;
  const feedbackNeedsReview = Number(workspace.feedbackSummary?.needsReview || 0);
  if (feedbackNeedsReview > 0) return { health: 'needs_attention', summary: `${feedbackNeedsReview}개 추천 피드백 검토가 필요해요.`, nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
  if (recommendationCount > 0) return { health: 'ready', summary: `${recommendationCount}개 추천 초안이 준비됐어요.`, nextAction: '결과 다운로드', actionKey: 'polibot-download', usage };
  return { health: 'empty', summary: '공통 상품 자료 기준으로 고객 조건 입력과 추천 초안을 시작할 수 있어요.', nextAction: '상품 추천', actionKey: 'polibot-recommend', usage };
}

function applyPolibotCatalogReadiness(status = {}, qualityReport = {}) {
  const recommendableProducts = Number(qualityReport?.recommendableProducts || 0);
  if (recommendableProducts <= 0 || status.health !== 'empty') return status;
  return {
    ...status,
    health: 'ready',
    summary: `${recommendableProducts.toLocaleString('ko-KR')}개 상품 자료로 추천을 시작할 수 있어요.`,
    nextAction: '상품 추천',
    actionKey: 'polibot-recommend'
  };
}

function summarizeInfludexProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates.length : 0;
  const results = Array.isArray(workspace.infludexResults) ? workspace.infludexResults.length : 0;
  const missing = Array.isArray(workspace.infludexResults) ? workspace.infludexResults.filter((item) => item.analysisStatus === 'data_missing').length : 0;
  if (results > 0) return { health: missing > 0 ? 'needs_attention' : 'ready', summary: missing > 0 ? `${missing}개 후보 데이터 보강이 필요해요.` : `${results}개 인플루언서 분석 결과가 준비됐어요.`, nextAction: '결과 다운로드', actionKey: 'infludex-download', usage };
  if (candidates > 0) return { health: usage.remaining <= 0 ? 'needs_attention' : 'needs_setup', summary: `${candidates}개 후보가 분석 대기 중이에요.`, nextAction: usage.remaining <= 0 ? '크레딧 충전' : '후보 분석', actionKey: usage.remaining <= 0 ? 'billing' : 'infludex-grade', usage };
  return { health: 'empty', summary: '인스타그램 후보를 업로드하면 등급 분석을 시작할 수 있어요.', nextAction: '후보 업로드', actionKey: 'infludex-upload', usage };
}

function summarizeAuvibotProduct({ product, grant } = {}) {
  const workspace = workspaceFromGrant(grant);
  const usage = productUsageFromGrant(grant, product.id);
  const jobs = Array.isArray(workspace.jobs) ? workspace.jobs : [];
  const ready = jobs.filter((job) => ['ready', 'rendered', 'queued'].includes(job.status)).length;
  const running = jobs.filter((job) => ['running', 'sourcing', 'editing', 'rendering'].includes(job.status)).length;
  if (ready > 0) return { health: 'ready', summary: `${ready}개 쇼츠 작업이 포스팅 대기 중이에요.`, nextAction: '포스팅 현황', actionKey: 'auvibot-posts', usage };
  if (running > 0) return { health: 'needs_setup', summary: `${running}개 자동화 작업이 진행 중이에요.`, nextAction: '포스팅 현황', actionKey: 'auvibot-posts', usage };
  return { health: 'needs_setup', summary: '설정 확인 후 영상 자동화를 시작할 수 있어요.', nextAction: '자동화 실행', actionKey: 'auvibot-run', usage };
}

function summarizeGrantedProduct({ product, grant } = {}) {
  const base = {
    productId: product.id,
    name: product.name,
    description: product.description,
    granted: true,
    status: grant.status || 'active'
  };
  if (product.status === 'preparing' || productServiceClosedInProduction(product.id)) {
    return { ...base, ...actionForLockedProduct(product), granted: true };
  }
  if (product.id === 'dexor') return { ...base, ...summarizeDexorProduct({ product, grant }) };
  if (product.id === 'spread') return { ...base, ...summarizeSpreadProduct({ product, grant }) };
  if (product.id === 'polibot') return { ...base, ...summarizePolibotProduct({ product, grant }) };
  if (product.id === 'infludex') return { ...base, ...summarizeInfludexProduct({ product, grant }) };
  if (product.id === 'auvibot') return { ...base, ...summarizeAuvibotProduct({ product, grant }) };
  return { ...base, health: 'ready', summary: '제품을 사용할 수 있어요.', nextAction: `${product.name} 열기`, actionKey: product.id, usage: productUsageFromGrant(grant, product.id) };
}

export async function buildProductWorkspaceSummary({ userId, allowedAccountIds = [] } = {}) {
  const [rawGrants, user] = await Promise.all([
    dbList('user_products', { user_id: userId }).catch(() => []),
    dbGet('users', { id: userId }).catch(() => null)
  ]);
  const unlimitedUsage = UNLIMITED_TEST_EMAILS.has(String(user?.email || '').trim().toLowerCase());
  const grants = rawGrants.map((grant) => ({ ...grant, unlimitedUsage: grantHasUnlimitedUsage(grant, user) }));
  const grantByProductId = new Map(grants.map((grant) => [grant.product_id, grant]));
  const accountIds = Array.isArray(allowedAccountIds) ? allowedAccountIds.filter(Boolean) : [];
  const [accounts, queueGroups] = await Promise.all([
    Promise.all(accountIds.map((id) => dbGet('accounts', { id }).catch(() => null))),
    Promise.all(accountIds.map((id) => dbList('post_queue', { account_id: id }).catch(() => [])))
  ]);
  const cujasaGrant = grantByProductId.get('cujasa') || { status: 'active', settings: {}, unlimitedUsage };
  const products = PRODUCTS.map((product) => {
    const grant = product.id === 'cujasa' ? cujasaGrant : grantByProductId.get(product.id);
    if (product.id === 'cujasa') {
      return summarizeCujasaProduct({
        product,
        grant,
        accounts: accounts.filter(Boolean),
        queue: queueGroups.flat()
      });
    }
    if (!grant || grant.status === 'suspended' || grant.status === 'expired') {
      return {
        productId: product.id,
        name: product.name,
        description: product.description,
        granted: false,
        status: product.status || 'active',
        usage: null,
        ...actionForLockedProduct(product)
      };
    }
    return summarizeGrantedProduct({ product, grant });
  });
  const needsAttention = products.filter((item) => ['needs_attention', 'needs_setup'].includes(item.health)).length;
  const activeCount = products.filter((item) => item.granted && item.health !== 'maintenance').length;
  const cujasa = products.find((item) => item.productId === 'cujasa');
  return {
    products,
    overview: {
      activeCount,
      needsAttention,
      scheduled: cujasa?.metrics?.scheduled || 0,
      posted: cujasa?.metrics?.posted || 0,
      accounts: cujasa?.metrics?.accounts || 0
    },
    primaryAction: products.find((item) => ['needs_attention', 'needs_setup'].includes(item.health))
      || products.find((item) => item.granted && item.health === 'empty')
      || products.find((item) => item.granted)
      || products[0]
  };
}

export async function getProductWorkspaceStatus(userId, productId) {
  const product = productById(productId);
  const grant = await getGrant(userId, productId);
  const status = summarizeGrantedProduct({ product, grant });
  if (productId !== 'polibot') return status;
  const importedReadiness = await getImportedPolibotCatalogReadiness().catch((error) => {
    console.warn('[polibot_status_imported_catalog_load_failed]', error?.message || error);
    return null;
  });
  if (importedReadiness?.knowledgeDbSummary?.importedCatalogItems > 0) {
    const qualityReport = importedReadiness.qualityReport || {};
    return {
      ...applyPolibotCatalogReadiness(status, qualityReport),
      qualityReport: compactPolibotClientQualityReport(qualityReport),
      knowledgeDbSummary: {
        ...EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY,
        ...(importedReadiness.knowledgeDbSummary || {})
      },
      catalog: importedReadiness.catalog || { companies: [], productGroups: [], months: [] }
    };
  }
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const rawCurrentKnowledge = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [];
  const dbKnowledge = await listPolibotDbKnowledgeSources(userId).catch((error) => {
    console.warn('[polibot_status_knowledge_load_failed]', error?.message || error);
    return [];
  });
  const catalogReviews = attachPolibotCatalogItemCache(normalizeCatalogReviews(workspace.catalogReviews));
  const knowledgeSources = (dbKnowledge.length ? dbKnowledge : rawCurrentKnowledge)
    .slice(0, 500)
    .map((source) => ({
      ...source,
      catalogItems: sourceCatalogItems(source, catalogReviews)
    }));
  const qualityReport = knowledgeSources.length && knowledgeSources.every((source) => source.dbSourceId)
    ? buildPolibotDbQualityReport(knowledgeSources)
    : buildPolibotRecommendationQualityReport(knowledgeSources, catalogReviews);
  const knowledgeDbSummary = {
    ...EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY,
    ...buildPolibotLightKnowledgeSummary(knowledgeSources),
    companies: (qualityReport?.companies || []).map((name) => ({ name, count: 0 })),
    productGroups: (qualityReport?.productGroups || []).map((name) => ({ name, count: 0 }))
  };
  return {
    ...applyPolibotCatalogReadiness(status, qualityReport),
    qualityReport: compactPolibotClientQualityReport(qualityReport),
    knowledgeDbSummary,
    catalog: buildPolibotCatalog(knowledgeSources)
  };
}

function sortDexorResults(results = []) {
  return [...results].sort((a, b) => {
    const aLabel = a.strengthenedGrade || a.scoreLabel || a.grade || '';
    const bLabel = b.strengthenedGrade || b.scoreLabel || b.grade || '';
    const gradeDelta = (DEXOR_SCORE_ORDER[aLabel] ?? 99) - (DEXOR_SCORE_ORDER[bLabel] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.strengthenedScore || b.score || 0) - Number(a.strengthenedScore || a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.url || '').localeCompare(String(b.url || ''));
  });
}

function sortInfludexResults(results = []) {
  return [...results].sort((a, b) => {
    const gradeDelta = (INFLUDEX_GRADE_ORDER[a.grade] ?? 99) - (INFLUDEX_GRADE_ORDER[b.grade] ?? 99);
    if (gradeDelta) return gradeDelta;
    const scoreDelta = Number(b.score || 0) - Number(a.score || 0);
    if (scoreDelta) return scoreDelta;
    return String(a.handle || a.url || '').localeCompare(String(b.handle || b.url || ''));
  });
}

function parseInfludexRows(input = '', fileName = '') {
  const rows = String(input || '')
    .split(/\n|\r/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = [];
  let header = null;
  rows.forEach((line, index) => {
    const cells = splitCandidateLine(line);
    const joined = cells.join(' ');
    const looksLikeHeader = /url|계정|닉네임|핸들|handle|category|카테고리|followers|팔로워|likes|좋아요|댓글|reels?|views?|조회수|이름\/설명|이메일\/문의/i.test(joined)
      && !/^https?:\/\//i.test(cells[0] || '')
      && !String(cells[0] || '').startsWith('@');
    if (looksLikeHeader) {
      header = cells.map((cell) => String(cell || '').trim().toLowerCase());
      return;
    }
    const headerIndex = (patterns = []) => {
      if (!header) return '';
      return header.findIndex((name) => {
        const compactName = String(name || '').replace(/\s+/g, '');
        return patterns.some((pattern) => pattern.test(name) || pattern.test(compactName));
      });
    };
    const byHeader = (patterns = []) => {
      const columnIndex = headerIndex(patterns);
      return columnIndex >= 0 ? cells[columnIndex] || '' : '';
    };
    const rawUrl = byHeader([/^url$/, /링크/]) || cells.find((cell) => /^https?:\/\//i.test(cell)) || '';
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : '';
    const handle = byHeader([/handle/, /핸들/, /계정/, /닉네임/, /\bid\b/]) || cells.find((cell) => /^@?[a-zA-Z0-9._]{2,50}$/.test(cell) && !/^\d+$/.test(cell)) || (url.match(/instagram\.com\/([^/?#]+)/i)?.[1] || '');
    if (!url && !handle) return;
    const metaCells = cells.filter((cell) => cell !== url && cell !== handle);
    const recentPostAt = byHeader([/recent/, /최근/, /게시일/]) || metaCells.find((cell) => /\d{4}[-./]\d{1,2}[-./]\d{1,2}/.test(cell)) || '';
    const followerCount = parseNumberLike(byHeader([/follower/, /팔로워/]));
    const avgLikes = parseNumberLike(byHeader([/avglike/, /likes?/, /좋아요/]));
    const avgComments = parseNumberLike(byHeader([/avgcomment/, /comments?/, /댓글/]));
    const avgReelsViewPatterns = [/avgreels?views?/, /reels?views?/, /avgviews?/, /views?/, /릴스.*조회/, /조회수/];
    const hasAvgReelsViewHeader = headerIndex(avgReelsViewPatterns) >= 0;
    const avgReelsViews = parseNumberLike(byHeader(avgReelsViewPatterns));
    const numbers = metaCells.map(parseNumberLike).filter((value) => value !== null);
    const displayName = byHeader([/이름/, /설명/, /name/, /description/]) || '';
    const bio = byHeader([/bio/, /소개/, /프로필/, /설명/]) || '';
    const targetCategory = byHeader([/target/, /campaign/, /목표/, /캠페인/, /타겟/]) || '';
    const contactMemo = byHeader([/이메일/, /문의/, /contact/, /email/]) || metaCells.find((cell) => /@.+\.|010-|오픈톡|litt\.ly|linktr\.ee|카톡|문의/i.test(cell)) || '';
    const descriptionText = [displayName, bio, contactMemo, fileName].filter(Boolean).join(' ');
    const inferredCategory = /부업|수익|n잡|n잡|n잡|재테크|머니/i.test(descriptionText) ? '부업/수익화'
      : /ai|인공지능|콘텐츠/i.test(descriptionText) ? 'AI/콘텐츠'
        : /마케팅|브랜딩|브랜드/i.test(descriptionText) ? '마케팅/브랜딩'
          : '';
    const category = byHeader([/category/, /카테고리/, /분야/]) || inferredCategory || metaCells.find((cell) => cell && cell !== recentPostAt && cell !== contactMemo && parseNumberLike(cell) === null && !/광고|협찬|체험단|스폰서|이동|-$/i.test(cell)) || '';
    const adMemo = byHeader([/admemo/, /광고/, /협찬/, /메모/]) || metaCells.find((cell) => /광고|협찬|체험단|스폰서|상업/i.test(cell)) || '';
    candidates.push({
      id: `infludex-${hashText(`${url || handle}-${index}`)}`,
      url,
      handle: String(handle || '').replace(/^@/, ''),
      displayName,
      description: displayName,
      category,
      followerCount: followerCount ?? numbers[0] ?? null,
      avgLikes: avgLikes ?? numbers[1] ?? null,
      avgComments: avgComments ?? numbers[2] ?? null,
      avgReelsViews: avgReelsViews ?? (hasAvgReelsViewHeader ? null : numbers[3]) ?? null,
      recentPostAt,
      contactMemo,
      adMemo,
      bio,
      targetCategory,
      source: fileName ? 'file-or-manual' : 'manual',
      createdAt: now()
    });
  });
  return candidates
    .filter((item, index, all) => all.findIndex((row) => (row.url || row.handle) === (item.url || item.handle)) === index)
    .slice(0, 500);
}

function stripXmlText(xml = '') {
  return String(xml || '')
    .replace(/<\/w:tc>/g, ',')
    .replace(/<\/w:tr>/g, '\n')
    .replace(/<\/w:p>\s*,/g, ',')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/a:t>\s*<a:t[^>]*>/g, ' ')
    .replace(/<\/w:t>\s*<w:t[^>]*>\s*(?=(?:https?:\/\/|@?[a-zA-Z0-9._-]+,))/g, '\n')
    .replace(/<\/w:t>\s*<w:t[^>]*>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t\f\v]*,[ \t\f\v]*/g, ',')
    .replace(/\n+,/g, ',')
    .replace(/,+\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/[ \t\f\v]*\n[ \t\f\v]*/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractDocxTextFromBase64(base64 = '') {
  const buffer = Buffer.from(String(base64 || ''), 'base64');
  if (!buffer.length) return '';
  const zip = new AdmZip(buffer);
  return zip.getEntries()
    .filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.entryName))
    .map((entry) => stripXmlText(entry.getData().toString('utf8')))
    .filter(Boolean)
    .join('\n');
}

function infludexRowsFromFiles(files = []) {
  return (Array.isArray(files) ? files : []).map((file) => {
    const fileName = file?.fileName || file?.name || '';
    const ext = String(fileName).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    if (ext === 'docx') return extractDocxTextFromBase64(file.base64 || '');
    if (ext === 'csv' || ext === 'txt') {
      return Buffer.from(String(file.base64 || ''), 'base64').toString('utf8');
    }
    return '';
  }).filter(Boolean).join('\n');
}

function normalizeList(input = '') {
  return String(input)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 200);
}

function formatPolibotMoneyAmount(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/원|만원|억|이하|이상|~/.test(text)) return text;
  return /^\d+(?:\.\d+)?$/.test(text) ? `${text}만원` : text;
}

function parsePolibotPremiumAmount(value = '') {
  const text = String(value || '').trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, '');
  const range = normalized.match(/(\d+(?:\.\d+)?)\s*[~\-]\s*(\d+(?:\.\d+)?)/);
  if (range) return Number(range[2]);
  const match = normalized.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;
  return /원/.test(normalized) && !/만원/.test(normalized) ? amount / 10000 : amount;
}

function formatPolibotPremiumAmount(value) {
  if (!Number.isFinite(Number(value))) return '';
  return `${Number(value).toLocaleString('ko-KR')}만원`;
}

function polibotBudgetFitLevel(amount, target) {
  if (!Number.isFinite(Number(amount)) || !Number.isFinite(Number(target)) || Number(target) <= 0) {
    return { level: 'reference', ratio: null, overAmount: null, label: '예산 기준 확인' };
  }
  const ratio = Number(amount) / Number(target);
  const overAmount = Number(amount) - Number(target);
  if (ratio <= 1) return { level: 'within_budget', ratio, overAmount, label: '예산 내' };
  if (ratio <= 1.15) return { level: 'near_budget', ratio, overAmount, label: '예산 근접 초과' };
  if (ratio <= 1.5) return { level: 'over_budget', ratio, overAmount, label: '예산 초과' };
  return { level: 'severe_over_budget', ratio, overAmount, label: '예산 크게 초과' };
}

function polibotBudgetOverrunText(amount, target) {
  const fit = polibotBudgetFitLevel(amount, target);
  if (!Number.isFinite(fit.overAmount) || fit.overAmount <= 0) return '';
  const percent = Math.round((fit.ratio - 1) * 1000) / 10;
  return `${formatPolibotPremiumAmount(amount)}가 목표 ${formatPolibotPremiumAmount(target)}보다 ${formatPolibotPremiumAmount(fit.overAmount)} 초과 (${percent}%)`;
}

function buildPolibotPremiumPlan(profile = {}) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const remodel = /리모델링|보험료\s*(절감|감액)/.test(profile.purpose || '');
  const targetPremium = Number.isFinite(target) ? formatPolibotPremiumAmount(target) : formatPolibotMoneyAmount(profile.budget);
  const currentPremium = Number.isFinite(current) ? formatPolibotPremiumAmount(current) : formatPolibotMoneyAmount(profile.existingPremium);
  let additionalBudgetMemo = '';
  if (Number.isFinite(target) && Number.isFinite(current)) {
    const diff = Math.round((target - current) * 10) / 10;
    if (remodel) additionalBudgetMemo = `기존 보험 조정 포함 · 목표 ${formatPolibotPremiumAmount(target)} / 현재 ${formatPolibotPremiumAmount(current)}`;
    else if (diff > 0) additionalBudgetMemo = `추가 가능 예산 약 ${formatPolibotPremiumAmount(diff)}`;
    else if (diff === 0) additionalBudgetMemo = '추가 여력 없음 · 기존 보험 조정 또는 보장 재배치 중심';
    else additionalBudgetMemo = `목표가 현재보다 약 ${formatPolibotPremiumAmount(Math.abs(diff))} 낮음 · 절감/리모델링 확인 필요`;
  } else if (remodel) {
    additionalBudgetMemo = '기존 보험 조정까지 포함해 목표 보험료 안에서 검토';
  } else {
    additionalBudgetMemo = '목표와 현재 납입 보험료 확인 시 추가 가능 예산 계산';
  }
  return { targetPremium, currentPremium, additionalBudgetMemo };
}

const POLIBOT_COVERAGE_TARGETS = [
  { key: 'cancer', label: '암 진단비', aliases: ['암', '일반암'], target: 5000, needs: ['암'] },
  { key: 'similarCancer', label: '유사암/소액암', aliases: ['유사암', '소액암'], target: 1000, needs: ['암'] },
  { key: 'brain', label: '뇌혈관/뇌졸중', aliases: ['뇌', '뇌혈관', '뇌졸중'], target: 2000, needs: ['뇌'] },
  { key: 'heart', label: '허혈성/심근경색', aliases: ['심장', '허혈성', '심근경색'], target: 2000, needs: ['심장'] },
  { key: 'surgery', label: '질병/상해 수술비', aliases: ['수술'], target: 300, needs: ['수술'] },
  { key: 'hospital', label: '입원일당', aliases: ['입원'], target: 5, needs: ['입원'] },
  { key: 'medical', label: '실손/실비', aliases: ['실손', '실비'], target: 1, needs: ['실손'] },
  { key: 'care', label: '간병/치매/요양', aliases: ['간병', '치매', '요양'], target: 1000, needs: ['간병', '치매', '생활비'] },
  { key: 'death', label: '사망/후유장해', aliases: ['사망', '후유장해'], target: 3000, needs: ['사망'] },
  { key: 'driver', label: '운전자', aliases: ['운전자'], target: 1, needs: ['운전자'] }
];

function parsePolibotCoverageAmount(value = '') {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!text) return null;
  if (/있음|가입|유지|예/i.test(text)) return 1;
  if (/없음|미가입|무/i.test(text)) return 0;
  if (/억/.test(text)) {
    const eok = Number(text.match(/(\d+(?:\.\d+)?)\s*억/)?.[1] || 0);
    const man = Number(text.match(/억\s*(\d+(?:\.\d+)?)\s*만?/)?.[1] || 0);
    const amount = (Number.isFinite(eok) ? eok * 10000 : 0) + (Number.isFinite(man) ? man : 0);
    return amount || null;
  }
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const amount = Number(match[0]);
  if (!Number.isFinite(amount)) return null;
  return amount;
}

function normalizePolibotCurrentCoverage(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return Object.fromEntries(POLIBOT_COVERAGE_TARGETS.map((item) => [
    item.key,
    source[item.key] && typeof source[item.key] === 'object'
      ? {
          amount: String(source[item.key].amount ?? '').trim(),
          renewalType: String(source[item.key].renewalType ?? '').trim(),
          maturity: String(source[item.key].maturity ?? '').trim(),
          note: String(source[item.key].note ?? '').trim()
        }
      : {
          amount: String(source[item.key] ?? '').trim(),
          renewalType: '',
          maturity: '',
          note: ''
        }
  ]));
}

function normalizePolibotPolicyDetails(raw = []) {
  const rows = Array.isArray(raw) ? raw : [];
  return rows.map((item) => ({
    company: String(item?.company || '').trim(),
    productName: String(item?.productName || '').trim(),
    startDate: String(item?.startDate || '').trim(),
    renewalType: String(item?.renewalType || '').trim(),
    premium: String(item?.premium || '').trim(),
    paymentPeriod: String(item?.paymentPeriod || '').trim(),
    maturity: String(item?.maturity || '').trim(),
    status: String(item?.status || '').trim()
  })).filter((item) => Object.values(item).some(Boolean)).slice(0, 12);
}

const POLIBOT_RECENT3_MONTH_FIELDS = [
  'diagnosis',
  'suspicion',
  'treatment',
  'admission',
  'surgery',
  'medication',
  'extraExam'
];

function normalizePolibotRecent3MonthDetails(raw = '') {
  if (raw && typeof raw === 'object') {
    return {
      diagnosis: String(raw.diagnosis || '').trim(),
      suspicion: String(raw.suspicion || '').trim(),
      treatment: String(raw.treatment || '').trim(),
      admission: String(raw.admission || '').trim(),
      surgery: String(raw.surgery || '').trim(),
      medication: String(raw.medication || '').trim(),
      extraExam: String(raw.extraExam || '').trim(),
      confirmedBy: String(raw.confirmedBy || '').trim(),
      note: String(raw.note || '').trim()
    };
  }
  return null;
}

function normalizePolibotRecent3MonthDisclosure(raw = '') {
  const details = normalizePolibotRecent3MonthDetails(raw);
  if (details) {
    const values = POLIBOT_RECENT3_MONTH_FIELDS.map((key) => String(details[key] || '').trim().toLowerCase());
    const answeredValues = values.filter(Boolean);
    const noneValues = new Set(['none', 'no', '없음', '무', '해당없음', '해당 없음']);
    if (answeredValues.length === POLIBOT_RECENT3_MONTH_FIELDS.length && answeredValues.every((value) => noneValues.has(value))) {
      return `없음${details.confirmedBy ? ` · 확인자:${details.confirmedBy}` : ''}`;
    }
    return [
      details.diagnosis && `진단:${details.diagnosis}`,
      details.suspicion && `의심소견:${details.suspicion}`,
      details.treatment && `치료:${details.treatment}`,
      details.admission && `입원:${details.admission}`,
      details.surgery && `수술:${details.surgery}`,
      details.medication && `투약:${details.medication}`,
      details.extraExam && `추가검사:${details.extraExam}`,
      details.confirmedBy && `확인자:${details.confirmedBy}`,
      details.note
    ].filter(Boolean).join(' · ');
  }
  return String(raw || '').trim();
}

function normalizePolibotDisclosureDetails(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    recent3Months: normalizePolibotRecent3MonthDisclosure(source.recent3Months),
    recent3MonthDetails: normalizePolibotRecent3MonthDetails(source.recent3MonthDetails || source.recent3Months),
    recent1Year: String(source.recent1Year || '').trim(),
    recent5Years: String(source.recent5Years || '').trim(),
    recentExam: String(source.recentExam || '').trim(),
    admissionSurgery: String(source.admissionSurgery || '').trim(),
    longTreatment: String(source.longTreatment || '').trim(),
    longMedication: String(source.longMedication || '').trim(),
    currentMedication: String(source.currentMedication || '').trim(),
    medicationRiskReview: String(source.medicationRiskReview || '').trim(),
    hiraDiseaseCodes: Array.isArray(source.hiraDiseaseCodes) ? source.hiraDiseaseCodes : [],
    majorDisease: String(source.majorDisease || '').trim(),
    completeCure: String(source.completeCure || '').trim(),
    followUp: String(source.followUp || '').trim(),
    details: String(source.details || '').trim()
  };
}

function normalizePolibotUnderwritingAssessment(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    route: String(source.route || '').trim(),
    standardPossible: String(source.standardPossible || '').trim(),
    burden: String(source.burden || '').trim(),
    surcharge: String(source.surcharge || '').trim(),
    simpleReview: String(source.simpleReview || '').trim(),
    note: String(source.note || '').trim()
  };
}

function normalizePolibotAnalysisResult(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    gaps: String(source.gaps || '').trim(),
    duplicates: String(source.duplicates || '').trim(),
    premiumIssue: String(source.premiumIssue || '').trim(),
    keepList: String(source.keepList || '').trim(),
    remodelList: String(source.remodelList || '').trim(),
    caution: String(source.caution || '').trim()
  };
}

function polibotCurrentCoverageAnalysis(profile = {}) {
  const currentCoverage = normalizePolibotCurrentCoverage(profile.currentCoverage);
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  const rows = POLIBOT_COVERAGE_TARGETS.map((target) => {
    const rawEntry = currentCoverage[target.key] || {};
    const raw = rawEntry.amount || '';
    const amount = parsePolibotCoverageAmount(raw);
    const needed = needs.some((need) => target.needs.some((term) => String(need || '').includes(term) || term.includes(String(need || ''))))
      || target.aliases.some((alias) => needs.some((need) => String(need || '').includes(alias)));
    let status = '미확인';
    let reason = '현재 담보금액이 입력되지 않았습니다.';
    if (amount === 0) {
      status = needed ? '부족' : '미가입';
      reason = needed ? '필요 보장인데 현재 가입이 없는 것으로 입력됐습니다.' : '현재 가입 없음으로 입력됐습니다.';
    } else if (Number.isFinite(amount)) {
      if (target.key === 'medical' || target.key === 'driver') {
        status = amount > 0 ? '보유' : needed ? '부족' : '미가입';
        reason = amount > 0 ? '보유 여부가 확인됐습니다.' : '보유 여부 확인이 필요합니다.';
      } else if (amount >= target.target) {
        status = needed ? '충분 후보' : '보유';
        reason = `기준 ${target.target.toLocaleString('ko-KR')}만원 이상으로 입력됐습니다.`;
      } else {
        status = needed ? '부족' : '낮음';
        reason = `기준 ${target.target.toLocaleString('ko-KR')}만원 대비 낮게 입력됐습니다.`;
      }
    } else if (raw) {
      status = '확인 필요';
      reason = '금액 대신 메모로 입력되어 증권 기준 확인이 필요합니다.';
    }
    return {
      key: target.key,
      label: target.label,
      value: raw,
      amount,
      renewalType: rawEntry.renewalType || '',
      maturity: rawEntry.maturity || '',
      note: rawEntry.note || '',
      needed,
      status,
      reason
    };
  });
  const gaps = rows.filter((row) => row.needed && ['부족', '미가입', '미확인', '확인 필요'].includes(row.status));
  const duplicates = rows.filter((row) => !row.needed && ['충분 후보', '보유'].includes(row.status));
  const unknown = rows.filter((row) => ['미확인', '확인 필요'].includes(row.status));
  return {
    rows,
    gaps,
    duplicates,
    unknown,
    summary: [
      gaps.length ? `부족/확인 보장 ${gaps.length}개` : '필요 보장 기준 큰 공백 없음',
      duplicates.length ? `중복 점검 ${duplicates.length}개` : '',
      unknown.length ? `미확인 ${unknown.length}개` : ''
    ].filter(Boolean).join(' · ')
  };
}

function polibotAgeValue(profile = {}) {
  const age = Number(String(profile.age || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(age) && age > 0 ? age : null;
}

function polibotAgeRangeStatus(item = {}, profile = {}) {
  const age = polibotAgeValue(profile);
  const rangeText = String(item.ageRange || '').trim();
  if (!age || !rangeText) return { status: 'unknown', label: '가입연령 확인 필요', reason: rangeText || '상품 자료에 가입연령이 명확하지 않아요.' };
  const numbers = rangeText.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) || [];
  if (numbers.length >= 2) {
    const min = Math.min(numbers[0], numbers[1]);
    const max = Math.max(numbers[0], numbers[1]);
    if (age < min || age > max) return { status: 'blocked', label: '연령 조건 불리', reason: `${age}세는 자료상 가입연령 ${min}~${max}세 범위를 벗어날 수 있어요.` };
    return { status: 'ok', label: '연령 조건 부합', reason: `${age}세는 자료상 가입연령 ${min}~${max}세 범위 안에 있어요.` };
  }
  const only = numbers[0];
  if (Number.isFinite(only) && /이상|부터/.test(rangeText) && age < only) return { status: 'blocked', label: '연령 조건 불리', reason: `${only}세 이상 조건으로 보이며 현재 ${age}세예요.` };
  if (Number.isFinite(only) && /이하|까지/.test(rangeText) && age > only) return { status: 'blocked', label: '연령 조건 불리', reason: `${only}세 이하 조건으로 보이며 현재 ${age}세예요.` };
  return { status: 'unknown', label: '가입연령 확인 필요', reason: `${rangeText} 기준을 상담 시 확인해야 해요.` };
}

function polibotUnderwritingMedicalText(profile = {}) {
  const medical = String(profile.medicalHistory || '').trim();
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const looksLikeCoverageTable = (value = '') => /암\s*진단|뇌\/심장|뇌혈관질환|허혈성심장질환|운전자|실손|일반암|유사암|고액암|수술비|입원비|담보|가입금액|보험료/i.test(value);
  const disclosureText = Object.values(disclosure)
    .filter(Boolean)
    .map((value) => Array.isArray(value)
      ? value.map((item) => typeof item === 'object' ? [item.code, item.name, item.context].filter(Boolean).join(' ') : String(item || '')).join(' ')
      : value && typeof value === 'object'
        ? Object.values(value).filter((item) => typeof item === 'string' || typeof item === 'number').join(' ')
      : String(value || ''))
    .filter((value) => !looksLikeCoverageTable(String(value || '')))
    .join(' ');
  const routeText = String(profile.underwritingAssessment?.route || '').trim();
  const strongMedical = /심평원|병원|약국|진료|처방|투약|복용|외래|고혈압|당뇨|고지혈|디스크|염좌|골절|용종|결절|KCD|상병|질병코드|E1[0-4]|I10|3개월|1년|5년/i.test(medical);
  const weakMedical = /입원|수술|시술|치료|검사|재검|추적|관찰|소견/i.test(medical);
  const explicitRoute = /부담보|할증|조건부|거절|간편\s*(3|고지)|3\.\d{1,2}\.\d{1,2}|고혈압|당뇨|투약|입원|수술/i.test(routeText);
  return [
    disclosureText,
    explicitRoute ? routeText : '',
    strongMedical || (weakMedical && !looksLikeCoverageTable(medical)) ? medical : ''
  ].filter(Boolean).join(' ');
}

function polibotDiseaseSignals(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = normalizePolibotMatchText(`${medical} ${profile.familyHistory || ''}`);
  const codes = [...text.matchAll(/\b([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?|[A-Z][0-9]{3})\b/gi)]
    .map((match) => String(match[1] || '').toUpperCase())
    .filter(Boolean);
  const hasCodeRange = (letter, min, max) => codes.some((code) => {
    const match = code.match(/^([A-Z])(\d{2})/);
    if (!match || match[1] !== letter) return false;
    const value = Number(match[2]);
    return value >= min && value <= max;
  });
  const signals = {
    codes: [...new Set(codes)].slice(0, 20),
    hypertension: hasCodeRange('I', 10, 10) || /고혈압|본태성\s*혈압|혈압약/i.test(text),
    diabetes: hasCodeRange('E', 10, 14) || /당뇨|당뇨병|인슐린/i.test(text),
    ischemicHeart: hasCodeRange('I', 20, 25) || /허혈성\s*심장|협심증|심근경색/i.test(text),
    arrhythmia: hasCodeRange('I', 47, 49) || /부정맥|심방세동|심실빈맥/i.test(text),
    heartFailure: hasCodeRange('I', 50, 50) || /심부전/i.test(text),
    cerebrovascular: hasCodeRange('I', 60, 69) || /뇌혈관|뇌졸중|뇌출혈|뇌경색/i.test(text),
    cancer: hasCodeRange('C', 0, 97) || /암|악성신생물|백혈병|림프종|갑상선암|전이|재발/i.test(text),
    dementia: hasCodeRange('F', 0, 3) || /치매|알츠하이머/i.test(text)
  };
  signals.chronic = signals.hypertension || signals.diabetes || signals.arrhythmia || signals.heartFailure;
  signals.major = signals.cancer || signals.ischemicHeart || signals.cerebrovascular || signals.dementia;
  signals.queries = [
    signals.hypertension && '고혈압',
    signals.diabetes && '당뇨',
    signals.ischemicHeart && '허혈성심장',
    signals.ischemicHeart && '협심증',
    signals.arrhythmia && '부정맥',
    signals.heartFailure && '심부전',
    signals.cerebrovascular && '뇌혈관',
    signals.cerebrovascular && '뇌졸중',
    signals.cancer && '암 진단비',
    signals.cancer && '암 주요치료비',
    signals.dementia && '치매',
    signals.dementia && '간병'
  ].filter(Boolean);
  signals.labels = [
    signals.hypertension && '고혈압',
    signals.diabetes && '당뇨',
    signals.ischemicHeart && '허혈성심장질환',
    signals.arrhythmia && '부정맥',
    signals.heartFailure && '심부전',
    signals.cerebrovascular && '뇌혈관질환',
    signals.cancer && '암',
    signals.dementia && '치매'
  ].filter(Boolean);
  return signals;
}

function inferPolibotMedicalWindowMonths(text = '') {
  const value = normalizePolibotMatchText(text);
  const yearMatch = value.match(/(?:심평원|hira|진료|의료기관|약국|청구)[^\n]{0,24}?(\d{1,2})\s*년\s*(?:자료|이력|조회|기준)?/);
  if (yearMatch) return Number(yearMatch[1]) * 12;
  const monthMatch = value.match(/(?:심평원|hira|진료|의료기관|약국|청구)[^\n]{0,24}?(\d{1,2})\s*(?:개월|달)\s*(?:자료|이력|조회|기준)?/);
  if (monthMatch) return Number(monthMatch[1]);
  if (/심평원\s*5년|5년\s*자료\s*기준|5년\s*이력/.test(value)) return 60;
  if (/심평원\s*3개월|3개월\s*자료|3달\s*전|3개월치/.test(value)) return 3;
  return null;
}

function stripNegatedPolibotMedicalTerms(text = '') {
  return String(text || '')
    .replace(/입원\s*0\s*일/g, '')
    .replace(/외래\s*0\s*일/g, '')
    .replace(/치료횟수\s*0\s*회/g, '')
    .replace(/투약일수\s*0\s*일/g, '')
    .replace(/처방일수\s*0\s*일/g, '')
    .replace(/(?:진단|의심소견|치료|입원|수술|투약|추가검사)\s*:\s*(?:none|no|없음|무|해당없음|해당\s*없음)/gi, '')
    .replace(/입원\s*\/\s*수술\s*(?:없음|없|무|미확인)/g, '')
    .replace(/입원\s*(?:및|,|·)?\s*수술\s*(?:없음|없|무|미확인)/g, '')
    .replace(/수술\s*(?:명시\s*)?(?:없음|없|무|미확인)/g, '')
    .replace(/입원\s*(?:명시\s*)?(?:없음|없|무|미확인)/g, '')
    .replace(/(?:장기\s*)?투약\s*(?:명시\s*)?(?:없음|없|무|미확인)/g, '')
    .replace(/복용\s*(?:명시\s*)?(?:없음|없|무|미확인)/g, '')
    .replace(/처방\s*(?:명시\s*)?(?:없음|없|무|미확인)/g, '');
}

function extractPolibotMedicalEvents(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = normalizePolibotMatchText(`${medical} ${profile.familyHistory || ''}`);
  const diseaseSignals = polibotDiseaseSignals(profile);
  const coverageWindowMonths = inferPolibotMedicalWindowMonths(text);
  const positiveText = stripNegatedPolibotMedicalTerms(text);
  const numbersFor = (pattern) => [...text.matchAll(pattern)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
  const sum = (values = []) => values.reduce((total, value) => total + value, 0);
  const admissionDays = sum(numbersFor(/입원\s*(\d+)\s*일/g).filter((value) => value > 0));
  const outpatientDays = sum(numbersFor(/외래\s*(\d+)\s*일/g).filter((value) => value > 0));
  const pharmacyClaims = sum(numbersFor(/약국\s*(?:이용|청구\s*이력\s*확인)?\s*(\d+)\s*건/g).filter((value) => value > 0));
  const institutionClaims = sum(numbersFor(/의료기관\s*(\d+)\s*건/g).filter((value) => value > 0));
  const maxFor = (patterns = []) => Math.max(0, ...patterns.flatMap((pattern) => numbersFor(pattern)).filter((value) => value > 0));
  const explicitTreatmentCount = maxFor([/치료횟수\s*(\d+)\s*회/g]);
  const inferredTreatmentCount = maxFor([
    /(?:치료|진료|외래|통원)\s*(?:횟수|건수)?\s*[:：]?\s*(\d{1,3})\s*(?:회|건|일)/g,
    /(\d{1,3})\s*(?:회|건|일)\s*(?:치료|진료|외래|통원)/g
  ]);
  const treatmentCount = explicitTreatmentCount || inferredTreatmentCount || outpatientDays;
  const medicationDays = maxFor([
    /투약일수\s*(\d+)\s*일/g,
    /처방일수\s*(\d+)\s*일/g,
    /(?:총\s*)?(?:투약|처방|복약|조제)\s*(?:일수|기간)?\s*[:：]?\s*(\d{1,3})\s*일/g,
    /(\d{1,3})\s*일분/g,
    /(\d{1,3})\s*일\s*(?:처방|투약|복용|복약|조제)/g
  ]);
  const medicationReviewText = [
    String(profile.disclosureDetails?.medicationRiskReview || ''),
    text
  ].filter(Boolean).join(' ');
  const hiraDocumentTypes = [
    /기본\s*진료\s*정보|진료정보요약|의료기관\s*\d+\s*건|치료횟수\s*\d+\s*회/.test(text) && '기본진료정보',
    /약제\s*정보|약국\s*\d+\s*건|투약일수\s*\d+\s*일|처방일수\s*\d+\s*일/.test(text) && '약제정보',
    /진료비정보|요양급여비용|혜택받은\s*금액|진료비/.test(text) && '진료비정보',
    /상병정보|질병\s*코드|kcd|주상병|부상병/.test(text) && '상병정보'
  ].filter(Boolean);
  const hasNoSurgery = /수술\s*:\s*(?:none|no|없음|무|해당없음)|입원\s*\/\s*수술\s*(?:없음|없|무|미확인)|입원\s*(?:및|,|·)?\s*수술\s*(?:없음|없|무|미확인)|수술\s*(?:명시\s*)?(?:없음|없|무|미확인)|수술.*(?:없음|없|무|미확인)/i.test(text);
  const hasNoAdmission = /입원\s*:\s*(?:none|no|없음|무|해당없음)|입원\s*\/\s*수술\s*(?:없음|없|무|미확인)|입원\s*(?:및|,|·)?\s*수술\s*(?:없음|없|무|미확인)|입원\s*0\s*일|입원\s*(?:명시\s*)?(?:없음|없|무|미확인)/i.test(text);
  const hasNoLongMedication = /투약\s*:\s*(?:none|no|없음|무|해당없음)|투약일수\s*0\s*일|처방일수\s*0\s*일|(?:장기\s*)?투약\s*(?:명시\s*)?(?:없음|없|무|미확인)|복용\s*(?:명시\s*)?(?:없음|없|무|미확인)|처방\s*(?:명시\s*)?(?:없음|없|무|미확인)/i.test(text);
  const hasAdmission = admissionDays > 0 || (/입원/.test(positiveText) && !hasNoAdmission);
  const hasSurgery = /수술|시술/.test(positiveText) && !hasNoSurgery;
  const hasMajorDisease = diseaseSignals.major || /암|백혈병|협심증|심근경색|심장판막|간경화|뇌졸중|뇌출혈|뇌경색|에이즈|hiv|후유증|전이|재발|c\d{2}|i2[0-5]|i6[0-9]/i.test(text);
  const hasChronicDisease = diseaseSignals.chronic || /고혈압|혈압|당뇨|고지혈|고지혈증|콜레스테롤|지질|i10|e1[0-4]/i.test(text);
  const hasHealthyTreatmentThreshold = treatmentCount >= 7 || /7회\s*이상\s*치료|7일\s*이상\s*치료/.test(text);
  const hasHealthyMedicationThreshold = medicationDays >= 30 || /30일\s*이상\s*투약|30일\s*이상\s*처방|30일\s*이상\s*복용/.test(text);
  const sustainedMedicationTags = [
    (/ADHD|주의력\s*결핍|과잉행동|F90/i.test(medicationReviewText)) && 'ADHD/주의력결핍',
    (/성조숙|사춘기\s*조발|조발\s*사춘기|E30(?:\.1)?/i.test(medicationReviewText)) && '성조숙증/사춘기장애',
    (/정신\/행동|정신건강|F\d{2}/i.test(medicationReviewText)) && '정신/행동 관련 상병',
    (/내분비|호르몬|갑상선|E0[0-7]|E2[0-9]|E3[0-5]/i.test(medicationReviewText)) && '내분비/호르몬 관련 상병'
  ].filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
  const hasSustainedMedicationReview = sustainedMedicationTags.length > 0 || /지속투약\s*심사|지속\s*투약|현재\s*복용|처방\s*유지/.test(medicationReviewText);
  const hasLongMedication = !hasNoLongMedication && (hasHealthyMedicationThreshold || hasChronicDisease || /투약|복용|처방\s*유지|현재\s*처방|30일\s*이상\s*투약|장기\s*처방|약\s*복용/i.test(positiveText));
  const hasFollowup = /검사|재검|추적|관찰|소견|결절|용종|검진/.test(positiveText);
  const highRiskDepartment = /순환기|심장|신경과|신경외과|종양|혈액|내분비|신장|호흡기/.test(text);
  const moderateRiskDepartment = /정형외과|내과|가정의학과|한방병원|치과|안과|소아청소년과/.test(text);
  const hasHira = /심평원|의료기관|병원|약국|진료|외래|처방/.test(text);
  const reasons = [
    admissionDays > 0 && `입원 ${admissionDays}일`,
    outpatientDays > 0 && `외래 ${outpatientDays}일`,
    pharmacyClaims > 0 && `약국 ${pharmacyClaims}건`,
    institutionClaims > 0 && `의료기관 ${institutionClaims}건`,
    treatmentCount > 0 && `치료횟수 ${treatmentCount}회`,
    medicationDays > 0 && `투약일수 ${medicationDays}일`,
    hasSurgery && '수술/시술 단서',
    hasLongMedication && '장기투약/만성질환 단서',
    hasFollowup && '검사/추적관찰 단서',
    hasMajorDisease && '주요질환 단서',
    highRiskDepartment && '고위험 진료과 단서',
    !highRiskDepartment && moderateRiskDepartment && '일반 진료과 반복 단서'
  ].filter(Boolean);
  return {
    text,
    positiveText,
    hasHira,
    coverageWindowMonths,
    coverageWindowLabel: coverageWindowMonths ? `${coverageWindowMonths >= 12 ? `${coverageWindowMonths / 12}년` : `${coverageWindowMonths}개월`} 자료` : '',
    admissionDays,
    outpatientDays,
    pharmacyClaims,
    institutionClaims,
    treatmentCount,
    medicationDays,
    hiraDocumentTypes,
    hasAdmission,
    hasSurgery,
    hasAdmissionSurgery: hasAdmission || hasSurgery,
    hasMajorDisease,
    hasChronicDisease,
    hasLongMedication,
    hasHealthyTreatmentThreshold,
    hasHealthyMedicationThreshold,
    hasSustainedMedicationReview,
    sustainedMedicationTags,
    hasFollowup,
    highRiskDepartment,
    moderateRiskDepartment,
    hasLightHiraUse: hasHira
      && (outpatientDays > 0 || pharmacyClaims > 0 || institutionClaims > 0 || treatmentCount > 0 || medicationDays > 0 || hasFollowup || (diseaseSignals.codes || []).length > 0)
      && !hasMajorDisease
      && !hasAdmission
      && !hasSurgery
      && !hasLongMedication,
    diseaseSignals,
    reasons
  };
}

function polibotDisclosureWindowReview(events = {}, requiredMonths = 0) {
  if (!requiredMonths || !events.hasHira) return null;
  if (!events.coverageWindowMonths) {
    if (!/심평원|hira|자료\s*기준|조회/.test(events.text || '')) return null;
    return {
      status: 'needs_review',
      reasonCode: 'lookback_unknown',
      reason: `${requiredMonths >= 12 ? `${requiredMonths / 12}년` : `${requiredMonths}개월`} 고지기간을 판단할 자료 조회기간이 확인되지 않았습니다.`
    };
  }
  if (events.coverageWindowMonths < requiredMonths) {
    return {
      status: 'needs_review',
      reasonCode: 'lookback_short',
      reason: `${events.coverageWindowLabel || `${events.coverageWindowMonths}개월 자료`}만으로는 ${requiredMonths >= 12 ? `${requiredMonths / 12}년` : `${requiredMonths}개월`} 고지기간 통과 여부를 확정할 수 없습니다.`
    };
  }
  return null;
}

function polibotDisclosureRecent3MonthReview(profile = {}, events = {}) {
  if (!events.hasHira) return null;
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const details = disclosure.recent3MonthDetails;
  if (details) {
    const values = POLIBOT_RECENT3_MONTH_FIELDS.map((key) => String(details[key] || '').trim().toLowerCase());
    const answeredValues = values.filter(Boolean);
    const noneValues = new Set(['none', 'no', '없음', '무', '해당없음', '해당 없음']);
    const positiveValues = new Set(['yes', 'y', 'true', '있음', '예', '네', '유']);
    if (answeredValues.length < POLIBOT_RECENT3_MONTH_FIELDS.length) {
      return {
        status: 'needs_review',
        reasonCode: 'recent3_incomplete',
        reason: '최근 3개월 고지 문진 항목 일부가 비어 있어 진단, 의심소견, 치료, 입원, 수술, 투약, 추가검사 여부를 모두 확인해야 합니다.'
      };
    }
    if (values.every((value) => noneValues.has(value))) return null;
    if (values.some((value) => positiveValues.has(value)) || String(details.note || '').trim()) {
      return {
        status: 'needs_review',
        reasonCode: 'recent3_medical_event',
        reason: '최근 3개월 고지 문진에 의료행위 단서가 있어 질병확정진단, 의심소견, 치료, 입원, 수술, 투약, 추가검사 여부를 확인해야 합니다.'
      };
    }
  }
  const recentText = normalizePolibotMatchText(disclosure.recent3Months || '');
  if (/없음|무|해당\s*없|이상\s*없|문제\s*없|특이\s*없/.test(recentText)) return null;
  if (/있음|예|진단|의심|치료|입원|수술|투약|검사|소견|외래|처방/.test(recentText)) {
    return {
      status: 'needs_review',
      reasonCode: 'recent3_medical_event',
      reason: '최근 3개월 고지 문진에 의료행위 단서가 있어 질병확정진단, 의심소견, 치료, 입원, 수술, 투약, 추가검사 여부를 확인해야 합니다.'
    };
  }
  if ((events.coverageWindowMonths || 0) >= 12 || /심평원|hira/.test(events.text || '')) {
    return {
      status: 'needs_review',
      reasonCode: 'recent3_missing',
      reason: '심평원 자료에는 최근 3개월 이력이 포함되지 않아 최근 3개월 고지 문진 확인 후 확정할 수 있습니다.'
    };
  }
  return null;
}

function polibotDisclosureCodeRequiredMonths(code = '') {
  const normalized = normalizePolibotDisclosureCode(code) || String(code || '').trim();
  const parts = normalized.split('.').map((part) => Number(part)).filter(Number.isFinite);
  if (parts.length >= 3 && parts[0] === 3) return Math.max(3, parts[1] * 12, parts[2] * 12);
  if (parts.length >= 3 && parts[0] === 5) return Math.max(parts[1] * 12, parts[2] * 12);
  return 0;
}

function polibotDisclosureRecent3Cleared(profile = {}, events = {}) {
  return !polibotDisclosureRecent3MonthReview(profile, events);
}

function polibotDisclosureRuleContext(profile = {}) {
  const events = extractPolibotMedicalEvents(profile);
  const diseaseSignals = events.diseaseSignals || polibotDiseaseSignals(profile);
  const medical = polibotUnderwritingMedicalText(profile);
  const text = normalizePolibotMatchText([
    medical,
    profile.familyHistory,
    profile.underwritingAssessment?.route,
    profile.underwritingAssessment?.note,
    profile.underwritingAssessment?.simpleReview
  ].filter(Boolean).join(' '));
  const rawMedical = String(profile.medicalHistory || '').trim();
  const explicitNoMedical = /^(없음|무|해당\s*없음?|이상\s*없음?|문제\s*없음?|특이\s*사항\s*없음?)$/i.test(String(rawMedical || medical || '').trim());
  const noMedical = explicitNoMedical
    && !events.hasHira
    && !events.hasAdmissionSurgery
    && !events.hasLongMedication
    && !events.hasFollowup
    && !events.hasMajorDisease
    && !events.hasChronicDisease;
  return {
    events,
    diseaseSignals,
    medical,
    text,
    noMedical,
    hasRecent3Clear: polibotDisclosureRecent3Cleared(profile, events),
    hasLongLookbackEvidence: (events.coverageWindowMonths || 0) >= 120 || /10년|십년/.test(text),
    hasFiveYearEvidence: (events.coverageWindowMonths || 0) >= 60 || /5년|오년/.test(text),
    hasLightIssue: events.hasLightHiraUse
      || (/경증|초경증|용종|결절|검진|외래|통원|약국|처방|추적|관찰/.test(text)
        && !events.hasMajorDisease
        && !events.hasAdmissionSurgery
        && !events.hasLongMedication)
  };
}

const POLIBOT_DISCLOSURE_RULES = [
  {
    code: '5.10.5',
    label: '건강고지/우량체 비교',
    category: '건강고지',
    priority: 78,
    when: ({ noMedical }) => noMedical,
    reason: '병력 이슈가 낮아 건강고지 또는 우량체 계열을 먼저 비교할 수 있습니다.',
    nextCheck: '일반심사 보험료와 건강고지 보험료 차이를 먼저 비교하세요.'
  },
  {
    code: '5.5.5',
    label: '표준/건강고지 비교',
    category: '건강고지',
    priority: 70,
    when: ({ noMedical }) => noMedical,
    reason: '표준형 가능성이 높은 고객이라 5.5.5 계열도 보험료 비교 후보입니다.',
    nextCheck: '표준심사 가능 여부와 고지 질문 원문을 확인하세요.'
  },
  {
    code: '3.0.5',
    label: '초경증/무사고 전환 참고',
    category: '간편고지',
    priority: 66,
    when: ({ hasLightIssue, events }) => hasLightIssue && !events.hasAdmissionSurgery && !events.hasMajorDisease && !events.hasLongMedication,
    reason: '입원/수술/장기투약 단서가 약한 경증 외래·검사 중심 자료라 3.0.5 계열은 참고 후보로 볼 수 있습니다.',
    nextCheck: '해당 회사가 3.0.5를 실제 판매/전환 코드로 쓰는지 설계 화면에서 확인하세요.'
  },
  {
    code: '3.2.5',
    label: '초경증 간편고지',
    category: '간편고지',
    priority: 72,
    when: ({ hasLightIssue, events }) => hasLightIssue && !events.hasAdmissionSurgery && !events.hasMajorDisease && !events.hasLongMedication,
    reason: '최근 입원/수술/중대질환보다 외래·검사 단서가 중심이라 3.2.5 초경증 후보를 비교합니다.',
    nextCheck: '최근 3개월 문진과 5년 내 입원/수술 여부를 확인하세요.'
  },
  {
    code: '3.3.5',
    label: '추적관찰/검사 이력 간편고지',
    category: '간편고지',
    priority: 76,
    when: ({ events }) => (events.hasFollowup || events.hasLightHiraUse) && !events.hasAdmissionSurgery && !events.hasMajorDisease,
    reason: '검사/재검/추적관찰 또는 심평원 이력이 있어 3.3.5 질문형을 비교 후보로 둡니다.',
    nextCheck: '검사 결과가 단순 추적관찰인지 추가 치료 지시인지 구분하세요.'
  },
  {
    code: '3.5.5',
    label: '5년형 간편고지',
    category: '간편고지',
    priority: 86,
    when: ({ events }) => events.hasAdmissionSurgery || events.hasLongMedication || events.hasChronicDisease,
    reason: '입원/수술/장기투약 또는 만성질환 단서가 있어 5년형 간편고지를 우선 비교합니다.',
    nextCheck: '5년 내 입원, 수술, 7일 이상 치료, 30일 이상 투약 여부를 확인하세요.'
  },
  {
    code: '3.6.5',
    label: '고혈압/당뇨 추가고지 비교',
    category: '간편고지',
    priority: 82,
    when: ({ diseaseSignals, events }) => (diseaseSignals.hypertension || diseaseSignals.diabetes) && !events.hasMajorDisease,
    reason: '고혈압/당뇨 단서가 있어 서버 코드표의 추가고지형 후보를 비교합니다.',
    nextCheck: '최근 수치, 합병증, 인슐린 사용, 입원/수술 여부를 확인하세요.'
  },
  {
    code: '3.10.5',
    label: '10년/5년형 경증 유병자',
    category: '간편고지',
    priority: 84,
    strictLookback: true,
    when: ({ events, diseaseSignals, hasLightIssue, hasLongLookbackEvidence }) => (
      diseaseSignals.hypertension
      || diseaseSignals.diabetes
      || (hasLightIssue && hasLongLookbackEvidence)
      || (events.hasLongMedication && !events.hasAdmissionSurgery && !events.hasMajorDisease)
    ),
    reason: '만성질환 투약 또는 경증 유병자 단서가 있어 3.10.5 상품군을 비교합니다.',
    nextCheck: '10년 자료가 없으면 3.10.5 확정 추천은 보류하고 고객 문진으로 보완하세요.'
  },
  {
    code: '3.10.5.5',
    label: '당뇨 추가고지형',
    category: '간편고지',
    priority: 83,
    strictLookback: true,
    when: ({ diseaseSignals }) => diseaseSignals.diabetes,
    reason: '당뇨 진단/투약 단서가 있어 당뇨 추가고지형을 별도 비교합니다.',
    nextCheck: '합병증, 인슐린, 최근 HbA1c/혈당 수치와 입원 이력을 확인하세요.'
  },
  {
    code: '3.10.10',
    label: '10년형 중증/수술 이력 간편고지',
    category: '간편고지',
    priority: 90,
    strictLookback: true,
    when: ({ events, diseaseSignals }) => (
      events.hasMajorDisease
      || events.hasAdmissionSurgery
      || diseaseSignals.cancer
      || diseaseSignals.ischemicHeart
      || diseaseSignals.cerebrovascular
      || diseaseSignals.arrhythmia
      || diseaseSignals.heartFailure
    ),
    reason: '중대질환, 심뇌혈관/부정맥, 입원/수술 이력 가능성이 있어 10년형 간편고지를 검토합니다.',
    nextCheck: '10년 내 진단, 입원, 수술, 계속 치료, 후유증 여부를 분리해서 확인하세요.'
  }
];

function polibotDisclosureRuleReviews(context = {}, rule = {}, requiredMonths = 0) {
  const reviews = [];
  const windowReview = polibotDisclosureWindowReview(context.events, requiredMonths);
  if (windowReview) reviews.push(windowReview);
  if (rule.strictLookback && requiredMonths >= 120 && !context.hasLongLookbackEvidence) {
    reviews.push({
      status: 'needs_review',
      reasonCode: 'long_lookback_unconfirmed',
      reason: '10년형 고지 코드는 현재 입력 자료만으로 확정하지 않고, 10년 내 진단·입원·수술·계속치료·투약 문진을 별도 확인해야 합니다.'
    });
  }
  return reviews.filter((review, index, list) => review?.reasonCode && list.findIndex((row) => row.reasonCode === review.reasonCode) === index);
}

function buildPolibotDisclosureCodeAssessments(profile = {}) {
  const context = polibotDisclosureRuleContext(profile);
  const profileRecent3Review = polibotDisclosureRecent3MonthReview(profile, context.events);
  return POLIBOT_DISCLOSURE_RULES
    .map((rule) => {
      if (!rule.when(context)) return null;
      const requiredMonths = polibotDisclosureCodeRequiredMonths(rule.code);
      const reviews = [profileRecent3Review, ...polibotDisclosureRuleReviews(context, rule, requiredMonths)].filter(Boolean);
      const blockers = reviews.map((review) => review.reason).filter(Boolean);
      const score = Math.max(35, Math.min(100, Number(rule.priority || 70) - blockers.length * 12));
      const status = blockers.length ? 'needs_review' : score >= 82 ? 'recommended' : 'compare';
      const reviewReasonCodes = reviews.map((review) => review.reasonCode).filter(Boolean);
      const statusLabel = status === 'recommended'
        ? '우선 추천'
        : status === 'compare'
          ? '비교 후보'
          : reviewReasonCodes.includes('long_lookback_unconfirmed')
            ? '가입 가능성 있음 · 심사 확인'
            : '검수 필요';
      return {
        code: rule.code,
        label: rule.label,
        category: rule.category,
        status,
        statusLabel,
        confidence: score,
        requiredMonths,
        reason: blockers.length ? `${rule.reason} ${blockers.join(' ')}` : rule.reason,
        baseReason: rule.reason,
        blockers,
        nextCheck: rule.nextCheck,
        diseaseTags: context.diseaseSignals.labels || [],
        reviewReasonCodes
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
}

function polibotMedicalRisk(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const disclosureText = '';
  const family = String(profile.familyHistory || '').trim();
  const text = `${medical} ${disclosureText} ${family}`;
  const events = extractPolibotMedicalEvents(profile);
  if (!medical && !disclosureText) return { level: 'unknown', label: '고지 확인 필요', reasons: ['최근 3개월/1년/5년 고지와 현재 투약 여부를 확인해야 해요.'] };
  if (/없음|무|해당\s*없/i.test(`${medical} ${disclosureText}`) && !/있음|예|수술|입원|투약|치료|진단|검사|추적|관찰/i.test(disclosureText)) {
    return {
      level: 'low',
      label: '고지 리스크 낮음',
      severity: 'low',
      underwritingBias: 'standard_first',
      routeHint: '표준심사 우선',
      reasons: ['입력상 병력/고지 이슈가 없어요.'],
      flags: [],
      questions: ['최근 건강검진에서 추가검사 소견이 없었는지만 최종 확인하세요.']
    };
  }
  const reasons = [];
  const flags = [];
  if (/고혈압|혈압/i.test(text)) flags.push({ key: 'hypertension', label: '고혈압/혈압', risk: 'moderate', question: '최근 혈압 수치, 복용 약, 합병증 여부를 확인해야 합니다.' });
  if (/당뇨/i.test(text)) flags.push({ key: 'diabetes', label: '당뇨', risk: 'high', question: '당화혈색소, 인슐린 사용 여부, 합병증 여부를 확인해야 합니다.' });
  if (/고지혈|콜레스테롤|지질/i.test(text)) flags.push({ key: 'dyslipidemia', label: '고지혈/지질', risk: 'moderate', question: '복용 약과 심혈관 합병증 동반 여부를 확인해야 합니다.' });
  if (events.hasAdmissionSurgery) flags.push({ key: 'recent_admission_surgery', label: '입원/수술/시술', risk: 'high', question: '최근 5년 이력인지, 완치/추적관찰 여부를 확인해야 합니다.' });
  if (events.hasFollowup) flags.push({ key: 'followup_exam', label: '추적검사/결절/소견', risk: 'high', question: '최근 3개월 추가검사 소견과 최종 진단명을 확인해야 합니다.' });
  if (events.hasMajorDisease) flags.push({ key: 'major_disease', label: '암/심뇌혈관 이력', risk: 'high', question: '진단 시점, 치료 종료일, 재발/전이/후유증 여부를 확인해야 합니다.' });
  if (events.hasHealthyTreatmentThreshold) flags.push({ key: 'healthy_treatment_7', label: '7회 이상 치료', risk: 'high', question: '건강체 고지 기준의 7회 이상 치료 해당 여부와 같은 질환 반복 치료인지 확인해야 합니다.' });
  if (events.hasHealthyMedicationThreshold) flags.push({ key: 'healthy_medication_30', label: '30일 이상 투약', risk: 'high', question: '약제정보 기준 처방일수와 현재 복용 여부를 확인해야 합니다.' });
  if (/디스크|관절|허리|목/i.test(text)) flags.push({ key: 'musculoskeletal', label: '근골격계', risk: 'moderate', question: '부담보 가능성이 있어 부위, 치료 기간, 현재 증상을 확인해야 합니다.' });
  if (events.hasLongMedication || /치료|진단/i.test(text)) flags.push({ key: 'medication_treatment', label: '투약/치료/진단', risk: 'moderate', question: '투약 기간과 현재 치료 지속 여부를 확인해야 합니다.' });
  if (/암|심장|뇌|당뇨/i.test(family)) flags.push({ key: 'family_history', label: '가족력', risk: 'reference', question: '가족력은 본인 병력과 분리해 관련 담보 니즈와 고지 질문 해당 여부만 확인합니다.' });
  if (events.reasons.length || /치료|진단|고혈압|당뇨|고지혈|디스크|암|심장|뇌/i.test(text)) {
    reasons.push('병력/투약/검사 이력이 있어 표준체, 할증, 부담보, 간편심사 여부를 비교해야 해요.');
  }
  if (/암|심장|뇌|당뇨/i.test(family)) reasons.push('가족력 때문에 관련 담보 인수 기준을 확인하는 편이 좋아요.');
  const hasHigh = flags.some((item) => item.risk === 'high');
  const severity = hasHigh ? 'high' : flags.length ? 'moderate' : 'unknown';
  return {
    level: 'review',
    label: severity === 'high' ? '고지 심사 강함' : '고지 심사 필요',
    severity,
    underwritingBias: severity === 'high' ? 'simple_or_conditional' : 'standard_compare',
    routeHint: severity === 'high' ? '간편심사/조건부 인수 우선 비교' : '표준심사와 간편심사 동시 비교',
    reasons: reasons.length ? reasons : ['병력 상세가 있어 인수 가능 여부 확인이 필요해요.'],
    flags,
    questions: flags.map((item) => item.question).slice(0, 6)
  };
}

function buildPolibotManagerCodeRecommendations(profile = {}) {
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const events = extractPolibotMedicalEvents(profile);
  const medical = polibotUnderwritingMedicalText(profile);
  const needs = Array.isArray(profile.needs) ? profile.needs : normalizeList(profile.needs);
  const text = [
    medical,
    Object.values(disclosure).filter(Boolean).join(' '),
    String(profile.existingMedicalPlan || ''),
    String(profile.underwritingAssessment?.route || '')
  ].join(' ');
  const add = (items, item) => {
    if (!item?.code || items.some((row) => row.code === item.code)) return items;
    items.push({
      status: item.status || 'review',
      severity: item.severity || (item.status === 'applied' ? 'info' : 'medium'),
      source: item.source || '설계매니저 기준',
      ...item
    });
    return items;
  };
  const items = [];
  const numberAfter = (pattern) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : null;
  };
  const outpatientDays = numberAfter(/외래\s*(\d+)\s*일/);
  const pharmacyCount = numberAfter(/약국\s*(\d+)\s*건/);
  const medicalCount = numberAfter(/의료기관\s*(\d+)\s*건/);
  const treatmentCount = events.treatmentCount || numberAfter(/치료횟수\s*(\d+)\s*회/);
  const medicationDays = events.medicationDays || numberAfter(/투약일수\s*(\d+)\s*일/);
  const hiraDocumentTypes = events.hiraDocumentTypes || [];

  if (/심평원\s*5년|의료기관\/약국\s*이용/.test(text)) {
    add(items, {
      code: 'HIRA-5Y-REVIEW',
      label: '심평원 5년 이력 확인',
      reason: '심평원 자료가 들어왔으므로 3개월/1년/5년 고지 질문과 실제 청구 이력을 분리해 확인해야 합니다.',
      status: 'applied',
      severity: 'info',
      source: '심평원 자료'
    });
  }
  if (hiraDocumentTypes.length >= 2) {
    add(items, {
      code: 'HIRA-MULTI-SOURCE',
      label: '심평원 다중자료 반영',
      reason: `심평원 ${hiraDocumentTypes.join(', ')}가 함께 들어와 치료횟수와 투약일수를 같이 봅니다.`,
      status: 'applied',
      severity: 'info',
      source: '심평원 자료'
    });
  } else if (events.hasHira) {
    if (!hiraDocumentTypes.includes('기본진료정보')) {
      add(items, {
        code: 'HIRA-BASIC-MISSING',
        label: '기본진료정보 추가 필요',
        reason: '치료횟수와 외래/입원 기준 확인을 위해 기본진료정보 자료를 추가하면 정확도가 올라갑니다.',
        status: 'review',
        source: '심평원 자료'
      });
    }
    if (!hiraDocumentTypes.includes('약제정보')) {
      add(items, {
        code: 'HIRA-PHARMACY-MISSING',
        label: '약제정보 추가 필요',
        reason: '30일 이상 투약 여부를 잡으려면 약제정보 자료가 필요합니다.',
        status: 'review',
        source: '심평원 자료'
      });
    }
  }
  if (events.hasHealthyTreatmentThreshold) {
    add(items, {
      code: 'HEALTHY-TREATMENT-7',
      label: '건강체 7회 치료 확인',
      reason: `치료횟수 ${treatmentCount || 7}회 기준으로 건강체 7회 이상 치료 고지 해당 여부를 확인해야 합니다.`,
      status: 'review',
      severity: 'high',
      source: '심평원 자료'
    });
  }
  if (events.hasHealthyMedicationThreshold) {
    add(items, {
      code: 'HEALTHY-MEDICATION-30',
      label: '건강체 30일 투약 확인',
      reason: `투약일수 ${medicationDays || 30}일 기준으로 건강체 30일 이상 투약 고지 해당 여부를 확인해야 합니다.`,
      status: 'review',
      severity: 'high',
      source: '심평원 자료'
    });
  }
  if (events.hasSustainedMedicationReview) {
    add(items, {
      code: 'HIRA-SUSTAINED-MEDICATION',
      label: '상병별 지속투약 확인',
      reason: [
        medicationDays ? `투약일수 ${medicationDays}일` : '투약 이력',
        (events.sustainedMedicationTags || []).length ? `${events.sustainedMedicationTags.join(', ')} 단서` : '상병/약제정보 단서',
        '같은 투약일수라도 ADHD, 성조숙증, 정신/내분비 계열은 현재 복용과 치료 지속 여부에 따라 건강체/간편심사 판단이 달라질 수 있습니다.'
      ].filter(Boolean).join(' · '),
      status: 'review',
      severity: 'high',
      source: '심평원 상병/약제정보'
    });
  }
  const exceptionMatches = Array.isArray(profile.exceptionDiseaseMatches) ? profile.exceptionDiseaseMatches : buildPolibotExceptionDiseaseMatches(profile);
  if (exceptionMatches.length) {
    const top = exceptionMatches[0];
    add(items, {
      code: 'EXCEPTION-DISEASE-MATCH',
      label: '예외질환 대조 확인',
      reason: [
        `${exceptionMatches.length}개 예외질환 후보`,
        top.company && `${top.company} ${top.kcdCode || ''} ${top.diseaseName || ''}`.trim(),
        top.conditionText && compactPolibotText(top.conditionText, 120)
      ].filter(Boolean).join(' · '),
      status: top.recommendationImpact === 'exception_candidate' ? 'applied' : 'review',
      severity: top.recommendationImpact === 'restricted_candidate' ? 'high' : 'medium',
      source: '예외질환 리스트'
    });
  }
  if ((Number.isFinite(pharmacyCount) && pharmacyCount >= 3) || /약국\s*청구|약국\s*이력|약국\s*이용/.test(text)) {
    add(items, {
      code: 'HIRA-PHARMACY-MULTI',
      label: '약국 청구 다수',
      reason: pharmacyCount ? `약국 청구 ${pharmacyCount}건이 확인되어 처방일수와 현재 복용 여부를 확인해야 합니다.` : '약국 청구 이력이 있어 약명, 처방일수, 현재 복용 여부를 확인해야 합니다.',
      status: 'review',
      source: '심평원 자료'
    });
  }
  if (Number.isFinite(outpatientDays) && outpatientDays >= 10) {
    add(items, {
      code: 'HIRA-OUTPATIENT-MANY',
      label: '외래 이용 다수',
      reason: `외래 ${outpatientDays}일 이력이 있어 같은 질환의 반복 치료인지 확인해야 합니다.`,
      status: 'review',
      source: '심평원 자료'
    });
  }
  if (Number.isFinite(medicalCount) && medicalCount >= 10) {
    add(items, {
      code: 'HIRA-MEDICAL-MULTI',
      label: '의료기관 이용 다수',
      reason: `의료기관 이용 ${medicalCount}건이 확인되어 진료과별 반복 방문 여부를 확인해야 합니다.`,
      status: 'review',
      source: '심평원 자료'
    });
  }
  if (/정형외과|한방병원|관절|허리|목|디스크|염좌/.test(events.positiveText || text)) {
    add(items, {
      code: 'UW-MUSCULOSKELETAL',
      label: '근골격계 부담보 확인',
      reason: '정형외과/한방병원 또는 근골격계 단서가 있어 부위 부담보 가능성을 확인해야 합니다.',
      status: 'review',
      source: '심평원/고지 자료'
    });
  }
  if (/내과|고혈압|혈압|당뇨|고지혈|콜레스테롤|지질/.test(events.positiveText || text)) {
    add(items, {
      code: 'UW-INTERNAL-MED',
      label: '내과성 질환 고지 확인',
      reason: '내과성 질환 또는 관련 진료과 단서가 있어 만성질환 투약 여부를 확인해야 합니다.',
      status: 'review',
      source: '심평원/고지 자료'
    });
  }
  if (events.hasFollowup) {
    add(items, {
      code: 'UW-FOLLOWUP-EXAM',
      label: '추가검사/추적관찰 확인',
      reason: '추가검사, 재검사, 추적관찰 단서가 있어 3개월/1년 고지 해당 여부를 확인해야 합니다.',
      status: 'review',
      severity: 'high',
      source: '고지 자료'
    });
  }
  if (events.hasAdmissionSurgery) {
    add(items, {
      code: 'UW-ADMISSION-SURGERY',
      label: '입원/수술 이력 확인',
      reason: '입원/수술/시술 이력이 있어 최근 5년 고지와 완치 여부 확인이 필요합니다.',
      status: 'review',
      severity: 'high',
      source: '고지 자료'
    });
  }
  if (String(profile.existingMedicalPlan || '').trim() && String(profile.existingMedicalPlan || '').trim() !== '없음') {
    add(items, {
      code: 'MEDPLAN-DUP',
      label: '기존 실손 중복 확인',
      reason: '기존 실손이 있어 새 실손/의료비 담보 추천 전 중복 여부를 확인해야 합니다.',
      status: 'review',
      source: '보장분석 자료'
    });
  }
  if (needs.includes('수술')) {
    add(items, {
      code: 'NEED-SURGERY',
      label: '수술비 보완 우선',
      reason: '필요 보장에 수술이 있어 질병/상해 수술비와 기존 담보 중복을 우선 비교합니다.',
      status: 'applied',
      severity: 'info',
      source: '보장분석 자료'
    });
  }
  if (/간편|유병|고지\s*심사|표준\/간편|표준심사와 간편심사|조건부|당뇨|고혈압|부담보|할증/.test(events.positiveText || text) || events.hasLongMedication || items.some((item) => item.severity === 'high')) {
    add(items, {
      code: 'ROUTE-SIMPLE-COMPARE',
      label: '표준/간편 동시 비교',
      reason: '고지 이슈가 있어 표준심사 단독보다 간편심사 또는 조건부 인수 가능성을 함께 비교합니다.',
      status: 'applied',
      severity: 'high',
      source: '설계매니저 기준'
    });
  }
  if (!items.length && /없음|해당\s*없/.test(text)) {
    add(items, {
      code: 'ROUTE-STANDARD-FIRST',
      label: '표준심사 우선',
      reason: '입력상 고지 이슈가 낮아 간편심사보다 표준심사를 먼저 비교합니다.',
      status: 'applied',
      severity: 'info',
      source: '설계매니저 기준'
    });
  }
  return items.slice(0, 12);
}

function codeContext(text = '', index = 0, length = 0) {
  return String(text || '').slice(Math.max(0, index - 48), Math.min(String(text || '').length, index + length + 72)).replace(/\s+/g, ' ').trim();
}

function polibotCodeBoundary(text = '', index = 0, length = 0) {
  const value = String(text || '');
  return {
    before: value[index - 1] || '',
    after: value[index + length] || ''
  };
}

function hasPolibotMedicalContext(context = '') {
  return /진단|진료|질환|질병|상병|염좌|골절|고혈압|당뇨|폴립|선종|수술|입원|통원|약처방|투약|치료|검사|백내장|망막|전립선|황반|늑골|관절|무릎|발목|요추|대장|용종|고지/.test(context);
}

function hasPolibotDocumentNoiseContext(context = '') {
  return /보험|상품|GA|월호|페이지|고객제시불가|파일:|보험료|가입설계/.test(context);
}

function isPolibotLikelyDateOrAmount(value = '', context = '') {
  const code = String(value || '').trim();
  if (/^(19|20)\d{2}$/.test(code)) return true;
  if (/^\d{6,8}$/.test(code)) return true;
  if (/\d{4}[-./]\d{1,2}|\d{1,3}(?:,\d{3})원|만원|세|회|일/.test(context) && !/코드|번호|담보|특약|상병|질병/.test(context)) return true;
  return false;
}

function normalizePolibotDisclosureCode(raw = '') {
  const value = String(raw || '').trim();
  const dottedParts = value.match(/^([35])\.(\d{1,2})\.(\d{1,2})(?:\.(\d{1,2}))?$/);
  if (dottedParts) return [dottedParts[1], Number(dottedParts[2]), Number(dottedParts[3]), dottedParts[4] ? Number(dottedParts[4]) : ''].filter((part) => part !== '').join('.');
  const compact = value.match(/^3(\d{1,2})(\d{2})$/);
  if (compact) return `3.${Number(compact[1])}.${Number(compact[2])}`;
  const shorthand = {
    305: '3.0.5',
    315: '3.1.5',
    310: '3.1.0',
    325: '3.2.5',
    333: '3.3.3',
    335: '3.3.5',
    345: '3.4.5',
    355: '3.5.5',
    3105: '3.10.5',
    31010: '3.10.10',
    5105: '5.10.5',
    51010: '5.10.10'
  };
  if (shorthand[value]) return shorthand[value];
  return '';
}

function isPolibotStandaloneCode(text = '', index = 0, length = 0) {
  const { before, after } = polibotCodeBoundary(text, index, length);
  return !/[A-Za-z0-9가-힣]/.test(before) && !/[A-Za-z0-9가-힣]/.test(after);
}

function addPolibotActualCode(items, item = {}) {
  const code = String(item.code || '').trim().toUpperCase();
  if (!code || items.some((row) => row.code === code && row.kind === item.kind)) return;
  items.push({
    code,
    kind: item.kind || 'code',
    label: item.label || code,
    status: item.status || 'review',
    source: item.source || '고객 자료',
    reason: item.reason || '자료에서 실제 코드 후보로 확인됐습니다.',
    context: item.context || '',
    confidence: item.confidence || 70,
    requiredMonths: item.requiredMonths || 0,
    reviewReasonCode: item.reviewReasonCode || '',
    reviewReasonCodes: Array.isArray(item.reviewReasonCodes) ? item.reviewReasonCodes : []
  });
}

function buildPolibotRecommendedDisclosureCodes(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const routeText = String(profile.underwritingAssessment?.route || '').trim();
  const rawMedical = String(profile.medicalHistory || '').trim();
  const explicitNoMedical = /^(없음|무|해당\s*없음?|이상\s*없음?|문제\s*없음?|특이\s*사항\s*없음?)$/i.test(String(rawMedical || medical || '').trim());
  if (!medical && !explicitNoMedical) return [];
  const text = normalizePolibotMatchText([
    medical,
    profile.familyHistory,
    routeText,
    profile.underwritingAssessment?.note,
    profile.underwritingAssessment?.simpleReview
  ].filter(Boolean).join(' '));
  const events = extractPolibotMedicalEvents(profile);
  const items = [];
  const add = (item = {}) => {
    if (!item.code || items.some((row) => row.code === item.code)) return;
    const recentReview = polibotDisclosureRecent3MonthReview(profile, events);
    const requiredMonths = item.requiredMonths || polibotDisclosureCodeRequiredMonths(item.code);
    const matchedRule = POLIBOT_DISCLOSURE_RULES.find((rule) => rule.code === item.code);
    const ruleReviews = matchedRule
      ? polibotDisclosureRuleReviews(polibotDisclosureRuleContext(profile), matchedRule, requiredMonths)
      : [polibotDisclosureWindowReview(events, requiredMonths)].filter(Boolean);
    const reviews = [recentReview, ...ruleReviews].filter(Boolean);
    const reasonCodes = reviews.map((review) => review.reasonCode).filter(Boolean);
    const finalStatus = reviews.length ? 'needs_review' : item.status || 'recommended';
    items.push({
      kind: 'disclosure_recommendation',
      label: '추천 간편고지 유형',
      source: '설계매니저 산출',
      confidence: 78,
      context: medical.slice(0, 240),
      ...item,
      status: finalStatus,
      reviewReasonCodes: reasonCodes,
      reviewReasonCode: reasonCodes[0] || '',
      reason: reviews.length ? `${item.reason || ''} ${reviews.map((review) => review.reason).join(' ')}`.trim() : item.reason
    });
  };
  const hasHira = events.hasHira;
  const noMedical = explicitNoMedical && !hasHira && !events.hasAdmissionSurgery && !events.hasLongMedication && !events.hasFollowup && !events.hasMajorDisease && !events.hasChronicDisease;
  const hasChronicMedication = events.hasLongMedication;
  const hasFollowup = events.hasFollowup;
  const hasAdmissionSurgery = events.hasAdmissionSurgery;
  const hasMajor = events.hasMajorDisease;
  const diseaseSignals = events.diseaseSignals || polibotDiseaseSignals(profile);
  const hasHypertensionDiabetes = diseaseSignals.hypertension || diseaseSignals.diabetes || /고혈압|혈압|당뇨/.test(text);
  const hasLongWindow = /10년|십년|장기|30일|7일|입원일수|수술일|치료\s*종료|완치/.test(text);
  const hasLightIssue = (
    events.hasLightHiraUse
    || (/경증|초경증|용종|결절|검진|외래|통원|약국|처방/.test(text) && !hasMajor && !hasAdmissionSurgery && !hasChronicMedication)
  );
  const hasLongLookbackEvidence = (events.coverageWindowMonths || 0) >= 120 || /10년|십년/.test(text);

  if (hasMajor || (hasAdmissionSurgery && hasLongWindow)) {
    add({
      code: '3.10.10',
      reason: '중대질환 또는 입원/수술 이력 가능성이 있어 10년형 간편고지까지 산출 후보로 둡니다.',
      requiredMonths: 120,
      confidence: hasMajor ? 88 : 82
    });
  }
  if ((hasLightIssue && hasLongLookbackEvidence) || (hasChronicMedication && !hasAdmissionSurgery && !hasMajor)) {
    add({
      code: '3.10.5',
      reason: hasLightIssue
        ? '경증/초경증 또는 외래·처방 중심 단서가 있어 서버 코드표의 3.10.5 간편고지 후보를 함께 봅니다.'
        : '만성질환 투약 단서가 있으나 중대/입원 이력이 약해 3.10.5 경증 유병자 후보를 비교합니다.',
      requiredMonths: 120,
      confidence: hasLightIssue ? 84 : 80
    });
  }
  if (hasAdmissionSurgery || hasChronicMedication) {
    add({
      code: '3.5.5',
      reason: hasAdmissionSurgery
        ? '입원/수술/시술 단서가 있어 최근 5년 고지형 산출을 우선 후보로 둡니다.'
        : '만성질환 투약 또는 처방 단서가 있어 5년형 간편고지 산출을 우선 후보로 둡니다.',
      requiredMonths: 60,
      confidence: hasChronicMedication ? 86 : 82
    });
  }
  if (hasFollowup || events.hasLightHiraUse) {
    add({
      code: '3.3.5',
      reason: hasFollowup
        ? '검사/재검/추적관찰 단서가 있어 3개월·3년·5년 질문형을 비교 후보로 둡니다.'
        : '심평원/진료 이력은 있으나 중대 병력 단서가 약해 3.3.5 비교 후보로 둡니다.',
      requiredMonths: 60,
      confidence: hasFollowup ? 80 : 74
    });
  }
  if ((hasFollowup || events.hasLightHiraUse) && !hasAdmissionSurgery && !hasMajor && !hasChronicMedication) {
    add({
      code: '3.2.5',
      reason: '입원/수술/장기투약 단서가 약한 경증 외래·검사 중심 자료라 3.2.5 초경증 후보도 비교합니다.',
      requiredMonths: 60,
      confidence: 72
    });
  }
  if (noMedical) {
    add({
      code: '5.10.5',
      reason: '입력상 병력 이슈가 낮아 건강고지/우량체 계열 후보를 우선 비교합니다.',
      confidence: 78
    });
    add({
      code: '5.5.5',
      reason: '표준·건강고지 가능 고객이면 5.5.5 계열도 보험료 비교 후보로 둡니다.',
      confidence: 72
    });
  }
  if (diseaseSignals.diabetes || (hasHypertensionDiabetes && /당뇨고지|당뇨\s*고지|합병증|인슐린/.test(text))) {
    add({
      code: '3.10.5.5',
      reason: '당뇨 진단/투약 또는 당뇨 고지 단서가 있어 3.10.5.5 당뇨고지형을 별도 후보로 둡니다.',
      confidence: 82
    });
  }
  buildPolibotDisclosureCodeAssessments(profile)
    .filter((item) => ['recommended', 'compare', 'needs_review'].includes(item.status))
    .forEach((item) => {
      add({
        code: item.code,
        status: item.status,
        reason: `${item.statusLabel}: ${item.baseReason}`,
        requiredMonths: item.requiredMonths,
        confidence: item.confidence
      });
    });
  return items;
}

function buildPolibotActualCodes(profile = {}) {
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const disclosureText = Object.values(disclosure)
    .map((value) => Array.isArray(value)
      ? value.map((item) => typeof item === 'object' ? [item.code, item.name, item.context].filter(Boolean).join(' ') : String(item || '')).join(' ')
      : String(value || ''))
    .filter(Boolean)
    .join('\n');
  const text = [
    String(profile.medicalHistory || ''),
    disclosureText,
    String(profile.existingPolicies || ''),
    String(profile.underwritingAssessment?.route || '')
  ].filter(Boolean).join('\n');
  const items = [];
  for (const match of text.matchAll(/\b([A-Z][0-9]{2}(?:\.[0-9A-Z]{1,2})?|[A-Z][0-9]{3})\b/gi)) {
    const raw = match[1] || '';
    const context = codeContext(text, match.index || 0, raw.length);
    const medicalContext = hasPolibotMedicalContext(context);
    if (hasPolibotDocumentNoiseContext(context) && !medicalContext) continue;
    addPolibotActualCode(items, {
      code: raw,
      kind: 'KCD',
      label: '상병/KCD 코드',
      source: /심평원|병원|약국|진료/.test(context) ? '심평원/병력 자료' : '고지 메모',
      reason: '상병 또는 KCD 형식 코드로 보여 고지 분류 확인이 필요합니다.',
      context,
      confidence: medicalContext ? 92 : 78
    });
  }
  const explicitPatterns = [
    /(?:보장|담보|특약|상병|질병|고지)\s*(?:코드|번호)\s*[:：#]?\s*(\d{2,5})\b/gi,
    /\b(\d{2,5})\s*번\s*(?:담보|보장|특약|상병|질병|고지|코드)\b/gi
  ];
  for (const pattern of explicitPatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1] || '';
      const context = codeContext(text, match.index || 0, raw.length);
      if (isPolibotLikelyDateOrAmount(raw, context)) continue;
      addPolibotActualCode(items, {
        code: raw,
        kind: 'numeric',
        label: '숫자 코드',
        source: '자료 내 코드 문맥',
        reason: '코드/번호 문맥에서 나온 숫자입니다. 금액이나 나이가 아닌지 최종 확인하세요.',
        context,
        confidence: /상병|질병|고지/.test(context) ? 82 : 74
      });
    }
  }
  const disclosurePatterns = [
    /\b([35]\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)\b/g,
    /\b(305|315|325|333|335|345|355|3105|31010|5105|51010|310)\b/g,
    /\b3(\d{1,2})(\d{2})\b/g
  ];
  for (const pattern of disclosurePatterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[0] || '';
      const code = normalizePolibotDisclosureCode(raw);
      const context = codeContext(text, match.index || 0, raw.length);
      if (!code) continue;
      if (!/간편|유병|고지|표준|심사/.test(context)) continue;
      if (/^(325|335|355|333|310)$/.test(code) && !isPolibotStandaloneCode(text, match.index || 0, raw.length)) continue;
      addPolibotActualCode(items, {
        code,
        kind: 'disclosure',
        label: '간편고지 유형',
        source: '고지 메모',
        reason: '간편고지 유형 숫자로 보여 표준/간편 비교 기준에 반영합니다.',
        context,
        confidence: code.includes('.') ? 90 : 80
      });
    }
  }
  buildPolibotRecommendedDisclosureCodes(profile).forEach((item) => {
    if (items.some((row) => row.code === item.code)) return;
    addPolibotActualCode(items, item);
  });
  return items.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0)).slice(0, 24);
}

function buildPolibotExceptionDiseaseMatches(profile = {}) {
  const { diseases } = polibotExceptionDiseaseData();
  if (!diseases.length) return [];
  const selectedCompany = String(profile.company || '').trim();
  const companyScoped = selectedCompany && selectedCompany !== '전체 보험사';
  const kcdCodes = polibotProfileKcdCodes(profile);
  const kcdBases = new Set(kcdCodes.map(polibotKcdBase).filter(Boolean));
  const terms = polibotExceptionDiseaseTerms(profile);
  const events = extractPolibotMedicalEvents(profile);
  const medicationDays = Number(events.medicationDays || 0);
  const admissionDays = Number(events.admissionDays || 0);
  const hasSurgery = Boolean(events.hasSurgery);
  const rawMatches = [];
  for (const item of diseases) {
    if (companyScoped && item.company && item.company !== selectedCompany) continue;
    const itemCode = normalizePolibotKcdCode(item.kcdCode);
    const itemBase = polibotKcdBase(itemCode);
    const exactCode = itemCode && kcdCodes.includes(itemCode);
    const baseCode = !exactCode && itemBase && kcdBases.has(itemBase);
    const nameHit = !exactCode && !baseCode && terms.some((term) => {
      const haystack = `${item.diseaseName || ''} ${(item.aliases || []).join(' ')}`;
      return term.length >= 2 && (haystack.includes(term) || term.includes(item.diseaseName || ''));
    });
    if (!exactCode && !baseCode && !nameHit) continue;
    const admissionLimit = Number(item.admissionDayLimit || 0);
    const conditionFlags = [
      admissionLimit && admissionDays ? admissionDays <= admissionLimit ? '입원일수 조건 범위 내' : `입원일수 ${admissionDays}일이 자료상 ${admissionLimit}일 기준 초과 가능` : '',
      item.hasSurgeryLimit && hasSurgery ? '수술 여부 조건 확인 필요' : '',
      medicationDays ? `투약일수 ${medicationDays}일은 예외질환 조건과 별도 확인 필요` : ''
    ].filter(Boolean);
    const score = Math.min(100,
      (exactCode ? 92 : baseCode ? 82 : 68)
      + (companyScoped ? 5 : 0)
      + (item.eligibilityLevel === 'immediate_accept' ? 3 : 0)
      - (item.eligibilityLevel === 'restricted' ? 12 : 0)
    );
    rawMatches.push({
      company: item.company || '',
      carrierType: item.carrierType || '',
      sourceFileName: item.sourceFileName || '',
      kcdCode: item.kcdCode || '',
      diseaseName: item.diseaseName || '',
      diseaseCategory: item.diseaseCategory || '',
      eligibilityLevel: item.eligibilityLevel || 'unknown',
      conditionText: item.conditionText || '',
      admissionDayLimit: item.admissionDayLimit || null,
      waitingPeriod: item.waitingPeriod || null,
      matchType: exactCode ? 'kcd_exact' : baseCode ? 'kcd_base' : 'name',
      confidence: score,
      conditionFlags,
      recommendationImpact: ['immediate_accept', 'acceptable'].includes(item.eligibilityLevel)
        ? 'exception_candidate'
        : ['review_or_conditional', 'conditional_immediate', 'mixed_by_coverage'].includes(item.eligibilityLevel)
          ? 'review_candidate'
          : item.eligibilityLevel === 'restricted' ? 'restricted_candidate' : 'unknown'
    });
  }
  return rawMatches
    .sort((a, b) => b.confidence - a.confidence || String(a.company).localeCompare(String(b.company), 'ko'))
    .filter((item, index, all) => all.findIndex((row) => row.company === item.company && row.kcdCode === item.kcdCode && row.diseaseName === item.diseaseName) === index)
    .slice(0, 20);
}

function buildPolibotConsultationSummary(profile = {}, consultationDraft = null, exceptionDiseaseMatches = []) {
  const coverageAnalysis = polibotCurrentCoverageAnalysis(profile);
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const events = extractPolibotMedicalEvents(profile);
  const medicalSummary = [
    events.hiraDocumentTypes?.length ? `심평원 자료: ${events.hiraDocumentTypes.join(', ')}` : '',
    events.treatmentCount ? `치료횟수 ${events.treatmentCount}회` : '',
    events.medicationDays ? `투약일수 ${events.medicationDays}일` : '',
    events.sustainedMedicationTags?.length ? `지속투약 확인: ${events.sustainedMedicationTags.join(', ')}` : '',
    events.diseaseSignals?.labels?.length ? `질환 신호: ${events.diseaseSignals.labels.join(', ')}` : ''
  ].filter(Boolean);
  const disclosureSummary = [
    disclosure.recent3Months && `3개월: ${disclosure.recent3Months}`,
    disclosure.recent1Year && `1년: ${disclosure.recent1Year}`,
    disclosure.recent5Years && `5년: ${compactPolibotText(disclosure.recent5Years, 160)}`,
    disclosure.currentMedication && `현재/장기 투약: ${compactPolibotText(disclosure.currentMedication, 160)}`,
    disclosure.admissionSurgery && `입원/수술: ${compactPolibotText(disclosure.admissionSurgery, 160)}`
  ].filter(Boolean);
  const exceptionSummary = exceptionDiseaseMatches.slice(0, 6).map((item) => [
    item.company,
    item.kcdCode,
    item.diseaseName,
    item.eligibilityLevel
  ].filter(Boolean).join(' · '));
  return {
    profile: {
      name: profile.name || '',
      birthdate: profile.birthdate || '',
      age: profile.age || '',
      gender: profile.gender || '',
      phone: profile.phone || ''
    },
    profileLabel: [
      profile.name || '고객명 미입력',
      profile.birthdate || '',
      profile.age ? `${profile.age}세` : '',
      profile.gender || ''
    ].filter(Boolean).join(' · '),
    purpose: profile.purpose || '',
    needs: Array.isArray(profile.needs) ? profile.needs : normalizeList(profile.needs),
    budget: profile.budget || '',
    existingCoverage: {
      summary: coverageAnalysis.summary,
      gaps: coverageAnalysis.gaps.slice(0, 8),
      duplicates: coverageAnalysis.duplicates.slice(0, 8),
      existingPremium: profile.existingPremium || '',
      existingMedicalPlan: profile.existingMedicalPlan || ''
    },
    medicalSummary,
    disclosureSummary,
    exceptionSummary,
    route: consultationDraft?.designManagerSummary?.route || '',
    missing: consultationDraft?.missing || [],
    nextQuestions: consultationDraft?.nextQuestions || [],
    createdAt: now()
  };
}

function polibotCoverageCodeQueries(profile = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : normalizeList(profile.needs);
  const medicalText = polibotUnderwritingMedicalText(profile);
  const diseaseSignals = polibotDiseaseSignals(profile);
  const actualDisclosureCodes = (Array.isArray(profile.actualCodes) ? profile.actualCodes : [])
    .map((item) => normalizePolibotDisclosureCode(item?.code || ''))
    .filter(Boolean);
  const text = [
    needs.join(' '),
    medicalText,
    profile.purpose,
    profile.analysisResult?.gaps,
    profile.analysisResult?.remodelList,
    ...(Array.isArray(profile.managerCodes) ? profile.managerCodes.map((item) => `${item.label || ''} ${item.reason || ''}`) : [])
  ].filter(Boolean).join(' ');
  const queries = new Set();
  needs.forEach((need) => {
    if (/암/.test(need)) ['암 진단비', '유사암', '항암치료'].forEach((item) => queries.add(item));
    if (/뇌/.test(need)) ['뇌혈관', '뇌졸중', '뇌출혈'].forEach((item) => queries.add(item));
    if (/심장|허혈|심근/.test(need)) ['허혈성심장', '급성심근경색', '심장질환'].forEach((item) => queries.add(item));
    if (/수술/.test(need)) ['수술비', '질병수술', '상해수술'].forEach((item) => queries.add(item));
    if (/입원/.test(need)) ['입원일당', '입원비'].forEach((item) => queries.add(item));
    if (/실손|실비/.test(need)) ['실손', '통원'].forEach((item) => queries.add(item));
    if (/간병|치매/.test(need)) ['간병', '치매'].forEach((item) => queries.add(item));
    if (/운전자/.test(need)) ['운전자', '교통사고처리지원금', '변호사선임비'].forEach((item) => queries.add(item));
    queries.add(need);
  });
  if (actualDisclosureCodes.length || /간편|유병|고지|당뇨|고혈압|고지혈|투약|치료|검사|입원|수술|처방|외래/.test(medicalText)) {
    queries.add('간편고지');
    queries.add('유병자');
  }
  diseaseSignals.queries.forEach((query) => queries.add(query));
  if (diseaseSignals.labels.length) {
    queries.add(`${diseaseSignals.labels.join(' ')} 간편고지`);
    queries.add(`${diseaseSignals.labels.join(' ')} 보장`);
  }
  if (diseaseSignals.cerebrovascular || diseaseSignals.ischemicHeart || diseaseSignals.arrhythmia || diseaseSignals.heartFailure) {
    queries.add('순환계 주요치료비');
    queries.add('심뇌혈관');
  }
  actualDisclosureCodes.forEach((code) => {
    queries.add(code);
    queries.add(`${code} 간편고지`);
  });
  (Array.isArray(profile.managerCodes) ? profile.managerCodes : []).forEach((item) => {
    const memo = `${item.code || ''} ${item.label || ''} ${item.reason || ''}`;
    if (/간편|유병|고지/.test(memo)) queries.add('간편고지');
    if (/건강고지|표준/.test(memo)) queries.add('건강고지');
  });
  if (/근골격|정형외과|허리|무릎|발목|골절|염좌/.test(text)) {
    queries.add('골절');
    queries.add('상해수술');
  }
  return [...queries].map((item) => String(item || '').trim()).filter(Boolean).slice(0, 28);
}

function polibotCoverageCodeContext(candidate = {}) {
  return String(candidate.context || '').replace(/\s+/g, ' ').trim();
}

function isNoisyPolibotCoverageCode(candidate = {}) {
  const code = String(candidate.code || '').trim();
  const context = polibotCoverageCodeContext(candidate);
  if (isNoisyPolibotCodeCandidate(candidate)) return true;
  if (!code) return true;
  if (/^\d$/.test(code)) return true;
  if (/^\d{1,2}$/.test(code)) return true;
  if (/^(310|325|333|335|355)$/.test(code)) return true;
  if (/[{(]?[A-F0-9]{8}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{12}[)}]?/i.test(context)) return true;
  if (/style\.visibility|visibility/i.test(context)) return true;
  if (/^(19|20)\d{2}$/.test(code)) return true;
  return false;
}

function inferPolibotCoverageCodeValue(candidate = {}, query = '') {
  const code = String(candidate.code || '').trim();
  const context = polibotCoverageCodeContext(candidate);
  const coverageKeywords = Array.isArray(candidate.coverageKeywords) ? candidate.coverageKeywords : [];
  const codeIndex = context.indexOf(code);
  const nearby = codeIndex >= 0
    ? context.slice(Math.max(0, codeIndex - 70), Math.min(context.length, codeIndex + code.length + 95))
    : context.slice(0, 160);
  const patterns = [
    new RegExp(`([가-힣A-Za-z0-9·ㆍ()/\\s]{1,38}${code}\\s*만(?:원)?)`),
    new RegExp(`([가-힣A-Za-z0-9·ㆍ()/\\s]{1,38}${code}\\s*천만(?:원)?)`),
    new RegExp(`([가-힣A-Za-z0-9·ㆍ()/\\s]{1,38}${code}\\s*억(?:원)?)`),
    new RegExp(`([가-힣A-Za-z0-9·ㆍ()/\\s]{0,28}${code}\\s*간편고지형)`),
    new RegExp(`(${code}\\s*간편고지(?:형|\\s*고당)?)`),
    /([가-힣A-Za-z0-9·ㆍ()/\s]{1,36}C코드\s*\d+\s*개)/,
    /([가-힣A-Za-z0-9·ㆍ()/\s]{1,44}(?:진단비|수술비|입원일당|입원비|치료비|생활비|통원보장|납입면제|후유장해|보장|특약|담보))/,
    /((?:암|유사암|뇌혈관|뇌졸중|뇌출혈|허혈성심장|급성심근경색|질병|상해|간병|치매|운전자)[가-힣A-Za-z0-9·ㆍ()/\s]{0,34})/
  ];
  for (const pattern of patterns) {
    const match = nearby.match(pattern);
    const value = String(match?.[1] || '').replace(/\s+/g, ' ').trim();
    if (value && value.length >= 2 && !/^\d+$/.test(value) && !/^(신규담보|특약|담보|보장)$/.test(value)) return value.slice(0, 70);
  }
  if (query) return query;
  return coverageKeywords.length ? coverageKeywords.slice(0, 3).join('/') : '보장 코드';
}

function compactPolibotMatchedCoverageCode(candidate = {}, query = '') {
  const connectedValue = inferPolibotCoverageCodeValue(candidate, query);
  const disclosureCode = normalizePolibotDisclosureCode(candidate.code || '');
  return {
    code: disclosureCode || String(candidate.code || '').trim(),
    label: connectedValue,
    connectedValue,
    kind: disclosureCode ? 'manager_code_candidate' : 'coverage',
    query,
    status: candidate.status || 'review_needed',
    source: candidate.fileName || 'polidoc',
    company: candidate.company || '',
    companies: Array.isArray(candidate.companies) ? candidate.companies.slice(0, 5) : [],
    productName: candidate.productName || '',
    productGroup: candidate.productGroup || '',
    coverageKeywords: Array.isArray(candidate.coverageKeywords) ? candidate.coverageKeywords.slice(0, 8) : [],
    context: String(candidate.context || '').replace(/\s+/g, ' ').trim().slice(0, 220),
    confidence: Number(candidate.score || candidate.confidence || 0),
    month: candidate.month || ''
  };
}

async function buildPolibotMatchedCoverageCodes(userId = '', profile = {}) {
  const queries = polibotCoverageCodeQueries(profile);
  if (!queries.length) return [];
  const blockedReviewReasonCodes = new Set(['recent3_missing', 'recent3_incomplete', 'recent3_medical_event']);
  const profileRecent3Review = polibotDisclosureRecent3MonthReview(profile, extractPolibotMedicalEvents(profile));
  const hasBlockingProfileDisclosureReview = profileRecent3Review && blockedReviewReasonCodes.has(profileRecent3Review.reasonCode);
  const allowedDisclosureCodes = new Set((Array.isArray(profile.actualCodes) ? profile.actualCodes : [])
    .filter((item) => {
      const reasonCodes = Array.isArray(item?.reviewReasonCodes) ? item.reviewReasonCodes : [item?.reviewReasonCode].filter(Boolean);
      if (reasonCodes.some((code) => blockedReviewReasonCodes.has(code))) return false;
      return item?.kind !== 'disclosure_recommendation' || item?.status !== 'needs_review';
    })
    .map((item) => normalizePolibotDisclosureCode(item?.code || ''))
    .filter(Boolean));
  const hasBlockingDisclosureReview = hasBlockingProfileDisclosureReview || (Array.isArray(profile.actualCodes) ? profile.actualCodes : [])
    .some((item) => {
      const reasonCodes = Array.isArray(item?.reviewReasonCodes) ? item.reviewReasonCodes : [item?.reviewReasonCode].filter(Boolean);
      return reasonCodes.some((code) => blockedReviewReasonCodes.has(code));
    });
  const hasAnyDisclosureCode = (Array.isArray(profile.actualCodes) ? profile.actualCodes : [])
    .some((item) => normalizePolibotDisclosureCode(item?.code || ''));
  const hasUnderwritingEvidence = Boolean(polibotUnderwritingMedicalText(profile));
  const batches = await Promise.all(queries.map(async (query) => {
    const rows = await searchPolibotCodeCandidates(userId, { query, limit: 16, includeChunks: true }).catch(() => []);
    return rows.map((row) => compactPolibotMatchedCoverageCode(row, query));
  }));
  const selected = [];
  for (const item of batches.flat().sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))) {
    if (isNoisyPolibotCoverageCode(item)) continue;
    if (item.kind === 'manager_code_candidate') {
      if (hasBlockingDisclosureReview) continue;
      if (hasAnyDisclosureCode && allowedDisclosureCodes.size === 0) continue;
      if (allowedDisclosureCodes.size === 0 && !hasUnderwritingEvidence) continue;
      if (allowedDisclosureCodes.size > 0 && !allowedDisclosureCodes.has(item.code)) continue;
    }
    const identity = [
      item.code,
      item.kind,
      item.company || (item.companies || [])[0] || '',
      item.productName || '',
      item.connectedValue || item.label || ''
    ].join('|');
    if (selected.some((row) => row.identity === identity)) continue;
    selected.push({ ...item, identity });
    if (selected.length >= 48) break;
  }
  const byDiversity = [];
  const bucketCounts = new Map();
  for (const item of selected) {
    const bucket = [item.code, item.kind].join('|');
    const count = bucketCounts.get(bucket) || 0;
    if (count >= 4 && item.kind === 'manager_code_candidate') continue;
    if (count >= 3 && item.kind !== 'manager_code_candidate') continue;
    bucketCounts.set(bucket, count + 1);
    byDiversity.push(item);
    if (byDiversity.length >= 32) break;
  }
  return byDiversity.map(({ identity, ...item }) => item);
}

function polibotDesignCodePriority(item = {}) {
  const code = normalizePolibotDisclosureCode(item.code || '') || String(item.code || '').trim();
  if (/^5\./.test(code)) return '건강고지 비교';
  if (/^3\./.test(code)) return item.kind === 'manager_code_candidate' ? '간편고지 비교' : '간편고지 근거';
  return ['암', '유사암/소액암', '뇌혈관', '심장', '수술비', '납입면제', '간편고지'].includes(polibotCoverageCodeCategory(item)) ? '우선 검토' : '보완 검토';
}

function polibotDesignCodeSourceLabel(item = {}) {
  if (item.kind === 'manager_code_candidate') return '설매 코드표';
  return item.source || 'polidoc';
}

function normalizePolibotDesignRecommendedCode(item = {}) {
  const category = polibotCoverageCodeCategory(item);
  return {
    code: normalizePolibotDisclosureCode(item.code || '') || String(item.code || '').trim(),
    connectedValue: item.connectedValue || item.label || item.productName || '보장 코드',
    category,
    company: item.company || (item.companies || [])[0] || '',
    productName: item.productName || '',
    productGroup: item.productGroup || '',
    priority: polibotDesignCodePriority(item),
    source: polibotDesignCodeSourceLabel(item),
    confidence: item.confidence || '',
    context: item.context || ''
  };
}

function groupPolibotDesignRecommendedCodes(items = []) {
  const groups = new Map();
  for (const item of items) {
    const key = [item.code, item.source].join('|');
    const current = groups.get(key);
    if (!current) {
      groups.set(key, {
        ...item,
        productCount: item.productName ? 1 : 0,
        companies: item.company ? [item.company] : [],
        productNames: item.productName ? [item.productName] : []
      });
      continue;
    }
    const companies = [...new Set([...(current.companies || []), item.company].filter(Boolean))];
    const productNames = [...new Set([...(current.productNames || []), item.productName].filter(Boolean))];
    groups.set(key, {
      ...current,
      company: companies.slice(0, 2).join(', '),
      productName: productNames[0] || current.productName || '',
      connectedValue: productNames.length > 1 ? `${productNames[0]} 외 ${productNames.length - 1}개` : current.connectedValue,
      productCount: productNames.length || current.productCount || 0,
      companies,
      productNames: productNames.slice(0, 5),
      confidence: Math.max(Number(current.confidence || 0), Number(item.confidence || 0)) || current.confidence || item.confidence || ''
    });
  }
  return [...groups.values()];
}

function polibotCodeEvidenceMatches(code = '', matchedCoverageCodes = []) {
  const normalized = normalizePolibotDisclosureCode(code) || String(code || '').trim();
  if (!normalized) return [];
  return (Array.isArray(matchedCoverageCodes) ? matchedCoverageCodes : [])
    .filter((item) => (normalizePolibotDisclosureCode(item?.code || '') || String(item?.code || '').trim()) === normalized)
    .map((item) => ({
      code: normalized,
      company: item.company || (item.companies || [])[0] || '',
      productName: item.productName || '',
      productGroup: item.productGroup || '',
      connectedValue: item.connectedValue || item.label || '',
      source: item.source || '',
      confidence: Number(item.confidence || 0),
      context: item.context || ''
    }))
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .filter((item, index, list) => list.findIndex((row) => row.company === item.company && row.productName === item.productName && row.source === item.source && row.connectedValue === item.connectedValue) === index)
    .slice(0, 5);
}

function enrichPolibotDisclosureAssessmentsWithEvidence(assessments = [], matchedCoverageCodes = []) {
  return (Array.isArray(assessments) ? assessments : []).map((item) => {
    const evidenceMatches = polibotCodeEvidenceMatches(item.code, matchedCoverageCodes);
    const bestEvidence = evidenceMatches[0] || {};
    return {
      ...item,
      evidenceMatches,
      evidenceSummary: evidenceMatches.length
        ? `${[...new Set(evidenceMatches.map((row) => row.company).filter(Boolean))].slice(0, 3).join(', ') || '서버 자료'} ${evidenceMatches.length}건 근거`
        : '',
      company: bestEvidence.company || '',
      productName: bestEvidence.productName || '',
      source: bestEvidence.source || ''
    };
  });
}

function formatPolibotReviewNeed(reason = '') {
  const text = String(reason || '').trim();
  if (!text) return '';
  return /확인\s*필요$|검수\s*필요$/.test(text) ? text : `${text} 확인 필요`;
}

function polibotPriceStrategy(profile = {}) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const purpose = String(profile.purpose || '').trim();
  const renewal = String(profile.renewalPreference || '').trim();
  const wantsSaving = /보험료\s*(절감|감액)/.test(purpose) || (Number.isFinite(target) && Number.isFinite(current) && target < current);
  const wantsUpgrade = /보장\s*강화|신규\s*가입|상속|노후|가족/.test(purpose) || (Number.isFinite(target) && Number.isFinite(current) && target > current);
  const remodel = /리모델링/.test(purpose);
  let mode = 'balanced';
  if (wantsSaving) mode = 'save';
  else if (wantsUpgrade) mode = 'upgrade';
  else if (remodel) mode = 'remodel';
  const label = {
    save: '보험료 감액 우선',
    upgrade: '보장 강화 우선',
    remodel: '기존 보험 재배치',
    balanced: '보장/보험료 균형'
  }[mode];
  const reasons = [
    Number.isFinite(target) && `목표 월 보험료 ${formatPolibotPremiumAmount(target)}`,
    Number.isFinite(current) && `현재 월 보험료 ${formatPolibotPremiumAmount(current)}`,
    renewal === '비갱신 선호' && '비갱신 선호로 초기 보험료 부담을 함께 봐야 해요.',
    renewal === '허용' && '갱신형 허용이라 같은 예산에서 보장 폭을 넓힐 수 있어요.',
    mode === 'save' && '비슷한 보장이면 보험료를 낮추는 후보를 우선 검토합니다.',
    mode === 'upgrade' && '보험료가 다소 높아도 핵심 진단비/간병/수술 보장을 두껍게 보는 후보를 우선 검토합니다.',
    mode === 'remodel' && '기존 보험과 중복되는 담보를 줄이고 부족 담보를 보완하는 관점입니다.'
  ].filter(Boolean);
  return { mode, label, targetPremium: Number.isFinite(target) ? formatPolibotPremiumAmount(target) : '', currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '', reasons };
}

function polibotPurposeAnalysis(profile = {}, { premiumFit = {}, medicalRisk = {}, coverageMatches = [], evidenceIntegrity = {} } = {}) {
  const purpose = String(profile.purpose || '').trim();
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const existingMedical = String(profile.existingMedicalPlan || '').trim();
  const renewal = String(profile.renewalPreference || '').trim();
  const matchedNeeds = coverageMatches.filter((item) => item.status === 'matched').length;
  const totalNeeds = coverageMatches.length;
  let mode = 'balanced';
  if (/보험료\s*(절감|감액)/.test(purpose)) mode = 'save';
  else if (/리모델링/.test(purpose)) mode = 'remodel';
  else if (/신규\s*가입/.test(purpose)) mode = 'new';
  else if (/보장\s*강화/.test(purpose)) mode = 'upgrade';

  const blockers = [];
  const successCriteria = [];
  const tradeoffs = [];
  const nextQuestions = [];
  let score = 62;

  if (mode === 'save') {
    successCriteria.push('기존 보장 중 유지할 담보를 정한 뒤 월 보험료 절감 가능성을 비교합니다.');
    if (Number.isFinite(target) && Number.isFinite(current) && target < current) {
      score += 14;
      successCriteria.push(`현재 ${formatPolibotPremiumAmount(current)}에서 목표 ${formatPolibotPremiumAmount(target)}로 낮추는 기준이 확인됩니다.`);
    } else {
      score -= 10;
      blockers.push('절감 목표가 현재 보험료보다 낮은지 숫자로 확인되지 않았습니다.');
    }
    if (premiumFit.level === 'within_budget' || premiumFit.level === 'reference_within_budget') score += 8;
    if (premiumFit.level === 'severe_over_budget' || premiumFit.level === 'reference_severe_over_budget') {
      score -= 16;
      blockers.push('절감 목적 대비 추천 후보 보험료가 크게 초과됩니다.');
    }
    if (premiumFit.level === 'estimate_needed') blockers.push('비교 보험료가 없어 실제 절감액을 계산할 수 없습니다.');
    tradeoffs.push('보험료를 낮추면 진단비, 입원일당, 수술비 한도가 줄 수 있습니다.');
    nextQuestions.push('절감해도 절대 줄이면 안 되는 담보와 최소 가입금액은 얼마인가요?');
  } else if (mode === 'upgrade') {
    successCriteria.push('보험료보다 암/뇌/심장/간병/수술 등 핵심 담보 보강을 우선합니다.');
    if (matchedNeeds >= Math.max(1, Math.ceil(totalNeeds * 0.6))) score += 12;
    else {
      score -= 12;
      blockers.push('입력한 핵심 보장 중 추천 상품과 직접 연결되는 항목이 부족합니다.');
    }
    if (Number.isFinite(target) && Number.isFinite(current) && target > current) score += 6;
    if (renewal === '비갱신 선호') tradeoffs.push('비갱신 선호라 초기 보험료가 높아질 수 있습니다.');
    nextQuestions.push('보험료가 올라가도 반드시 보강하고 싶은 1순위 담보는 무엇인가요?');
  } else if (mode === 'remodel') {
    successCriteria.push('기존 실손/기존 보험과 중복되는 담보를 정리하고 부족한 담보만 보완합니다.');
    if (existingMedical && existingMedical !== '없음') score += 8;
    else {
      score -= 10;
      blockers.push('기존 실손 또는 기존 보험 상세가 없어 중복 담보 판단이 제한됩니다.');
    }
    if (matchedNeeds > 0) score += 6;
    if (premiumFit.level === 'estimate_needed') blockers.push('리모델링 전후 보험료 차액 산출이 필요합니다.');
    if (premiumFit.level === 'severe_over_budget' || premiumFit.level === 'reference_severe_over_budget') blockers.push('리모델링 목표 보험료와 추천 후보 보험료 차이가 큽니다.');
    tradeoffs.push('기존 계약 해지 전 면책기간, 감액기간, 재가입 가능성을 반드시 확인해야 합니다.');
    nextQuestions.push('기존 증권의 담보별 가입금액, 갱신 여부, 납입기간을 확인했나요?');
  } else if (mode === 'new') {
    successCriteria.push('기본 진단비/입원/수술/실손/운전자 등 생활 리스크 순서로 빈 보장을 채웁니다.');
    if (matchedNeeds >= Math.max(1, Math.ceil(totalNeeds * 0.5))) score += 10;
    else {
      score -= 8;
      blockers.push('신규 가입의 기본 보장 우선순위와 추천 상품 연결이 약합니다.');
    }
    if (medicalRisk.level === 'low') score += 8;
    if (medicalRisk.level === 'review') tradeoffs.push('병력 때문에 표준형보다 간편심사/조건부 인수 가능성을 함께 봐야 합니다.');
    nextQuestions.push('처음 가입이라면 사망/진단비/실손/운전자 중 월 예산 안에서 우선순위를 어떻게 둘까요?');
  } else {
    successCriteria.push('보장 공백과 보험료 부담을 균형 있게 비교합니다.');
    if (matchedNeeds > 0) score += 6;
    nextQuestions.push('절감과 보장 강화 중 어느 쪽이 더 중요한가요?');
  }

  if (evidenceIntegrity.score < 62) {
    score -= 16;
    blockers.push('근거 정확도가 낮아 목적별 판단을 확정하기 어렵습니다.');
  } else if (evidenceIntegrity.score < 82) {
    score -= 8;
    blockers.push('일부 근거는 검수 후 최종 목적 적합도를 판단해야 합니다.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    mode,
    label: {
      save: '목적 적합도: 보험료 감액',
      upgrade: '목적 적합도: 보장 강화',
      remodel: '목적 적합도: 리모델링',
      new: '목적 적합도: 신규 가입',
      balanced: '목적 적합도: 균형 검토'
    }[mode],
    score,
    level: score >= 78 ? '높음' : score >= 58 ? '검수 필요' : '낮음',
    successCriteria,
    blockers,
    tradeoffs,
    nextQuestions
  };
}

function polibotCoverageMatch(catalogItems = [], profile = {}) {
  const itemText = catalogItems.map((item) => [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [
      group.plan,
      group.linkedSummary,
      ...(Array.isArray(group.coverages) ? group.coverages.flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount]) : [])
    ]) : [])
  ].filter(Boolean).join(' ')).join(' ');
  return (profile.needs || []).map((need) => {
    const terms = polibotNeedTerms(need);
    const matchedTerms = terms.filter((term) => term && itemText.includes(term));
    return {
      need,
      status: matchedTerms.length ? 'matched' : 'unconfirmed',
      label: matchedTerms.length ? '매칭' : '확인 필요',
      reason: matchedTerms.length
        ? `${matchedTerms.slice(0, 4).join(', ')} 관련 상품/담보/가입금액 근거가 확인돼요.`
        : '확정 자료에서 이 니즈와 직접 연결되는 담보 키워드가 약해요.'
    };
  });
}

function polibotCoveragePriority(profile = {}) {
  const age = polibotAgeValue(profile);
  const needs = profile.needs || [];
  return needs.map((need) => {
    let priority = '보통';
    let reason = '입력한 필요 보장입니다.';
    if (/암|뇌|심장/.test(need)) {
      priority = '높음';
      reason = '진단비 중심 핵심 보장이라 기존 가입금액과 보장 범위를 우선 확인해야 해요.';
    }
    if (/간병|치매|요양/.test(need)) {
      priority = age && age >= 50 ? '높음' : '보통';
      reason = '장기 유지와 지급 조건 차이가 커서 보장 개시 조건과 인정 기준 확인이 중요해요.';
    }
    if (/실손|실비/.test(need)) {
      priority = '중복 확인';
      reason = '기존 실손이 있으면 중복 가입/전환 가능성을 먼저 확인해야 해요.';
    }
    if (/유병자|간편/.test(need)) {
      priority = '심사 전략';
      reason = '병력 여부에 따라 일반심사와 간편심사의 보험료/보장 차이를 비교해야 해요.';
    }
    if (/운전자/.test(need)) {
      priority = '생활 리스크';
      reason = '운전 빈도와 벌금/변호사비/사고처리지원금 담보 구성을 확인해야 해요.';
    }
    return { need, priority, reason };
  });
}

function polibotUnderwritingChecklist(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = `${medical} ${profile.familyHistory || ''}`;
  const checks = [
    {
      key: 'recent_treatment',
      label: '최근 치료/투약',
      status: /수술|입원|치료|투약|약|진단|검사|추적|관찰/i.test(medical) ? '확인 필요' : medical ? '낮음' : '미확인',
      reason: medical ? `입력 병력: ${medical}` : '병력 입력이 없어 고지 질문을 먼저 확인해야 해요.'
    },
    {
      key: 'chronic_disease',
      label: '만성질환',
      status: /고혈압|당뇨|고지혈|심장|뇌|간염|신장|디스크/i.test(medical) ? '확인 필요' : '낮음',
      reason: /고혈압|당뇨|고지혈/i.test(medical)
        ? '복용 약, 조절 수치, 합병증 여부에 따라 인수 조건이 달라질 수 있어요.'
        : '만성질환 키워드는 뚜렷하지 않아요.'
    },
    {
      key: 'existing_medical',
      label: '기존 실손/중복',
      status: profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' ? '확인 필요' : profile.existingMedicalPlan === '없음' ? '낮음' : '미확인',
      reason: profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음'
        ? '기존 실손 가입 시기, 자기부담률, 전환 여부를 확인해야 해요.'
        : '기존 실손 여부가 없거나 미가입으로 입력됐어요.'
    },
    {
      key: 'family_history',
      label: '가족력',
      status: /암|심장|뇌|당뇨/i.test(profile.familyHistory || '') ? '확인 필요' : profile.familyHistory ? '낮음' : '미확인',
      reason: profile.familyHistory ? `입력 가족력: ${profile.familyHistory}` : '가족력이 미입력이라 주요 질환 가족력을 확인하면 좋아요.'
    }
  ];
  return checks;
}

function polibotDisclosureTimeline(profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = `${medical} ${profile.familyHistory || ''}`;
  const events = extractPolibotMedicalEvents(profile);
  const entries = [
    {
      key: '3m',
      label: '최근 3개월',
      status: (/3개월|최근|의심|소견|추가검사|재검|검사|진단|치료|투약/i.test(text) || events.hasAdmissionSurgery) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '질병확정진단, 질병의심소견, 치료, 입원, 수술, 투약, 추가검사 소견 여부를 확인합니다.'
    },
    {
      key: '1y',
      label: '최근 1년',
      status: /1년|재검|추가검사|검진|건강검진|추적/i.test(text) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '진찰 또는 건강검진 후 추가검사/재검사 이력이 있는지 확인합니다.'
    },
    {
      key: '2y',
      label: '최근 2년',
      status: (/2년/i.test(text) || events.hasAdmissionSurgery) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '간편심사에서 자주 보는 입원/수술 이력 기간입니다.'
    },
    {
      key: '5y',
      label: '최근 5년',
      status: (/5년|30일|7일|장기|고혈압|협심증|심근경색|심장판막|간경화|뇌졸중|당뇨|에이즈|HIV/i.test(text) || events.hasAdmissionSurgery || events.hasMajorDisease) ? '확인 필요' : medical ? '미해당 가능' : '미확인',
      reason: '입원, 수술, 7일 이상 치료, 30일 이상 투약, 주요 질병 이력을 확인합니다.'
    }
  ];
  return entries;
}

function polibotUnderwritingRoute(profile = {}, catalogItems = []) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = `${medical} ${profile.familyHistory || ''}`;
  const events = extractPolibotMedicalEvents(profile);
  const age = polibotAgeValue(profile);
  const hasNoEventHira = events.hasHira
    && !events.hasLightHiraUse
    && !events.hasAdmissionSurgery
    && !events.hasChronicDisease
    && !events.hasLongMedication
    && !events.hasFollowup
    && !events.hasMajorDisease
    && !events.hasHealthyTreatmentThreshold
    && !events.hasHealthyMedicationThreshold
    && !events.hasSustainedMedicationReview;
  const hasNoMedical = Boolean(medical)
    && (/^(없음|무|해당\s*없음?|이상\s*없음?|문제\s*없음?|특이\s*사항\s*없음?)$/i.test(medical.trim()) || hasNoEventHira)
    && !events.hasAdmissionSurgery
    && !events.hasChronicDisease
    && !events.hasLongMedication
    && !events.hasFollowup
    && !events.hasMajorDisease;
  const hasChronic = events.hasChronicDisease || /협심증|심근경색|뇌졸중|심장|간경화/i.test(text);
  const hasRecentRedFlag = /3개월|의심|소견|추가검사|재검|치료|투약|30일|7일/i.test(events.positiveText || text) || events.hasAdmissionSurgery || events.highRiskDepartment;
  const hasMajorDisease = events.hasMajorDisease;
  const productText = catalogItems.map((item) => `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')}`).join(' ');
  const hasSimpleProduct = /간편|유병|고지|325|335|355|310|3\.2\.5|3\.5\.5|3\.10/.test(productText);
  const hasSpecialProduct = /고혈압|당뇨|유병|간편/.test(productText);
  const hasNoUnderwritingProduct = /무심사|무고지|묻지\s*않/.test(productText);
  const routes = [];

  if (hasNoMedical) {
    routes.push({
      type: 'standard',
      label: '표준형/건강고지 우선',
      priority: 1,
      status: '우선 검토',
      reason: '입력상 병력 이슈가 없으므로 간편심사보다 일반/건강고지 상품을 먼저 비교해야 보험료 과다를 피할 수 있어요.'
    });
  } else if ((hasChronic || events.hasLongMedication) && !events.hasAdmissionSurgery && !hasMajorDisease) {
    routes.push({
      type: 'chronic_special',
      label: '고혈압/당뇨 등 특화 또는 간편심사',
      priority: 1,
      status: hasSpecialProduct || hasSimpleProduct ? '우선 검토' : '상품 확인 필요',
      reason: '만성질환 투약 이력이 있으면 일반심사 거절/할증 가능성이 있어 특화형이나 간편심사 후보를 먼저 봅니다.'
    });
    routes.push({
      type: 'standard',
      label: '표준형 재도전',
      priority: 2,
      status: '비교 검토',
      reason: '조절 수치가 안정적이고 합병증이 없으면 일반심사가 더 저렴할 수 있어 병행 비교가 필요해요.'
    });
  } else if (hasRecentRedFlag || hasMajorDisease) {
    routes.push({
      type: 'simple',
      label: '간편심사 우선',
      priority: 1,
      status: hasSimpleProduct ? '우선 검토' : '상품 확인 필요',
      reason: '최근 치료/투약/입원/수술 또는 주요 질병 이력이 있으면 표준형보다 간편고지 통과 가능성을 먼저 확인해야 해요.'
    });
    routes.push({
      type: 'conditional',
      label: '조건부 인수 검토',
      priority: 2,
      status: '부담보/할증/감액 가능',
      reason: '심사 결과에 따라 특정 질병 부담보, 보험료 할증, 감액기간 조건이 붙을 수 있어요.'
    });
  } else if (events.hasLightHiraUse || events.hasFollowup) {
    routes.push({
      type: 'balanced',
      label: '표준형과 간편심사 동시 비교',
      priority: 1,
      status: '비교 검토',
      reason: '심평원 외래/약국 이력은 있으나 입원·수술·장기투약 단서가 약해 표준형과 경증 간편고지를 함께 비교합니다.'
    });
    routes.push({
      type: 'standard',
      label: '표준형 재도전',
      priority: 2,
      status: '비교 검토',
      reason: '진료 목적과 최종 진단명이 단순 이력이면 표준심사가 더 유리할 수 있어요.'
    });
  } else {
    routes.push({
      type: 'balanced',
      label: '표준형과 간편심사 동시 비교',
      priority: 1,
      status: '비교 검토',
      reason: '병력 상세가 불명확하므로 표준형 보험료와 간편심사 통과 가능성을 함께 비교합니다.'
    });
  }

  if ((age && age >= 70) || /거절|가입불가|중증|암|심근경색|뇌졸중/i.test(text)) {
    routes.push({
      type: 'no_underwriting',
      label: '무심사/제한형 후순위',
      priority: 3,
      status: hasNoUnderwritingProduct ? '후순위 검토' : '대체 상품 필요',
      reason: '고령 또는 중증 병력으로 심사형이 어렵다면 무심사/보장제한형을 마지막 대안으로 검토합니다.'
    });
  }

  return routes.sort((a, b) => a.priority - b.priority);
}

function polibotPremiumFit(profile = {}, catalogItems = [], premiumReferences = []) {
  const target = parsePolibotPremiumAmount(profile.budget);
  const current = parsePolibotPremiumAmount(profile.existingPremium);
  const itemPremiums = catalogItems
    .flatMap((item) => [
      item.premiumExample,
      ...(Array.isArray(item.premiumExamples) ? item.premiumExamples.map((example) => example.premium) : []),
      ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => row.amount) : []),
      ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => row.amount)) : [])
    ])
    .map(parsePolibotPremiumAmount)
    .filter((value) => Number.isFinite(value) && value > 0);
  const referencePremiums = premiumReferences
    .map((item) => item.premium)
    .map(parsePolibotPremiumAmount)
    .filter((value) => Number.isFinite(value) && value > 0);
  const knownPremiums = itemPremiums.length ? itemPremiums : referencePremiums;
  if (!Number.isFinite(target)) {
    return { level: 'unknown', label: '예산 기준 부족', reason: '목표 월 보험료가 숫자로 확인되지 않아 보험료 적합도는 보류합니다.' };
  }
  if (!knownPremiums.length) {
    return {
      level: 'estimate_needed',
      label: '보험료 산출 필요',
      reason: `목표 ${formatPolibotPremiumAmount(target)} 기준으로 설계 보험료를 산출해야 해요.`,
      targetPremium: formatPolibotPremiumAmount(target),
      currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : ''
    };
  }
  const minPremium = Math.min(...knownPremiums);
  const budgetFit = polibotBudgetFitLevel(minPremium, target);
  if (!itemPremiums.length && referencePremiums.length) {
    return {
      level: budgetFit.level === 'within_budget' ? 'reference_within_budget'
        : budgetFit.level === 'severe_over_budget' ? 'reference_severe_over_budget' : 'reference_over_budget',
      label: '참고 보험료표 있음',
      reason: `문서 내 보험료표 최저 ${formatPolibotPremiumAmount(minPremium)} / 목표 ${formatPolibotPremiumAmount(target)}${budgetFit.overAmount > 0 ? ` · ${polibotBudgetOverrunText(minPremium, target)}` : ''}. 다만 상품 행 연결이 검수되지 않아 설계 보험료 확인이 필요합니다.`,
      targetPremium: formatPolibotPremiumAmount(target),
      currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '',
      examplePremium: formatPolibotPremiumAmount(minPremium),
      overBudgetRatio: budgetFit.ratio,
      overBudgetAmount: Number.isFinite(budgetFit.overAmount) ? formatPolibotPremiumAmount(budgetFit.overAmount) : '',
      confidence: 'reference'
    };
  }
  const level = budgetFit.level;
  return {
    level,
    label: level === 'within_budget' ? '예산 내 후보 있음'
      : level === 'near_budget' ? '예산 근접 초과'
        : level === 'severe_over_budget' ? '예산 크게 초과' : '예산 초과 가능',
    reason: `확인된 최저 예시 보험료 ${formatPolibotPremiumAmount(minPremium)} / 목표 ${formatPolibotPremiumAmount(target)}${budgetFit.overAmount > 0 ? ` · ${polibotBudgetOverrunText(minPremium, target)}` : ''}`,
    targetPremium: formatPolibotPremiumAmount(target),
    currentPremium: Number.isFinite(current) ? formatPolibotPremiumAmount(current) : '',
    examplePremium: formatPolibotPremiumAmount(minPremium),
    overBudgetRatio: budgetFit.ratio,
    overBudgetAmount: Number.isFinite(budgetFit.overAmount) ? formatPolibotPremiumAmount(budgetFit.overAmount) : ''
  };
}

function selectPolibotPremiumExample(catalogItems = [], profile = {}, premiumReferences = []) {
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const itemCandidates = catalogItems.flatMap((item) => {
    const examples = Array.isArray(item.premiumExamples) && item.premiumExamples.length
      ? item.premiumExamples
      : item.premiumExample ? [{ premium: item.premiumExample, age: '', gender: '', confidence: item.premiumConfidence || 'unknown', matchScore: item.premiumConfidence === 'exact' ? 100 : 60 }]
        : Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => ({
          premium: row.amount,
          age: row.age || '',
          gender: row.gender || '',
          confidence: row.confidence || 'table_row',
          matchScore: row.score || 58
        }))
          : Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => ({
            premium: row.amount,
            age: row.age || '',
            gender: row.gender || '',
            confidence: row.confidence || group.linkConfidence || 'linked_group',
            matchScore: group.linkScore || 62
          }))) : [];
    return examples.map((example) => {
      const exampleAge = Number(String(example.age || '').replace(/[^\d.]/g, ''));
      let score = Number(example.matchScore || 0);
      if (Number.isFinite(exampleAge) && age) score += Math.max(0, 30 - Math.abs(exampleAge - age));
      if (gender && example.gender && String(example.gender).includes(gender.slice(0, 1))) score += 18;
      if (example.plan) score += 6;
      if (example.confidence === 'catalog_item' || item.premiumConfidence === 'catalog_item') score += 18;
      if (example.confidence === 'document_match') score += 8;
      return {
        productName: item.productName,
        company: item.company,
        premium: example.premium,
        age: example.age || '',
        gender: example.gender || '',
        plan: example.plan || '',
        confidence: example.confidence || item.premiumConfidence || 'unknown',
        matchQuality: polibotPremiumMatchQuality({ ...example, amount: parsePolibotPremiumAmount(example.premium) }, profile),
        score
      };
    });
  }).filter((item) => item.premium);
  const referenceCandidates = premiumReferences.map((reference) => {
    const exampleAge = Number(String(reference.age || '').replace(/[^\d.]/g, ''));
    let score = 28;
    if (Number.isFinite(exampleAge) && age) score += Math.max(0, 24 - Math.abs(exampleAge - age));
    if (gender && reference.gender && String(reference.gender).includes(gender.slice(0, 1))) score += 14;
    if (reference.productName) score += 10;
    if (reference.confidence === 'catalog_item') score += 18;
    const matchQuality = polibotPremiumMatchQuality({ ...reference, premium: reference.premium, amount: parsePolibotPremiumAmount(reference.premium) }, profile);
    return {
      productName: reference.productName || '문서 내 보험료표',
      company: reference.company || '',
      premium: reference.premium,
      age: reference.age || '',
      gender: reference.gender || '',
      plan: reference.plan || '',
      label: reference.label || '',
      sourcePage: reference.sourcePage || '',
      confidence: reference.confidence || 'document_reference',
      linkStatus: reference.linkStatus || 'unlinked_document_table',
      matchQuality,
      score,
      referenceOnly: true
    };
  }).filter((item) => item.premium);
  const candidates = itemCandidates.length ? itemCandidates : referenceCandidates;
  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best) return { memo: '보험료 산출 필요', confidence: 'none', selected: null };
  const details = [best.company, best.productName, best.age ? `${best.age}세` : '', best.gender].filter(Boolean).join(' · ');
  if (best.referenceOnly) {
    return {
      memo: `${best.premium}${details ? ` (${details})` : ''} · 참고 보험료표, 상품별 설계 확인 필요`,
      confidence: 'reference',
      matchQuality: best.matchQuality || polibotPremiumMatchQuality({ ...best, amount: parsePolibotPremiumAmount(best.premium) }, profile),
      selected: best
    };
  }
  return {
    memo: `${best.premium}${details ? ` (${details})` : ''}`,
    confidence: best.confidence === 'catalog_item' ? 'confirmed' : 'estimated',
    matchQuality: best.matchQuality || polibotPremiumMatchQuality({ ...best, amount: parsePolibotPremiumAmount(best.premium) }, profile),
    selected: best
  };
}

function polibotItemDiagnostics(catalogItems = [], profile = {}) {
  return catalogItems.slice(0, 5).map((item) => {
    const age = polibotAgeRangeStatus(item, profile);
    const needHits = (profile.needs || []).filter((need) => catalogItemMatchesNeeds(item, [need]));
    const decisionBreakdown = polibotItemDecisionBreakdown(item, profile);
    const cautions = [
      age.status === 'blocked' && age.reason,
      age.status === 'unknown' && '가입연령 자료가 불완전합니다.',
      item.renewalType && /갱신/.test(item.renewalType) && profile.renewalPreference === '비갱신 선호' && '고객은 비갱신 선호라 갱신형 여부 확인이 필요합니다.',
      item.completeness !== '충분' && '상품 정보가 충분하지 않아 약관/설계서 확인이 필요합니다.',
      item.conditionRules?.underwritingTypes?.length && `심사 유형 확인: ${item.conditionRules.underwritingTypes.join(', ')}`,
      item.linkedBenefitGroups?.length && item.linkedBenefitGroups.every((group) => group.linkConfidence === 'weak') && '보험료-담보-조건 연결 강도가 낮아 검수 필요',
      ...(decisionBreakdown.blockers || []),
      ...(item.excludedAudience || []).map((value) => `제외 대상 확인: ${value}`)
    ].filter(Boolean);
    let fitScore = decisionBreakdown.score || (50 + Math.min(30, needHits.length * 10));
    if (age.status === 'ok') fitScore += 8;
    if (age.status === 'blocked') fitScore -= 45;
    if (decisionBreakdown.purposeMismatch) fitScore -= 24;
    if (item.premiumExample) fitScore += 5;
    if (item.completeness === '충분') fitScore += 7;
    if (cautions.length) fitScore -= Math.min(18, cautions.length * 4);
    fitScore = Math.max(0, Math.min(100, fitScore));
    return {
      productName: item.productName,
      company: item.company,
      fitScore,
      fitLevel: decisionBreakdown.level || (fitScore >= 78 ? '우선 검토' : fitScore >= 58 ? '검토 가능' : '주의 검토'),
      matchedNeeds: needHits,
      ageStatus: age.label,
      premiumStatus: decisionBreakdown.premium?.amount
        ? `${decisionBreakdown.premium.amount}${decisionBreakdown.premium.age ? ` · ${decisionBreakdown.premium.age}세` : ''}${decisionBreakdown.premium.gender ? ` · ${decisionBreakdown.premium.gender}` : ''}`
        : item.premiumExample ? `예시 ${item.premiumExample}` : item.premiumTableRows?.length ? `보험료표 ${item.premiumTableRows[0].amount}` : item.linkedBenefitGroups?.[0]?.premiums?.[0]?.amount ? `연결묶음 ${item.linkedBenefitGroups[0].premiums[0].amount}` : '보험료 산출 필요',
      decisionBreakdown,
      strengths: decisionBreakdown.strengths || [],
      blockers: decisionBreakdown.blockers || [],
      cautions
    };
  });
}

function polibotEvidenceIntegrity({ profile = {}, catalogItems = [], premiumCatalogItems = [], premiumReferences = [] } = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  const primaryItems = (premiumCatalogItems.length ? premiumCatalogItems : catalogItems).slice(0, 5);
  const checks = [];
  let score = 100;

  const namedProducts = primaryItems.filter((item) => item.productName && item.company && item.company !== '미분류');
  if (namedProducts.length) {
    checks.push({ key: 'product_identity', status: 'ok', label: '상품/보험사 식별', reason: `${namedProducts.length}개 대표 상품의 상품명과 보험사가 확인됩니다.` });
  } else {
    score -= 28;
    checks.push({ key: 'product_identity', status: 'weak', label: '상품/보험사 식별', reason: '대표 상품명 또는 보험사명이 부족해 추천 근거 검수가 필요합니다.' });
  }

  const ageChecks = primaryItems.map((item) => polibotAgeRangeStatus(item, profile));
  const knownAgeChecks = ageChecks.filter((item) => item.status !== 'unknown');
  const blockedAgeChecks = ageChecks.filter((item) => item.status === 'blocked');
  if (blockedAgeChecks.length) {
    score -= 30;
    checks.push({ key: 'age_rule', status: 'blocked', label: '가입연령', reason: blockedAgeChecks[0].reason || '고객 나이가 일부 상품 가입연령과 맞지 않을 수 있습니다.' });
  } else if (knownAgeChecks.length) {
    checks.push({ key: 'age_rule', status: 'ok', label: '가입연령', reason: '대표 상품의 가입연령 조건을 고객 나이와 대조했습니다.' });
  } else {
    score -= 14;
    checks.push({ key: 'age_rule', status: 'unknown', label: '가입연령', reason: '가입연령 자료가 비어 있어 약관 또는 설계 화면 확인이 필요합니다.' });
  }

  const matchedNeeds = needs.filter((need) => primaryItems.some((item) => catalogItemMatchesNeeds(item, [need])));
  if (!needs.length) {
    score -= 10;
    checks.push({ key: 'coverage_match', status: 'unknown', label: '보장 니즈', reason: '고객 필요 보장이 입력되지 않아 담보 매칭을 보류합니다.' });
  } else if (matchedNeeds.length) {
    checks.push({ key: 'coverage_match', status: matchedNeeds.length === needs.length ? 'ok' : 'partial', label: '보장 니즈', reason: `${matchedNeeds.length}/${needs.length}개 니즈가 대표 상품 담보 키워드와 연결됩니다.` });
    if (matchedNeeds.length < needs.length) score -= Math.min(14, (needs.length - matchedNeeds.length) * 5);
  } else {
    score -= 22;
    checks.push({ key: 'coverage_match', status: 'weak', label: '보장 니즈', reason: '대표 상품 담보 키워드와 고객 니즈의 직접 매칭이 약합니다.' });
  }

  const exactPremium = premiumCatalogItems.some((item) => item.premiumExample && ['exact', 'catalog_item'].includes(item.premiumConfidence));
  const tablePremium = premiumCatalogItems.some((item) => Array.isArray(item.premiumTableRows) && item.premiumTableRows.length > 0);
  const linkedPremium = premiumCatalogItems.some((item) => Array.isArray(item.linkedBenefitGroups) && item.linkedBenefitGroups.some((group) => (group.premiums || []).length && (group.coverages || []).length));
  const estimatedPremium = premiumCatalogItems.some((item) => item.premiumExample && !['exact', 'catalog_item', 'none'].includes(item.premiumConfidence));
  if (exactPremium) {
    checks.push({ key: 'premium_link', status: 'ok', label: '보험료 연결', reason: '상품 행에 직접 연결된 보험료 예시가 있습니다.' });
  } else if (linkedPremium) {
    score -= 8;
    checks.push({ key: 'premium_link', status: 'linked_group', label: '보험료-담보 묶음', reason: '상품/플랜 단위로 보험료와 담보가 함께 묶여 추천 근거로 사용할 수 있습니다.' });
  } else if (premiumReferences.length) {
    score -= 16;
    checks.push({ key: 'premium_link', status: 'reference', label: '보험료 연결', reason: '문서 내 보험료표는 있으나 상품 행 연결이 확정되지 않아 참고값으로만 사용합니다.' });
  } else if (tablePremium) {
    score -= 12;
    checks.push({ key: 'premium_link', status: 'table', label: '보험료표 행', reason: '상품 주변 보험료표 행은 있으나 최종 설계 보험료와 일치하는지 확인이 필요합니다.' });
  } else if (estimatedPremium) {
    score -= 18;
    checks.push({ key: 'premium_link', status: 'estimated', label: '보험료 연결', reason: '보험료 후보는 있으나 상품 직접 연결 근거가 약해 설계 보험료 확인이 필요합니다.' });
  } else {
    score -= 28;
    checks.push({ key: 'premium_link', status: 'missing', label: '보험료 연결', reason: '추천 대표 상품의 보험료 예시가 없어 설계 산출 전 최종 비교가 어렵습니다.' });
  }

  const weakCompleteness = primaryItems.filter((item) => item.completeness && item.completeness !== '충분').length;
  if (weakCompleteness) {
    score -= Math.min(14, weakCompleteness * 4);
    checks.push({ key: 'catalog_completeness', status: 'partial', label: '상품 정보 완성도', reason: `${weakCompleteness}개 대표 상품은 납입/갱신/가입조건 등 일부 항목 보강이 필요합니다.` });
  } else if (primaryItems.length) {
    checks.push({ key: 'catalog_completeness', status: 'ok', label: '상품 정보 완성도', reason: '대표 상품의 기본 카탈로그 정보가 충분한 편입니다.' });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 82 ? '높음' : score >= 62 ? '검수 필요' : '자료 보강 필요';
  return {
    score,
    level,
    label: `근거 정확도 ${level}`,
    reason: score >= 82
      ? '상품/보험사/보장/가입조건/보험료 근거가 비교적 잘 연결되어 있습니다.'
      : score >= 62 ? '추천은 가능하지만 일부 근거는 상담 전 검수해야 합니다.' : '정확 추천을 위해 원문 또는 설계 데이터 보강이 우선입니다.',
    checks
  };
}

function polibotDecisionScore({ coverageMatches = [], medicalRisk = {}, premiumFit = {}, ageChecks = [], evidenceIntegrity = {}, purposeAnalysis = {} } = {}) {
  const matchedCoverageCount = coverageMatches.filter((item) => item.status === 'matched').length;
  const components = [
    { key: 'coverage', label: '보장 니즈 매칭', score: matchedCoverageCount * 10, reason: `${matchedCoverageCount}/${coverageMatches.length || 0}개 매칭` },
    { key: 'medical', label: '병력 리스크', score: medicalRisk.level === 'low' ? 12 : medicalRisk.level === 'review' ? -8 : 0, reason: medicalRisk.label || medicalRisk.level || '미확인' },
    {
      key: 'premium',
      label: '보험료 적합도',
      score: premiumFit.level === 'within_budget' ? 10
        : premiumFit.level === 'near_budget' ? -4
          : premiumFit.level === 'over_budget' ? -10
            : premiumFit.level === 'severe_over_budget' ? -22
          : premiumFit.level === 'reference_within_budget' ? 4
            : premiumFit.level === 'reference_over_budget' ? -4
              : premiumFit.level === 'reference_severe_over_budget' ? -14
                : premiumFit.level === 'estimate_needed' ? -8 : 0,
      reason: premiumFit.label || premiumFit.level || '미확인'
    },
    {
      key: 'age',
      label: '가입연령',
      score: ageChecks.some((item) => item.status === 'blocked') ? -20 : ageChecks.some((item) => item.status === 'ok') ? 6 : 0,
      reason: ageChecks.some((item) => item.status === 'blocked') ? '연령 조건 불리 후보 있음' : ageChecks.some((item) => item.status === 'ok') ? '연령 조건 부합 후보 있음' : '가입연령 미확인'
    },
    {
      key: 'evidence',
      label: '근거 정확도',
      score: evidenceIntegrity.score < 62 ? -20 : evidenceIntegrity.score < 82 ? -10 : 4,
      reason: evidenceIntegrity.label || ''
    },
    {
      key: 'purpose',
      label: '목적 적합도',
      score: purposeAnalysis.score >= 78 ? 8 : purposeAnalysis.score < 58 ? -12 : purposeAnalysis.score < 70 ? -4 : 0,
      reason: purposeAnalysis.label || purposeAnalysis.level || ''
    }
  ];
  const rawScore = 45 + components.reduce((sum, component) => sum + Number(component.score || 0), 0);
  const score = Math.max(0, Math.min(100, rawScore));
  return {
    score,
    scoreFormula: {
      base: 45,
      rawTotal: rawScore,
      total: score,
      components
    },
    level: score >= 80 ? '높음' : score >= 60 ? '보통' : '주의',
    reason: score >= 80
      ? '고객 니즈와 자료 근거가 비교적 잘 맞습니다.'
      : score >= 60 ? '추천 가능하지만 가입조건/보험료 확인이 필요합니다.' : '상담 전 추가 정보 확인이 우선입니다.'
  };
}

function polibotCompanyOutlook(catalogItems = [], profile = {}, underwritingRoute = [], itemDiagnostics = []) {
  const byCompany = new Map();
  catalogItems.forEach((item) => {
    const company = item.company || '미분류';
    if (!byCompany.has(company)) byCompany.set(company, []);
    byCompany.get(company).push(item);
  });
  const diagnosticKey = (item = {}) => `${item.company || ''}-${item.productName || ''}`;
  const diagnosticsByKey = new Map(itemDiagnostics.map((item) => [diagnosticKey(item), item]));
  const primaryRoute = underwritingRoute[0] || {};
  return [...byCompany.entries()].slice(0, 6).map(([company, items]) => {
    const diagnostics = items
      .map((item) => diagnosticsByKey.get(diagnosticKey(item)))
      .filter(Boolean);
    const bestScore = diagnostics.length ? Math.max(...diagnostics.map((item) => Number(item.fitScore || 0))) : 0;
    const matchedNeeds = [...new Set(diagnostics.flatMap((item) => item.matchedNeeds || []))];
    const hasSimple = items.some((item) => /간편|유병|고지|325|335|355|3\.2\.5|3\.5\.5|3\.10/.test(`${item.productName || ''} ${item.productGroup || ''}`));
    const hasStandardLike = items.some((item) => !/간편|유병|무심사|무고지/.test(`${item.productName || ''} ${item.productGroup || ''}`));
    const cautions = [...new Set(diagnostics.flatMap((item) => item.cautions || []))].slice(0, 4);
    let status = bestScore >= 78 ? '우선 검토' : bestScore >= 58 ? '비교 검토' : '확인 필요';
    if (primaryRoute.type === 'chronic_special' && hasSimple) status = '우선 검토';
    if (primaryRoute.type === 'standard' && hasStandardLike) status = '우선 검토';
    if (primaryRoute.type === 'simple' && !hasSimple) status = '간편심사 상품 확인 필요';
    return {
      company,
      status,
      fitScore: bestScore,
      route: hasSimple ? '간편/유병자 후보 포함' : hasStandardLike ? '표준형 후보 중심' : primaryRoute.label || '심사 경로 확인',
      products: [...new Set(items.map((item) => item.productName).filter(Boolean))].slice(0, 4),
      matchedNeeds,
      reasons: [
        matchedNeeds.length ? `${matchedNeeds.join(', ')} 니즈와 연결됩니다.` : '직접 매칭되는 니즈가 약해 추가 확인이 필요합니다.',
        hasSimple && '간편/유병자형 후보가 있어 병력 고객의 대안으로 검토할 수 있습니다.',
        hasStandardLike && primaryRoute.type !== 'simple' && '표준형 후보가 있어 보험료 비교 가치가 있습니다.',
        ...cautions
      ].filter(Boolean).slice(0, 5)
    };
  }).sort((a, b) => b.fitScore - a.fitScore);
}

function summarizePolibotCompanyConcentration(items = []) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => ({
      company: String(item.company || '').trim(),
      productName: String(item.productName || item.connectedValue || item.label || '').trim(),
      code: String(item.code || '').trim()
    }))
    .filter((item) => item.company);
  const total = rows.length;
  if (total < 3) return null;
  const groups = [...rows.reduce((map, item) => {
    const current = map.get(item.company) || { company: item.company, count: 0, products: new Set(), codes: new Set() };
    current.count += 1;
    if (item.productName) current.products.add(item.productName);
    if (item.code) current.codes.add(item.code);
    map.set(item.company, current);
    return map;
  }, new Map()).values()].sort((a, b) => b.count - a.count);
  const top = groups[0];
  if (!top || top.count < 3 || top.count / total < 0.65) return null;
  return {
    detected: true,
    company: top.company,
    count: top.count,
    total,
    share: Math.round((top.count / total) * 100),
    reason: `${top.company} 후보가 ${top.count}/${total}개로 집중되어 실제 설계 가능 보험사인지, 자료 편중인지 확인해야 합니다.`,
    products: [...top.products].slice(0, 4),
    codes: [...top.codes].slice(0, 6),
    otherCandidates: groups.slice(1, 5).map((item) => ({ company: item.company, count: item.count }))
  };
}

function polibotCoverageCodeCategory(item = {}) {
  const valueText = [
    item.connectedValue,
    item.label
  ].filter(Boolean).join(' ');
  const primaryText = [
    valueText,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : [])
  ].filter(Boolean).join(' ');
  const text = [
    item.code,
    primaryText,
    item.query
  ].filter(Boolean).join(' ');
  const primaryRules = [
    [/납입면제|면제/, '납입면제'],
    [/순환계|심장|허혈|급성심근|협심증/, '심장'],
    [/뇌|뇌혈관|뇌졸중|뇌출혈/, '뇌혈관'],
    [/수술|질병수술|종수술/, '수술비'],
    [/입원|통원|일당/, '입원/통원'],
    [/유사암|소액암|갑상선|제자리|경계성|기타피부암/, '유사암/소액암'],
    [/암|항암|표적|방사선|카티|CAR|진단비/, '암'],
    [/간병|치매|요양|장기요양/, '간병/치매'],
    [/간편|유병|고지|3\.2\.5|3\.5\.5|3\.10\.10|325|335|355/, '간편고지'],
    [/운전자|벌금|변호사|교통|사고처리/, '운전자'],
    [/상해|골절|화상|후유장해|장해/, '상해']
  ];
  for (const [pattern, category] of primaryRules) {
    if (pattern.test(valueText)) return category;
  }
  for (const [pattern, category] of primaryRules) {
    if (pattern.test(primaryText)) return category;
  }
  for (const [pattern, category] of primaryRules) {
    if (pattern.test(text)) return category;
  }
  return '기타 보장';
}

function polibotManagerRouteLabel(underwritingRoute = [], medicalRisk = {}, profile = {}, actualCodes = []) {
  const primaryRoute = underwritingRoute[0] || {};
  const routeType = primaryRoute.type || '';
  const medical = `${polibotUnderwritingMedicalText(profile)} ${profile.familyHistory || ''}`;
  const hasSimpleDisclosureCode = actualCodes.some((item) => /^3\./.test(normalizePolibotDisclosureCode(item.code || '') || String(item.code || '')));
  if (routeType === 'standard') {
    if (hasSimpleDisclosureCode) {
      return {
        route: '표준형/간편 동시 비교',
        routeReason: '간편고지 코드 후보가 있어 표준형 보험료와 간편심사 통과 가능성을 동시에 비교합니다.'
      };
    }
    return {
      route: '표준형 우선',
      routeReason: primaryRoute.reason || '병력 이슈가 낮아 표준형 보험료를 먼저 산출합니다.'
    };
  }
  if (routeType === 'chronic_special') {
    return {
      route: '표준형 우선 + 조건부/간편 비교',
      routeReason: primaryRoute.reason || '만성질환 이력이 있어 표준형과 간편심사를 같이 비교합니다.'
    };
  }
  if (routeType === 'simple') {
    return {
      route: '간편심사 우선',
      routeReason: primaryRoute.reason || '최근 치료/투약 또는 주요 병력 가능성이 있어 간편심사 통과 가능성을 먼저 봅니다.'
    };
  }
  if (routeType === 'conditional') {
    return {
      route: '조건부 인수 검토',
      routeReason: primaryRoute.reason || '부담보, 할증, 감액 조건을 확인해야 합니다.'
    };
  }
  if (medicalRisk.level === 'review' || hasSimpleDisclosureCode || /고혈압|당뇨|투약|입원|수술|암|뇌|심장|3\.10\.10|3\.5\.5|3\.2\.5/i.test(medical)) {
    return {
      route: '표준형/간편 동시 비교',
      routeReason: '병력 또는 고지 코드가 있어 표준형 보험료와 간편심사 통과 가능성을 동시에 비교합니다.'
    };
  }
  return {
    route: '표준 가능',
    routeReason: primaryRoute.reason || '입력 정보상 표준심사 가능성을 먼저 확인합니다.'
  };
}

function buildPolibotDesignManagerSummary({
  profile = {},
  decisionAnalysis = {},
  managerCodes = [],
  actualCodes = [],
  matchedCoverageCodes = [],
  catalogItems = []
} = {}) {
  const medicalRisk = decisionAnalysis.medicalRisk || polibotMedicalRisk(profile);
  const underwritingRoute = decisionAnalysis.underwritingRoute || polibotUnderwritingRoute(profile, catalogItems);
  const coveragePriority = decisionAnalysis.coveragePriority || polibotCoveragePriority(profile);
  const priceStrategy = decisionAnalysis.priceStrategy || polibotPriceStrategy(profile);
  const route = polibotManagerRouteLabel(underwritingRoute, medicalRisk, profile, actualCodes);
  const disclosureCodeAssessments = enrichPolibotDisclosureAssessmentsWithEvidence(
    buildPolibotDisclosureCodeAssessments(profile),
    matchedCoverageCodes
  );
  const seenCode = new Set();
  const needsReviewDisclosureCodes = new Set(actualCodes
    .filter((item) => item.status === 'needs_review')
    .map((item) => normalizePolibotDisclosureCode(item.code || '') || String(item.code || '').trim())
    .filter(Boolean));
  const profileRecent3Review = polibotDisclosureRecent3MonthReview(profile, extractPolibotMedicalEvents(profile));
  const hasBlockingDisclosureReview = actualCodes.some((item) => {
    const reasonCodes = Array.isArray(item.reviewReasonCodes) ? item.reviewReasonCodes : [item.reviewReasonCode].filter(Boolean);
    return reasonCodes.some((code) => ['recent3_missing', 'recent3_incomplete', 'recent3_medical_event'].includes(code));
  }) || ['recent3_missing', 'recent3_incomplete', 'recent3_medical_event'].includes(profileRecent3Review?.reasonCode);
  const evidenceRecommendedCodes = groupPolibotDesignRecommendedCodes(matchedCoverageCodes
    .map(normalizePolibotDesignRecommendedCode)
    .filter(() => !hasBlockingDisclosureReview)
    .filter((item) => !needsReviewDisclosureCodes.has(item.code))
    .filter((item) => item.source === '설매 코드표' || !/^\d+$/.test(item.code || ''))
    .filter((item) => {
      const key = [item.code, item.company, item.productName].join('|');
      return item.code && !seenCode.has(key) && seenCode.add(key);
    }))
    .slice(0, 18);
  const ruleRecommendedCodes = disclosureCodeAssessments
    .filter((item) => item.status !== 'needs_review' || !hasBlockingDisclosureReview)
    .map((item) => ({
      code: item.code,
      connectedValue: item.label,
      category: item.category,
      company: item.company || '',
      productName: item.productName || '',
      productGroup: item.category,
      priority: item.status === 'recommended' ? '우선 검토' : item.status === 'compare' ? '비교 검토' : '검수 필요',
      source: item.evidenceSummary ? `고객조건 룰 + ${item.evidenceSummary}` : '고객조건 룰',
      confidence: item.confidence,
      context: item.reason,
      status: item.status,
      statusLabel: item.statusLabel,
      blockers: item.blockers,
      nextCheck: item.nextCheck,
      evidenceMatches: item.evidenceMatches || []
    }));
  const recommendedCodes = groupPolibotDesignRecommendedCodes([...ruleRecommendedCodes, ...evidenceRecommendedCodes])
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, 18);
  const companyConcentration = summarizePolibotCompanyConcentration([
    ...recommendedCodes,
    ...matchedCoverageCodes,
    ...catalogItems
  ]);
  const codeCategories = [...new Set(recommendedCodes.map((item) => item.category).filter(Boolean))];
  const priorityCoverage = [
    ...coveragePriority
      .filter((item) => item.priority === '높음' || item.priority === '심사 전략' || item.priority === '중복 확인')
      .map((item) => ({
        label: item.need,
        priority: item.priority,
        reason: item.reason
      })),
    ...codeCategories.slice(0, 6).map((category) => ({
      label: category,
      priority: ['암', '뇌혈관', '심장', '수술비', '납입면제'].includes(category) ? '높음' : '보완',
      reason: 'polidoc 보장코드에서 연결된 담보군입니다.'
    }))
  ].filter((item, index, list) => item.label && list.findIndex((other) => other.label === item.label) === index).slice(0, 8);
  const riskFlags = [
    medicalRisk.label && medicalRisk.level !== 'low' && medicalRisk.label,
    ...(medicalRisk.flags || []).map((item) => `${item.label}: ${item.question || item.risk || '확인 필요'}`),
    ...managerCodes.filter((item) => item.status !== 'applied').map((item) => `${item.code} · ${item.reason || item.label}`),
    ...actualCodes.slice(0, 6).map((item) => `${item.code}${item.label ? ` · ${item.label}` : ''}`)
  ].filter(Boolean).slice(0, 10);
  const sellerQuestions = [
    medicalRisk.level !== 'low' && '표준형 심사 가능성과 간편심사 보험료를 둘 다 산출했나요?',
    actualCodes.some((item) => /3\.10\.10|3\.5\.5|3\.2\.5/.test(item.code || '')) && '간편고지 질문의 기간 조건에 실제로 해당하는지 재확인했나요?',
    actualCodes.some((item) => /I10|E1[0-4]/.test(item.code || '')) && '고혈압/당뇨 투약 기간, 최근 수치, 합병증 여부를 확인했나요?',
    priorityCoverage.some((item) => /암|뇌|심장/.test(item.label)) && '암/뇌/심장 진단비 목표 금액과 기존 가입금액 차이를 확인했나요?',
    recommendedCodes.length > 0 && `설매 코드표/보장코드 후보 ${recommendedCodes.slice(0, 5).map((item) => [item.code, item.company].filter(Boolean).join('@')).join(', ')}를 실제 설계 특약에 반영했나요?`,
    companyConcentration && `${companyConcentration.company}만 많이 나온 이유가 고객조건 적합 때문인지, 업로드 자료/상품DB 편중 때문인지 비교 보험사를 확인했나요?`,
    priceStrategy.mode === 'save' && '절감 목표를 맞추기 위해 줄이면 안 되는 담보를 분리했나요?',
    priceStrategy.mode === 'upgrade' && '월 보험료 상한 안에서 핵심 진단비를 먼저 두껍게 구성했나요?',
    '최종 청약 전 고지사항 원문과 설계서 특약명을 대조했나요?'
  ].filter(Boolean).slice(0, 8);
  const nextAction = (() => {
    if (/간편심사 우선/.test(route.route)) return '간편심사 1안 산출 후 표준형 가능 여부를 보조 확인';
    if (/동시 비교|조건부\/간편/.test(route.route)) return '표준형 1안과 간편심사 1안을 동시에 산출해 보험료/보장 차이 비교';
    if (/표준형 우선|표준 가능/.test(route.route)) return '표준형 1안을 먼저 산출하고 고지 결과에 따라 간편심사 대안 준비';
    return '고지 조건과 기존 보장을 보강한 뒤 추천안 재산출';
  })();
  return {
    route: route.route,
    routeReason: route.routeReason,
    nextAction,
    priorityCoverage,
    recommendedCodes,
    codeAssessments: disclosureCodeAssessments,
    companyConcentration,
    riskFlags,
    sellerQuestions
  };
}

function normalizePolibotMatchText(value = '') {
  return String(value || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function polibotCodeCoverageTokens(item = {}) {
  return [
    item.connectedValue,
    item.label,
    item.query,
    item.context,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : [])
  ]
    .map(normalizePolibotMatchText)
    .filter(Boolean);
}

function scopePolibotMatchedCoverageCodes(codes = [], { catalogItems = [], keywordHits = [], productGroup = '', sourceCompanies = [] } = {}) {
  const catalogCompanies = new Set([
    ...sourceCompanies,
    ...catalogItems.flatMap((item) => item.companies?.length ? item.companies : [item.company])
  ].filter(Boolean));
  const catalogText = normalizePolibotMatchText([
    productGroup,
    ...keywordHits,
    ...catalogItems.flatMap((item) => [
      item.productName,
      item.productGroup,
      item.disclosureMemo,
      item.reductionMemo,
      ...(item.coverageKeywords || []),
      ...(item.coverageDetails || []).map((detail) => `${detail.label || ''} ${detail.category || ''} ${detail.fineCategory || ''}`)
    ])
  ].filter(Boolean).join(' '));
  const hasSimpleRoute = /간편|유병|고지|표준|심사/.test(catalogText);
  const scoped = [];
  for (const item of Array.isArray(codes) ? codes : []) {
    const code = String(item?.code || '').trim();
    if (!code) continue;
    const itemCompanies = [item.company, ...(Array.isArray(item.companies) ? item.companies : [])].filter(Boolean);
    const companyMatches = !catalogCompanies.size
      || !itemCompanies.length
      || itemCompanies.some((company) => catalogCompanies.has(company));
    if (!companyMatches) continue;
    if (/^(310|325|333|335|355)$/.test(code) && hasSimpleRoute) {
      scoped.push(item);
      continue;
    }
    const tokens = polibotCodeCoverageTokens(item).filter((token) => token.length >= 2);
    const coverageMatches = tokens.some((token) => catalogText.includes(token) || token.split(/[,\s/]+/).some((part) => part.length >= 2 && catalogText.includes(part)));
    if (coverageMatches) scoped.push(item);
  }
  return scoped
    .filter((item, index, list) => list.findIndex((row) => row.code === item.code) === index)
    .slice(0, 12);
}

function buildPolibotDecisionAnalysis({ profile = {}, catalogItems = [], premiumCatalogItems = catalogItems, premiumReferences = [], keywordText = '', name = '' } = {}) {
  const medicalRisk = polibotMedicalRisk(profile);
  const priceStrategy = polibotPriceStrategy(profile);
  const disclosureTimeline = polibotDisclosureTimeline(profile);
  const underwritingRoute = polibotUnderwritingRoute(profile, catalogItems);
  const ageChecks = catalogItems.slice(0, 4).map((item) => ({
    productName: item.productName,
    company: item.company,
    ...polibotAgeRangeStatus(item, profile)
  }));
  const blockedByAge = ageChecks.some((item) => item.status === 'blocked');
  const hasUnknownAge = ageChecks.some((item) => item.status === 'unknown');
  const eligibilityLevel = blockedByAge
    ? '확인 필요'
    : medicalRisk.level === 'review'
      ? '고지 심사 필요'
      : hasUnknownAge ? '조건 확인 필요' : '검토 가능';
  const coverageMatches = polibotCoverageMatch(catalogItems, profile);
  const coveragePriority = polibotCoveragePriority(profile);
  const underwritingChecklist = polibotUnderwritingChecklist(profile);
  const premiumFit = polibotPremiumFit(profile, premiumCatalogItems, premiumReferences);
  const evidenceIntegrity = polibotEvidenceIntegrity({ profile, catalogItems, premiumCatalogItems, premiumReferences });
  const purposeAnalysis = polibotPurposeAnalysis(profile, { premiumFit, medicalRisk, coverageMatches, evidenceIntegrity });
  const itemDiagnostics = polibotItemDiagnostics(catalogItems, profile);
  const decisionScore = polibotDecisionScore({ coverageMatches, medicalRisk, premiumFit, ageChecks, evidenceIntegrity, purposeAnalysis });
  const companyOutlook = polibotCompanyOutlook(catalogItems, profile, underwritingRoute, itemDiagnostics);
  const itemDecisionSummary = {
    priorityItems: itemDiagnostics
      .filter((item) => ['우선 추천', '우선 검토'].includes(item.fitLevel) || Number(item.fitScore || 0) >= 82)
      .map((item) => `${item.company || ''} ${item.productName || ''}`.trim())
      .filter(Boolean)
      .slice(0, 3),
    holdItems: itemDiagnostics
      .filter((item) => (item.blockers || []).length || Number(item.fitScore || 0) < 64)
      .map((item) => ({
        productName: item.productName,
        company: item.company,
        reasons: (item.blockers || item.cautions || []).slice(0, 3)
      }))
      .slice(0, 5),
    premiumUnknownItems: itemDiagnostics
      .filter((item) => item.decisionBreakdown?.premium?.status === 'unknown')
      .map((item) => `${item.company || ''} ${item.productName || ''}`.trim())
      .filter(Boolean)
      .slice(0, 5)
  };
  const matchedCount = coverageMatches.filter((item) => item.status === 'matched').length;
  const why = [
    `${name}은(는) ${keywordText || '상품 자료'} 기준으로 고객 니즈 ${matchedCount}/${coverageMatches.length || 0}개와 연결됩니다.`,
    itemDecisionSummary.priorityItems.length && `우선 후보: ${itemDecisionSummary.priorityItems.join(', ')}`,
    itemDecisionSummary.holdItems.length && `보류/검수 후보 ${itemDecisionSummary.holdItems.length}개는 가입조건, 보험료, 심사 조건 확인이 필요합니다.`,
    priceStrategy.mode === 'save' && '고객 목적이 보험료 감액 쪽이라 중복 담보 정리와 월 보험료 비교가 핵심입니다.',
    priceStrategy.mode === 'upgrade' && '고객 목적이 보장 강화 쪽이라 보험료보다 핵심 담보 두께와 보장 범위를 우선 봅니다.',
    priceStrategy.mode === 'remodel' && '리모델링 목적이라 기존 실손/기존 보험과 중복되는 담보를 먼저 대조해야 합니다.',
    medicalRisk.level === 'review' && '병력 이력이 있어 일반심사 상품과 간편심사 상품을 함께 비교해야 합니다.',
    medicalRisk.level === 'low' && '입력상 병력 이슈가 없어 표준 심사 가능성을 우선 검토할 수 있습니다.',
    underwritingRoute[0]?.reason,
    premiumFit.level === 'estimate_needed' && '상품별 보험료 예시가 부족해 실제 설계 보험료 산출 후 최종 순위를 정해야 합니다.',
    premiumFit.confidence === 'reference' && '문서 안에 보험료표는 있지만 상품 행과 정확히 연결되지 않아 참고값으로만 사용합니다.',
    evidenceIntegrity.score < 82 && `${evidenceIntegrity.label}: ${evidenceIntegrity.reason}`,
    `${purposeAnalysis.label} ${purposeAnalysis.score}점: ${purposeAnalysis.level}`
  ].filter(Boolean);
  const nextQuestions = [
    medicalRisk.level !== 'low' && '최근 5년 내 입원, 수술, 30일 이상 투약, 추가검사 소견이 있었나요?',
    ...(medicalRisk.questions || []),
    disclosureTimeline.some((item) => item.key === '3m' && item.status === '확인 필요') && '최근 3개월 내 건강검진 의심소견이나 추가검사 소견이 청약서 질문에 해당하나요?',
    underwritingRoute.some((item) => item.type === 'standard' && item.status.includes('비교')) && '표준형으로 먼저 심사했을 때 예상 보험료와 간편심사 보험료를 비교했나요?',
    profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' && '기존 실손 가입 시기와 보장 형태를 확인했나요?',
    priceStrategy.mode === 'save' && '절감 목표가 월 몇 만원인지, 줄이면 안 되는 담보가 무엇인지 확인했나요?',
    priceStrategy.mode === 'upgrade' && '보험료가 올라가도 유지 가능한 상한선이 얼마인지 확인했나요?',
    ...(purposeAnalysis.nextQuestions || []),
    coverageMatches.some((item) => item.status !== 'matched') && '미매칭 니즈는 별도 특약이나 다른 상품으로 보완해야 하나요?',
    hasUnknownAge && '상품별 정확한 가입연령과 납입기간을 확인했나요?'
  ].filter(Boolean);
  const managerCodes = Array.isArray(profile.managerCodes) ? profile.managerCodes : buildPolibotManagerCodeRecommendations(profile);
  const actualCodes = Array.isArray(profile.actualCodes) ? profile.actualCodes : buildPolibotActualCodes(profile);
  const exceptionDiseaseMatches = Array.isArray(profile.exceptionDiseaseMatches) ? profile.exceptionDiseaseMatches : buildPolibotExceptionDiseaseMatches(profile);
  const matchedCoverageCodes = Array.isArray(profile.matchedCoverageCodes) ? profile.matchedCoverageCodes : [];
  const designManagerSummary = buildPolibotDesignManagerSummary({
    profile,
    decisionAnalysis: {
      medicalRisk,
      underwritingRoute,
      coveragePriority,
      priceStrategy
    },
    managerCodes,
    actualCodes,
    exceptionDiseaseMatches,
    matchedCoverageCodes,
    catalogItems
  });
  return {
    eligibilityLevel,
    decisionScore,
    medicalRisk,
    managerCodes,
    actualCodes,
    matchedCoverageCodes,
    designManagerSummary,
    disclosureTimeline,
    underwritingRoute,
    priceStrategy,
    purposeAnalysis,
    premiumFit,
    evidenceIntegrity,
    premiumReferences: premiumReferences.slice(0, 8),
    ageChecks,
    coverageMatches,
    coveragePriority,
    underwritingChecklist,
    itemDiagnostics,
    itemDecisionSummary,
    companyOutlook,
    why,
    nextQuestions
  };
}

async function getGrant(userId, productId) {
  const product = productById(productId);
  if (!product || !ALLOWED_PRODUCTS.has(product.id)) {
    const error = new Error('지원하지 않는 제품입니다.');
    error.status = 404;
    throw error;
  }
  const [grant, user] = await Promise.all([
    dbGet('user_products', { user_id: userId, product_id: product.id }),
    dbGet('users', { id: userId }).catch(() => null)
  ]);
  if (!grant || grant.status === 'suspended' || grant.status === 'expired') {
    const error = new Error('제품 사용 권한이 필요합니다.');
    error.status = 403;
    throw error;
  }
  return {
    ...grant,
    unlimitedUsage: grantHasUnlimitedUsage(grant, user)
  };
}

async function updateWorkspace(userId, productId, patch) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  const next = {
    ...current,
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

async function updateWorkspaceAndConsume(userId, productId, patch) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, productId);
  if (usage.remaining <= 0) {
    const error = new Error('사용 가능 횟수가 남아 있지 않습니다.');
    error.status = 402;
    throw error;
  }
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  if (grant.unlimitedUsage) {
    const next = {
      ...current,
      workspace: {
        ...workspace,
        ...patch,
        updatedAt: now()
      }
    };
    const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
    const settings = updated?.settings || next;
    return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: true }, productId);
  }
  const nextUsage = {
    limit: usage.limit,
    used: usage.used + 1
  };
  const next = {
    ...current,
    usage: {
      ...usageRoot,
      [productId]: nextUsage
    },
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, settings, productId);
}

async function updateWorkspaceAndConsumeCount(userId, productId, patchBuilder, consumeCount = 1) {
  const grant = await getGrant(userId, productId);
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usageRoot = current.usage && typeof current.usage === 'object' ? current.usage : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, productId);
  const count = Math.max(1, Number(consumeCount || 1));
  if (!grant.unlimitedUsage && usage.remaining < count) {
    const error = new Error('사용 가능 횟수가 부족합니다.');
    error.status = 402;
    error.remaining = usage.remaining;
    throw error;
  }
  const workspace = current.workspace && typeof current.workspace === 'object' ? current.workspace : {};
  const patch = typeof patchBuilder === 'function' ? patchBuilder(workspace, usage) : patchBuilder;
  const next = {
    ...current,
    ...(grant.unlimitedUsage ? {} : {
      usage: {
        ...usageRoot,
        [productId]: {
          limit: usage.limit,
          used: usage.used + count
        }
      }
    }),
    workspace: {
      ...workspace,
      ...patch,
      updatedAt: now()
    }
  };
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  const settings = updated?.settings || next;
  return withUsage(settings.workspace || next.workspace, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

export async function getProductWorkspace(userId, productId) {
  const timing = productId === 'polibot' ? createPolibotTimingLogger('polibot_workspace_timing') : null;
  const grant = await getGrant(userId, productId);
  timing?.mark('grant');
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const next = { ...workspace };
  if (Array.isArray(next.analysisResults)) next.analysisResults = sortDexorResults(next.analysisResults);
  if (Array.isArray(next.infludexResults)) next.infludexResults = sortInfludexResults(next.infludexResults);
  if (productId === 'polibot') {
    const rawCurrentKnowledge = Array.isArray(next.knowledgeSources) ? next.knowledgeSources : [];
    const dbKnowledge = await listPolibotDbKnowledgeSources(userId).catch((error) => {
      console.warn('[polibot_workspace_knowledge_load_failed]', error?.message || error);
      return [];
    });
    timing?.mark('knowledge_load');
    const currentKnowledge = dbKnowledge.length ? [] : rawCurrentKnowledge;
    const seedKnowledge = dbKnowledge.length ? [] : polibotSeedKnowledgeSources();
    const catalogReviews = attachPolibotCatalogItemCache(normalizeCatalogReviews(next.catalogReviews));
    const merged = [...dbKnowledge, ...currentKnowledge, ...seedKnowledge];
    next.knowledgeSources = merged
      .filter((item, index, all) => all.findIndex((row) => row.id === item.id || `${row.month}-${row.fileName}` === `${item.month}-${item.fileName}`) === index)
      .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
      .slice(0, 500)
      .map((source) => ({
        ...source,
        catalogItems: sourceCatalogItems(source, catalogReviews)
      }));
    timing?.mark('catalog_items');
    next.catalogReviews = catalogReviews;
    next.latestKnowledgeMonth = next.knowledgeSources[0]?.month || next.latestKnowledgeMonth || '';
    next.catalog = buildPolibotCatalog(next.knowledgeSources);
    timing?.mark('catalog');
    next.qualityReport = next.knowledgeSources.length && next.knowledgeSources.every((source) => source.dbSourceId)
      ? buildPolibotDbQualityReport(next.knowledgeSources)
      : buildPolibotQualityReport(next.knowledgeSources, catalogReviews);
    timing?.mark('quality_report');
    next.knowledgeDbSummary = {
      ...EMPTY_POLIBOT_KNOWLEDGE_DB_SUMMARY,
      ...buildPolibotLightKnowledgeSummary(next.knowledgeSources),
      companies: (next.qualityReport?.companies || []).map((name) => ({ name, count: 0 })),
      productGroups: (next.qualityReport?.productGroups || []).map((name) => ({ name, count: 0 }))
    };
    next.monthlyChangeReport = next.knowledgeSources.length <= 80
      ? buildPolibotMonthlyChangeReport(next.knowledgeSources, catalogReviews)
      : next.monthlyChangeReport || { added: [], changed: [], removed: [] };
    timing?.mark('summary');
    timing?.flush({
      sourceCount: next.knowledgeSources.length,
      catalogItemCount: next.knowledgeSources.reduce((sum, source) => sum + (Array.isArray(source.catalogItems) ? source.catalogItems.length : 0), 0)
    });
    next.knowledgeSources = next.knowledgeSources.map(compactPolibotClientKnowledgeSource);
    next.qualityReport = compactPolibotClientQualityReport(next.qualityReport);
  }
  return withUsage(next, { ...settings, unlimitedUsage: grant.unlimitedUsage }, productId);
}

export async function getPolibotCustomerWorkspace(userId) {
  const grant = await getGrant(userId, 'polibot');
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  return compactPolibotSavedWorkspace(withUsage(workspace, { ...settings, unlimitedUsage: grant.unlimitedUsage }, 'polibot'));
}

function createPolibotTimingLogger(label = 'polibot_timing') {
  const startedAt = Date.now();
  let previousAt = startedAt;
  const stages = [];
  return {
    mark(stage) {
      const currentAt = Date.now();
      stages.push({ stage, ms: currentAt - previousAt });
      previousAt = currentAt;
    },
    flush(extra = {}) {
      const totalMs = Date.now() - startedAt;
      const slowStages = stages.filter((item) => item.ms >= POLIBOT_RECOMMEND_TIMING_WARN_MS);
      if (totalMs >= POLIBOT_RECOMMEND_TIMING_WARN_MS || slowStages.length) {
        console.warn(`[${label}]`, {
          totalMs,
          slowStages,
          stages,
          ...extra
        });
      }
    }
  };
}

function buildPolibotLightKnowledgeSummary(knowledgeSources = []) {
  const catalogItems = knowledgeSources.flatMap((source) => Array.isArray(source.catalogItems) ? source.catalogItems : []);
  return {
    totalSources: knowledgeSources.length,
    globalSources: knowledgeSources.filter((source) => source.scope === 'global').length,
    userSources: knowledgeSources.filter((source) => source.scope === 'user').length,
    importedSources: knowledgeSources.filter((source) => source.sourceChannel === 'local_ingest' || source.sourceSystem === 'polibot_core').length,
    latestMonth: knowledgeSources.map((source) => source.month).filter(Boolean).sort().reverse()[0] || '',
    recommendableCatalogItems: catalogItems.filter((item) => item.status === 'confirmed' || item.status === 'recommendable').length,
    importedCatalogItems: catalogItems.filter((item) => String(item.id || '').startsWith('imported-')).length,
    reviewNeededCatalogItems: catalogItems.filter((item) => item.status === 'review' || item.status === 'review_needed').length,
    conflictCatalogItems: catalogItems.filter((item) => item.status === 'conflict').length,
    privacyRiskSources: knowledgeSources.filter((source) => source.knowledgeStatus === 'privacy_risk').length,
    highQualitySources: knowledgeSources.filter((source) => Number(source.evidenceQualityScore || 0) >= 78).length
  };
}

async function getPolibotRecommendationContext(userId, timing = null) {
  const grant = await getGrant(userId, 'polibot');
  timing?.mark('grant');
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const workspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const rawCurrentKnowledge = Array.isArray(workspace.knowledgeSources) ? workspace.knowledgeSources : [];
  const dbKnowledge = await listPolibotDbKnowledgeSources(userId).catch((error) => {
    console.warn('[polibot_recommend_knowledge_load_failed]', error?.message || error);
    return [];
  });
  timing?.mark('knowledge_load');
  const currentKnowledge = dbKnowledge.length ? [] : rawCurrentKnowledge;
  const seedKnowledge = dbKnowledge.length ? [] : polibotSeedKnowledgeSources();
  const catalogReviews = attachPolibotCatalogItemCache(normalizeCatalogReviews(workspace.catalogReviews));
  const knowledgeSources = [...dbKnowledge, ...currentKnowledge, ...seedKnowledge]
    .filter((item, index, all) => all.findIndex((row) => row.id === item.id || `${row.month}-${row.fileName}` === `${item.month}-${item.fileName}`) === index)
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, 500)
    .map((source) => ({
      ...source,
      catalogItems: sourceCatalogItems(source, catalogReviews)
    }));
  timing?.mark('catalog_items');
  const qualityReport = knowledgeSources.length && knowledgeSources.every((source) => source.dbSourceId)
    ? buildPolibotDbQualityReport(knowledgeSources)
    : buildPolibotRecommendationQualityReport(knowledgeSources, catalogReviews);
  timing?.mark('quality_report');
  return {
    workspace: withUsage({
      ...workspace,
      knowledgeSources,
      catalogReviews,
      latestKnowledgeMonth: knowledgeSources[0]?.month || workspace.latestKnowledgeMonth || '',
      qualityReport,
      knowledgeDbSummary: buildPolibotLightKnowledgeSummary(knowledgeSources)
    }, { ...settings, unlimitedUsage: grant.unlimitedUsage }, 'polibot'),
    knowledgeSources,
    catalogReviews,
    qualityReport
  };
}

export async function startAuvibotAutomationRun(userId, input = {}) {
  if (process.env.AUVIBOT_RENDER_WORKER_ENABLED !== 'true') {
    const error = new Error('AUVIBOT 영상 렌더 자동화는 관리자 테스트 중입니다. 고객용 실행은 렌더 워커 배포 후 사용할 수 있습니다.');
    error.status = 503;
    error.code = 'AUVIBOT_RENDER_WORKER_NOT_READY';
    throw error;
  }
  const grant = await getGrant(userId, 'auvibot');
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const usage = normalizeUsage({ ...current, unlimitedUsage: grant.unlimitedUsage }, 'auvibot');
  const requestedCount = Math.max(1, Math.min(10, Number(input.count || 1)));
  const count = grant.unlimitedUsage ? requestedCount : Math.min(requestedCount, usage.remaining);
  if (count <= 0) {
    const error = new Error('무료 사용이 종료되었습니다. 결제 후 계속 이용할 수 있습니다.');
    error.status = 402;
    error.code = 'AUVIBOT_FREE_USAGE_ENDED';
    throw error;
  }
  const nowIso = now();
  const sourceMode = ['mixed', 'product-first', 'trend-first'].includes(input.sourceMode) ? input.sourceMode : 'mixed';
  const quality = ['conversion', 'trend', 'safe'].includes(input.quality) ? input.quality : 'conversion';
  const category = String(input.category || '전체').trim() || '전체';
  const workspace = await updateWorkspaceAndConsumeCount(userId, 'auvibot', (currentWorkspace = {}) => {
    const jobs = Array.isArray(currentWorkspace.jobs) ? currentWorkspace.jobs : [];
    const nextJobs = Array.from({ length: count }).map((_, index) => ({
      id: `auvibot-${Date.now()}-${index}`,
      status: 'queued',
      sourceMode,
      quality,
      category,
      createdAt: nowIso,
      title: category === '전체' ? '자동 주제 쇼츠' : `${category} 쇼츠`
    }));
    return {
      jobs: [...nextJobs, ...jobs].slice(0, 50),
      lastRunAt: nowIso,
      lastRun: {
        sourceMode,
        quality,
        category,
        requestedCount,
        acceptedCount: count
      }
    };
  }, count);
  return {
    ok: true,
    status: 'queued',
    workspace
  };
}

export async function searchPolibotCoverageCodes(userId, params = {}) {
  await getGrant(userId, 'polibot');
  const query = String(params.query || params.q || '').trim();
  const company = String(params.company || '').trim();
  const coverage = String(params.coverage || '').trim();
  const results = await searchPolibotCodeCandidates(userId, {
    query,
    company,
    coverage,
    limit: params.limit || 30
  });
  return {
    query,
    company,
    coverage,
    count: results.length,
    results,
    notice: results.length
      ? '검수 상태가 함께 표시됩니다. 추천 가능 상태가 아닌 근거는 고객 제시 전 확인이 필요합니다.'
      : '일치하는 코드 후보를 찾지 못했습니다. 보장명, 보험사, 숫자 코드를 바꿔 다시 검색해 주세요.'
  };
}

const SUBLOG_CATEGORIES = new Set(['AI', '영상', '음악', '생산성', '클라우드', '업무', '마케팅', '개발', '기타']);
const SUBLOG_CURRENCIES = new Set(['KRW', 'USD']);

function mapSublogSubscription(row = {}) {
  return {
    id: row.id,
    name: row.name || '',
    amount: Number(row.amount || 0),
    currency: row.currency || 'KRW',
    billingDay: Number(row.billing_day || 1),
    category: row.category || '기타',
    memo: row.memo || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || row.created_at || null
  };
}

function normalizeSublogPayload(input = {}) {
  const name = String(input.name || '').trim();
  const amount = Number(String(input.amount ?? '').replace(/,/g, ''));
  const currency = SUBLOG_CURRENCIES.has(String(input.currency || '').toUpperCase())
    ? String(input.currency).toUpperCase()
    : 'KRW';
  const billingDay = Math.min(31, Math.max(1, Number(input.billingDay || input.billing_day || 1) || 1));
  const rawCategory = String(input.category || '기타').trim();
  const category = SUBLOG_CATEGORIES.has(rawCategory) ? rawCategory : '기타';
  const memo = String(input.memo || '').trim().slice(0, 500);
  if (!name) {
    const error = new Error('구독 이름을 입력해주세요.');
    error.status = 400;
    throw error;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    const error = new Error('구독 금액을 입력해주세요.');
    error.status = 400;
    throw error;
  }
  return {
    name: name.slice(0, 120),
    amount,
    currency,
    billing_day: billingDay,
    category,
    memo
  };
}

export async function listSublogSubscriptions(userId) {
  await getGrant(userId, 'sublog');
  const rows = await dbList('sublog_subscriptions', { user_id: userId }, { order: 'created_at', ascending: false });
  return { items: rows.map(mapSublogSubscription) };
}

export async function saveSublogSubscription(userId, input = {}) {
  await getGrant(userId, 'sublog');
  const payload = normalizeSublogPayload(input);
  const id = String(input.id || '').trim();
  if (id) {
    const existing = await dbGet('sublog_subscriptions', { id, user_id: userId });
    if (!existing) {
      const error = new Error('구독 항목을 찾을 수 없습니다.');
      error.status = 404;
      throw error;
    }
    const [updated] = await dbUpdate('sublog_subscriptions', { id, user_id: userId }, payload);
    return { item: mapSublogSubscription(updated) };
  }
  const inserted = await dbInsert('sublog_subscriptions', { user_id: userId, ...payload });
  return { item: mapSublogSubscription(inserted) };
}

export async function deleteSublogSubscription(userId, subscriptionId) {
  await getGrant(userId, 'sublog');
  const id = String(subscriptionId || '').trim();
  const existing = id ? await dbGet('sublog_subscriptions', { id, user_id: userId }) : null;
  if (!existing) {
    const error = new Error('구독 항목을 찾을 수 없습니다.');
    error.status = 404;
    throw error;
  }
  await dbDelete('sublog_subscriptions', { id, user_id: userId });
  return { ok: true };
}

export async function saveDexorCandidates(userId, { urls = '', fileName = '', targetCategory = '' } = {}) {
  const parsed = parseCandidateRows(urls, fileName);
  const normalizedTargetCategory = normalizeDexorCategory(targetCategory) || '기타';
  const candidates = parsed.length > 0
    ? parsed
    : parseUrls(urls).map((url, index) => ({
      id: `dexor-${hashText(`${url}-${index}`)}`,
      url,
      source: fileName ? 'file-or-manual' : 'manual',
      blogName: deriveBlogNameFromUrl(url),
      candidateCategory: '',
      createdAt: now()
    }));
  return updateWorkspace(userId, 'dexor', {
    candidates,
    targetCategory: normalizedTargetCategory,
    fileName: String(fileName || '').trim(),
    analysisResults: []
  });
}

function buildDexorFallbackAnalysisResult(candidate, workspace = {}) {
    const hash = hashText(candidate.url);
    const targetCategory = normalizeDexorCategory(workspace.targetCategory) || '기타';
    const candidateCategory = normalizeDexorCategory(candidate.candidateCategory) || '미입력';
    const recentTime = candidate.recentPostAt ? new Date(candidate.recentPostAt.replace(/[./]/g, '-')).getTime() : 0;
    const daysSinceRecent = recentTime ? Math.floor((Date.now() - recentTime) / (24 * 60 * 60 * 1000)) : null;
    const naverBonus = /blog\.naver\.com/i.test(candidate.url) ? 6 : 0;
    const longUrlPenalty = candidate.url.length > 120 ? 3 : 0;
    const freshnessBonus = daysSinceRecent === null ? 0 : daysSinceRecent <= 14 ? 12 : daysSinceRecent <= 45 ? 8 : daysSinceRecent <= 90 ? 3 : -8;
    const visitBonus = Number(candidate.visitEstimate || 0) >= 10000 ? 10 : Number(candidate.visitEstimate || 0) >= 3000 ? 7 : Number(candidate.visitEstimate || 0) >= 1000 ? 4 : Number(candidate.visitEstimate || 0) > 0 ? 1 : 0;
    const reactionBonus = Number(candidate.reactionEstimate || 0) >= 100 ? 8 : Number(candidate.reactionEstimate || 0) >= 30 ? 5 : Number(candidate.reactionEstimate || 0) >= 10 ? 2 : 0;
    const adPenalty = candidate.adMemo ? 12 : 0;
    const categoryBonus = candidateCategory === '미입력' || targetCategory === '기타'
      ? 0
      : candidateCategory === targetCategory ? 18 : -16;
    const legacyIndex = normalizeLegacyDexorIndex(candidate.legacyIndex);
    const legacyBonus = legacyIndex === '고급' ? 10 : legacyIndex === '중급' ? 4 : legacyIndex === '초급' ? -12 : 0;
    const contentQualityScore = dexorContentQualitySignal(candidate);
    const qualityBonus = contentQualityScore >= 80 ? 6 : contentQualityScore >= 65 ? 3 : contentQualityScore < 40 ? -8 : contentQualityScore < 55 ? -3 : 0;
    const exposureSignal = dexorExposureSignal({
      candidate,
      targetCategory,
      candidateCategory,
      daysSinceRecent
    });
    const tieBreaker = hash % 5;
    const score = Math.max(20, Math.min(98, 50 + tieBreaker + naverBonus + freshnessBonus + visitBonus + reactionBonus + categoryBonus + legacyBonus + exposureSignal.bonus + qualityBonus - longUrlPenalty - adPenalty));
    const scoreLabel = dexorScoreLabel(score);
    const scoreComment = dexorScoreComment(score);
    const riskFlags = [
      candidate.adMemo ? '광고성 콘텐츠 신호' : '',
      daysSinceRecent !== null && daysSinceRecent > 60 ? '최근 활동 약함' : '',
      candidateCategory !== '미입력' && targetCategory !== '기타' && candidateCategory !== targetCategory ? '카테고리 불일치' : ''
    ].filter(Boolean);
    const strengthened = strengthenDexorResult({
      score,
      scoreLabel,
      candidate,
      daysSinceRecent,
      targetCategory,
      candidateCategory,
      exposureSignal,
      contentQualityScore,
      riskFlags
    });
    const summaryReasons = [
      /blog\.naver\.com/i.test(candidate.url) ? '네이버' : '외부',
      candidateCategory !== '미입력' && targetCategory !== '기타' ? (candidateCategory === targetCategory ? '카테고리 일치' : '카테고리 다름') : '',
      daysSinceRecent === null ? '' : daysSinceRecent <= 45 ? '최근 활동 양호' : '최근 활동 확인',
      candidate.visitEstimate ? `조회 ${candidate.visitEstimate}` : '',
      candidate.reactionEstimate ? `반응 ${candidate.reactionEstimate}` : '',
      exposureSignal.rank ? `검색 ${exposureSignal.rank}위권` : '',
      candidate.legacyIndex ? `기존 지수 ${candidate.legacyIndex}` : '',
      candidate.adMemo ? '광고성 확인' : ''
    ].filter(Boolean);
    const reasonSummary = summaryReasons.join(' · ') || '기본 지표 기준';
    return {
      id: candidate.id,
      url: candidate.url,
      blogName: candidate.blogName || deriveBlogNameFromUrl(candidate.url) || '미입력',
      targetCategory,
      candidateCategory,
      legacyIndex: strengthened.legacyIndex,
      score,
      grade: scoreLabel,
      scoreLabel,
      scoreComment,
      originalScore: strengthened.originalScore,
      originalGrade: strengthened.originalGrade,
      strengthenedScore: strengthened.strengthenedScore,
      strengthenedGrade: strengthened.strengthenedGrade,
      strengthenedDecision: strengthened.strengthenedDecision,
      dataConfidence: strengthened.dataConfidence,
      verificationFlags: strengthened.verificationFlags,
      searchValidation: strengthened.searchValidation,
      contentQualityScore,
      gradeStatus: strengthened.gradeStatus,
      visitEstimate: candidate.visitEstimate ?? null,
      reactionEstimate: candidate.reactionEstimate ?? null,
      recentPostAt: candidate.recentPostAt || '',
      searchRank: candidate.searchRank ?? null,
      exposureKeywordCount: candidate.exposureKeywordCount ?? 0,
      riskFlags,
      reasonSummary,
      reasons: [reasonSummary],
      analyzedAt: now()
    };
}

function buildDexorRssAnalysisResult(candidate, workspace = {}, exposureResult) {
  const targetCategory = normalizeDexorCategory(workspace.targetCategory) || '기타';
  const candidateCategory = normalizeDexorCategory(candidate.candidateCategory) || '미입력';
  const breakdown = exposureResult.breakdown || {};
  const latestPostDays = Number.isFinite(Number(breakdown.latestPostDays)) ? Number(breakdown.latestPostDays) : null;
  const recentPostAt = latestPostDays === null
    ? ''
    : formatDexorDate(new Date(Date.now() - latestPostDays * 24 * 60 * 60 * 1000));
  const contentQualityScore = Math.round(dexorClamp(
    (Number(breakdown.topicFit || 0) * 0.4)
    + (Number(breakdown.diaFit || 0) * 0.35)
    + (Number(breakdown.activityFit || 0) * 0.25)
  ));
  const sourceStatus = breakdown.sourceStatus || 'public-rss';
  const dataConfidence = {
    level: sourceStatus === 'public-rss' ? '높음' : '보통',
    score: sourceStatus === 'public-rss' ? 88 : 66,
    sourceLabel: sourceStatus === 'public-rss' ? '네이버 RSS 실측' : '공개 신호 추정',
    reason: sourceStatus === 'public-rss'
      ? '최근 공개 RSS 글을 직접 읽어 주제, 활동성, 광고 신호를 계산했습니다.'
      : '공개 데이터 일부만 확인되어 추정 신호를 함께 반영했습니다.'
  };
  const score = Math.max(0, Math.min(100, Math.round(Number(exposureResult.score || 0))));
  const grade = exposureResult.grade || dexorScoreLabel(score);
  const recentKeywordCheck = breakdown.recentKeywordCheck || {};
  const reasonSummary = [
    exposureResult.category ? `${exposureResult.category} 기준` : '',
    `주제 ${breakdown.topicFit ?? '-'}점`,
    `최근 10개 중 ${recentKeywordCheck.matchedCount ?? 0}개 관련`,
    `최근 5개 중 ${recentKeywordCheck.recentFiveMatchedCount ?? 0}개 관련`,
    latestPostDays === null ? '' : latestPostDays <= 45 ? '최근 활동 양호' : '최근 활동 확인'
  ].filter(Boolean).join(' · ');
  return {
    id: candidate.id,
    url: candidate.url,
    blogName: candidate.blogName || deriveBlogNameFromUrl(candidate.url) || '미입력',
    targetCategory,
    candidateCategory,
    legacyIndex: normalizeLegacyDexorIndex(candidate.legacyIndex),
    score,
    grade,
    scoreLabel: grade,
    scoreComment: dexorScoreComment(score),
    originalScore: score,
    originalGrade: grade,
    strengthenedScore: score,
    strengthenedGrade: grade,
    strengthenedDecision: exposureResult.decision || dexorScoreComment(score),
    dataConfidence,
    verificationFlags: [...new Set(exposureResult.riskFlags || [])],
    searchValidation: {
      status: breakdown.exposureSignal?.status || recentKeywordCheck.status || 'normal',
      score: Number(breakdown.topicFit || 0),
      rank: null,
      keywordCount: recentKeywordCheck.matchedCount || 0,
      label: breakdown.exposureSignal?.label || recentKeywordCheck.label || 'RSS 공개 신호 확인'
    },
    contentQualityScore,
    gradeStatus: '유지',
    visitEstimate: breakdown.dailyVisitorSignal?.estimatedAverage || candidate.visitEstimate || null,
    reactionEstimate: candidate.reactionEstimate ?? null,
    recentPostAt,
    searchRank: candidate.searchRank ?? null,
    exposureKeywordCount: recentKeywordCheck.matchedCount || candidate.exposureKeywordCount || 0,
    riskFlags: exposureResult.riskFlags || [],
    reasonSummary,
    reasons: exposureResult.reasons || [reasonSummary],
    breakdown,
    analyzedAt: now()
  };
}

async function analyzeDexorCandidateWithRss(candidate, workspace = {}) {
  const targetCategory = normalizeDexorCategory(workspace.targetCategory) || '기타';
  const candidateCategory = normalizeDexorCategory(candidate.candidateCategory) || '';
  const industry = targetCategory === '기타'
    ? dexorCategoryToIndustry(candidateCategory)
    : dexorCategoryToIndustry(targetCategory);
  const exposureResult = await dexorAnalyzeExposurePotential(candidate.url, 'quick', {
    industry,
    keyword: ''
  });
  return buildDexorRssAnalysisResult(candidate, workspace, exposureResult);
}

export async function analyzeDexorCandidates(userId) {
  const workspace = await getProductWorkspace(userId, 'dexor');
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  if (candidates.length === 0) {
    const error = new Error('분석할 후보가 없습니다.');
    error.status = 400;
    throw error;
  }
  const analysisResults = [];
  for (const candidate of candidates) {
    try {
      analysisResults.push(await analyzeDexorCandidateWithRss(candidate, workspace));
    } catch {
      analysisResults.push(buildDexorFallbackAnalysisResult(candidate, workspace));
    }
  }
  const sortedResults = sortDexorResults(analysisResults);
  return updateWorkspaceAndConsume(userId, 'dexor', { analysisResults: sortedResults });
}

export async function resetDexorWorkspace(userId) {
  return updateWorkspace(userId, 'dexor', {
    candidates: [],
    targetCategory: '기타',
    fileName: '',
    analysisResults: []
  });
}

export async function saveInfludexCandidates(userId, { rows = '', fileName = '', files = [] } = {}) {
  const current = await getProductWorkspace(userId, 'infludex');
  const fileRows = infludexRowsFromFiles(files);
  const mergedRows = [String(rows || '').trim(), fileRows.trim()].filter(Boolean).join('\n');
  const selectedFileName = String(fileName || files?.[0]?.fileName || files?.[0]?.name || '').trim();
  if (!mergedRows.trim() && Array.isArray(current.candidates) && current.candidates.length > 0) {
    return current;
  }
  const candidates = parseInfludexRows(mergedRows, selectedFileName);
  if (candidates.length === 0) {
    const error = new Error('인스타그램 후보를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  return updateWorkspace(userId, 'infludex', {
    candidates,
    candidateRows: mergedRows,
    fileName: selectedFileName,
    infludexResults: []
  });
}

export async function analyzeInfludexCandidates(userId) {
  const workspace = await getProductWorkspace(userId, 'infludex');
  const candidates = Array.isArray(workspace.candidates) ? workspace.candidates : [];
  if (candidates.length === 0) {
    const error = new Error('분석할 인스타그램 후보가 없습니다.');
    error.status = 400;
    throw error;
  }
  const enrichedCandidates = await enrichInfludexCandidates(candidates);
  const infludexResults = sortInfludexResults(enrichedCandidates.map((candidate) => {
    const analysis = analyzeInfludexCandidate(candidate);
    return {
      id: candidate.id,
      url: candidate.url,
      handle: candidate.handle,
      category: candidate.category || '카테고리 미입력',
      followerCount: candidate.followerCount,
      avgLikes: candidate.avgLikes,
      avgComments: candidate.avgComments,
      avgReelsViews: candidate.avgReelsViews,
      recentReelsCount: candidate.recentReelsCount ?? null,
      recentReelsMetricSource: candidate.recentReelsMetricSource || '',
      recentPostAt: candidate.recentPostAt || '',
      displayName: candidate.displayName || '',
      description: candidate.description || '',
      bio: candidate.bio || '',
      targetCategory: candidate.targetCategory || candidate.campaignCategory || '',
      contactMemo: candidate.contactMemo || '',
      adMemo: candidate.adMemo || '',
      enrichmentStatus: candidate.enrichmentStatus || '',
      engagementRate: analysis.engagementRate,
      reelsViewRate: analysis.reelsViewRate,
      commentShare: analysis.commentShare,
      score: analysis.score,
      grade: analysis.grade,
      originalScore: analysis.originalScore ?? analysis.score,
      originalGrade: analysis.originalGrade || analysis.grade,
      finalScore: analysis.finalScore ?? analysis.score,
      finalGrade: analysis.finalGrade || analysis.grade,
      decision: analysis.decision || '',
      dataConfidence: analysis.dataConfidence ?? null,
      categorySignal: analysis.categorySignal || null,
      gradeStatus: analysis.gradeStatus || '유지',
      analysisStatus: analysis.analysisStatus,
      scoreBreakdown: analysis.scoreBreakdown,
      gradeReason: analysis.gradeReason,
      riskFlags: analysis.riskFlags,
      reasons: analysis.gradeReason,
      analyzedAt: now()
    };
  }));
  return updateWorkspaceAndConsume(userId, 'infludex', { candidates: enrichedCandidates, infludexResults });
}

export async function resetInfludexWorkspace(userId) {
  return updateWorkspace(userId, 'infludex', {
    candidates: [],
    candidateRows: '',
    fileName: '',
    infludexResults: []
  });
}

export async function savePolibotUpload(userId, { fileName = '', note = '' } = {}) {
  const cleanFileName = String(fileName || '').trim();
  const cleanNote = String(note || '').trim();
  if (!cleanFileName && !cleanNote) {
    const error = new Error('보험 상품 PDF 또는 메모를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  return updateWorkspace(userId, 'polibot', {
    upload: {
      fileName: cleanFileName,
      note: cleanNote,
      parsedProducts: cleanFileName ? 8 + (hashText(cleanFileName) % 17) : 0,
      uploadedAt: now()
    }
  });
}

export async function savePolibotKnowledge(userId, { files = [], month = '', note = '' } = {}) {
  const items = await normalizePolibotKnowledgeItems({ files, month, note });
  if (items.length === 0) {
    const error = new Error('월별 자료 파일명 또는 메모를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  await ingestPolibotKnowledge({
    userId,
    scope: 'user',
    sourceChannel: 'web_upload',
    sourceLabel: month || 'POLIBOT 웹 업로드',
    files,
    month,
    note
  });
  const grant = await getGrant(userId, 'polibot');
  const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const rawWorkspace = settings.workspace && typeof settings.workspace === 'object' ? settings.workspace : {};
  const current = Array.isArray(rawWorkspace.knowledgeSources) ? rawWorkspace.knowledgeSources : [];
  const knowledgeSources = [...items, ...current]
    .sort((a, b) => String(b.month || '').localeCompare(String(a.month || '')) || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
    .slice(0, 500);
  return updateWorkspace(userId, 'polibot', {
    knowledgeSources,
    latestKnowledgeMonth: knowledgeSources[0]?.month || ''
  });
}

function polibotEvidencePayload(source = {}, reviews = {}) {
  const catalogItems = sourceCatalogItems(source, reviews);
  return {
    sourceId: source.dbSourceId || source.id || '',
    dbSourceId: source.dbSourceId || '',
    fileName: source.fileName,
    month: source.month,
    company: source.company,
    companies: source.companies || [],
    productGroup: source.productGroup,
    productNames: [...new Set(catalogItems.map((item) => item.productName).filter(Boolean))].slice(0, 12),
    catalogItems: catalogItems.slice(0, 6).map(compactPolibotClientCatalogItem),
    premiumReferences: (Array.isArray(source.premiumReferences) ? source.premiumReferences : []).slice(0, 6).map((item) => ({
      company: item.company || '',
      productName: compactPolibotText(item.productName || '', 80),
      premium: item.premium || '',
      age: item.age || '',
      gender: item.gender || '',
      linkStatus: item.linkStatus || ''
    })),
    keywords: source.keywordHits?.length ? source.keywordHits : source.keywords || [],
    matchScore: source.matchScore || 0,
    sourceChannel: source.sourceChannel || '',
    knowledgeStatus: source.knowledgeStatus || '',
    evidenceQualityScore: Number(source.evidenceQualityScore || 0),
    evidenceQualityLevel: source.evidenceQualityLevel || '',
    evidenceQualityReasons: source.evidenceQualityReasons || [],
    targetAudience: source.targetAudience || [],
    cautions: source.cautions || [],
    summary: source.summary || ''
  };
}

function compactPolibotText(value = '', max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function compactPolibotClientCoverage(item = {}) {
  return {
    category: item.fineCategory || item.category || '',
    title: compactPolibotText(item.title || '', 80),
    amount: compactPolibotText(item.amount || '', 40)
  };
}

function compactPolibotClientCatalogItem(item = {}) {
  const decisionBreakdown = item.decisionBreakdown || {};
  return {
    id: item.id || '',
    sourceId: item.sourceId || '',
    productName: compactPolibotText(item.productName || '', 120),
    company: item.company || '',
    productGroup: item.productGroup || '',
    coverageKeywords: (item.coverageKeywords || []).slice(0, 10),
    ageRange: item.ageRange || '',
    paymentTerm: item.paymentTerm || '',
    renewalType: item.renewalType || '',
    disclosureMemo: compactPolibotText(item.disclosureMemo || '', 160),
    reductionMemo: compactPolibotText(item.reductionMemo || '', 120),
    premiumExample: item.premiumExample || '',
    premiumExamples: (item.premiumExamples || []).slice(0, 3),
    premiumTableRows: (item.premiumTableRows || []).slice(0, 3),
    premiumConfidence: item.premiumConfidence || '',
    refundRate: item.refundRate || '',
    coverageDetails: (item.coverageDetails || []).slice(0, 6).map(compactPolibotClientCoverage),
    coverageTableRows: (item.coverageTableRows || []).slice(0, 4).map(compactPolibotClientCoverage),
    conditionRules: {
      ageRules: (item.conditionRules?.ageRules || []).slice(0, 3),
      paymentTerms: (item.conditionRules?.paymentTerms || []).slice(0, 3),
      underwritingTypes: (item.conditionRules?.underwritingTypes || []).slice(0, 4),
      waitingPeriods: (item.conditionRules?.waitingPeriods || []).slice(0, 2).map((value) => compactPolibotText(value, 120))
    },
    linkedBenefitGroups: (item.linkedBenefitGroups || []).slice(0, 2).map((group) => ({
      key: group.key || '',
      plan: compactPolibotText(group.plan || '', 80),
      linkedSummary: compactPolibotText(group.linkedSummary || '', 140),
      linkConfidence: group.linkConfidence || '',
      premiums: (group.premiums || []).slice(0, 3),
      coverages: (group.coverages || []).slice(0, 4).map(compactPolibotClientCoverage),
      conditions: {
        ageRange: group.conditions?.ageRange || '',
        paymentTerm: group.conditions?.paymentTerm || '',
        renewalType: group.conditions?.renewalType || ''
      }
    })),
    evidenceAnchors: (item.evidenceAnchors || []).slice(0, 2).map((anchor) => ({ excerpt: compactPolibotText(anchor.excerpt || '', 120) })),
    decisionBreakdown: decisionBreakdown.level || decisionBreakdown.score ? {
      level: decisionBreakdown.level || '',
      score: decisionBreakdown.score || 0,
      scoreFormula: decisionBreakdown.scoreFormula ? {
        components: (decisionBreakdown.scoreFormula.components || []).slice(0, 8)
      } : null,
      premium: decisionBreakdown.premium ? {
        amount: decisionBreakdown.premium.amount || '',
        status: decisionBreakdown.premium.status || '',
        score: decisionBreakdown.premium.score || 0,
        matchQuality: decisionBreakdown.premium.matchQuality ? {
          label: decisionBreakdown.premium.matchQuality.label || '',
          level: decisionBreakdown.premium.matchQuality.level || ''
        } : null
      } : null,
      age: decisionBreakdown.age ? {
        label: decisionBreakdown.age.label || '',
        status: decisionBreakdown.age.status || '',
        score: decisionBreakdown.age.score || 0
      } : null,
      underwriting: decisionBreakdown.underwriting ? {
        status: decisionBreakdown.underwriting.status || '',
        score: decisionBreakdown.underwriting.score || 0,
        classification: decisionBreakdown.underwriting.classification ? {
          label: decisionBreakdown.underwriting.classification.label || '',
          level: decisionBreakdown.underwriting.classification.level || ''
        } : null
      } : null,
      evidence: decisionBreakdown.evidence ? {
        score: decisionBreakdown.evidence.score || 0,
        quality: decisionBreakdown.evidence.quality ? {
          level: decisionBreakdown.evidence.quality.level || '',
          label: decisionBreakdown.evidence.quality.label || ''
        } : null
      } : null,
      strengths: (decisionBreakdown.strengths || []).slice(0, 3),
      blockers: (decisionBreakdown.blockers || []).slice(0, 3)
    } : null,
    targetAudience: (item.targetAudience || []).slice(0, 5),
    excludedAudience: (item.excludedAudience || []).slice(0, 5),
    cautionMemo: compactPolibotText(item.cautionMemo || '', 160),
    completeness: item.completeness || '부족',
    displayKind: item.displayKind || polibotCatalogItemKind(item),
    evidenceFile: item.evidenceFile || '',
    evidenceMonth: item.evidenceMonth || '',
    conflictReasons: (item.conflictReasons || []).slice(0, 4)
  };
}

function compactPolibotClientKnowledgeSource(source = {}) {
  const catalogItems = Array.isArray(source.catalogItems) ? source.catalogItems : [];
  return {
    id: source.id || '',
    dbSourceId: source.dbSourceId || '',
    fileName: source.fileName || '',
    month: source.month || '',
    fileType: source.fileType || '',
    company: source.company || '',
    companies: (source.companies || []).slice(0, 12),
    productGroup: source.productGroup || '',
    productNames: (source.productNames || catalogItems.map((item) => item.productName)).filter(Boolean).slice(0, 12),
    keywords: (source.keywords || []).slice(0, 12),
    scope: source.scope || '',
    sourceChannel: source.sourceChannel || '',
    knowledgeStatus: source.knowledgeStatus || '',
    recommendationEligible: source.recommendationEligible !== false,
    evidenceQualityScore: Number(source.evidenceQualityScore || 0),
    evidenceQualityLevel: source.evidenceQualityLevel || '',
    catalogItemCount: catalogItems.length,
    summary: compactPolibotText(source.summary || source.textSnippet || '', 180),
    uploadedAt: source.uploadedAt || ''
  };
}

function compactPolibotClientQualityReport(report = {}) {
  return {
    totalSources: report.totalSources || 0,
    recommendableProducts: report.recommendableProducts || 0,
    reviewNeededProducts: report.reviewNeededProducts || 0,
    excludedProducts: report.excludedProducts || 0,
    ocrNeeded: report.ocrNeeded || 0,
    privacyRiskSources: report.privacyRiskSources || 0,
    conflictProducts: report.conflictProducts || 0,
    companies: (report.companies || []).slice(0, 80),
    productGroups: (report.productGroups || []).slice(0, 40),
    keywords: (report.keywords || []).slice(0, 40),
    premiumReferenceCount: report.premiumReferenceCount || 0,
    premiumTableRows: report.premiumTableRows || 0,
    linkedBenefitGroups: report.linkedBenefitGroups || 0,
    strongLinkedBenefitGroups: report.strongLinkedBenefitGroups || 0
  };
}

function compactPolibotSavedWorkspace(workspace = {}) {
  return {
    customerProfile: workspace.customerProfile || null,
    consultationDraft: workspace.consultationDraft || null,
    consultationSummary: workspace.consultationSummary || null,
    qualityReport: compactPolibotClientQualityReport(workspace.qualityReport || {}),
    recommendations: Array.isArray(workspace.recommendations) ? workspace.recommendations : [],
    customers: Array.isArray(workspace.customers) ? workspace.customers : [],
    excludedCandidates: Array.isArray(workspace.excludedCandidates) ? workspace.excludedCandidates : [],
    managerCodes: Array.isArray(workspace.managerCodes) ? workspace.managerCodes : [],
    actualCodes: Array.isArray(workspace.actualCodes) ? workspace.actualCodes : [],
    matchedCoverageCodes: Array.isArray(workspace.matchedCoverageCodes) ? workspace.matchedCoverageCodes : [],
    exceptionDiseaseMatches: Array.isArray(workspace.exceptionDiseaseMatches) ? workspace.exceptionDiseaseMatches : [],
    designManagerReview: workspace.designManagerReview || null,
    recommendationNotice: workspace.recommendationNotice || '',
    knowledgeSnapshot: workspace.knowledgeSnapshot || null,
    feedbackSummary: workspace.feedbackSummary || null,
    latestKnowledgeMonth: workspace.latestKnowledgeMonth || workspace.knowledgeSnapshot?.latestKnowledgeMonth || '',
    catalog: workspace.catalog || null,
    usage: workspace.usage || null,
    updatedAt: workspace.updatedAt || ''
  };
}

function compactPolibotDbSummary(summary = {}) {
  return {
    totalSources: summary.totalSources || 0,
    globalSources: summary.globalSources || 0,
    userSources: summary.userSources || 0,
    latestMonth: summary.latestMonth || '',
    recommendableCatalogItems: summary.recommendableCatalogItems || 0,
    importedSources: summary.importedSources || 0,
    importedCatalogItems: summary.importedCatalogItems || 0,
    reviewNeededCatalogItems: summary.reviewNeededCatalogItems || 0,
    conflictCatalogItems: summary.conflictCatalogItems || 0,
    privacyRiskSources: summary.privacyRiskSources || 0,
    highQualitySources: summary.highQualitySources || 0
  };
}

function polibotCatalogItemVersionKey(item = {}) {
  return [
    item.company || '미분류',
    String(item.productName || '').replace(/\s+/g, '')
  ].join('|');
}

function polibotCatalogComparableSnapshot(item = {}) {
  const coverages = [
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => group.coverages || []) : [])
  ];
  const premiums = [
    item.premiumExample,
    ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => row.amount || row.premium) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((premium) => premium.amount)) : [])
  ].filter(Boolean);
  return {
    company: item.company || '',
    productName: item.productName || '',
    productGroup: item.productGroup || '',
    premium: premiums[0] || '',
    premiumSet: [...new Set(premiums)].sort(),
    ageRange: item.ageRange || item.conditionDetails?.ageRange || '',
    renewalType: item.renewalType || item.conditionDetails?.renewalType || '',
    paymentTerm: item.paymentTerm || item.conditionDetails?.paymentTerm || '',
    coverageSet: [...new Set(coverages
      .map((coverage) => [
        coverage.fineCategory || coverage.category || '',
        coverage.title || '',
        coverage.amount || ''
      ].join(' '))
      .filter(Boolean))].sort(),
    underwritingTypes: [...new Set(item.conditionRules?.underwritingTypes || item.conditionDetails?.conditionRules?.underwritingTypes || [])].sort()
  };
}

function firstComparablePremium(snapshot = {}) {
  const value = parsePolibotPremiumAmount(snapshot.premium);
  return Number.isFinite(value) ? value : null;
}

function changedPolibotFields(current = {}, previous = {}) {
  const checks = [
    ['premium', '보험료'],
    ['ageRange', '가입연령'],
    ['renewalType', '갱신/비갱신'],
    ['paymentTerm', '납입/만기'],
    ['coverageSet', '담보/가입금액'],
    ['underwritingTypes', '심사조건']
  ];
  return checks
    .filter(([key]) => JSON.stringify(current[key] || '') !== JSON.stringify(previous[key] || ''))
    .map(([, label]) => label);
}

function polibotChangeDetails(current = {}, previous = {}) {
  const details = [];
  const currentPremium = firstComparablePremium(current);
  const previousPremium = firstComparablePremium(previous);
  if (Number.isFinite(currentPremium) && Number.isFinite(previousPremium) && previousPremium > 0 && currentPremium !== previousPremium) {
    const delta = Math.round((currentPremium - previousPremium) * 10) / 10;
    const rate = Math.round(((currentPremium - previousPremium) / previousPremium) * 1000) / 10;
    details.push(`보험료 ${delta > 0 ? '+' : ''}${formatPolibotPremiumAmount(delta)} (${rate > 0 ? '+' : ''}${rate}%)`);
  }
  const addedCoverages = (current.coverageSet || []).filter((item) => !(previous.coverageSet || []).includes(item));
  const removedCoverages = (previous.coverageSet || []).filter((item) => !(current.coverageSet || []).includes(item));
  if (addedCoverages.length) details.push(`추가 담보 ${addedCoverages.slice(0, 3).join(', ')}`);
  if (removedCoverages.length) details.push(`삭제 담보 ${removedCoverages.slice(0, 3).join(', ')}`);
  if (current.ageRange !== previous.ageRange) details.push(`가입연령 ${previous.ageRange || '-'} → ${current.ageRange || '-'}`);
  if (current.renewalType !== previous.renewalType) details.push(`갱신조건 ${previous.renewalType || '-'} → ${current.renewalType || '-'}`);
  if (JSON.stringify(current.underwritingTypes || []) !== JSON.stringify(previous.underwritingTypes || [])) {
    details.push(`심사조건 ${(previous.underwritingTypes || []).join('/') || '-'} → ${(current.underwritingTypes || []).join('/') || '-'}`);
  }
  return details.slice(0, 8);
}

function buildPolibotMonthlyChangeReport(knowledgeSources = [], reviews = {}) {
  const months = [...new Set(knowledgeSources.map((source) => source.month).filter(Boolean))].sort((a, b) => b.localeCompare(a));
  const [latestMonth, previousMonth] = months;
  if (!latestMonth) {
    return { latestMonth: '', previousMonth: '', added: [], removed: [], changed: [], unchangedCount: 0, summary: '월별 비교할 자료가 아직 없습니다.' };
  }
  if (!previousMonth) {
    return { latestMonth, previousMonth: '', added: [], removed: [], changed: [], unchangedCount: 0, summary: `${latestMonth} 자료만 있어 전월 비교는 대기 중입니다.` };
  }
  const byMonth = (month) => new Map(knowledgeSources
    .filter((source) => source.month === month)
    .flatMap((source) => sourceAllCatalogItems(source, reviews))
    .filter((item) => item.productName)
    .map((item) => [polibotCatalogItemVersionKey(item), polibotCatalogComparableSnapshot(item)]));
  const latest = byMonth(latestMonth);
  const previous = byMonth(previousMonth);
  const added = [...latest.entries()]
    .filter(([key]) => !previous.has(key))
    .map(([, item]) => item)
    .slice(0, 30);
  const removed = [...previous.entries()]
    .filter(([key]) => !latest.has(key))
    .map(([, item]) => item)
    .slice(0, 30);
  const changed = [...latest.entries()]
    .filter(([key]) => previous.has(key))
    .map(([key, item]) => ({
      ...item,
      previous: previous.get(key),
      changedFields: changedPolibotFields(item, previous.get(key)),
      changeDetails: polibotChangeDetails(item, previous.get(key))
    }))
    .filter((item) => item.changedFields.length)
    .slice(0, 30);
  const unchangedCount = [...latest.keys()].filter((key) => previous.has(key) && !changed.some((item) => polibotCatalogItemVersionKey(item) === key)).length;
  return {
    latestMonth,
    previousMonth,
    added,
    removed,
    changed,
    unchangedCount,
    summary: `${latestMonth} vs ${previousMonth}: 신규 ${added.length}개, 변경 ${changed.length}개, 제외 ${removed.length}개`
  };
}

function buildPolibotKnowledgeSnapshot({ workspace = {}, evidence = [], recommendations = [], recommendationNotice = '' } = {}) {
  const usedSources = [...new Map(evidence
    .map((source) => [source.dbSourceId || source.id || source.fileName, source])
    .filter(([key]) => key)
  ).values()].slice(0, 20);
  const usedCatalogItems = recommendations
    .flatMap((recommendation) => recommendation.catalogItems || [])
    .map((item) => ({
      sourceId: item.sourceId || '',
      company: item.company || '',
      productName: item.productName || '',
      evidenceFile: item.evidenceFile || ''
    }))
    .filter((item, index, all) => item.productName && all.findIndex((row) => `${row.company}-${row.productName}-${row.sourceId}` === `${item.company}-${item.productName}-${item.sourceId}`) === index)
    .slice(0, 30);
  return {
    createdAt: now(),
    latestKnowledgeMonth: workspace.latestKnowledgeMonth || '',
    dbSummary: compactPolibotDbSummary(workspace.knowledgeDbSummary || {}),
    usedSources: usedSources.map((source) => ({
      sourceId: source.dbSourceId || source.id || '',
      fileName: source.fileName || '',
      month: source.month || '',
      scope: source.scope || '',
      sourceChannel: source.sourceChannel || '',
      knowledgeStatus: source.knowledgeStatus || '',
      evidenceQualityScore: Number(source.evidenceQualityScore || 0)
    })),
    usedCatalogItems,
    recommendationCount: recommendations.length,
    failureReason: recommendations.length ? '' : recommendationNotice
  };
}

const POLIBOT_GENERIC_PRODUCT_NAMES = new Set([
  '생명보험', '손해보험', '보험상품', '보장성 보험', '보장성보험', '종신보험', '정기보험',
  '건강보험', '암보험', '실손보험', '치매보험', '연금보험', '변액보험', '저축성보험',
  '장기종합보험', '치매간병보험', '어린이보험', '태아보험', '간편건강보험'
]);

const POLIBOT_BAD_PRODUCT_PATTERN = /가이드북|자료이용|상품비교|자료모음|상품전략|금융환경|관심상품|영업이슈|보험의\s*A|상품의\s*기본|간추린|상품\s*안내|본\s*내용|예시된|따라서|고객\s*조건|보장분석|가입담보|님의\s*상품별|판매되고\s*있는|자료는\s*상품|보험이\s*어려운|알쓸신통|주요국가|기준금리|세계\s*경제뉴스|국내\s*경제뉴스|보험시장|비급여|데이터로\s*읽는|2030\s*보험|보험영업에서|반드시\s*챙겨야|사내\s*교육용|교육\s*목적|무단배포|경제뉴스|시장\s*선점|pdf|pptx|xlsx|csv|https?:/i;
const POLIBOT_PURPOSES = ['보장 강화', '보험료 감액', '보험료 절감', '리모델링', '신규 가입', '노후/간병 준비', '자녀/가족 보장'];

function normalizePolibotProductName(value = '') {
  return String(value || '')
    .normalize('NFC')
    .replace(/\.(pdf|pptx?|docx|xlsx|csv|txt)$/ig, ' ')
    .replace(/상품명|구\s*분|보험료|변경월|변경일|작성기준일/gi, ' ')
    .replace(/\r?\n+/g, ' ')
    .replace(/^\s*\d+(?:[,.\d]*원|\s*세)?\s*/g, ' ')
    .replace(/^(?:남성|여성|보장|담보|합계|월납|기준|순위)\s*/g, ' ')
    .replace(/[{}[\]←→󰀲︙]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitPolibotProductText(value = '') {
  const normalized = normalizePolibotProductName(value);
  if (!normalized) return [];
  const matches = normalized.match(/(?:[A-Za-z가-힣0-9+·()ⅡⅢⅣⅤ-]+\s*){1,6}(?:보험|플랜|특약|담보|진단비|수술비|입원비|간병비)(?:\s*(?:Plus|PLUS|플러스|더드림|원픽|하이픽|세븐|Q|Ⅱ|Ⅲ|IV|V|260\d(?:\.\d)?))?/g) || [];
  const direct = normalized.length <= 44 ? [normalized] : [];
  return [...direct, ...matches].map(normalizePolibotProductName);
}

function sourceProductNameCandidates(source = {}) {
  return [
    ...(Array.isArray(source.productNames) ? source.productNames : []),
    String(source.textSnippet || '').slice(0, 2500),
    String(source.summary || '').slice(0, 500)
  ];
}

function normalizeCatalogReviews(reviews = {}) {
  if (!reviews || typeof reviews !== 'object') return {};
  const toList = (value) => {
    if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 20);
    return String(value || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  };
  return Object.fromEntries(Object.entries(reviews)
    .filter(([key, value]) => key && value && typeof value === 'object')
    .slice(0, 1000)
    .map(([key, value]) => [key, {
      status: ['confirmed', 'auto', 'review', 'excluded'].includes(value.status) ? value.status : 'review',
      productName: String(value.productName || '').trim(),
      company: String(value.company || '').trim(),
      productGroup: String(value.productGroup || '').trim(),
      coverageKeywords: toList(value.coverageKeywords),
      ageRange: String(value.ageRange || '').trim(),
      paymentTerm: String(value.paymentTerm || '').trim(),
      renewalType: String(value.renewalType || '').trim(),
      disclosureMemo: String(value.disclosureMemo || '').trim(),
      reductionMemo: String(value.reductionMemo || '').trim(),
      premiumExample: String(value.premiumExample || '').trim(),
      refundRate: String(value.refundRate || '').trim(),
      targetAudience: toList(value.targetAudience),
      excludedAudience: toList(value.excludedAudience),
      cautionMemo: String(value.cautionMemo || '').trim(),
      reason: String(value.reason || '').trim(),
      reviewedAt: value.reviewedAt || now()
    }]));
}

function attachPolibotCatalogItemCache(reviews = {}) {
  if (!reviews || typeof reviews !== 'object') return reviews;
  if (!Object.prototype.hasOwnProperty.call(reviews, '__sourceCatalogItemCache')) {
    Object.defineProperty(reviews, '__sourceCatalogItemCache', {
      value: new Map(),
      enumerable: false,
      configurable: false
    });
  }
  if (!Object.prototype.hasOwnProperty.call(reviews, '__sourceAllCatalogItemCache')) {
    Object.defineProperty(reviews, '__sourceAllCatalogItemCache', {
      value: new Map(),
      enumerable: false,
      configurable: false
    });
  }
  return reviews;
}

function sourceCatalogItems(source = {}, reviews = {}) {
  const cache = reviews && typeof reviews === 'object' ? reviews.__sourceCatalogItemCache : null;
  const cacheKey = cache && (source.dbSourceId || source.id || `${source.month || ''}-${source.fileName || ''}`);
  if (cache && cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  const items = sourceAllCatalogItems(source, reviews);
  const usableItems = items
    .filter((item) => item.status === 'confirmed'
      && Number(item.confidence || 0) >= 80
      && ['충분', '보통'].includes(item.completeness || '부족')
      && isPolibotCatalogItemUsable(item));
  if (cache && cacheKey) cache.set(cacheKey, usableItems);
  return usableItems;
}

function sourceAllCatalogItems(source = {}, reviews = {}) {
  if (Array.isArray(source.catalogItems) && source.catalogItems.length && source.dbSourceId) return source.catalogItems;
  const cache = reviews && typeof reviews === 'object' ? reviews.__sourceAllCatalogItemCache : null;
  const cacheKey = cache && (source.dbSourceId || source.id || `${source.month || ''}-${source.fileName || ''}`);
  if (cache && cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);
  const items = buildPolibotCatalogItems([source], { includeReview: true, reviews });
  if (cache && cacheKey) cache.set(cacheKey, items);
  return items;
}

function catalogItemMatchesNeeds(item = {}, needs = []) {
  if (!Array.isArray(needs) || needs.length === 0) return true;
  const haystack = [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [group.plan, group.linkedSummary, ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount])]) : [])
  ].filter(Boolean).join(' ');
  return needs.some((need) => polibotNeedTerms(need)
    .some((term) => term && (haystack.includes(term) || String(need || '').includes(item.productGroup || ''))));
}

function catalogItemTitleMatchesNeeds(item = {}, needs = []) {
  if (!Array.isArray(needs) || needs.length === 0) return true;
  const productName = String(item.productName || '');
  if (needs.includes('운전자')) return /운전자|오토바이|자동차|교통/.test(productName);
  const haystack = [
    productName,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [group.plan, group.linkedSummary, ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title])]) : [])
  ].filter(Boolean).join(' ');
  return needs.some((need) => polibotNeedTerms(need)
    .some((term) => term && haystack.includes(term)));
}

function polibotIsDriverItem(item = {}) {
  return /운전자|오토바이|자동차|교통|사고처리|벌금|변호사선임/.test([
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.fineCategory, detail.title]) : [])
  ].filter(Boolean).join(' '));
}

function polibotCatalogItemProfileBlockers(item = {}, profile = {}) {
  const name = cleanPolibotRecommendationName(item.productName, item.company);
  const text = [
    name,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.targetAudience) ? item.targetAudience : []),
    ...(Array.isArray(item.excludedAudience) ? item.excludedAudience : [])
  ].filter(Boolean).join(' ');
  const gender = String(profile.gender || '').trim();
  const age = polibotAgeValue(profile);
  const blockers = [];
  if (/여성|여자|유방|자궁|난소/i.test(text) && /^남/.test(gender)) blockers.push('남성 고객에게 여성 전용/여성 질환 상품은 제외합니다.');
  if (/남성|남자|전립선/i.test(text) && /^여/.test(gender)) blockers.push('여성 고객에게 남성 전용/남성 질환 상품은 제외합니다.');
  if (age && age > 30 && /어린이|자녀|아이|키즈|태아/i.test(name)) blockers.push('성인 고객에게 어린이/자녀 전용 상품은 제외합니다.');
  if (age && age < 15 && /종신|연금|노후|치매|간병/i.test(name) && !/(어린이|자녀|아이|키즈|태아)/i.test(name)) blockers.push('미성년 고객에게 성인 목적 상품은 제외합니다.');
  if (!isPolibotCatalogItemUsable({ ...item, productName: name })) blockers.push('상품명이 아닌 설명/담보 항목은 제외합니다.');
  return blockers;
}

function isPolibotCatalogItemProfileEligible(item = {}, profile = {}) {
  return polibotCatalogItemProfileBlockers(item, profile).length === 0;
}

function polibotPurposeMismatch(item = {}, profile = {}) {
  const needs = Array.isArray(profile.needs) ? profile.needs : [];
  if (polibotIsDriverItem(item) && !needs.some((need) => /운전자|교통|자동차/.test(String(need || '')))) {
    return {
      type: 'driver_without_need',
      label: '운전자 니즈 없음',
      reason: '고객 필요 보장에 운전자/교통사고 보장이 없어 운전자보험은 전용 추천보다 후순위 대체 후보입니다.'
    };
  }
  return null;
}

function polibotNeedTerms(need = '') {
  const value = String(need || '').trim();
  const aliases = {
    실손: ['실손', '실비', '의료비', '통원'],
    실비: ['실손', '실비', '의료비', '통원'],
    암: ['암', '항암', '표적', '유방암', '갑상선'],
    뇌: ['뇌', '뇌혈관', '뇌졸중'],
    심장: ['심장', '허혈', '급성심근', '순환계'],
    간병: ['간병', '요양', '장기요양'],
    치매: ['치매', '인지'],
    간편: ['간편', '유병', '고지', '355', '335', '333'],
    유병자: ['간편', '유병', '고지', '355', '335', '333'],
    운전자: ['운전자', '교통', '자동차'],
    상해: ['상해', '골절', '후유장해'],
    수술: ['수술', '시술'],
    입원: ['입원', '입원일당'],
    종신: ['종신', '사망', '상속'],
    사망: ['종신', '사망', '정기', '상속'],
    연금: ['연금', '노후', '은퇴', '저축'],
    생활비: ['생활비', '소득', '진단비', '일당']
  };
  return [...new Set([value, ...(aliases[value] || [])].filter(Boolean))];
}

function isPolibotCatalogItemUsable(item = {}) {
  const name = String(item.productName || '').trim();
  const compact = name.replace(/\s+/g, '');
  const company = String(item.company || '').replace(/\s+/g, '');
  if (!name || name.length < 3) return false;
  if (company && (compact === company || compact === company.replace(/생명|화재|손해보험|손보/g, ''))) return false;
  if (/^(?:손해보험|생명보험|화재보험|보험|상품|플랜)$/.test(compact)) return false;
  if (/보험금|보험금\s*청구|보험금\s*서류|보험금\/해약환급금|보전\s*서류|고객센터|헬프데스크|전화\s*문의|필수\s*서류|유의사항|금융소비자|개인정보|신용정보|청약|환전|해외송금|서비스|수수료|기준금리|시가총액|총\s*자산|가입고객|외화보험상품|보험차익|보험\s*가입\s*기간|하였으며|보장\s*한도|보험\s*한도|보험\s*소식/i.test(name)) return false;
  if (/비교|현황|전략상품|소식지?|간추린|가이드|자료|안내|기준|목록|요약|실태|재정\s*위기|플랜\s*비교|일부상품\s*제외|대응\s*방안|제안하세요|제안가능|저렴|운영담보|동일|확대|축소/i.test(name)) return false;
  if (/우대\s*플랜은|플랜은|보험료는|보장은|담보는|특징은|보상\s*예시|우대플랜.*예시|각\s*[\d,]+(?:천|만)?만원|치료생활비\s*[\d,]+|월\s*\d+\s*원/i.test(name)) return false;
  if (/보장\s*내용|가입\s*예시|보험료\s*예시|납입\s*예시|해약\s*환급|해지\s*환급|만기\s*환급|가입\s*한도|보장\s*금액|산출\s*기준|가입\s*기준/i.test(name)) return false;
  if (/시설.*재가|재가.*시설|다양한.*특약|특약\s*구성\s*가능|구성\s*가능|지원비.*입원일당/i.test(name)) return false;
  if (/(?:보험료\s*)?납입\s*면제|납입면제대상|후유장해|장해지급률|장해분류표/i.test(name) && !/(?:보험|플랜).{0,8}$/.test(name.replace(/보험료/g, ''))) return false;
  if (name.length > 46 && !/(?:무배당|무\)|보험|플랜|종신보험|연금보험).{0,16}$/.test(name)) return false;
  return true;
}

function cleanPolibotRecommendationName(value = '', company = '') {
  const companyText = String(company || '').trim();
  const companyCompact = companyText.replace(/\s+/g, '');
  const companyPattern = companyCompact
    ? new RegExp(`^${companyCompact.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*`, 'i')
    : null;
  const rawName = String(value || '').trim();
  const compactName = rawName.replace(/\s+/g, '');
  return rawName
    .normalize('NFC')
    .replace(/^(?:월호|실효|정상)\s+/g, '')
    .replace(/^[▶①-⑳⓵-⓾🅽\-\s·:]+/g, '')
    .replace(companyPattern || /^$/, '')
    .replace(/^무\)/g, '(무)')
    .replace(/\s무\)/g, ' (무)')
    .replace(/\s+/g, ' ')
    .replace(/추천\s*플랜\s*추천\s*플랜/g, '추천플랜')
    .replace(/플랜\s*추천\s*플랜/g, '플랜')
    .replace(/추천\s*플랜$/g, '플랜')
    .replace(/보험\s*보험/g, '보험')
    .replace(/\s+/g, ' ')
    .trim() || compactName;
}

function polibotCatalogItemKind(item = {}) {
  const name = cleanPolibotRecommendationName(item.productName, item.company);
  if (!name) return 'document';
  const compact = name.replace(/\s+/g, '');
  if (/^(?:손해보험|생명보험|화재보험|보험|상품|플랜)$/.test(compact)) return 'document';
  if (/보험금|서류|유의사항|안내|자료|목록|요약|기준|현황|비교|실태|재정\s*위기|대응\s*방안|제안하세요|제안가능|저렴|운영담보|동일|확대|축소|한도|가입\s*예시|보험료\s*예시|환급|공시|약관/i.test(name)) return 'document';
  if (/우대\s*플랜은|플랜은|보험료는|보장은|담보는|특징은|보상\s*예시|우대플랜.*예시|각\s*[\d,]+(?:천|만)?만원|치료생활비\s*[\d,]+|월\s*\d+\s*원/i.test(name)) return 'document';
  if (/시설.*재가|재가.*시설|다양한.*특약|특약\s*구성\s*가능|구성\s*가능|지원비.*입원일당/i.test(name)) return 'document';
  if (/(?:보험료\s*)?납입\s*면제|납입면제대상|후유장해|장해지급률|장해분류표/i.test(name) && !/(?:보험|플랜).{0,8}$/.test(name.replace(/보험료/g, ''))) return 'rider';
  if (/특약|담보/.test(name)) return 'rider';
  if (/(진단비|수술비|입원일당|치료비|생활비|간병비|보장비)$/.test(name) && !/보험/.test(name)) return 'rider';
  if (/플랜/.test(name) && !/보험/.test(name)) return 'plan';
  if (/보험/.test(name) || /종신|연금|운전자|치매|간병|실손|암/.test(name)) return 'product';
  return 'plan';
}

function polibotItemPremiumRows(item = {}) {
  return [
    item.premiumExample && { premium: item.premiumExample, confidence: item.premiumConfidence || 'example' },
    ...(Array.isArray(item.premiumExamples) ? item.premiumExamples.map((row) => ({
      premium: row.premium,
      age: row.age || '',
      gender: row.gender || '',
      confidence: row.confidence || 'premium_example'
    })) : []),
    ...(Array.isArray(item.premiumTableRows) ? item.premiumTableRows.map((row) => ({
      premium: row.amount,
      age: row.age || '',
      gender: row.gender || '',
      plan: row.plan || '',
      confidence: row.confidence || 'premium_table'
    })) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => (group.premiums || []).map((row) => ({
      premium: row.amount,
      age: row.age || '',
      gender: row.gender || '',
      plan: row.plan || group.plan || '',
      confidence: row.confidence || group.linkConfidence || 'linked_group',
      linkConfidence: group.linkConfidence || '',
      linkScore: group.linkScore || 0
    }))) : [])
  ].filter((row) => row && row.premium);
}

function polibotBestPremiumForProfile(item = {}, profile = {}) {
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const target = parsePolibotPremiumAmount(profile.budget);
  const candidates = polibotItemPremiumRows(item)
    .map((row) => {
      const amount = parsePolibotPremiumAmount(row.premium);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      const rowAge = Number(String(row.age || '').replace(/[^\d.]/g, ''));
      let score = 40;
      if (Number.isFinite(rowAge) && age) score += Math.max(0, 24 - Math.abs(rowAge - age));
      if (gender && row.gender && String(row.gender).includes(gender.slice(0, 1))) score += 16;
      if (row.linkConfidence === 'strong') score += 16;
      else if (row.linkConfidence === 'usable') score += 8;
      if (row.confidence === 'catalog_item' || row.confidence === 'product_table_row' || row.confidence === 'product_premium_matrix') score += 10;
      if (Number.isFinite(target)) {
        if (amount <= target) score += 12;
        else if (amount <= target * 1.15) score += 4;
        else score -= 10;
      }
      return { ...row, amount, score };
    })
    .filter(Boolean);
  return candidates.sort((a, b) => b.score - a.score || a.amount - b.amount)[0] || null;
}

function polibotPremiumMatchQuality(bestPremium = null, profile = {}) {
  if (!bestPremium) {
    return {
      level: 'missing',
      label: '보험료 없음',
      reason: '상품과 연결된 보험료 행이 없어 설계 산출이 필요합니다.'
    };
  }
  const age = polibotAgeValue(profile);
  const gender = String(profile.gender || '').trim();
  const rowAge = Number(String(bestPremium.age || '').replace(/[^\d.]/g, ''));
  const ageDelta = Number.isFinite(rowAge) && age ? Math.abs(rowAge - age) : null;
  const genderMatched = Boolean(gender && bestPremium.gender && String(bestPremium.gender).includes(gender.slice(0, 1)));
  const planMatched = Boolean(bestPremium.plan);
  let score = 45;
  if (ageDelta === 0) score += 22;
  else if (ageDelta !== null && ageDelta <= 5) score += 14;
  else if (ageDelta !== null && ageDelta <= 10) score += 6;
  else if (ageDelta !== null) score -= 8;
  if (genderMatched) score += 18;
  if (planMatched) score += 8;
  if (bestPremium.linkConfidence === 'strong') score += 14;
  else if (bestPremium.linkConfidence === 'usable') score += 8;
  if (/catalog_item|product|exact/i.test(bestPremium.confidence || '')) score += 10;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    level: score >= 78 ? 'high' : score >= 58 ? 'medium' : 'low',
    label: score >= 78 ? '고객 조건 근접 보험료' : score >= 58 ? '참고 가능 보험료' : '참고 보험료',
    reason: [
      bestPremium.age ? `보험료표 나이 ${bestPremium.age}` : '나이 행 없음',
      bestPremium.gender ? `성별 ${bestPremium.gender}${genderMatched ? ' 매칭' : ' 확인'}` : '성별 행 없음',
      bestPremium.plan ? `플랜 ${bestPremium.plan}` : '',
      bestPremium.linkConfidence && `연결 ${bestPremium.linkConfidence}`
    ].filter(Boolean).join(' · '),
    ageDelta,
    genderMatched,
    planMatched
  };
}

function polibotUnderwritingClassification(item = {}, profile = {}) {
  const medical = polibotUnderwritingMedicalText(profile);
  const text = `${medical} ${profile.familyHistory || ''}`;
  const itemText = `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')} ${item.disclosureMemo || ''} ${item.cautionMemo || ''}`;
  const hasMedical = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(text);
  const noMedical = Boolean(medical) && /없음|무|해당\s*없/i.test(medical);
  const simple = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(itemText);
  const noUnderwriting = /무심사|무고지|묻지\s*않/.test(itemText);
  const exclusion = /가입\s*불가|인수\s*거절|제외|제한/.test(`${itemText} ${(item.excludedAudience || []).join(' ')}`);
  const age = polibotAgeRangeStatus(item, profile);
  if (age.status === 'blocked') return { level: 'blocked', label: '연령 초과 가능', reason: age.reason };
  if (exclusion) return { level: 'blocked', label: '인수 어려움', reason: '상품 자료에 가입 제한/제외 문구가 있습니다.' };
  if (hasMedical && simple) return { level: 'preferred', label: '간편심사 우선', reason: '병력 키워드가 있어 간편/유병자형을 우선 비교합니다.' };
  if (hasMedical && noUnderwriting) return { level: 'fallback', label: '무심사 후순위', reason: '심사형이 어려울 때 마지막 대안으로 검토합니다.' };
  if (hasMedical) return { level: 'review', label: '표준심사 가능성 검수', reason: '병력/투약/검사 이력 때문에 표준심사, 할증, 부담보 여부 확인이 필요합니다.' };
  if (noMedical && simple) return { level: 'caution', label: '표준심사 우선', reason: '병력 이슈가 없으면 간편형보다 표준형 보험료를 먼저 비교합니다.' };
  if (noMedical) return { level: 'preferred', label: '표준심사 가능', reason: '입력상 병력 이슈가 없어 표준심사 가능성을 우선 봅니다.' };
  return { level: 'unknown', label: '고지 확인 필요', reason: '최근 치료/투약/검사 이력 확인 후 심사 경로를 확정합니다.' };
}

function polibotItemEvidenceQuality(item = {}) {
  const anchors = Array.isArray(item.evidenceAnchors) ? item.evidenceAnchors : [];
  const coverageAnchors = [
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows : [])
  ].filter((row) => row.evidenceAnchor);
  const linked = polibotLinkedGroupStrength(item);
  let score = 35;
  if (item.productName && item.company && item.company !== '미분류') score += 14;
  if (anchors.length) score += 12;
  if (coverageAnchors.length) score += Math.min(18, coverageAnchors.length * 4);
  if (item.premiumExample || item.premiumTableRows?.length) score += 12;
  if (linked === 'strong') score += 14;
  else if (linked === 'usable') score += 8;
  if (item.ageRange || item.conditionRules?.underwritingTypes?.length) score += 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score,
    level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
    reasons: [
      item.productName && item.company && '상품명/보험사 확인',
      anchors.length && `원문 앵커 ${anchors.length}개`,
      coverageAnchors.length && `담보 원문 ${coverageAnchors.length}개`,
      item.premiumExample || item.premiumTableRows?.length ? '보험료 근거 있음' : '',
      linked && `보험료-담보 연결 ${linked}`
    ].filter(Boolean)
  };
}

function polibotLinkedGroupStrength(item = {}) {
  const groups = Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups : [];
  if (groups.some((group) => group.linkConfidence === 'strong')) return 'strong';
  if (groups.some((group) => group.linkConfidence === 'usable')) return 'usable';
  if (groups.length) return 'weak';
  return '';
}

function polibotItemDecisionBreakdown(item = {}, profile = {}) {
  const age = polibotAgeRangeStatus(item, profile);
  const needHits = (profile.needs || []).filter((need) => catalogItemMatchesNeeds(item, [need]));
  const bestPremium = polibotBestPremiumForProfile(item, profile);
  const target = parsePolibotPremiumAmount(profile.budget);
  const medicalText = `${polibotUnderwritingMedicalText(profile)} ${profile.familyHistory || ''}`;
  const hasNoMedical = Boolean(medicalText) && /없음|무|해당\s*없/i.test(medicalText);
  const hasMedicalRisk = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(medicalText);
  const productText = `${item.productName || ''} ${item.productGroup || ''} ${(item.coverageKeywords || []).join(' ')}`;
  const profileBlockers = polibotCatalogItemProfileBlockers(item, profile);
  const simpleProduct = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(productText);
  const noUnderwritingProduct = /무심사|무고지|묻지\s*않/.test(productText);
  const linkedStrength = polibotLinkedGroupStrength(item);
  const premiumLevel = !bestPremium
    ? 'unknown'
    : polibotBudgetFitLevel(bestPremium.amount, target).level;
  const premiumMatchQuality = polibotPremiumMatchQuality(bestPremium, profile);
  const underwritingClassification = polibotUnderwritingClassification(item, profile);
  const itemEvidenceQuality = polibotItemEvidenceQuality(item);
  const purposeMismatch = polibotPurposeMismatch(item, profile);
  const coverageScore = Math.min(30, needHits.length * 10);
  const ageScore = age.status === 'ok' ? 18 : age.status === 'blocked' ? -30 : -8;
  const premiumScore = premiumLevel === 'within_budget' ? 18
    : premiumLevel === 'near_budget' ? 8
      : premiumLevel === 'over_budget' ? -18
        : premiumLevel === 'severe_over_budget' ? -32
          : premiumLevel === 'reference' ? 4 : -8;
  const underwritingScore = hasNoMedical && simpleProduct ? -12
    : hasMedicalRisk && simpleProduct ? 16
      : hasMedicalRisk && noUnderwritingProduct ? 4
        : hasMedicalRisk ? -6
          : hasNoMedical ? 8 : 0;
  const evidenceScore = linkedStrength === 'strong' ? 18
    : linkedStrength === 'usable' ? 10
      : linkedStrength === 'weak' ? -4
        : item.premiumExample || item.coverageDetails?.length ? 4 : -8;
  const evidenceQualityBonus = itemEvidenceQuality.level === 'high' ? 6 : itemEvidenceQuality.level === 'low' ? -6 : 0;
  const renewalScore = item.renewalType && profile.renewalPreference === '비갱신 선호' && /비갱신/.test(item.renewalType) ? 8
    : item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType) ? -10 : 0;
  const purposeScore = purposeMismatch ? -24 : 0;
  const scoreComponents = [
    { key: 'coverage', label: '보장 니즈', score: coverageScore, reason: needHits.length ? `${needHits.join(', ')} 매칭` : (profile.needs || []).length ? '입력 니즈 직접 매칭 약함' : '니즈 미입력' },
    { key: 'age', label: '가입연령', score: ageScore, reason: age.reason || age.label },
    { key: 'premium', label: '보험료', score: premiumScore, reason: bestPremium ? `${formatPolibotPremiumAmount(bestPremium.amount)} · ${premiumLevel}` : '보험료 근거 없음' },
    {
      key: 'underwriting',
      label: '심사 적합도',
      score: underwritingScore,
      reason: hasMedicalRisk
        ? simpleProduct ? '병력 고객에게 간편/유병자형 적합' : noUnderwritingProduct ? '무심사/제한형 후순위 대안' : '병력 고객 표준심사 검수 필요'
        : hasNoMedical ? '병력 이슈 없음' : '병력 미확인'
    },
    { key: 'evidence', label: '근거 연결', score: evidenceScore + evidenceQualityBonus, reason: `${linkedStrength || (item.premiumExample || item.coverageDetails?.length ? 'partial' : 'weak')} · ${itemEvidenceQuality.level}` },
    { key: 'renewal', label: '갱신 선호', score: renewalScore, reason: item.renewalType || '갱신 정보 없음' },
    { key: 'purpose_mismatch', label: '목적 불일치', score: purposeScore, reason: purposeMismatch?.reason || '목적 불일치 없음' }
  ];
  const rawTotal = 50 + scoreComponents.reduce((sum, component) => sum + Number(component.score || 0), 0);
  const total = Math.max(0, Math.min(100, Math.round(rawTotal)));
  const blockers = [
    age.status === 'blocked' && age.reason,
    premiumLevel === 'over_budget' && bestPremium && Number.isFinite(target) && `확인 보험료 ${formatPolibotPremiumAmount(bestPremium.amount)}가 목표 ${formatPolibotPremiumAmount(target)}를 초과합니다.`,
    premiumLevel === 'severe_over_budget' && bestPremium && Number.isFinite(target) && `예산 크게 초과: ${polibotBudgetOverrunText(bestPremium.amount, target)}`,
    premiumMatchQuality.level === 'low' && '고객 나이/성별과 보험료 행 연결이 약합니다.',
    purposeMismatch?.reason,
    ...profileBlockers,
    ['blocked', 'review'].includes(underwritingClassification.level) && underwritingClassification.reason,
    hasMedicalRisk && !simpleProduct && !noUnderwritingProduct && '병력 입력이 있어 표준심사 인수/할증/부담보 가능성 확인이 필요합니다.',
    linkedStrength === 'weak' && '보험료-담보-조건 연결 강도가 약합니다.',
    !needHits.length && (profile.needs || []).length > 0 && '입력 니즈와 직접 연결되는 담보 근거가 약합니다.',
    item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType) && '비갱신 선호 고객에게 갱신형 부담이 있습니다.'
  ].filter(Boolean);
  const strengths = [
    needHits.length > 0 && `${needHits.join(', ')} 니즈와 연결됩니다.`,
    age.status === 'ok' && age.reason,
    bestPremium && `고객 조건과 가장 가까운 보험료 예시 ${formatPolibotPremiumAmount(bestPremium.amount)}${bestPremium.age ? ` / ${bestPremium.age}세` : ''}${bestPremium.gender ? ` / ${bestPremium.gender}` : ''}`,
    premiumMatchQuality.level === 'high' && premiumMatchQuality.reason,
    underwritingClassification.level === 'preferred' && underwritingClassification.reason,
    hasMedicalRisk && simpleProduct && '병력 고객에게 간편/유병자형 대안으로 볼 수 있습니다.',
    hasNoMedical && !simpleProduct && '병력 이슈가 없어 표준형 후보로 먼저 비교할 수 있습니다.',
    linkedStrength === 'strong' && '보험료와 담보가 강하게 연결된 근거가 있습니다.',
    linkedStrength === 'usable' && '보험료-담보 묶음을 추천 근거로 사용할 수 있습니다.'
  ].filter(Boolean);
  const level = age.status === 'blocked' ? '연령 초과 후보'
    : profileBlockers.length ? '제외 후보'
      : purposeMismatch ? '대체 후보'
      : premiumLevel === 'severe_over_budget' ? '예산 초과 후보'
        : blockers.length && total < 68 ? '보류 검토' : total >= 82 ? '우선 추천' : total >= 64 ? '비교 후보' : '주의 후보';
  return {
    level,
    score: total,
    scoreFormula: {
      base: 50,
      rawTotal,
      total,
      components: scoreComponents
    },
    coverage: {
      status: needHits.length ? 'matched' : (profile.needs || []).length ? 'weak' : 'unknown',
      score: coverageScore,
      matchedNeeds: needHits
    },
    age: { status: age.status, label: age.label, score: ageScore, reason: age.reason },
    premium: {
      status: premiumLevel,
      score: premiumScore,
      amount: bestPremium ? formatPolibotPremiumAmount(bestPremium.amount) : '',
      rawAmount: bestPremium?.premium || '',
      age: bestPremium?.age || '',
      gender: bestPremium?.gender || '',
      plan: bestPremium?.plan || '',
      matchQuality: premiumMatchQuality,
      confidence: bestPremium?.confidence || ''
    },
    underwriting: {
      status: hasMedicalRisk ? (simpleProduct ? 'simple_fit' : noUnderwritingProduct ? 'limited_fallback' : 'review_needed') : hasNoMedical ? 'standard_first' : 'unknown',
      score: underwritingScore,
      classification: underwritingClassification,
      reason: hasMedicalRisk
        ? simpleProduct ? '병력 키워드와 간편/유병자 상품 성격이 맞습니다.' : '병력 키워드가 있어 심사 조건 확인이 필요합니다.'
        : hasNoMedical ? '병력 이슈 없음 입력으로 표준심사 우선 비교가 적절합니다.' : '병력 정보가 부족합니다.'
    },
    evidence: {
      status: linkedStrength || (item.premiumExample || item.coverageDetails?.length ? 'partial' : 'weak'),
      score: evidenceScore + evidenceQualityBonus,
      quality: itemEvidenceQuality,
      reason: linkedStrength === 'strong' ? '연결 근거 강함' : linkedStrength === 'usable' ? '연결 근거 사용 가능' : linkedStrength === 'weak' ? '연결 근거 약함' : '일부 상품 정보만 확인됨'
    },
    renewal: {
      status: renewalScore > 0 ? 'preferred' : renewalScore < 0 ? 'mismatch' : 'neutral',
      score: renewalScore,
      reason: item.renewalType || ''
    },
    purposeMismatch,
    strengths: strengths.slice(0, 5),
    blockers: blockers.slice(0, 6)
  };
}

function polibotCatalogItemScore(item = {}, profile = {}) {
  const haystack = [
    item.productName,
    item.productGroup,
    ...(Array.isArray(item.coverageKeywords) ? item.coverageKeywords : []),
    ...(Array.isArray(item.coverageDetails) ? item.coverageDetails.flatMap((detail) => [detail.category, detail.fineCategory, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.coverageTableRows) ? item.coverageTableRows.flatMap((detail) => [detail.category, detail.title, detail.amount]) : []),
    ...(Array.isArray(item.linkedBenefitGroups) ? item.linkedBenefitGroups.flatMap((group) => [
      group.plan,
      group.linkedSummary,
      ...(group.coverages || []).flatMap((coverage) => [coverage.category, coverage.fineCategory, coverage.title, coverage.amount])
    ]) : [])
  ].filter(Boolean).join(' ');
  const terms = (profile.needs || []).flatMap(polibotNeedTerms);
  let score = 0;
  const kind = polibotCatalogItemKind(item);
  const profileBlockers = polibotCatalogItemProfileBlockers(item, profile);
  const ageStatus = polibotAgeRangeStatus(item, profile);
  const bestPremium = polibotBestPremiumForProfile(item, profile);
  const linkedStrength = polibotLinkedGroupStrength(item);
  if (kind === 'product') score += 18;
  if (kind === 'plan') score += 8;
  if (kind === 'rider') score -= 10;
  if (kind === 'document') score -= 40;
  if (profileBlockers.length) score -= 80;
  const medicalText = `${polibotUnderwritingMedicalText(profile)} ${profile.familyHistory || ''}`;
  const hasNoMedical = medicalText && /없음|무|해당\s*없/i.test(medicalText);
  const hasMedicalRisk = /고혈압|혈압|당뇨|고지혈|수술|입원|치료|투약|약|진단|검사|추적|관찰|암|심장|뇌|디스크/i.test(medicalText);
  const simpleProduct = /간편|유병|고지|325|335|355|333|3\.2\.5|3\.5\.5|3\.10/.test(`${item.productName || ''} ${item.productGroup || ''}`);
  if (hasNoMedical && simpleProduct) score -= 12;
  if (hasMedicalRisk && simpleProduct) score += 14;
  if ((profile.needs || []).includes('운전자')) {
    if (/운전자|오토바이|자동차|교통/.test(item.productName || '')) score += 16;
    else if (/종신|암보험|건강보험/.test(item.productName || '')) score -= 18;
  }
  if (polibotPurposeMismatch(item, profile)) score -= 32;
  terms.forEach((term) => {
    if (term && haystack.includes(term)) score += 8;
  });
  if (ageStatus.status === 'ok') score += 8;
  if (ageStatus.status === 'blocked') score -= 48;
  if (ageStatus.status === 'unknown') score -= 3;
  if (linkedStrength === 'strong') score += 14;
  else if (linkedStrength === 'usable') score += 8;
  else if (linkedStrength === 'weak') score -= 4;
  if (item.premiumExample) score += 5;
  if (Array.isArray(item.premiumExamples) && item.premiumExamples.length) score += 6;
  if (Array.isArray(item.premiumTableRows) && item.premiumTableRows.length) score += 5;
  if (bestPremium) score += 5;
  if (item.ageRange) score += 3;
  if (Array.isArray(item.coverageDetails) && item.coverageDetails.length) score += Math.min(8, item.coverageDetails.length);
  if (Array.isArray(item.coverageTableRows) && item.coverageTableRows.length) score += Math.min(6, item.coverageTableRows.length);
  if (item.renewalType && profile.renewalPreference === '비갱신 선호' && /비갱신/.test(item.renewalType)) score += 6;
  if (item.renewalType && profile.renewalPreference === '비갱신 선호' && /^갱신/.test(item.renewalType)) score -= 8;
  if (/보험|플랜$/.test(item.productName || '')) score += 4;
  if (String(item.productName || '').length > 34) score -= 4;
  if (/특약|담보|한도/.test(item.productName || '')) score -= 6;
  if (/추천\s*플랜|추천플랜/.test(item.productName || '')) score -= 3;
  const target = parsePolibotPremiumAmount(profile.budget);
  const itemPremium = bestPremium?.amount ?? parsePolibotPremiumAmount(item.premiumExample || item.premiumExamples?.[0]?.premium || '');
  if (Number.isFinite(target) && Number.isFinite(itemPremium)) {
    if (itemPremium <= target) score += 8;
    else if (itemPremium <= target * 1.2) score += 2;
    else score -= 8;
  }
  return score;
}

function representativePolibotCatalogItems(items = [], profile = {}) {
  const deduped = [];
  const seen = new Set();
  [...items]
    .sort((a, b) => polibotCatalogItemScore(b, profile) - polibotCatalogItemScore(a, profile))
    .forEach((item) => {
      const productName = cleanPolibotRecommendationName(item.productName, item.company);
      const key = `${item.company || ''}-${productName.replace(/\s+/g, '')}`;
      if (!productName || seen.has(key)) return;
      seen.add(key);
      deduped.push({
        ...item,
        productName,
        displayKind: polibotCatalogItemKind({ ...item, productName })
      });
    });
  const primary = deduped.filter((item) => item.displayKind === 'product');
  const plans = deduped.filter((item) => item.displayKind === 'plan');
  const riders = deduped.filter((item) => item.displayKind === 'rider');
  return [...primary, ...plans, ...riders].slice(0, 8);
}

function normalizePolibotCautions(values = [], profile = {}) {
  const existingMedicalPlan = String(profile.existingMedicalPlan || '').trim();
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value) => existingMedicalPlan !== '없음' || !/실손|중복/.test(value))
  )].slice(0, 6);
}

function cleanPolibotProductNames(names = []) {
  return [...new Set((Array.isArray(names) ? names : [])
    .flatMap(splitPolibotProductText)
    .map((name) => name.replace(/\s+보험$/, '보험').trim())
    .filter((name) => name.length >= 4 && name.length <= 36)
    .filter((name) => /(보험|플랜|특약|담보|진단비|수술비|입원비|간병비)/.test(name))
    .filter((name) => !POLIBOT_GENERIC_PRODUCT_NAMES.has(name.replace(/\s+/g, '')))
    .filter((name) => !POLIBOT_BAD_PRODUCT_PATTERN.test(name))
    .filter((name) => !/^\d|[,]{2,}|[?]{2,}|[|]/.test(name))
  )].slice(0, 5);
}

function classifyPolibotProducts(source = {}, reviews = {}) {
  const rawCandidates = sourceProductNameCandidates(source).flatMap(splitPolibotProductText);
  const allItems = sourceAllCatalogItems(source, reviews);
  const catalogItems = allItems.filter((item) => item.status === 'confirmed');
  const cleanNames = catalogItems.map((item) => item.productName);
  const cleanSet = new Set(cleanNames);
  const productCandidates = Array.isArray(source.productCandidates) ? source.productCandidates : [];
  const excluded = [...new Set(rawCandidates
    .map(normalizePolibotProductName)
    .filter((name) => name && !cleanSet.has(name))
    .filter((name) => POLIBOT_BAD_PRODUCT_PATTERN.test(name) || POLIBOT_GENERIC_PRODUCT_NAMES.has(name.replace(/\s+/g, ''))))]
    .concat(productCandidates.filter((item) => item.status === 'excluded').map((item) => item.name))
    .slice(0, 8);
  const status = catalogItems.some((item) => item.status === 'confirmed')
    ? 'confirmed'
    : allItems.some((item) => item.status === 'auto')
      ? 'auto'
      : (rawCandidates.length > 0 || productCandidates.some((item) => item.status === 'review') ? 'review' : 'none');
  return {
    sourceId: source.id || `${source.month}-${source.fileName}`,
    fileName: source.fileName,
    month: source.month,
    company: source.company,
    companies: source.companies || [],
    productGroup: source.productGroup,
    status,
    statusLabel: {
      confirmed: '확정 상품',
      auto: '자동 추출',
      review: '검토 필요',
      none: '상품명 부족'
    }[status],
    productNames: cleanNames,
    excludedPhrases: excluded,
    catalogItems,
    candidates: allItems
  };
}

function buildPolibotQualityReport(knowledgeSources = [], reviews = {}) {
  const catalog = knowledgeSources.map((source) => classifyPolibotProducts(source, reviews));
  const allCatalogItems = knowledgeSources.flatMap((source) => sourceAllCatalogItems(source, reviews));
  const catalogItems = allCatalogItems.filter((item) => item.status === 'confirmed' && item.productName);
  const reviewItems = allCatalogItems.filter((item) => ['auto', 'review'].includes(item.status));
  const excludedItems = allCatalogItems.filter((item) => item.status === 'excluded');
  const recommended = catalogItems.filter((item) => ['충분', '보통'].includes(item.completeness || '부족'));
  const insufficientItems = catalogItems.filter((item) => item.completeness === '부족');
  const review = catalog.filter((item) => item.status === 'review');
  const ocrNeeded = knowledgeSources.filter((item) => item.fileType === 'image').length;
  const excludedPhrases = [
    ...catalog.flatMap((item) => item.excludedPhrases || []),
    ...excludedItems.map((item) => item.productName)
  ];
  const companies = [...new Set(knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set(knowledgeSources.map((item) => item.productGroup).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set(knowledgeSources.flatMap((item) => item.keywords || []))]
    .slice(0, 20);
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(recommended.map((item) => `${item.company}-${item.productName}`)).size,
    insufficientProducts: insufficientItems.length,
    reviewNeededProducts: review.length + reviewItems.length,
    excludedPhrases: excludedPhrases.length,
    ocrNeeded,
    companies,
    productGroups,
    keywords,
    catalogItems: allCatalogItems.slice(0, 160),
    recommendableCatalogItems: catalogItems.slice(0, 120),
    catalog: catalog.slice(0, 80)
  };
}

function buildPolibotRecommendationQualityReport(knowledgeSources = [], reviews = {}) {
  const allCatalogItems = knowledgeSources.flatMap((source) => sourceAllCatalogItems(source, reviews));
  const catalogItems = allCatalogItems.filter((item) => item.status === 'confirmed' && item.productName);
  const reviewItems = allCatalogItems.filter((item) => ['auto', 'review'].includes(item.status));
  const excludedItems = allCatalogItems.filter((item) => item.status === 'excluded');
  const recommended = catalogItems.filter((item) => ['충분', '보통'].includes(item.completeness || '부족'));
  const companies = [...new Set([
    ...knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]),
    ...catalogItems.map((item) => item.company)
  ].filter((company) => company && company !== '미분류'))].sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set([
    ...knowledgeSources.map((item) => item.productGroup),
    ...catalogItems.map((item) => item.productGroup)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set([
    ...knowledgeSources.flatMap((item) => item.keywords || []),
    ...catalogItems.flatMap((item) => item.coverageKeywords || [])
  ].filter(Boolean))].slice(0, 20);
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(recommended.map((item) => `${item.company}-${item.productName}`)).size,
    insufficientProducts: catalogItems.filter((item) => item.completeness === '부족').length,
    reviewNeededProducts: reviewItems.length,
    excludedPhrases: excludedItems.length,
    ocrNeeded: knowledgeSources.filter((item) => item.fileType === 'image').length,
    companies,
    productGroups,
    keywords,
    catalogItems: allCatalogItems.slice(0, 80),
    recommendableCatalogItems: catalogItems.slice(0, 80)
  };
}

function buildPolibotDbQualityReport(knowledgeSources = []) {
  const allCatalogItems = knowledgeSources.flatMap((source) => Array.isArray(source.catalogItems) ? source.catalogItems : []);
  const allPremiumReferences = knowledgeSources.flatMap((source) => Array.isArray(source.premiumReferences) ? source.premiumReferences : []);
  const documentAnalyses = knowledgeSources.map((source) => source.documentAnalysis).filter(Boolean);
  const catalogItems = allCatalogItems.filter((item) => item.status === 'confirmed' && item.productName);
  const insufficientItems = catalogItems.filter((item) => item.completeness === '부족');
  const reviewItems = allCatalogItems.filter((item) => ['auto', 'review'].includes(item.status));
  const excludedItems = allCatalogItems.filter((item) => item.status === 'excluded');
  const companies = [...new Set([
    ...knowledgeSources.flatMap((item) => item.companies?.length ? item.companies : [item.company]),
    ...catalogItems.map((item) => item.company)
  ].filter((company) => company && company !== '미분류'))].sort((a, b) => a.localeCompare(b, 'ko'));
  const productGroups = [...new Set([
    ...knowledgeSources.map((item) => item.productGroup),
    ...catalogItems.map((item) => item.productGroup)
  ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const keywords = [...new Set([
    ...knowledgeSources.flatMap((item) => item.keywords || []),
    ...catalogItems.flatMap((item) => item.coverageKeywords || [])
  ].filter(Boolean))].slice(0, 20);
  const catalog = knowledgeSources.slice(0, 80).map((source) => {
    const sourceItems = Array.isArray(source.catalogItems) ? source.catalogItems.filter((item) => item.status === 'confirmed') : [];
    return {
      sourceId: source.id || source.dbSourceId || '',
      fileName: source.fileName,
      month: source.month,
      company: source.company,
      companies: source.companies || [],
      productGroup: source.productGroup,
      status: sourceItems.length ? 'confirmed' : 'none',
      statusLabel: sourceItems.length ? '확정 상품' : '상품명 부족',
      productNames: sourceItems.map((item) => item.productName).filter(Boolean).slice(0, 12),
      analysisQuality: source.documentAnalysis?.analysisQuality || {},
      premiumReferenceCount: Array.isArray(source.premiumReferences) ? source.premiumReferences.length : 0,
      excludedPhrases: [],
      catalogItems: sourceItems,
      candidates: sourceItems
    };
  });
  return {
    totalSources: knowledgeSources.length,
    recommendableProducts: new Set(catalogItems
      .filter((item) => ['충분', '보통'].includes(item.completeness || '부족'))
      .map((item) => `${item.company}-${item.productName}`)).size,
    insufficientProducts: insufficientItems.length,
    reviewNeededProducts: reviewItems.length,
    excludedPhrases: excludedItems.length,
    ocrNeeded: knowledgeSources.filter((item) => item.fileType === 'image').length,
    companies,
    productGroups,
    keywords,
    analysisSummary: {
      premiumReferenceCount: allPremiumReferences.length,
      linkedPremiumReferenceCount: allPremiumReferences.filter((item) => item.linkStatus === 'linked').length,
      documentAnalysisCount: documentAnalyses.length,
      coverageDetailCount: documentAnalyses.reduce((sum, item) => sum + Number(item.analysisQuality?.coverageDetailCount || 0), 0),
      conditionDetailDocuments: documentAnalyses.filter((item) => item.analysisQuality?.hasConditionDetails).length
    },
    catalogItems: allCatalogItems.slice(0, 160),
    recommendableCatalogItems: catalogItems.slice(0, 120),
    catalog
  };
}

function isPolibotRecommendationEligibleSource(source = {}) {
  return source.recommendationEligible !== false
    && !['privacy_risk', 'ocr_needed', 'excluded', 'conflict'].includes(source.knowledgeStatus);
}

function buildPolibotConsultationDraft(profile = {}, qualityReport = {}) {
  const needs = profile.needs || [];
  const coverageAnalysis = polibotCurrentCoverageAnalysis(profile);
  const policyDetails = normalizePolibotPolicyDetails(profile.existingPolicyDetails);
  const disclosure = normalizePolibotDisclosureDetails(profile.disclosureDetails);
  const underwriting = normalizePolibotUnderwritingAssessment(profile.underwritingAssessment);
  const analysisResult = normalizePolibotAnalysisResult(profile.analysisResult);
  const managerCodes = Array.isArray(profile.managerCodes) ? profile.managerCodes : buildPolibotManagerCodeRecommendations(profile);
  const actualCodes = Array.isArray(profile.actualCodes) ? profile.actualCodes : buildPolibotActualCodes(profile);
  const exceptionDiseaseMatches = Array.isArray(profile.exceptionDiseaseMatches) ? profile.exceptionDiseaseMatches : buildPolibotExceptionDiseaseMatches(profile);
  const matchedCoverageCodes = Array.isArray(profile.matchedCoverageCodes) ? profile.matchedCoverageCodes : [];
  const designManagerSummary = buildPolibotDesignManagerSummary({
    profile: { ...profile, managerCodes, actualCodes, matchedCoverageCodes },
    managerCodes,
    actualCodes,
    matchedCoverageCodes
  });
  const missing = [];
  if (!profile.age) missing.push('나이');
  if (!profile.gender) missing.push('성별');
  if (needs.length === 0) missing.push('필요 보장');
  if (!profile.budget) missing.push('예산');
  if (!profile.existingPremium) missing.push('현재 보험료');
  if (!profile.existingPolicies) missing.push('현재 가입 보험');
  if (profile.existingPolicies && policyDetails.length === 0) missing.push('기존 계약 상세');
  if (coverageAnalysis.unknown.length >= 6) missing.push('담보별 담보금액');
  if (!profile.existingMedicalPlan) missing.push('기존 실손 여부');
  if (!profile.medicalHistory) missing.push('병력/고지 이슈');
  if (!disclosure.recent3Months) missing.push('3개월 고지');
  if (!disclosure.recent1Year) missing.push('1년 고지');
  if (!disclosure.recent5Years) missing.push('5년 고지');
  if (!underwriting.route) missing.push('인수심사 방향');
  if (!analysisResult.gaps) missing.push('부족 보장');
  if (!analysisResult.remodelList) missing.push('추천 방향');
  const nextQuestions = [
    !profile.existingPolicies && '현재 가입 중인 보험사/상품명/월 보험료를 확인했나요?',
    profile.existingPolicies && policyDetails.length === 0 && '기존 계약별 보험사, 상품명, 갱신 여부, 만기, 보험료를 분리했나요?',
    coverageAnalysis.gaps.length > 0 && `현재 보장 기준 ${coverageAnalysis.gaps.slice(0, 3).map((item) => item.label).join(', ')} 공백을 우선 확인하세요.`,
    !profile.existingMedicalPlan && '기존 실손보험이 있나요?',
    (!profile.medicalHistory || !disclosure.recent5Years) && '최근 5년 내 입원, 수술, 투약이나 고지 이슈가 있나요?',
    !disclosure.recent3Months && '최근 3개월 내 진찰/검사/추가검사 소견이 있었나요?',
    !disclosure.recent1Year && '최근 1년 내 추가검사나 재검사 소견이 있었나요?',
    !underwriting.route && '표준심사, 간편심사, 조건부 인수 중 어느 경로가 우선인가요?',
    !analysisResult.remodelList && '유지할 계약과 보완할 담보를 분리했나요?',
    !profile.existingPremium && '현재 월 보험료는 얼마인가요?',
    !profile.renewalPreference && '갱신형 상품도 괜찮나요?',
    needs.includes('암') && '암 진단비 목표 금액이 있나요?',
    needs.some((need) => ['뇌', '심장'].includes(need)) && '뇌/심장 진단비를 각각 어느 정도로 보고 있나요?'
  ].filter(Boolean).slice(0, 6);
  const cautions = [
    '고지사항 확인 필요',
    coverageAnalysis.gaps.length > 0 && `보장 공백 후보: ${coverageAnalysis.gaps.slice(0, 4).map((item) => item.label).join(', ')}`,
    coverageAnalysis.duplicates.length > 0 && `중복/과다 여부 점검: ${coverageAnalysis.duplicates.slice(0, 3).map((item) => item.label).join(', ')}`,
    analysisResult.duplicates && `상담자 중복 판단: ${analysisResult.duplicates}`,
    analysisResult.caution && `해지/전환 주의: ${analysisResult.caution}`,
    !profile.existingMedicalPlan && '실손 중복 여부 확인 필요',
    !profile.medicalHistory && '병력/부담보 가능성 확인 필요',
    Object.values(disclosure).some((value) => /있음|예|치료|투약|입원|수술|검사|진단/i.test(value)) && '상세 고지에 따라 표준/간편/부담보 심사 경로 확인 필요',
    profile.renewalPreference === '비갱신 선호' && '비갱신형 보험료 부담 확인 필요',
    qualityReport.recommendableProducts === 0 && '자동 확정 상품 자료 부족',
    ...managerCodes.filter((item) => item.status !== 'applied').slice(0, 4).map((item) => `${item.code} · ${item.reason}`)
  ].filter(Boolean);
  const completeness = missing.length <= 1 ? '충분' : missing.length <= 4 ? '보통' : '부족';
  return {
    summary: [
      profile.name || '고객명 미입력',
      profile.age ? `${profile.age}세` : '',
      profile.gender || '',
      profile.purpose || ''
    ].filter(Boolean).join(' · ') || '고객 조건 미입력',
    needs,
    existingPolicies: profile.existingPolicies || '',
    existingPolicyDetails: policyDetails,
    currentCoverageAnalysis: coverageAnalysis,
    disclosureDetails: disclosure,
    underwritingAssessment: underwriting,
    analysisResult,
    managerCodes,
    actualCodes,
    exceptionDiseaseMatches,
    matchedCoverageCodes,
    designManagerSummary,
    missing,
    completeness,
    nextQuestions,
    cautions,
    memo: missing.length
      ? `${missing.slice(0, 3).join(', ')} 정보를 확인하면 상품 추천 정확도가 올라가요.`
      : '분석에 필요한 기본 정보가 비교적 충분해요.',
    createdAt: now()
  };
}

function polibotConfidence({ profile, sources, keywordHits, productNames, qualityReport }) {
  let score = 0;
  if (profile.age) score += 12;
  if (profile.gender) score += 8;
  if ((profile.needs || []).length > 0) score += 18;
  if (profile.budget) score += 8;
  if (profile.existingMedicalPlan) score += 8;
  if (profile.medicalHistory) score += 8;
  if (profile.renewalPreference) score += 5;
  score += Math.min(16, keywordHits.length * 4);
  score += Math.min(12, productNames.length * 4);
  score += Math.min(5, sources.filter((source) => source.month).length);
  const catalogItems = sources.flatMap((source) => sourceCatalogItems(source, profile.catalogReviews));
  if (catalogItems.some((item) => item.completeness === '충분')) score += 8;
  if (catalogItems.some((item) => item.completeness === '부족')) score -= 8;
  if ((qualityReport?.recommendableProducts || 0) < 3) score -= 12;
  const level = score >= 72 ? '높음' : score >= 48 ? '보통' : '낮음';
  const reasons = normalizePolibotCautions([
    level === '낮음' && '고객 정보 또는 상품 근거 보강 필요',
    !profile.medicalHistory && '최종 가입 전 고지 확인 필요',
    ...(Array.isArray(profile.riskHoldReasons) ? profile.riskHoldReasons.map(formatPolibotReviewNeed) : []),
    catalogItems.some((item) => item.completeness === '부족') && '확정 상품의 가입조건/주의사항 정보가 부족해요.',
    (qualityReport?.recommendableProducts || 0) < 3 && '추천 가능한 상품 카탈로그가 아직 적어요.'
  ].filter(Boolean), profile);
  return { level, score, reasons };
}

function buildPolibotRecommendationReview({ decisionAnalysis = {}, evidenceIntegrity = {}, catalogCautions = [], selectedPremium = {} } = {}) {
  const blockers = [];
  const reviewReasons = [];
  const routineChecks = [];
  const addUnique = (target, value) => {
    const text = String(value || '').trim();
    if (text && !target.includes(text)) target.push(text);
  };
  const premiumFit = decisionAnalysis.premiumFit || {};
  const medicalRisk = decisionAnalysis.medicalRisk || {};
  const ageChecks = Array.isArray(decisionAnalysis.ageChecks) ? decisionAnalysis.ageChecks : [];
  const itemSummary = decisionAnalysis.itemDecisionSummary || {};
  const integrityScore = Number(evidenceIntegrity.score || 0);
  const lowPremiumMatch = (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.matchQuality?.level === 'low');
  const purposeMismatchItems = (decisionAnalysis.itemDiagnostics || [])
    .filter((item) => item.decisionBreakdown?.purposeMismatch);

  if (decisionAnalysis.eligibilityLevel && decisionAnalysis.eligibilityLevel !== '검토 가능') {
    addUnique(blockers, `가입 가능성: ${decisionAnalysis.eligibilityLevel}`);
  }
  if (ageChecks.some((item) => item.status === 'blocked')) {
    addUnique(blockers, '가입연령 범위 초과 가능');
  }
  if (purposeMismatchItems.length) {
    addUnique(reviewReasons, purposeMismatchItems[0].decisionBreakdown.purposeMismatch.reason);
  }
  if (integrityScore > 0 && integrityScore < 62) {
    addUnique(blockers, `근거 정확도 낮음: ${integrityScore}점`);
  } else if (integrityScore > 0 && integrityScore < 82) {
    addUnique(reviewReasons, `근거 검수 필요: ${integrityScore}점`);
  }
  if (['severe_over_budget', 'reference_severe_over_budget'].includes(premiumFit.level)) {
    addUnique(reviewReasons, premiumFit.reason || '고객 예산을 크게 초과합니다.');
  } else if (['over_budget', 'reference_over_budget', 'near_budget'].includes(premiumFit.level)) {
    addUnique(reviewReasons, premiumFit.reason || '고객 예산 초과 가능');
  }
  if (premiumFit.level === 'estimate_needed') {
    addUnique(reviewReasons, '설계 보험료 산출 후 최종 비교 필요');
  }
  if (selectedPremium.confidence === 'reference') {
    addUnique(reviewReasons, '보험료가 상품 행과 직접 연결되지 않은 참고값입니다.');
  }
  if (lowPremiumMatch) {
    addUnique(reviewReasons, '고객 나이/성별과 보험료표 행 매칭이 약한 후보가 있습니다.');
  }
  if (medicalRisk.level === 'review') {
    addUnique(reviewReasons, medicalRisk.label || '고지 심사 필요');
  }
  if ((itemSummary.holdItems || []).length > 0) {
    addUnique(reviewReasons, `보류/검수 상품 ${itemSummary.holdItems.length}개 확인 필요`);
  }
  if ((itemSummary.premiumUnknownItems || []).length > 0) {
    addUnique(reviewReasons, `보험료 미확정 상품 ${itemSummary.premiumUnknownItems.length}개`);
  }

  catalogCautions.forEach((caution) => {
    const text = String(caution || '').trim();
    if (!text) return;
    if (/가입\s*불가|제외|제한|인수\s*거절|연령|초과|부담보|할증|감액|고지\s*상세|예산|보험료\s*산출|보험료\s*확인|근거|연결\s*강도|부족|검수|확정/.test(text)) {
      addUnique(reviewReasons, text);
      return;
    }
    addUnique(routineChecks, text);
  });

  const status = blockers.length || reviewReasons.length ? 'needs_review' : 'ready';
  const label = status === 'ready'
    ? '추천 초안 준비'
    : blockers.length ? '검수 후 제안' : '상담 확인 필요';
  const mainReasons = [...blockers, ...reviewReasons].slice(0, 6);
  const summary = status === 'ready'
    ? '핵심 가입조건, 보장 니즈, 보험료 근거가 상담 초안으로 사용할 수 있는 수준입니다.'
    : mainReasons.slice(0, 3).join(' · ') || '상담 전 확인할 조건이 있습니다.';

  return {
    status,
    label,
    summary,
    blockers: blockers.slice(0, 6),
    reasons: reviewReasons.slice(0, 8),
    routineChecks: routineChecks.slice(0, 8)
  };
}

function buildPolibotAdvisorExplanation({ profile = {}, name = '', decisionAnalysis = {}, selectedPremium = {}, catalogItems = [] } = {}) {
  const priceStrategy = decisionAnalysis.priceStrategy || {};
  const medicalRisk = decisionAnalysis.medicalRisk || {};
  const coverageMatches = decisionAnalysis.coverageMatches || [];
  const matched = coverageMatches.filter((item) => item.status === 'matched').map((item) => item.need);
  const unmatched = coverageMatches.filter((item) => item.status !== 'matched').map((item) => item.need);
  const holdItems = decisionAnalysis.itemDecisionSummary?.holdItems || [];
  const itemDiagnostics = decisionAnalysis.itemDiagnostics || [];
  const sorted = [...itemDiagnostics].sort((a, b) => Number(b.fitScore || 0) - Number(a.fitScore || 0));
  const first = sorted[0];
  const second = sorted[1];
  const excluded = sorted.filter((item) => (item.blockers || []).length).slice(0, 2);
  const primary = catalogItems[0] || {};
  return [
    `${name}은(는) ${matched.length ? `${matched.join(', ')} 보장과 직접 연결` : '입력 니즈와 연결 검토'}되어 우선 후보로 잡았습니다.`,
    first && `1순위 근거: ${[first.company, first.productName].filter(Boolean).join(' ')} · ${first.fitLevel} ${first.fitScore}점 · ${(first.strengths || []).slice(0, 2).join(', ') || first.premiumStatus}`,
    second && `2순위 비교: ${[second.company, second.productName].filter(Boolean).join(' ')} · ${second.fitLevel} ${second.fitScore}점 · ${(second.blockers || second.cautions || []).slice(0, 2).join(', ') || '조건 비교 후보'}`,
    selectedPremium?.memo && `보험료 판단: ${selectedPremium.memo}`,
    selectedPremium?.matchQuality?.label && `보험료 행 매칭: ${selectedPremium.matchQuality.label} · ${selectedPremium.matchQuality.reason}`,
    priceStrategy.label && `고객 목적은 ${priceStrategy.label} 기준으로 해석했습니다.`,
    medicalRisk.routeHint && `심사 방향은 ${medicalRisk.routeHint}입니다.`,
    primary.renewalType && `갱신 조건은 ${primary.renewalType}로 표시되어 장기 보험료 변동을 상담 때 확인해야 합니다.`,
    unmatched.length && `직접 연결이 약한 보장: ${unmatched.join(', ')}. 별도 특약 또는 다른 상품으로 보완 여부를 봅니다.`,
    holdItems.length && `비교 제외/보류 후보는 ${holdItems.length}개이며 주된 사유는 ${(holdItems[0].reasons || []).join(', ') || '가입조건 확인'}입니다.`,
    excluded.length && `제외/후순위 사유: ${excluded.map((item) => `${item.productName}: ${(item.blockers || []).slice(0, 2).join(', ')}`).join(' / ')}`
  ].filter(Boolean).slice(0, 7);
}

function buildPolibotExcludedCandidates(evidence = [], profile = {}) {
  return evidence
    .map((source) => {
      const items = sourceAllCatalogItems(source, profile.catalogReviews);
      const usable = sourceCatalogItems(source, profile.catalogReviews);
      return { source, items, usable };
    })
    .filter(({ usable }) => usable.length === 0)
    .slice(0, 6)
    .map(({ source, items }) => ({
      name: source.fileName || '자료명 미입력',
      reason: items.some((item) => item.status === 'excluded')
        ? '상품명 후보가 제외 처리됐거나 문서/담보 조각으로 판단됐습니다.'
        : items.some((item) => item.status === 'review')
          ? '상품 후보는 있으나 자동 확정 점수나 정보 완성도가 부족합니다.'
          : source.fileType === 'image'
        ? 'OCR 전 이미지 자료라 상품명을 확인하지 못했어요.'
        : source.keywordHits?.length ? '니즈 키워드는 있지만 실제 상품명이 부족해요.' : '고객 니즈와 직접 연결되는 근거가 약해요.',
      details: items.slice(0, 3).map((item) => `${item.productName || '상품명 미확인'} · ${item.status || '상태 미확인'} · ${item.completeness || '완성도 미확인'}`),
      fileName: source.fileName,
      month: source.month
    }));
}

function buildPolibotRecommendation({ profile, evidence, label, type, index, seed }) {
  const sources = evidence.slice(index, index + (type === 'bundle' ? 3 : 1));
  const primary = sources[0] || {};
  const keywordHits = [...new Set(sources.flatMap((source) => source.keywordHits || []).filter(Boolean))].slice(0, 6);
  const productGroup = primary.productGroup || label;
  const selectedCompany = String(profile.company || '').trim();
  const rawCatalogItems = sources.flatMap((source) => sourceCatalogItems(source, profile.catalogReviews))
    .filter((item) => !selectedCompany || selectedCompany === '전체 보험사' || item.company === selectedCompany || (item.companies || []).includes(selectedCompany))
    .filter((item) => isPolibotCatalogItemProfileEligible(item, profile))
    .sort((a, b) => polibotCatalogItemScore(b, profile) - polibotCatalogItemScore(a, profile));
  const needMatchedItems = rawCatalogItems.filter((item) => catalogItemMatchesNeeds(item, profile.needs));
  const candidateItems = needMatchedItems.length ? needMatchedItems : rawCatalogItems;
  const representativeItems = representativePolibotCatalogItems(candidateItems, profile);
  const supportItems = candidateItems
    .filter((item) => !representativeItems.some((representative) => representative.id && representative.id === item.id))
    .slice(0, 6);
  const catalogItems = [...representativeItems, ...supportItems].slice(0, 10);
  const titleItems = representativeItems.filter((item) => ['product', 'plan'].includes(item.displayKind || polibotCatalogItemKind(item)));
  const needMatchedTitleItems = titleItems.filter((item) => catalogItemTitleMatchesNeeds(item, profile.needs));
  const titleSourceItems = needMatchedTitleItems.length ? needMatchedTitleItems : titleItems;
  const eligibleTitleItems = titleSourceItems.filter((item) => polibotAgeRangeStatus(item, profile).status !== 'blocked' && !polibotPurposeMismatch(item, profile));
  const nameTitleItems = eligibleTitleItems.length ? eligibleTitleItems : titleSourceItems;
  const productNames = [...new Set(nameTitleItems.map((item) => cleanPolibotRecommendationName(item.productName, item.company)).filter(Boolean))];
  if (productNames.length === 0) return null;
  if (type === 'bundle' && productNames.length < 2) return null;
  const recommendationNameSet = new Set(productNames);
  const recommendationProductItems = titleItems
    .filter((item) => recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)));
  const recommendationCompanies = new Set(recommendationProductItems.map((item) => item.company).filter(Boolean));
  const sourceCompanies = [...new Set(catalogItems.flatMap((item) => item.companies?.length ? item.companies : [item.company]).filter((company) => company && company !== '미분류'))];
  const mainName = productNames[0];
  const prefix = sourceCompanies[0] && !mainName.includes(sourceCompanies[0]) ? `${sourceCompanies[0]} ` : '';
  const name = type === 'bundle'
    ? `${productNames.slice(0, 2).join(' + ')} 조합`
    : `${prefix}${mainName}`;
  const premiumCatalogItems = catalogItems
    .filter((item) => recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)))
    .slice(0, 4);
  const baseScore = Math.max(...sources.map((source) => Number(source.matchScore || 0)), 0);
  const score = Math.min(96, 70 + Math.min(18, baseScore) + Math.min(6, sources.length * 2));
  const coveredNeeds = (profile.needs || []).filter((need) => keywordHits.some((keyword) => need.includes(keyword) || keyword.includes(need))).slice(0, 5);
  const gapText = coveredNeeds.length ? coveredNeeds.join(', ') : (profile.needs || []).slice(0, 3).join(', ') || productGroup;
  const itemKeywords = [...new Set(catalogItems.flatMap((item) => item.coverageKeywords || []).filter(Boolean))].slice(0, 8);
  const keywordText = keywordHits.length ? keywordHits.join(', ') : itemKeywords.length ? itemKeywords.join(', ') : productGroup;
  const managerCodes = Array.isArray(profile.managerCodes) ? profile.managerCodes : buildPolibotManagerCodeRecommendations(profile);
  const actualCodes = Array.isArray(profile.actualCodes) ? profile.actualCodes : buildPolibotActualCodes(profile);
  const matchedCoverageCodes = Array.isArray(profile.matchedCoverageCodes) ? profile.matchedCoverageCodes : [];
  const recommendationMatchedCoverageCodes = scopePolibotMatchedCoverageCodes(matchedCoverageCodes, {
    catalogItems,
    keywordHits,
    productGroup,
    sourceCompanies
  });
  const analysisProfile = {
    ...profile,
    managerCodes,
    actualCodes,
    matchedCoverageCodes: recommendationMatchedCoverageCodes
  };
  const riskCautions = Array.isArray(profile.riskHoldReasons)
    ? profile.riskHoldReasons.map(formatPolibotReviewNeed)
    : [];
  const catalogCautions = normalizePolibotCautions([
    ...riskCautions,
    ...managerCodes
      .filter((item) => item.status !== 'applied')
      .map((item) => `${item.code} ${item.label}: ${item.reason}`),
    ...catalogItems.flatMap((item) => [
    ...(item.cautions || []),
    item.cautionMemo,
    item.disclosureMemo,
    item.reductionMemo,
    ...(item.excludedAudience || []).map((value) => `제외/제한: ${value}`)
    ])
  ].filter(Boolean), profile);
  const sourcePremiumReferences = sources
    .flatMap((source) => Array.isArray(source.premiumReferences) ? source.premiumReferences : [])
    .filter((item) => !recommendationCompanies.size || recommendationCompanies.has(item.company))
    .filter((item) => !item.productName || recommendationNameSet.has(cleanPolibotRecommendationName(item.productName, item.company)))
    .filter((item) => item && item.premium)
    .slice(0, 60);
  const selectedPremium = selectPolibotPremiumExample(premiumCatalogItems, profile, sourcePremiumReferences);
  const premiumMemo = selectedPremium.memo;
  const premiumPlan = buildPolibotPremiumPlan(profile);
  const decisionAnalysis = buildPolibotDecisionAnalysis({
    profile: analysisProfile,
    catalogItems,
    premiumCatalogItems,
    premiumReferences: sourcePremiumReferences,
    keywordText,
    name
  });
  const evidenceIntegrity = decisionAnalysis.evidenceIntegrity || {};
  const reviewSummary = buildPolibotRecommendationReview({
    decisionAnalysis,
    evidenceIntegrity,
    catalogCautions,
    selectedPremium
  });
  const advisorExplanation = buildPolibotAdvisorExplanation({
    profile: analysisProfile,
    name,
    decisionAnalysis,
    selectedPremium,
    catalogItems
  });
  const designManagerSummary = decisionAnalysis.designManagerSummary || buildPolibotDesignManagerSummary({
    profile: analysisProfile,
    decisionAnalysis,
    managerCodes,
    actualCodes,
    matchedCoverageCodes: recommendationMatchedCoverageCodes,
    catalogItems
  });
  const decisionScoreValue = Number(decisionAnalysis.decisionScore?.score || 0);
  const integrityScoreValue = Number(evidenceIntegrity.score || 0);
  const purposeScoreValue = Number(decisionAnalysis.purposeAnalysis?.score || 0);
  const blendedScore = Math.round((score * 0.34) + (decisionScoreValue * 0.28) + (integrityScoreValue * 0.2) + (purposeScoreValue * 0.18));
  const severeBudgetOverrun = ['severe_over_budget', 'reference_severe_over_budget'].includes(decisionAnalysis.premiumFit?.level)
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.status === 'severe_over_budget');
  const moderateBudgetOverrun = ['over_budget', 'reference_over_budget'].includes(decisionAnalysis.premiumFit?.level)
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.premium?.status === 'over_budget');
  const ageBlocked = (decisionAnalysis.ageChecks || []).some((item) => item.status === 'blocked')
    || (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.age?.status === 'blocked');
  const purposeMismatch = (decisionAnalysis.itemDiagnostics || []).some((item) => item.decisionBreakdown?.purposeMismatch);
  const adjustedScore = Math.max(0, Math.min(
    evidenceIntegrity.score < 62 ? 58 : evidenceIntegrity.score < 82 ? 78 : 96,
    ageBlocked ? 58 : 96,
    purposeMismatch ? 68 : 96,
    severeBudgetOverrun ? 72 : moderateBudgetOverrun ? 84 : 96,
    blendedScore
  ));
  return {
    id: `polibot-rec-${hashText(`${type}-${name}-${index}-${Date.now()}`)}`,
    type,
    name,
    score: adjustedScore,
    headline: type === 'bundle' ? '근거 자료를 묶어 만든 추천 조합이에요.' : '근거 자료에서 찾은 단품 추천이에요.',
    reason: `${keywordText} 자료가 고객 니즈와 맞아요.`,
    advisorExplanation,
    coverageGap: gapText ? `${gapText} 공백 점검` : '보장 공백 확인',
    decisionAnalysis,
    designManagerSummary,
    premium: premiumMemo,
    targetPremium: premiumPlan.targetPremium,
    currentPremium: premiumPlan.currentPremium,
    additionalBudgetMemo: premiumPlan.additionalBudgetMemo,
    premiumConfidence: selectedPremium.confidence,
    selectedPremiumExample: selectedPremium.selected,
    cautions: catalogCautions.length ? catalogCautions : normalizePolibotCautions(sources.flatMap((source) => source.cautions || []), profile),
    recommendationStatus: reviewSummary.status,
    recommendationStatusLabel: reviewSummary.label,
    reviewSummary,
    reviewReasons: [
      ...reviewSummary.blockers,
      ...reviewSummary.reasons,
      ...managerCodes.filter((item) => item.status !== 'applied').map((item) => `${item.code} · ${item.reason}`)
    ].slice(0, 8),
    routineChecks: reviewSummary.routineChecks,
    managerCodes,
    actualCodes,
    matchedCoverageCodes: recommendationMatchedCoverageCodes,
    keywords: keywordHits.length ? keywordHits : itemKeywords,
    catalogItems: catalogItems.map((item) => compactPolibotClientCatalogItem({
      ...item,
      decisionBreakdown: polibotItemDecisionBreakdown(item, profile)
    })),
    sourceCompanies,
    evidence: sources.map((source) => polibotEvidencePayload(source, profile.catalogReviews)),
    confidence: polibotConfidence({ profile, sources, keywordHits, productNames, qualityReport: profile.qualityReport }),
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    nextQuestions: [...new Set([
      ...(decisionAnalysis.nextQuestions || []),
      ...(profile.consultationDraft?.nextQuestions || [])
    ])].slice(0, 8),
    createdAt: now()
  };
}

export async function savePolibotRecommendation(userId, {
  name = '',
  age = '',
  gender = '',
  needs = '',
  budget = '',
  company = '',
  existingPolicies = '',
  existingPolicyDetails = [],
  currentCoverage = {},
  existingMedicalPlan = '',
  existingPremium = '',
  medicalHistory = '',
  disclosureDetails = {},
  underwritingAssessment = {},
  analysisResult = {},
  familyHistory = '',
  driving = '',
  renewalPreference = '',
  purpose = ''
} = {}) {
  const profile = {
    name: String(name || '').trim(),
    age: String(age || '').trim(),
    gender: String(gender || '').trim(),
    needs: normalizeList(needs),
    budget: String(budget || '').trim(),
    company: String(company || '').trim() || '전체 보험사',
    existingPolicies: String(existingPolicies || '').trim(),
    existingPolicyDetails: normalizePolibotPolicyDetails(existingPolicyDetails),
    currentCoverage: normalizePolibotCurrentCoverage(currentCoverage),
    existingMedicalPlan: String(existingMedicalPlan || '').trim(),
    existingPremium: String(existingPremium || '').trim(),
    medicalHistory: String(medicalHistory || '').trim(),
    disclosureDetails: normalizePolibotDisclosureDetails(disclosureDetails),
    underwritingAssessment: normalizePolibotUnderwritingAssessment(underwritingAssessment),
    analysisResult: normalizePolibotAnalysisResult(analysisResult),
    familyHistory: String(familyHistory || '').trim(),
    driving: String(driving || '').trim(),
    renewalPreference: String(renewalPreference || '').trim(),
    purpose: POLIBOT_PURPOSES.includes(String(purpose || '').trim()) ? String(purpose || '').trim() : String(purpose || '').trim()
  };
  const premiumPlan = buildPolibotPremiumPlan(profile);
  const timing = createPolibotTimingLogger('polibot_recommend_timing');
  profile.targetPremium = premiumPlan.targetPremium;
  profile.currentPremium = premiumPlan.currentPremium;
  profile.additionalBudgetMemo = premiumPlan.additionalBudgetMemo;
  profile.actualCodes = buildPolibotActualCodes(profile);
  profile.exceptionDiseaseMatches = buildPolibotExceptionDiseaseMatches(profile);
  profile.managerCodes = buildPolibotManagerCodeRecommendations(profile);
  timing.mark('actual_codes');
  const hardMissing = [
    !profile.age && '나이',
    profile.needs.length === 0 && '필요 보장',
    !profile.budget && '예산'
  ].filter(Boolean);
  if (!profile.age && profile.needs.length === 0 && !profile.budget) {
    const error = new Error('고객 나이, 니즈, 예산 중 하나 이상을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const missingForRecommendation = [
    !profile.age && '나이',
    !profile.gender && '성별',
    profile.needs.length === 0 && '필요 보장',
    !profile.budget && '예산',
    !profile.existingPolicies && '현재 가입 보험',
    profile.existingPolicies && profile.existingPolicyDetails.length === 0 && '기존 계약 상세',
    polibotCurrentCoverageAnalysis(profile).unknown.length >= 6 && '담보별 담보금액',
    !profile.existingMedicalPlan && '기존 실손 여부',
    !profile.medicalHistory && '병력/고지 이슈',
    !profile.disclosureDetails.recent3Months && '3개월 고지',
    !profile.disclosureDetails.recent1Year && '1년 고지',
    !profile.disclosureDetails.recent5Years && '5년 고지',
    !profile.underwritingAssessment.route && !profile.actualCodes.length && '인수심사 방향',
    !profile.analysisResult.gaps && '부족 보장',
    !profile.analysisResult.remodelList && '추천 방향'
  ].filter(Boolean);
  if (hardMissing.length > 0) {
    const qualityReport = buildPolibotQualityReport([], {});
    const consultationDraft = buildPolibotConsultationDraft(profile, qualityReport);
    const consultationSummary = buildPolibotConsultationSummary(profile, consultationDraft, profile.exceptionDiseaseMatches);
    const recommendationNotice = `추천 전에 ${(hardMissing.length ? hardMissing : missingForRecommendation).slice(0, 4).join(', ')} 정보를 먼저 확인해 주세요. 고객 조건이 부족해서 사용 횟수는 차감하지 않았어요.`;
    const patch = {
      customerProfile: profile,
      consultationDraft,
      consultationSummary,
      qualityReport,
      recommendations: [],
      excludedCandidates: [],
      exceptionDiseaseMatches: profile.exceptionDiseaseMatches,
      recommendationNotice
    };
    patch.knowledgeSnapshot = buildPolibotKnowledgeSnapshot({
      workspace: {},
      evidence: [],
      recommendations: [],
      recommendationNotice
    });
    timing.mark('hard_missing_patch');
    updateWorkspace(userId, 'polibot', patch).catch((error) => {
      console.warn('[polibot_incomplete_draft_save_failed]', error?.message || error);
    });
    timing.mark('queued_update');
    timing.flush({ mode: 'hard_missing', hardMissing });
    return {
      ...patch,
      updatedAt: now(),
      usage: normalizeUsage({}, 'polibot')
    };
  }
  const seed = hashText(JSON.stringify(profile));
  const {
    workspace,
    knowledgeSources,
    catalogReviews,
    qualityReport
  } = await getPolibotRecommendationContext(userId, timing);
  profile.matchedCoverageCodes = await buildPolibotMatchedCoverageCodes(userId, profile);
  timing.mark('matched_coverage_codes');
  const recommendationKnowledgeSources = knowledgeSources.filter(isPolibotRecommendationEligibleSource);
  const consultationDraft = buildPolibotConsultationDraft(profile, qualityReport);
  const consultationSummary = buildPolibotConsultationSummary(profile, consultationDraft, profile.exceptionDiseaseMatches);
  timing.mark('consultation');
  const riskHoldReasons = [
    !profile.existingMedicalPlan && '기존 실손 여부',
    profile.existingMedicalPlan && profile.existingMedicalPlan !== '없음' && '실손 중복 여부',
    !polibotUnderwritingMedicalText(profile) && '병력/고지 이슈',
    (!profile.disclosureDetails.recent3Months || !profile.disclosureDetails.recent1Year || !profile.disclosureDetails.recent5Years) && '고지 기간별 상세',
    ...profile.actualCodes.filter((item) => item.status === 'needs_review').sort((a, b) => {
      const priority = (item = {}) => {
        const reasonCodes = Array.isArray(item.reviewReasonCodes) ? item.reviewReasonCodes : [item.reviewReasonCode].filter(Boolean);
        if (reasonCodes.includes('recent3_medical_event')) return 1;
        if (reasonCodes.includes('recent3_missing') || reasonCodes.includes('recent3_incomplete')) return 2;
        if (reasonCodes.includes('lookback_short') || reasonCodes.includes('lookback_unknown')) return 3;
        return 9;
      };
      return priority(a) - priority(b);
    }).slice(0, 4).map((item) => {
      const reasonCodes = Array.isArray(item.reviewReasonCodes) ? item.reviewReasonCodes : [item.reviewReasonCode].filter(Boolean);
      if (reasonCodes.includes('recent3_missing')) return `${item.code} 최근 3개월 문진 확인 필요`;
      if (reasonCodes.includes('recent3_incomplete')) return `${item.code} 최근 3개월 문진 전체 항목 확인 필요`;
      if (reasonCodes.includes('recent3_medical_event')) return `${item.code} 최근 3개월 고지 상세 확인 필요`;
      if (reasonCodes.includes('lookback_short') || reasonCodes.includes('lookback_unknown')) return `${item.code} 자료기간 확인 필요`;
      return `${item.code} 검수 필요`;
    }),
    !profile.underwritingAssessment.route && !profile.actualCodes.length && '인수심사 방향',
    /있음|예|확인|수술|입원|투약|치료|진단/i.test(polibotUnderwritingMedicalText(profile)) && '고지 상세',
    Object.values(profile.disclosureDetails || {}).some((value) => /있음|예|확인|수술|입원|투약|치료|진단|검사/i.test(value)) && '고지 상세',
    Object.values(profile.underwritingAssessment || {}).some((value) => /부담보|할증|간편|조건부|어려움/i.test(value)) && '인수 조건',
    profile.budget && Number(String(profile.budget).replace(/[^\d.]/g, '')) > 0 && Number(String(profile.budget).replace(/[^\d.]/g, '')) < 5 && '예산 조건',
    ...profile.managerCodes.filter((item) => item.status !== 'applied').map((item) => item.label)
  ].filter(Boolean);
  const enrichedProfile = { ...profile, qualityReport, consultationDraft, catalogReviews, riskHoldReasons };
  const rankedEvidence = rankPolibotEvidence(recommendationKnowledgeSources, profile);
  timing.mark('rank');
  const evidence = rankedEvidence
    .filter((source) => Number(source.matchScore || 0) >= 9
      || (source.keywordHits || []).length > 0
      || sourceCatalogItems(source, catalogReviews).some((item) => catalogItemMatchesNeeds(item, profile.needs)))
    .slice(0, 12);
  const productEvidence = rankedEvidence
    .filter((source) => sourceCatalogItems(source, catalogReviews).some((item) => catalogItemMatchesNeeds(item, profile.needs)))
    .slice(0, 6);
  const recommendationEvidence = productEvidence;
  const labels = recommendationEvidence.map((source) => source.productGroup || '보장 검토');
  const singleRecommendations = labels.slice(0, 4).map((label, index) => buildPolibotRecommendation({
    profile: enrichedProfile,
    evidence: recommendationEvidence,
    label,
    type: 'single',
    index,
    seed
  }));
  const bundleRecommendations = recommendationEvidence.length >= 2 ? [0, 1].map((offset) => buildPolibotRecommendation({
    profile: enrichedProfile,
    evidence: recommendationEvidence,
    label: offset === 0 ? '질병/실손' : '생활비/간병',
    type: 'bundle',
    index: offset,
    seed: seed + 17
  })) : [];
  const recommendations = [...singleRecommendations, ...bundleRecommendations]
    .filter((item) => item && item.evidence.length > 0)
    .sort((a, b) => b.score - a.score)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.name === item.name) === index)
    .slice(0, 3);
  timing.mark('recommendations');
  const recommendationNotice = recommendations.length
    ? (riskHoldReasons.length ? `${riskHoldReasons.slice(0, 3).map(formatPolibotReviewNeed).join(', ')} 항목을 확인해 주세요. 추천 후보의 주의 조건에 표시했어요.` : '')
    : (qualityReport.recommendableProducts > 0
      ? '추천 가능한 상품은 있지만 입력한 고객 조건과 직접 맞는 조합을 찾지 못했어요. 니즈, 예산, 보험사 조건을 조금 더 구체화해 주세요.'
      : '추천 가능한 확정 상품 데이터가 부족해요. 상품 비교표나 설계 자료를 추가하거나 검토 필요 후보를 먼저 정리해 주세요.');
  const knowledgeSnapshot = buildPolibotKnowledgeSnapshot({
    workspace,
    evidence: recommendationEvidence.length ? recommendationEvidence : evidence,
    recommendations,
    recommendationNotice
  });
  const recommendationsWithSnapshot = recommendations.map((recommendation) => ({
    ...recommendation,
    knowledgeSnapshot: {
      createdAt: knowledgeSnapshot.createdAt,
      latestKnowledgeMonth: knowledgeSnapshot.latestKnowledgeMonth,
      dbSummary: knowledgeSnapshot.dbSummary,
      usedSourceIds: knowledgeSnapshot.usedSources.map((source) => source.sourceId).filter(Boolean),
      usedCatalogItems: knowledgeSnapshot.usedCatalogItems
        .filter((item) => (recommendation.catalogItems || []).some((candidate) => candidate.productName === item.productName && candidate.company === item.company))
        .slice(0, 10)
    }
  }));
  const recommendationDesignManagerSummary = recommendationsWithSnapshot[0]?.designManagerSummary || null;
  const workspaceFallbackDesignManagerSummary = buildPolibotDesignManagerSummary({
    profile,
    managerCodes: profile.managerCodes,
    actualCodes: profile.actualCodes,
    matchedCoverageCodes: profile.matchedCoverageCodes,
    catalogItems: []
  });
  const workspaceDesignManagerSummary = recommendationDesignManagerSummary && (recommendationDesignManagerSummary.recommendedCodes || []).length
    ? recommendationDesignManagerSummary
    : workspaceFallbackDesignManagerSummary;
  const designManagerReview = {
    status: 'review_requested',
    label: '설계매니저 검수 필요',
    purpose: profile.purpose || '',
    purposeMode: recommendationsWithSnapshot[0]?.decisionAnalysis?.purposeAnalysis?.mode || polibotPriceStrategy(profile).mode,
    route: workspaceDesignManagerSummary.route || '',
    routeReason: workspaceDesignManagerSummary.routeReason || '',
    recommendedCodes: workspaceDesignManagerSummary.recommendedCodes || [],
    codeAssessments: workspaceDesignManagerSummary.codeAssessments || [],
    exceptionDiseaseMatches: profile.exceptionDiseaseMatches || [],
    priorityCoverage: workspaceDesignManagerSummary.priorityCoverage || [],
    nextAction: recommendationsWithSnapshot.length ? '추천 후보 검수' : '추천 보류 사유 검수',
    reviewPoints: [
      profile.purpose && `고객 목적: ${profile.purpose}`,
      workspaceDesignManagerSummary.route && `심사 경로: ${workspaceDesignManagerSummary.route}`,
      (profile.exceptionDiseaseMatches || []).length && `예외질환 후보: ${(profile.exceptionDiseaseMatches || []).slice(0, 3).map((item) => `${item.company} ${item.kcdCode || ''} ${item.diseaseName}`.trim()).join(' / ')}`,
      ...(workspaceDesignManagerSummary.recommendedCodes || []).slice(0, 5).map((item) => `코드 후보: ${item.code} ${item.company || ''} ${item.connectedValue || ''}`.trim()),
      ...(riskHoldReasons || []).slice(0, 5),
      ...(recommendationsWithSnapshot[0]?.reviewReasons || []).slice(0, 5)
    ].filter(Boolean),
    requestedAt: now()
  };
  const patch = {
    customerProfile: profile,
    consultationDraft,
    consultationSummary,
    qualityReport: compactPolibotClientQualityReport(qualityReport),
    recommendations: recommendationsWithSnapshot,
    excludedCandidates: buildPolibotExcludedCandidates(evidence, profile),
    managerCodes: profile.managerCodes,
    actualCodes: profile.actualCodes,
    matchedCoverageCodes: profile.matchedCoverageCodes,
    exceptionDiseaseMatches: profile.exceptionDiseaseMatches,
    designManagerReview,
    recommendationNotice,
    knowledgeSnapshot
  };
  timing.mark('snapshot');
  const result = recommendationsWithSnapshot.length
    ? updateWorkspaceAndConsume(userId, 'polibot', patch)
    : updateWorkspace(userId, 'polibot', patch);
  const saved = await result;
  timing.mark('update');
  timing.flush({
    mode: recommendationsWithSnapshot.length ? 'recommended' : 'no_match',
    sourceCount: knowledgeSources.length,
    evidenceCount: recommendationEvidence.length,
    recommendationCount: recommendationsWithSnapshot.length
  });
  return compactPolibotSavedWorkspace(saved);
}

export async function listPolibotCatalogReview(userId) {
  const workspace = await getProductWorkspace(userId, 'polibot');
  return {
    qualityReport: workspace.qualityReport || {},
    catalogReviews: normalizeCatalogReviews(workspace.catalogReviews)
  };
}

export async function savePolibotCatalogReviews(userId, reviews = {}) {
  const workspace = await getProductWorkspace(userId, 'polibot');
  const currentReviews = normalizeCatalogReviews(workspace.catalogReviews);
  const nextReviews = normalizeCatalogReviews({
    ...currentReviews,
    ...reviews
  });
  return updateWorkspace(userId, 'polibot', {
    catalogReviews: nextReviews
  });
}

export async function savePolibotCustomer(userId, { id = '', name = '', age = '', memo = '', recommendationId = '', selectedRecommendation = null, profile = null } = {}) {
  const workspace = await getPolibotCustomerWorkspace(userId);
  const currentProfile = profile && typeof profile === 'object'
    ? profile
    : {
      ...(workspace.customerProfile || {}),
      name,
      age
    };
  const recommendation = selectedRecommendation && typeof selectedRecommendation === 'object'
    ? selectedRecommendation
    : (workspace.recommendations || []).find((item) => item.id === recommendationId);
  const customers = Array.isArray(workspace.customers) ? workspace.customers : [];
  const existing = customers.find((item) => item.id === id);
  const customer = {
    id: String(id || '').trim() || `polibot-customer-${hashText(`${currentProfile.name || name}-${currentProfile.age || age}-${Date.now()}`)}`,
    name: String(name || currentProfile.name || '').trim() || '이름 미입력',
    age: String(age || currentProfile.age || '').trim(),
    gender: String(currentProfile.gender || '').trim(),
    needs: Array.isArray(currentProfile.needs) ? currentProfile.needs : [],
    budget: String(currentProfile.budget || '').trim(),
    existingPolicies: String(currentProfile.existingPolicies || '').trim(),
    existingPolicyDetails: normalizePolibotPolicyDetails(currentProfile.existingPolicyDetails),
    currentCoverage: normalizePolibotCurrentCoverage(currentProfile.currentCoverage),
    existingMedicalPlan: String(currentProfile.existingMedicalPlan || '').trim(),
    existingPremium: String(currentProfile.existingPremium || '').trim(),
    medicalHistory: String(currentProfile.medicalHistory || '').trim(),
    disclosureDetails: normalizePolibotDisclosureDetails(currentProfile.disclosureDetails),
    underwritingAssessment: normalizePolibotUnderwritingAssessment(currentProfile.underwritingAssessment),
    analysisResult: normalizePolibotAnalysisResult(currentProfile.analysisResult),
    familyHistory: String(currentProfile.familyHistory || '').trim(),
    driving: String(currentProfile.driving || '').trim(),
    renewalPreference: String(currentProfile.renewalPreference || '').trim(),
    purpose: String(currentProfile.purpose || '').trim(),
    memo: String(memo || '').trim(),
    selectedRecommendation: recommendation || existing?.selectedRecommendation || null,
    recommendations: Array.isArray(workspace.recommendations) && workspace.recommendations.length ? workspace.recommendations : existing?.recommendations || [],
    consultationDraft: workspace.consultationDraft || existing?.consultationDraft || null,
    designManagerReview: workspace.designManagerReview || existing?.designManagerReview || null,
    excludedCandidates: workspace.excludedCandidates || existing?.excludedCandidates || [],
    knowledgeSnapshot: workspace.knowledgeSnapshot || recommendation?.knowledgeSnapshot || existing?.knowledgeSnapshot || null,
    updatedAt: now(),
    createdAt: existing?.createdAt || now()
  };
  const withoutCurrent = customers.filter((item) => item.id !== customer.id);
  const nextWorkspace = await updateWorkspace(userId, 'polibot', {
    customers: [customer, ...withoutCurrent].slice(0, 100)
  });
  return compactPolibotSavedWorkspace(nextWorkspace);
}

const POLIBOT_FEEDBACK_MAP = {
  '좋음': 'good',
  good: 'good',
  '애매함': 'unclear',
  unclear: 'unclear',
  '틀림': 'wrong',
  wrong: 'wrong'
};

function normalizePolibotFeedback(value = '') {
  const key = String(value || '').trim();
  return POLIBOT_FEEDBACK_MAP[key] || '';
}

function buildPolibotFeedbackLearningSignal({ target = {}, normalizedRating = '', reason = '', memo = '' } = {}) {
  const reasonText = `${reason || ''} ${memo || ''}`;
  const flags = [
    /상품명/.test(reasonText) && '상품명 추출/확정 규칙 검수',
    /보장|담보|매칭/.test(reasonText) && '담보 매칭 가중치 보정',
    /조건|가입|연령|고지|병력|심사/.test(reasonText) && '가입조건/고지 판단 보정',
    /보험료|가격|예산/.test(reasonText) && '보험료 연결/예산 판단 보정',
    /설명|이유|근거/.test(reasonText) && '상담 설명문 보강'
  ].filter(Boolean);
  return {
    rating: normalizedRating,
    shouldReview: normalizedRating !== 'good',
    productNames: [...new Set((target.catalogItems || []).map((item) => item.productName).filter(Boolean))].slice(0, 6),
    companies: [...new Set((target.catalogItems || []).map((item) => item.company).filter(Boolean))].slice(0, 6),
    evidenceFiles: [...new Set((target.evidence || []).map((item) => item.fileName).filter(Boolean))].slice(0, 6),
    reasonFlags: flags.length ? flags : [normalizedRating === 'good' ? '정상 추천 패턴' : '상담사 검수 필요'],
    memo: String(memo || '').trim().slice(0, 400)
  };
}

export async function savePolibotRecommendationFeedback(userId, {
  recommendationId = '',
  feedback = '',
  rating = '',
  reason = '',
  memo = '',
  customerId = ''
} = {}) {
  const normalizedRating = normalizePolibotFeedback(rating || feedback);
  if (!recommendationId || !normalizedRating) {
    const error = new Error('recommendationId와 feedback은 필수입니다.');
    error.status = 400;
    throw error;
  }
  const workspace = await getPolibotCustomerWorkspace(userId);
  const recommendations = Array.isArray(workspace.recommendations) ? workspace.recommendations : [];
  const target = recommendations.find((item) => item.id === recommendationId);
  if (!target) {
    const error = new Error('추천 항목을 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  const labelByRating = { good: '좋음', unclear: '애매함', wrong: '틀림' };
  const learningSignal = buildPolibotFeedbackLearningSignal({ target, normalizedRating, reason, memo });
  const feedbackPatch = {
    feedback: labelByRating[normalizedRating],
    feedbackRating: normalizedRating,
    feedbackReason: String(reason || '').trim(),
    feedbackMemo: String(memo || '').trim(),
    feedbackSavedAt: now()
  };
  const nextRecommendations = recommendations.map((item) => item.id === recommendationId
    ? { ...item, ...feedbackPatch }
    : item);
  const feedbackRow = await dbInsert('polibot_recommendation_feedback', {
    user_id: userId,
    recommendation_id: recommendationId,
    customer_id: String(customerId || '').trim() || null,
    rating: normalizedRating,
    reason: feedbackPatch.feedbackReason,
    memo: feedbackPatch.feedbackMemo,
    recommendation_snapshot: {
      id: target.id,
      name: target.name,
      type: target.type,
      score: target.score,
      reviewReasons: target.reviewReasons || [],
      advisorExplanation: target.advisorExplanation || [],
      learningSignal,
      cautions: target.cautions || [],
      catalogItems: target.catalogItems || [],
      evidence: target.evidence || []
    },
    knowledge_snapshot: target.knowledgeSnapshot || workspace.knowledgeSnapshot || {},
    routed_to_review: normalizedRating !== 'good'
  });
  const nextWorkspace = await updateWorkspace(userId, 'polibot', {
    recommendations: nextRecommendations,
    feedbackSummary: {
      ...(workspace.feedbackSummary || {}),
      lastFeedbackAt: feedbackPatch.feedbackSavedAt,
      lastFeedback: normalizedRating,
      lastLearningFlags: learningSignal.reasonFlags,
      total: Number(workspace.feedbackSummary?.total || 0) + 1,
      needsReview: Number(workspace.feedbackSummary?.needsReview || 0) + (normalizedRating === 'good' ? 0 : 1)
    }
  });
  return {
    ...compactPolibotSavedWorkspace(nextWorkspace),
    feedback: feedbackRow
  };
}

export async function saveSpreadCampaign(userId, { goal = '', channel = '', product = '' } = {}) {
  const cleanGoal = String(goal || '').trim();
  const cleanChannel = String(channel || '').trim();
  const cleanProduct = String(product || '').trim();
  if (!cleanGoal && !cleanChannel && !cleanProduct) {
    const error = new Error('캠페인 정보를 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const draft = {
    id: `spread-campaign-${Date.now()}-${hashText(`${cleanGoal}-${cleanChannel}-${cleanProduct}`)}`,
    title: `${cleanProduct || '제품'} 체험단`,
    goal: cleanGoal,
    channel: cleanChannel,
    product: cleanProduct,
    status: 'draft',
    headline: `${cleanProduct || '제품'} 캠페인 운영 초안`,
    mission: `${cleanChannel || '주요 채널'}에서 ${cleanGoal || '참여자 모집'}을 진행합니다.`,
    checklist: ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    applicants: [],
    submissionReview: null,
    createdAt: now(),
    updatedAt: now()
  };
  const workspace = await getProductWorkspace(userId, 'spread');
  const campaigns = normalizeSpreadCampaigns(workspace);
  return updateWorkspaceAndConsume(userId, 'spread', {
    campaigns: [draft, ...campaigns],
    selectedCampaignId: draft.id,
    campaignDraft: draft
  });
}

function campaignFromLegacyDraft(draft = {}, workspace = {}) {
  if (!draft || typeof draft !== 'object') return null;
  return {
    id: draft.id || `spread-campaign-${hashText(JSON.stringify(draft))}`,
    title: draft.title || draft.headline || `${draft.product || '제품'} 체험단`,
    goal: draft.goal || '',
    channel: draft.channel || '',
    product: draft.product || '',
    status: draft.status || 'draft',
    headline: draft.headline || `${draft.product || '제품'} 캠페인 운영 초안`,
    mission: draft.mission || `${draft.channel || '주요 채널'}에서 ${draft.goal || '참여자 모집'}을 진행합니다.`,
    checklist: Array.isArray(draft.checklist) ? draft.checklist : ['참여 조건 확인', '제출 URL 수집', '필수 키워드 검수'],
    applicants: Array.isArray(draft.applicants) ? draft.applicants : (Array.isArray(workspace.applicants) ? workspace.applicants : []),
    submissionReview: draft.submissionReview || workspace.submissionReview || null,
    createdAt: draft.createdAt || now(),
    updatedAt: draft.updatedAt || draft.createdAt || now()
  };
}

function normalizeSpreadCampaigns(workspace = {}) {
  const campaigns = Array.isArray(workspace.campaigns) ? workspace.campaigns : [];
  const normalized = campaigns.map((campaign) => campaignFromLegacyDraft(campaign, workspace)).filter(Boolean);
  if (normalized.length === 0 && workspace.campaignDraft) {
    const legacy = campaignFromLegacyDraft(workspace.campaignDraft, workspace);
    if (legacy) normalized.push(legacy);
  }
  return normalized;
}

function selectedSpreadCampaign(workspace = {}, campaignId = '') {
  const campaigns = normalizeSpreadCampaigns(workspace);
  const selectedId = campaignId || workspace.selectedCampaignId || campaigns[0]?.id || '';
  return {
    campaigns,
    selectedId,
    selected: campaigns.find((campaign) => campaign.id === selectedId) || campaigns[0] || null
  };
}

function upsertSelectedSpreadCampaign(workspace = {}, campaignId = '', updater = (campaign) => campaign) {
  const { campaigns, selectedId, selected } = selectedSpreadCampaign(workspace, campaignId);
  if (!selected) return { campaigns, selectedCampaignId: selectedId, selectedCampaign: null };
  const nextCampaign = {
    ...updater(selected),
    updatedAt: now()
  };
  const nextCampaigns = campaigns.map((campaign) => campaign.id === nextCampaign.id ? nextCampaign : campaign);
  return {
    campaigns: nextCampaigns,
    selectedCampaignId: nextCampaign.id,
    campaignDraft: nextCampaign,
    selectedCampaign: nextCampaign
  };
}

export async function updateSpreadCampaignStatus(userId, { campaignId = '', status = '' } = {}) {
  const allowedStatuses = new Set(['draft', 'recruiting', 'selecting', 'reviewing', 'completed']);
  if (!allowedStatuses.has(status)) {
    const error = new Error('지원하지 않는 캠페인 상태입니다.');
    error.status = 400;
    throw error;
  }
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status
  }));
  if (!patch.selectedCampaign) {
    const error = new Error('상태를 변경할 캠페인을 찾지 못했습니다.');
    error.status = 404;
    throw error;
  }
  return updateWorkspace(userId, 'spread', patch);
}

export async function saveSpreadApplicants(userId, { applicants = '', criteria = '', campaignId = '' } = {}) {
  const criteriaList = normalizeList(criteria);
  const applicantList = normalizeList(applicants);
  if (applicantList.length === 0) {
    const error = new Error('신청자 목록을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const rows = applicantList.map((name, index) => {
    const score = 55 + (hashText(`${name}-${criteria}`) % 41);
    return {
      id: `spread-applicant-${hashText(`${name}-${index}`)}`,
      name,
      score,
      status: score >= 80 ? '우선 선정' : score >= 68 ? '검토' : '보류',
      reason: criteriaList[0] || '기본 선정 기준',
      createdAt: now()
    };
  });
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status: 'selecting',
    applicants: rows,
    applicantCriteria: criteriaList
  }));
  return updateWorkspaceAndConsume(userId, 'spread', {
    ...patch,
    applicantCriteria: criteriaList,
    applicants: rows
  });
}

export async function reviewSpreadSubmission(userId, { url = '', required = '', forbidden = '', campaignId = '' } = {}) {
  const requiredList = normalizeList(required);
  const forbiddenList = normalizeList(forbidden);
  const normalizedUrl = String(url || '').trim();
  if (!normalizedUrl && requiredList.length === 0 && forbiddenList.length === 0) {
    const error = new Error('제출물 검수 기준을 입력해 주세요.');
    error.status = 400;
    throw error;
  }
  const checks = [
    { label: '제출 URL', passed: /^https?:\/\//i.test(normalizedUrl), detail: normalizedUrl || 'URL 없음' },
    ...requiredList.map((keyword) => ({ label: `필수 키워드: ${keyword}`, passed: false, detail: '본문 연결 전 수동 확인 필요' })),
    ...forbiddenList.map((keyword) => ({ label: `금지 표현: ${keyword}`, passed: true, detail: '입력 URL 단계에서는 감지 없음' }))
  ];
  const submissionReview = {
    url: normalizedUrl,
    required: requiredList,
    forbidden: forbiddenList,
    checks,
    reviewedAt: now()
  };
  const workspace = await getProductWorkspace(userId, 'spread');
  const patch = upsertSelectedSpreadCampaign(workspace, campaignId, (campaign) => ({
    ...campaign,
    status: 'reviewing',
    submissionReview
  }));
  return updateWorkspaceAndConsume(userId, 'spread', {
    ...patch,
    submissionReview
  });
}
