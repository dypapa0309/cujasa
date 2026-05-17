import OpenAI from 'openai';
import { safeJsonParse } from '../utils/safeJsonParse.js';
import { safeLogActivity } from './supabaseService.js';

const client = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45000);

function resolveFallback(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

async function logAiFallback(action, options = {}, reason, extra = {}) {
  if (typeof options.onFallback === 'function') {
    await options.onFallback({ action, reason, extra }).catch(() => null);
  }
  if (!options.logContext) return;
  await safeLogActivity({
    ...options.logContext,
    action,
    level: 'warn',
    message: `${options.schemaName || 'openai_json'} fallback: ${reason}`,
    payload: {
      schemaName: options.schemaName || null,
      reason,
      ...extra
    }
  });
}

function runValidation(value, validate) {
  if (!validate) return { ok: true };
  const result = validate(value);
  if (result === true) return { ok: true };
  if (result === false) return { ok: false, reason: 'schema validation failed' };
  return {
    ok: Boolean(result?.ok),
    reason: result?.reason || 'schema validation failed'
  };
}

export async function getJson(messages, fallback, options = {}) {
  if (!client) {
    await logAiFallback('ai_json_fallback', options, 'OPENAI_API_KEY is not configured');
    return resolveFallback(fallback);
  }
  try {
    const response = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages,
      response_format: { type: 'json_object' },
      temperature: Number(options.temperature ?? process.env.OPENAI_TEMPERATURE ?? 0.7)
    }, { timeout: Number(options.timeoutMs || OPENAI_TIMEOUT_MS) });
    const parsed = safeJsonParse(response.choices[0]?.message?.content, null);
    if (!parsed) {
      await logAiFallback('ai_json_fallback', options, 'response was not valid JSON');
      return resolveFallback(fallback);
    }
    const validation = runValidation(parsed, options.validate);
    if (!validation.ok) {
      await logAiFallback('ai_schema_fallback', options, validation.reason);
      return resolveFallback(fallback);
    }
    return parsed;
  } catch (error) {
    console.warn('[openai_json_fallback]', error.message);
    await logAiFallback('ai_json_fallback', options, error.message);
    return resolveFallback(fallback);
  }
}
