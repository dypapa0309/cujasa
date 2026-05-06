import { dbInsert, dbUpdate } from './supabaseService.js';

function unique(values = []) {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function telegramChatIds() {
  return unique([
    ...(process.env.TELEGRAM_CHAT_IDS || '').split(','),
    process.env.TELEGRAM_CHAT_ID
  ]);
}

async function sendSlack(message) {
  if (!process.env.SLACK_WEBHOOK_URL) return { configured: false };
  try {
    const response = await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message })
    });
    return { configured: true, ok: response.ok, status: response.status };
  } catch (error) {
    return { configured: true, ok: false, error: error.message };
  }
}

async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatIds = telegramChatIds();
  if (!token || chatIds.length === 0) return { configured: false, recipients: [] };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const recipients = [];
  for (const chatId of chatIds) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          disable_web_page_preview: true
        })
      });
      let body = null;
      try { body = await response.json(); } catch { body = null; }
      recipients.push({
        chatId,
        ok: response.ok,
        status: response.status,
        error: response.ok ? null : (body?.description || body?.error_code || 'telegram_send_failed')
      });
    } catch (error) {
      recipients.push({ chatId, ok: false, error: error.message });
    }
  }
  return {
    configured: true,
    recipients,
    ok: recipients.some((recipient) => recipient.ok),
    failed: recipients.filter((recipient) => !recipient.ok).length
  };
}

async function sendEmail(to, subject, text) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || process.env.OPS_EMAIL_FROM || 'CUJASA <no-reply@jasain.kr>';
  if (!apiKey || !to) return { configured: false, to };
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        text
      })
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    return {
      configured: true,
      ok: response.ok,
      status: response.status,
      id: body?.id || null,
      error: response.ok ? null : (body?.message || body?.error || 'email_send_failed')
    };
  } catch (error) {
    return { configured: true, ok: false, to, error: error.message };
  }
}

export async function sendNotification(type, message, payload = {}) {
  const row = await dbInsert('notifications', { type, channel: 'ops', message, payload, status: 'created' });
  const [slack, telegram] = await Promise.all([
    sendSlack(message),
    sendTelegram(message)
  ]);
  const sent = Boolean(slack.ok || telegram.ok);
  const resultPayload = {
    ...payload,
    delivery: { slack, telegram }
  };
  const [updated] = await dbUpdate('notifications', { id: row.id }, {
    payload: resultPayload,
    status: sent ? 'sent' : 'failed'
  }).catch(() => [null]);
  return updated || { ...row, payload: resultPayload, status: sent ? 'sent' : 'failed' };
}

export async function sendEmailNotification(type, to, subject, message, payload = {}) {
  const row = await dbInsert('notifications', { type, channel: 'email', message, payload: { ...payload, to, subject }, status: 'created' });
  const email = await sendEmail(to, subject, message);
  const [updated] = await dbUpdate('notifications', { id: row.id }, {
    payload: { ...payload, to, subject, delivery: { email } },
    status: email.ok ? 'sent' : 'failed'
  }).catch(() => [null]);
  return updated || { ...row, payload: { ...payload, to, subject, delivery: { email } }, status: email.ok ? 'sent' : 'failed' };
}

export async function safeSendNotification(type, message, payload = {}) {
  try {
    return await sendNotification(type, message, payload);
  } catch (error) {
    console.warn('[notification_failed]', { type, error: error.message });
    return null;
  }
}

export async function sendOpsAlert(type, { title, message, account = null, code = null, hint = null, payload = {} } = {}) {
  const lines = [
    `🚨 [CUJASA 운영 알림] ${title || type}`,
    account ? `계정: ${account.name || '-'} ${account.account_handle || ''}`.trim() : null,
    code ? `코드: ${code}` : null,
    message ? `내용: ${message}` : null,
    hint ? `조치: ${hint}` : null
  ].filter(Boolean);
  return safeSendNotification(type, lines.join('\n'), {
    accountId: account?.id,
    accountName: account?.name,
    accountHandle: account?.account_handle,
    code,
    hint,
    ...payload
  });
}
