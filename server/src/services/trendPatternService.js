import { readFileSync } from 'node:fs';
import { getJson } from './openaiService.js';
import { extractTrendPatternsPrompt } from '../prompts/extractTrendPatternsPrompt.js';
import { generateTrendInspiredPostPrompt } from '../prompts/generateTrendInspiredPostPrompt.js';
import { scorePostEngagement } from '../utils/postEngagementScoring.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { validatePostStyleFit } from '../utils/accountStyle.js';

const UNSAFE_PATTERN = /(정치|진보|보수|혐오|극혐|한심|노답|틀딱|맘충|남혐|여혐|요즘 애들|남자들은|여자들은|아줌마|아재|세대 차이|갈라치기|편가르|공포|망한다|끝장)/i;
const QUESTION_PATTERN = /[?？]|어느 쪽|뭐가|다들|여러분|어때|먼저 봐|고르|편해/;
const CHOICE_PATTERN = /( vs |VS|아니면|어느 쪽|먼저|갈리|디자인|관리|실용|편한|가격|공간|습관|빈도)/;
const EMPATHY_PATTERN = /(은근|막상|후회|귀찮|불편|오래 감|신경|큰맘|헷갈)/;
const SOURCE_SENTENCE_MIN_LENGTH = 12;
const fixtureSamples = JSON.parse(readFileSync(new URL('../data/trendSamples.json', import.meta.url), 'utf8'));

function normalizeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizePostBody(value = '') {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function firstSentence(value = '') {
  return normalizeText(value).split(/[.!?。！？]|\n/).map((line) => line.trim()).filter(Boolean)[0] || '';
}

function hasUnsafeFrame(text = '') {
  return UNSAFE_PATTERN.test(String(text || ''));
}

function safeId(value = '') {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || `trend-${Date.now()}`;
}

function numberValue(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function scoreTrendPerformance(sample = {}) {
  const likes = numberValue(sample.likes);
  const replies = numberValue(sample.replies);
  const reposts = numberValue(sample.reposts);
  const views = numberValue(sample.views);
  const engagementRate = views > 0 ? ((likes + replies + reposts) / views) * 100 : 0;
  const replyWeight = replies * 3;
  const raw = (likes * 0.35) + replyWeight + (reposts * 1.2) + (engagementRate * 18);
  return Math.round(raw);
}

export function safetyFlagsForTrend(sample = {}) {
  const text = normalizeText(sample.sourceText || sample.text || '');
  const flags = [];
  if (!text) flags.push('empty_text');
  if (hasUnsafeFrame(text)) flags.push('unsafe_conflict_frame');
  if (text.length < 20) flags.push('too_short');
  return flags;
}

function inferTensionType(text = '') {
  if (/(공간|좁|방|수납|보관|정리)/.test(text)) return 'space';
  if (/(가격|예산|비싸|저렴)/.test(text)) return 'budget';
  if (/(자주|매일|빈도|오래|계속)/.test(text)) return 'frequency';
  if (/(습관|먼저|시작|손대)/.test(text)) return 'habit';
  if (CHOICE_PATTERN.test(text)) return 'choice';
  if (/(체크|기준|포인트)/.test(text)) return 'checklist';
  return 'empathy';
}

function inferHookPattern(text = '') {
  const first = firstSentence(text);
  if (/후회|사고 나서/.test(first)) return '후회 방지 기준으로 시작';
  if (/갈리|vs|어느 쪽/.test(first)) return 'A/B 선택 갈림으로 시작';
  if (/은근|막상|불편|귀찮|신경/.test(first)) return '생활 속 은근한 불편으로 시작';
  if (/큰맘|시작|먼저/.test(first)) return '작은 행동 기준으로 시작';
  return '생활 기준 질문으로 시작';
}

function inferCommentQuestion(text = '') {
  if (/디자인|관리|씻기/.test(text)) return '디자인과 관리 편의 중 무엇을 먼저 보는지 묻기';
  if (/접어서|걸어두/.test(text)) return '정리 방식이 어느 쪽인지 묻기';
  if (/청소|손대/.test(text)) return '처음 시작하는 위치나 순서를 묻기';
  if (QUESTION_PATTERN.test(text)) return '개인 경험으로 5초 안에 답할 수 있는 질문 던지기';
  return '자신만의 기준을 가볍게 묻기';
}

function inferEmotionSignal(text = '') {
  if (/후회|실수/.test(text)) return '후회 방지';
  if (/은근|불편|귀찮|신경/.test(text)) return '공감 불편';
  if (/갈리|vs|어느 쪽/.test(text)) return '선택 갈림';
  return '생활 공감';
}

function inferVoicePattern(text = '') {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.some((line) => />|→|:/.test(line)) && lines.length >= 4) return '짧은 관찰을 줄별로 나열하고 비교 기호로 리듬을 만드는 말투';
  if (/ㅋㅋ|ㅎㅎ|ㅠㅠ|…|\.{3,}/.test(text)) return '구어체 감탄과 말끝 흐림을 섞는 편한 말투';
  if (QUESTION_PATTERN.test(text)) return '짧게 상황을 던지고 독자 기준을 묻는 말투';
  return '담백한 생활 관찰형 말투';
}

function inferFormatPattern(text = '') {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 4 && lines.filter((line) => />|→|:/.test(line)).length >= 2) return '제목 1줄 뒤 항목별 비교/판단을 한 줄씩 나열';
  if (/\d+\./.test(text)) return '번호 목록으로 기준을 짧게 정리';
  if (lines.length >= 3) return '짧은 문단을 여러 줄로 끊어 읽히게 구성';
  return '2-4문장 짧은 Threads 문단';
}

function inferLineBreakPattern(text = '') {
  const lines = String(text || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 5) return '거의 한 항목마다 줄바꿈';
  if (/\n\n/.test(text)) return '짧은 문단 사이 빈 줄';
  return '짧은 문장 위주';
}

function inferListStructure(text = '') {
  if (/(^|\n)\s*[@#]?\d{2}년생\s*>/m.test(text)) return '라벨 > 한 줄 평가를 반복하는 연도/유형별 목록';
  if (/(^|\n)\s*[-•]/m.test(text)) return '불릿형 짧은 목록';
  if (/\d+\./.test(text)) return '번호형 체크리스트';
  if (/>|→/.test(text)) return '기호로 비교 기준을 연결하는 목록';
  return '';
}

function inferPunctuationStyle(text = '') {
  const signals = [];
  if (/>/.test(text)) signals.push('>');
  if (/\.{3,}|…/.test(text)) signals.push('말줄임');
  if (/\+/.test(text)) signals.push('플러스 결합');
  if (/[!?]{2,}/.test(text)) signals.push('강한 물음/감탄');
  return signals.length ? `${signals.join(', ')}를 리듬 장치로 사용` : '구두점은 과하지 않게 사용';
}

function inferToneRegister(text = '') {
  if (/ㅋㅋ|ㅎㅎ|ㅠㅠ|뭔가|살짝|대체적으로|느낌/.test(text)) return '가볍고 주관적인 구어체';
  if (/개인적인 견해|내 기준|솔직히/.test(text)) return '개인 의견 전제로 부드럽게 단정';
  return '과한 존댓말보다 짧은 관찰체';
}

export function extractPatternFromSample(sample = {}) {
  const text = normalizeText(sample.sourceText || sample.text || '');
  const rawText = String(sample.sourceText || sample.text || '');
  const safetyFlags = safetyFlagsForTrend(sample);
  return {
    sourceId: safeId(sample.id || sample.sourceUrl || text.slice(0, 20)),
    sourceUrl: sample.sourceUrl || '',
    topicKeyword: sample.topicKeyword || '',
    hookPattern: inferHookPattern(text),
    commentQuestion: inferCommentQuestion(text),
    tensionType: inferTensionType(text),
    emotionSignal: inferEmotionSignal(text),
    reusableStructure: '첫 문장에 생활 불편/선택 갈림을 두고, 짧은 기준 설명 뒤 개인 경험 질문으로 마무리',
    voicePattern: inferVoicePattern(rawText),
    formatPattern: inferFormatPattern(rawText),
    lineBreakPattern: inferLineBreakPattern(rawText),
    listStructure: inferListStructure(rawText),
    punctuationStyle: inferPunctuationStyle(rawText),
    toneRegister: inferToneRegister(rawText),
    safetyFlags,
    performanceScore: scoreTrendPerformance(sample),
    sourceText: text
  };
}

export function rankTrendSamples(samples = [], { query = '', limit = 5 } = {}) {
  const q = normalizeText(query).toLowerCase();
  return samples
    .map((sample) => {
      const text = normalizeText([sample.topicKeyword, sample.sourceText || sample.text].filter(Boolean).join(' '));
      const topicFit = q && text.toLowerCase().includes(q) ? 20 : 0;
      const safetyFlags = safetyFlagsForTrend(sample);
      return {
        ...sample,
        performanceScore: scoreTrendPerformance(sample) + topicFit,
        safetyFlags
      };
    })
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, limit);
}

function fallbackPatterns(samples = [], options = {}) {
  return rankTrendSamples(samples, options)
    .map(extractPatternFromSample)
    .filter((pattern) => !pattern.safetyFlags.includes('unsafe_conflict_frame'));
}

function normalizeAiPatterns(patterns = [], samples = []) {
  const byId = new Map(samples.map((sample) => [safeId(sample.id || sample.sourceUrl || ''), sample]));
  return patterns.map((pattern, index) => {
    const sourceId = safeId(pattern.sourceId || samples[index]?.id || `pattern-${index}`);
    const source = byId.get(sourceId) || samples.find((sample) => safeId(sample.id || sample.sourceUrl || '') === sourceId) || samples[index] || {};
    return {
      sourceId,
      sourceUrl: source.sourceUrl || '',
      topicKeyword: source.topicKeyword || '',
      hookPattern: normalizeText(pattern.hookPattern || inferHookPattern(source.sourceText)),
      commentQuestion: normalizeText(pattern.commentQuestion || inferCommentQuestion(source.sourceText)),
      tensionType: pattern.tensionType || inferTensionType(source.sourceText),
      emotionSignal: normalizeText(pattern.emotionSignal || inferEmotionSignal(source.sourceText)),
      reusableStructure: normalizeText(pattern.reusableStructure || '첫 문장 후킹, 짧은 기준, 댓글 질문'),
      voicePattern: normalizeText(pattern.voicePattern || inferVoicePattern(source.sourceText)),
      formatPattern: normalizeText(pattern.formatPattern || inferFormatPattern(source.sourceText)),
      lineBreakPattern: normalizeText(pattern.lineBreakPattern || inferLineBreakPattern(source.sourceText)),
      listStructure: normalizeText(pattern.listStructure || inferListStructure(source.sourceText)),
      punctuationStyle: normalizeText(pattern.punctuationStyle || inferPunctuationStyle(source.sourceText)),
      toneRegister: normalizeText(pattern.toneRegister || inferToneRegister(source.sourceText)),
      safetyFlags: Array.isArray(pattern.safetyFlags) ? pattern.safetyFlags : safetyFlagsForTrend(source),
      performanceScore: scoreTrendPerformance(source),
      sourceText: normalizeText(source.sourceText || '')
    };
  }).filter((pattern) => !pattern.safetyFlags.includes('unsafe_conflict_frame'));
}

function hasFinalConsonant(value = '') {
  const last = String(value || '').trim().slice(-1);
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

function withSubjectParticle(value = '') {
  const text = normalizeText(value);
  return `${text}${hasFinalConsonant(text) ? '은' : '는'}`;
}

export async function extractTrendPatterns(samples = [], { query = '', limit = 5, useAi = true } = {}) {
  const ranked = rankTrendSamples(samples, { query, limit });
  const safeRanked = ranked.filter((sample) => !sample.safetyFlags.includes('unsafe_conflict_frame'));
  if (!useAi) return fallbackPatterns(safeRanked, { query, limit });
  const fallback = () => ({ patterns: fallbackPatterns(safeRanked, { query, limit }) });
  const result = await getJson(extractTrendPatternsPrompt({ query, samples: safeRanked }), fallback, {
    schemaName: 'extract_trend_patterns',
    validate: (value) => ({ ok: Array.isArray(value?.patterns), reason: 'patterns array is required' })
  });
  return normalizeAiPatterns(result.patterns || [], safeRanked)
    .sort((a, b) => b.performanceScore - a.performanceScore)
    .slice(0, limit);
}

function trendFallbackPosts({ query = '', contentScope = '', targetAudience = '', productCategory = '', patterns = [] } = {}) {
  const topic = normalizeText(query || productCategory || contentScope || '생활용품');
  const topicSubject = withSubjectParticle(topic);
  const audience = normalizeText(targetAudience || '이 계정의 독자');
  const pattern = patterns[0] || {};
  const livingDetails = /자취|원룸|집기|살림|생활/.test(`${topic} ${contentScope} ${audience}`)
    ? ['설거지 끝나고 바로 둘 자리', '빨래 전 잠깐 모아둘 바구니', '현관에서 나갈 때 바로 집는 물건']
    : ['자주 쓰는 순간에 바로 닿는 자리', '다시 넣을 때 손이 덜 가는 구조', '눈에 보여도 덜 어지러운 방식'];
  const listLike = /라벨|목록|줄별|>|나열|year of birth|traits/i.test([
    pattern.listStructure,
    pattern.formatPattern,
    pattern.voicePattern
  ].filter(Boolean).join(' '));
  if (listLike) {
    const labelBase = /회사|업무|직장/.test(topic) ? [
      ['신입', '질문은 많은데 뭔가 눈치 많이 봄'],
      ['1년차', '이제 좀 알 것 같아서 제일 바쁨+살짝 예민함'],
      ['2년차', '일은 제일 많이 하는데 티는 잘 안 남'],
      ['3년차', '여기부터 말투가 살짝 단단해짐'],
      ['4년차', '대체적으로 다 내려놓은 느낌 ........']
    ] : [
      ['처음 산 사람', '후기 엄청 찾아보고도 막상 쓰면 기준 바뀜'],
      ['한달 쓴 사람', '좋은 건 좋은데 은근 귀찮은 포인트 보임'],
      ['반년 쓴 사람', '관리 쉬운 게 제일 오래 간다는 쪽'],
      ['오래 쓴 사람', '예쁜 것보다 손 가는지가 더 중요해짐'],
      ['다시 사는 사람', '대체적으로 기준이 되게 단순해진 느낌 ........']
    ];
    const body = [
      `개인적인 견해 ${topic} 은근 갈리는 포인트`,
      ...labelBase.map(([label, line]) => `${label} > ${line}`),
      '',
      '다들 어느 쪽에 가까움?'
    ].join('\n');
    return [
      {
        contentType: '관찰나열형',
        patternSourceId: pattern.sourceId || '',
        body
      },
      {
        contentType: '느낌정리형',
        patternSourceId: pattern.sourceId || '',
        body: [
          `${topic} 볼 때 은근 갈리는 포인트`,
          '처음엔 다들 스펙 봄',
          '조금 지나면 귀찮은지 봄',
          '더 지나면 그냥 손이 가는지만 봄',
          '마지막엔 대체적으로 관리 쉬운 쪽으로 감 .........',
          '',
          `${audience} 기준으론 뭐가 제일 먼저임?`
        ].join('\n')
      },
      {
        contentType: '댓글유도형',
        patternSourceId: pattern.sourceId || '',
        body: [
          `내 기준 ${topic}`,
          '좋아 보이는 것 > 처음에만 설렘',
          '편한 것 > 은근 오래 감',
          '관리 쉬운 것 > 결국 제일 자주 씀',
          '자리 덜 차지하는 것 > 대체적으로 만족도 높음',
          '',
          '이거 나만 이렇게 봄?'
        ].join('\n')
      },
      {
        contentType: '상황비교형',
        patternSourceId: pattern.sourceId || '',
        body: [
          `${topicSubject} 살 때보다 쓰는 순간이 더 정확하더라`,
          '',
          `${livingDetails[0]}에서 편하면 오래 감`,
          `${livingDetails[1]}에서 귀찮으면 금방 방치됨`,
          `${livingDetails[2]}에서 손이 바로 가면 성공에 가까움`,
          '',
          `${audience} 입장에선 어떤 순간이 제일 중요함?`
        ].join('\n')
      },
      {
        contentType: '후회방지형',
        patternSourceId: pattern.sourceId || '',
        body: [
          `${topic} 고르기 전에 하나만 보면`,
          '내가 이걸 꺼내고 다시 넣는 장면이 바로 그려지는지',
          '',
          '그게 안 그려지면 예뻐도 생각보다 손이 덜 가더라고요.',
          '',
          '다들 살 때 제일 먼저 보는 기준 뭐예요?'
        ].join('\n')
      }
    ];
  }
  return [
    {
      contentType: '질문형',
      patternSourceId: pattern.sourceId || '',
      body: `${topic}, 많이 사는 것보다 먼저 둘 자리를 정하는 게 덜 후회되더라고요.\n\n${audience} 기준이면 ${livingDetails[0]}처럼 매일 손 가는 곳부터 티가 나요.\n\n처음 살림 맞출 때 제일 먼저 챙기고 싶은 자리는 어디예요?`
    },
    {
      contentType: '공감형',
      patternSourceId: pattern.sourceId || '',
      body: `${topic} 고를 때 처음엔 예쁜 것부터 보이는데, 살아보면 귀찮은 순간이 기준을 바꾸더라고요.\n\n${livingDetails[1]}처럼 잠깐 둘 곳이 있으면 바닥에 쌓이는 일이 확 줄어요.\n\n다들 집기 살 때 예쁜 쪽이 먼저예요, 아니면 치우기 쉬운 쪽이 먼저예요?`
    },
    {
      contentType: '체크리스트형',
      patternSourceId: pattern.sourceId || '',
      body: `${topic} 사기 전에는 큰 것보다 작은 동선을 먼저 보면 좋아요.\n\n1. ${livingDetails[0]}\n2. ${livingDetails[1]}\n3. ${livingDetails[2]}\n\n이 세 자리만 맞아도 처음 자취할 때 덜 어수선해요. 여러분은 어디부터 맞출 것 같아요?`
    },
    {
      contentType: '상황비교형',
      patternSourceId: pattern.sourceId || '',
      body: `막상 살아보면 ${topicSubject} 예쁜지보다 손이 덜 가는지가 오래 남더라고요.\n\n${livingDetails[0]}에서는 바로 쓰기 쉬운지,\n${livingDetails[1]}에서는 치우기 쉬운지,\n${livingDetails[2]}에서는 자리 차지를 덜 하는지.\n\n${audience}라면 셋 중 뭐부터 볼 것 같아요?`
    },
    {
      contentType: '후회방지형',
      patternSourceId: pattern.sourceId || '',
      body: `${topic} 살 때 후회 줄이는 기준은 생각보다 단순했어요.\n\n매일 쓰는 위치가 정해지는지,\n꺼내고 넣는 과정이 번거롭지 않은지,\n안 쓸 때도 집이 덜 어수선한지.\n\n처음 사는 거라면 여러분은 어떤 기준부터 챙길래요?`
    }
  ];
}

export function assessTrendSimilarityRisk(body = '', patterns = []) {
  const normalizedBody = normalizeText(body);
  const first = firstSentence(normalizedBody);
  const risky = patterns.some((pattern) => {
    const source = normalizeText(pattern.sourceText || '');
    if (!source) return false;
    const openingChunk = first.split(/[,.，、]/).map((chunk) => chunk.trim()).find((chunk) => chunk.length >= SOURCE_SENTENCE_MIN_LENGTH);
    if (openingChunk && source.includes(openingChunk)) return true;
    if (first.length >= SOURCE_SENTENCE_MIN_LENGTH && source.includes(first)) return true;
    const sourceWords = new Set(source.split(/\s+/).filter((word) => word.length >= 2));
    const bodyWords = first.split(/\s+/).filter((word) => word.length >= 2);
    if (bodyWords.length < 5) return false;
    const overlap = bodyWords.filter((word) => sourceWords.has(word)).length / bodyWords.length;
    return overlap >= 0.8;
  });
  return risky ? 'high' : 'low';
}

function normalizeGeneratedPosts(posts = [], context = {}) {
  const account = {
    target_audience: context.targetAudience || '이 계정의 독자',
    content_scope: context.contentScope || context.query || '생활용품',
    tone: '친근하고 자연스럽게',
    cta_style: '댓글로 가볍게 반응 유도',
    content_mode: 'question',
    content_intensity: 'normal',
    comment_induction_style: 'choice_question',
    product_mention_style: 'none',
    emoji_level: 'none',
    safe_debate_enabled: true,
    forbidden_topics: [],
    forbidden_words: []
  };
  const topic = {
    title: context.query || context.productCategory || context.contentScope || '생활용품',
    angle: '생활 속 선택 기준'
  };
  return posts.map((post, index) => {
    const body = normalizePostBody(post.body || '');
    const engagement = scorePostEngagement(body);
    const guardrail = validatePostCandidate(body, account, topic);
    const styleFit = validatePostStyleFit(body, account);
    const risk = assessTrendSimilarityRisk(body, context.patterns || []);
    const safetyFlags = [
      ...(guardrail.allowed ? [] : guardrail.reasons),
      ...(styleFit.allowed ? [] : styleFit.reasons),
      ...(risk === 'high' ? ['source_similarity_high'] : [])
    ];
    return {
      index,
      contentType: post.contentType || '질문형',
      body,
      patternSourceId: post.patternSourceId || context.patterns?.[0]?.sourceId || '',
      engagementScore: engagement.engagementScore,
      engagementPattern: engagement.engagementPattern,
      selectionReasons: engagement.selectionReasons,
      safetyFlags,
      similarityRisk: risk,
      allowed: guardrail.allowed && styleFit.allowed && risk !== 'high'
    };
  });
}

export async function generateTrendInspiredPosts(context = {}) {
  const patterns = Array.isArray(context.patterns) ? context.patterns : [];
  const fallback = () => ({ posts: trendFallbackPosts({ ...context, patterns }) });
  if (context.useAi === false) {
    return normalizeGeneratedPosts(fallback().posts, { ...context, patterns });
  }
  const result = await getJson(generateTrendInspiredPostPrompt({ ...context, patterns }), fallback, {
    schemaName: 'generate_trend_inspired_posts',
    validate: (value) => ({ ok: Array.isArray(value?.posts), reason: 'posts array is required' })
  });
  return normalizeGeneratedPosts((result.posts || []).slice(0, 3), { ...context, patterns });
}

async function fetchKeyApiTrendSamples({ query = '', since = '24h', limit = 10 } = {}) {
  const apiKey = process.env.TREND_SOURCE_API_KEY;
  if (!apiKey) throw new Error('TREND_SOURCE_API_KEY is not configured');
  const baseUrl = process.env.TREND_SOURCE_BASE_URL || 'https://api.keyapi.ai/threads/search';
  const url = new URL(baseUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('since', since);
  url.searchParams.set('limit', String(limit));
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'X-API-Key': apiKey
    }
  });
  if (!response.ok) throw new Error(`trend provider failed: ${response.status}`);
  const data = await response.json();
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data.results) ? data.results : [];
  return items.map((item, index) => ({
    id: item.id || item.pk || `keyapi-${index}`,
    sourceUrl: item.url || item.permalink || item.thread_url || '',
    topicKeyword: query,
    sourceText: item.text || item.caption || item.body || '',
    likes: item.likes || item.like_count || 0,
    replies: item.replies || item.reply_count || item.comments || item.comment_count || 0,
    reposts: item.reposts || item.repost_count || 0,
    views: item.views || item.view_count || 0,
    createdAt: item.created_at || item.taken_at || ''
  })).filter((item) => item.sourceText);
}

export async function fetchTrendSamples({ provider = process.env.TREND_SOURCE_PROVIDER || 'fixture', query = '', since = '24h', limit = 10 } = {}) {
  if (provider === 'keyapi') {
    try {
      const samples = await fetchKeyApiTrendSamples({ query, since, limit });
      return { provider: 'keyapi', usedFallback: false, samples };
    } catch (error) {
      return {
        provider: 'fixture',
        requestedProvider: 'keyapi',
        usedFallback: true,
        fallbackReason: error.message,
        samples: fixtureSamples.slice(0, limit)
      };
    }
  }
  return { provider: 'fixture', usedFallback: provider !== 'fixture', samples: fixtureSamples.slice(0, limit) };
}

export async function buildTrendInspiredContentPreview(options = {}) {
  const source = await fetchTrendSamples(options);
  const patterns = await extractTrendPatterns(source.samples, { query: options.query, limit: Number(options.patternLimit || 5), useAi: options.useAi !== false });
  const posts = await generateTrendInspiredPosts({
    query: options.query,
    contentScope: options.contentScope,
    targetAudience: options.targetAudience,
    productCategory: options.productCategory,
    patterns,
    useAi: options.useAi !== false
  });
  return {
    source,
    patterns,
    posts
  };
}
