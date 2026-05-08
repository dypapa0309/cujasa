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

export function isPolibotOcrConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function extractPolibotOcrText({ fileName = '', mimeType = 'image/png', base64 = '' } = {}) {
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
          '너는 보험 상품 자료 OCR 전처리 도우미다.',
          '이미지의 글자를 최대한 원문 순서대로 추출하되, 표는 행 단위로 읽기 쉽게 정리한다.',
          '추측한 상품명/보험료를 만들지 말고, 이미지에서 확인되는 텍스트만 반환한다.',
          '개인정보가 보이면 원문 그대로 반복하지 말고 [개인정보]로 표시한다.'
        ].join(' ')
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `파일명: ${fileName || '스캔본'}\n보험사, 상품명, 보장, 보험료, 가입연령, 갱신/비갱신, 고지/면책 조건을 놓치지 말고 OCR 텍스트로 정리해줘.`
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

  const text = String(response.choices?.[0]?.message?.content || '').trim();
  return {
    text,
    model,
    usage: response.usage || null
  };
}
