import { dbInsert } from './supabaseService.js';

export async function sendNotification(type, message, payload = {}) {
  const row = await dbInsert('notifications', { type, channel: 'local', message, payload, status: 'created' });
  if (process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message }) });
  }
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text: message }) });
  }
  return row;
}
