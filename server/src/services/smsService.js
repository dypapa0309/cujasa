const ALIGO_SEND_URL = 'https://apis.aligo.in/send/';

function smsConfig() {
  return {
    userId: process.env.ALIGO_USER_ID,
    apiKey: process.env.ALIGO_API_KEY,
    sender: process.env.ALIGO_SENDER,
    managerPhone: process.env.SETUP_MANAGER_PHONE
  };
}

export function isSmsConfigured() {
  const config = smsConfig();
  return Boolean(config.userId && config.apiKey && config.sender && config.managerPhone);
}

export async function sendSetupSms(message) {
  const config = smsConfig();
  if (!isSmsConfigured()) {
    return { skipped: true, reason: 'missing_aligo_config' };
  }

  const body = new URLSearchParams({
    key: config.apiKey,
    user_id: config.userId,
    sender: config.sender,
    receiver: config.managerPhone,
    msg: message,
    msg_type: message.length > 80 ? 'LMS' : 'SMS'
  });

  const response = await fetch(ALIGO_SEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await response.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!response.ok || String(json.result_code || json.code || '').startsWith('-')) {
    return {
      ok: false,
      status: response.status,
      error: json.message || json.raw || text || 'Aligo SMS send failed'
    };
  }
  return { ok: true, provider: 'aligo', response: json };
}
