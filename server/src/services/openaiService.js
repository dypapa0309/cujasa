import OpenAI from 'openai';
import { safeJsonParse } from '../utils/safeJsonParse.js';

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export async function getJson(messages, fallback) {
  if (!client) return typeof fallback === 'function' ? fallback() : fallback;
  const response = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.7
  });
  return safeJsonParse(response.choices[0]?.message?.content, fallback);
}
