import OpenAI from 'openai';
import { safeJsonParse } from '../utils/safeJsonParse.js';

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 20000);

export async function getJson(messages, fallback) {
  if (!client) return typeof fallback === 'function' ? fallback() : fallback;
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.7
    }, { timeout: OPENAI_TIMEOUT_MS });
    return safeJsonParse(response.choices[0]?.message?.content, fallback);
  } catch (error) {
    console.warn('[openai_json_fallback]', error.message);
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}
