import { readFile, writeFile } from 'node:fs/promises';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

const envFileUrl = new URL('../../.env', import.meta.url);

export const systemSettingFields = [
  { key: 'THREADS_APP_ID', label: 'Meta Threads App ID', group: 'Meta/Threads', secret: false },
  { key: 'THREADS_APP_SECRET', label: 'Meta Threads App Secret', group: 'Meta/Threads', secret: true },
  { key: 'THREADS_REDIRECT_URI', label: 'Threads Redirect URI', group: 'Meta/Threads', secret: false },
  { key: 'APP_BASE_URL', label: 'API Base URL', group: 'Meta/Threads', secret: false },
  { key: 'CLIENT_BASE_URL', label: 'Client Base URL', group: 'Meta/Threads', secret: false },
  { key: 'OPENAI_API_KEY', label: 'OpenAI API Key', group: 'AI 생성', secret: true },
  { key: 'OPENAI_MODEL', label: 'OpenAI Model', group: 'AI 생성', secret: false },
  { key: 'OPENAI_VISION_MODEL', label: 'OpenAI Vision Model', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_PROVIDER', label: 'Trend Source Provider', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_API_KEY', label: 'Trend Source API Key', group: 'AI 생성', secret: true },
  { key: 'TREND_SOURCE_BASE_URL', label: 'Trend Source Base URL', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_AUTO_REFRESH', label: 'Trend Auto Refresh', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_SINCE', label: 'Trend Source Since', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_LIMIT', label: 'Trend Source Limit', group: 'AI 생성', secret: false },
  { key: 'TREND_SOURCE_QUERY_LIMIT', label: 'Trend Query Limit', group: 'AI 생성', secret: false },
  { key: 'AUVIBOT_IMAGE_API_URL', label: 'AUVIBOT Image API URL', group: 'AI 생성', secret: false },
  { key: 'AUVIBOT_IMAGE_API_KEY', label: 'AUVIBOT Image API Key', group: 'AI 생성', secret: true },
  { key: 'CUJASA_IMAGE_POST_RATIO', label: 'CUJASA Image Post Ratio', group: 'AI 생성', secret: false },
  { key: 'PEXELS_API_KEY', label: 'Pexels API Key', group: '영상 소싱', secret: true },
  { key: 'PIXABAY_API_KEY', label: 'Pixabay API Key', group: '영상 소싱', secret: true },
  { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs API Key', group: 'TTS/음성', secret: true },
  { key: 'ELEVENLABS_VOICE_ID', label: 'ElevenLabs Voice ID', group: 'TTS/음성', secret: false },
  { key: 'SUPABASE_STORAGE_BUCKET', label: 'Supabase Storage Bucket', group: '저장소/렌더', secret: false },
  { key: 'SUPABASE_PUBLIC_ASSET_URL', label: 'Supabase Public Asset URL', group: '저장소/렌더', secret: false },
  { key: 'FFMPEG_PATH', label: 'FFmpeg Path', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_WORK_DIR', label: 'AUVIBOT Work Dir', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_DEFAULT_BGM_BUCKET', label: 'AUVIBOT BGM Bucket', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_DEFAULT_FONT', label: 'AUVIBOT Default Font', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_MAX_VIDEO_SECONDS', label: 'AUVIBOT Max Video Seconds', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_POSTING_MODE', label: 'AUVIBOT Posting Mode', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_STORAGE_BUCKET', label: 'AUVIBOT Storage Bucket', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_PUBLIC_BASE_URL', label: 'AUVIBOT Public Video URL', group: '저장소/렌더', secret: false },
  { key: 'AUVIBOT_RENDER_PRESET', label: 'AUVIBOT Render Preset', group: '저장소/렌더', secret: false },
  { key: 'YOUTUBE_CLIENT_ID', label: 'YouTube Client ID', group: '확장 채널', secret: false },
  { key: 'YOUTUBE_CLIENT_SECRET', label: 'YouTube Client Secret', group: '확장 채널', secret: true },
  { key: 'TIKTOK_CLIENT_KEY', label: 'TikTok Client Key', group: '확장 채널', secret: false },
  { key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok Client Secret', group: '확장 채널', secret: true },
  { key: 'INSTAGRAM_APP_ID', label: 'Instagram App ID', group: '확장 채널', secret: false },
  { key: 'INSTAGRAM_APP_SECRET', label: 'Instagram App Secret', group: '확장 채널', secret: true },
  { key: 'THREADS_DUPLICATE_TEST_OWNER_EMAILS', label: 'Threads 중복 허용 테스트 이메일', group: '테스트', secret: false }
];

const allowedSystemSettingKeys = new Set(systemSettingFields.map((field) => field.key));

export function maskEnvValue(value = '') {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${text.slice(0, 4)}...${text.slice(-4)}`;
}

async function readEnvFile() {
  try {
    return await readFile(envFileUrl, 'utf8');
  } catch {
    return '';
  }
}

function setEnvValue(raw, key, value) {
  const line = `${key}=${String(value || '').replace(/\r?\n/g, '')}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  if (pattern.test(raw)) return raw.replace(pattern, line);
  return `${raw.trimEnd()}\n${line}\n`;
}

async function listPersistedSystemSettings() {
  try {
    return await dbList('system_settings');
  } catch (error) {
    if (/system_settings|relation .* does not exist|schema cache/i.test(error?.message || '')) return [];
    throw error;
  }
}

export async function loadSystemSettingsIntoEnv() {
  const rows = await listPersistedSystemSettings().catch(() => []);
  rows.forEach((row) => {
    if (allowedSystemSettingKeys.has(row.key) && row.value) process.env[row.key] = String(row.value);
  });
  return rows.length;
}

export async function systemSettingsPayload() {
  const persisted = await listPersistedSystemSettings();
  const persistedByKey = new Map(persisted.map((row) => [row.key, row]));
  return {
    writable: true,
    persistence: 'database',
    fields: systemSettingFields.map((field) => {
      const persistedRow = persistedByKey.get(field.key);
      const value = persistedRow?.value || process.env[field.key] || '';
      return {
        ...field,
        configured: Boolean(value),
        source: persistedRow?.value ? 'database' : process.env[field.key] ? 'environment' : 'missing',
        displayValue: field.secret ? maskEnvValue(value) : value
      };
    })
  };
}

export async function updateSystemSettings(values = {}) {
  const entries = Object.entries(values)
    .filter(([key, value]) => allowedSystemSettingKeys.has(key) && String(value ?? '').trim() !== '')
    .map(([key, value]) => [key, String(value).trim()]);
  if (!entries.length) {
    const error = new Error('저장할 설정값이 없습니다.');
    error.status = 400;
    throw error;
  }

  let raw = await readEnvFile();
  for (const [key, value] of entries) {
    process.env[key] = value;
    const existing = await dbGet('system_settings', { key }).catch(() => null);
    if (existing) {
      await dbUpdate('system_settings', { key }, { value, is_secret: Boolean(systemSettingFields.find((field) => field.key === key)?.secret) });
    } else {
      await dbInsert('system_settings', { key, value, is_secret: Boolean(systemSettingFields.find((field) => field.key === key)?.secret) }).catch(() => null);
    }
    if (process.env.NODE_ENV !== 'production') raw = setEnvValue(raw, key, value);
  }
  if (process.env.NODE_ENV !== 'production') await writeFile(envFileUrl, raw, 'utf8');
  return systemSettingsPayload();
}
