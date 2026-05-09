import OpenAI from 'openai';

const DEFAULT_VISION_MODEL = 'gpt-4o-mini';
let client = null;

function getOpenAiClient() {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: Number(process.env.OPENAI_TIMEOUT_MS || 60000)
    });
  }
  return client;
}

function parseJson(content = '') {
  const text = String(content || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function numberValue(value) {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (/만/.test(text)) return Math.round(Number(text.replace(/[^0-9.]/g, '')) * 10000) || 0;
  if (/천/.test(text)) return Math.round(Number(text.replace(/[^0-9.]/g, '')) * 1000) || 0;
  const parsed = Number(text.replace(/[^0-9.]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function extractTrendReferenceFromImage({ fileName = '', mimeType = 'image/png', base64 = '', topicKeyword = '' } = {}) {
  const openai = getOpenAiClient();
  if (!openai) {
    const error = new Error('OpenAI OCR 설정이 없습니다. OPENAI_API_KEY를 확인해 주세요.');
    error.status = 503;
    throw error;
  }
  if (!base64) {
    const error = new Error('OCR에 사용할 이미지 데이터가 없습니다.');
    error.status = 400;
    throw error;
  }

  const model = process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || DEFAULT_VISION_MODEL;
  const response = await openai.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: 'system',
        content: [
          '너는 한국어 소셜 인기글 캡처 OCR 도우미다.',
          '이미지에서 게시글 본문과 반응 지표만 추출한다.',
          '작성자, 계정명, 프로필, 댓글 사용자명, URL, 개인정보는 저장하지 말고 빈 값 또는 [redacted]로 처리한다.',
          '반드시 JSON만 반환한다.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              fileName,
              topicKeyword,
              schema: {
                sourceText: '게시글 본문만. 작성자/계정명/댓글/URL 제외',
                likes: 'number',
                replies: 'number',
                reposts: 'number',
                views: 'number',
                platformHint: 'threads | instagram | unknown'
              }
            })
          },
          {
            type: 'image_url',
            image_url: {
              url: `data:${mimeType};base64,${base64}`,
              detail: 'high'
            }
          }
        ]
      }
    ]
  });

  const parsed = parseJson(response.choices?.[0]?.message?.content || '') || {};
  return {
    id: `ocr-${Date.now()}`,
    sourceText: String(parsed.sourceText || '').trim(),
    topicKeyword,
    likes: numberValue(parsed.likes),
    replies: numberValue(parsed.replies ?? parsed.comments),
    reposts: numberValue(parsed.reposts),
    views: numberValue(parsed.views),
    platformHint: parsed.platformHint || 'unknown',
    sourceType: 'screenshot_ocr',
    model,
    usage: response.usage || null
  };
}
