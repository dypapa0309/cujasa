const ALIGO_SEND_URL = 'https://apis.aligo.in/send/';

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizePhone(value = '') {
  return String(value || '').replace(/[^0-9]/g, '');
}

function smsConfig() {
  const managerPhones = unique([
    ...(process.env.SETUP_MANAGER_PHONES || '').split(','),
    process.env.SETUP_MANAGER_PHONE
  ].map(normalizePhone));
  return {
    userId: process.env.ALIGO_USER_ID,
    apiKey: process.env.ALIGO_API_KEY,
    sender: process.env.ALIGO_SENDER,
    managerPhones
  };
}

export function isSmsConfigured() {
  const config = smsConfig();
  return Boolean(config.userId && config.apiKey && config.sender && config.managerPhones.length > 0);
}

export async function sendSetupSms(message) {
  const config = smsConfig();
  if (!isSmsConfigured()) {
    return {
      skipped: true,
      reason: 'missing_aligo_config',
      configured: false,
      recipients: config.managerPhones.map((phone) => ({ phone, ok: false, skipped: true }))
    };
  }

  const recipients = [];
  for (const phone of config.managerPhones) {
    const body = new URLSearchParams({
      key: config.apiKey,
      user_id: config.userId,
      sender: config.sender,
      receiver: phone,
      msg: message,
      msg_type: message.length > 80 ? 'LMS' : 'SMS'
    });

    try {
      const response = await fetch(ALIGO_SEND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      const text = await response.text();
      let json = {};
      try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

      const ok = response.ok && !String(json.result_code || json.code || '').startsWith('-');
      recipients.push({
        phone,
        ok,
        status: response.status,
        error: ok ? null : (json.message || json.raw || text || 'Aligo SMS send failed'),
        response: json
      });
    } catch (error) {
      recipients.push({ phone, ok: false, error: error.message });
    }
  }
  return {
    ok: recipients.some((recipient) => recipient.ok),
    configured: true,
    provider: 'aligo',
    recipients,
    failed: recipients.filter((recipient) => !recipient.ok).length
  };
}
