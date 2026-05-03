export async function sendSlackMessage(text, blocks = null) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  if (!webhookUrl) return { skipped: true };

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) })
    });
    if (!response.ok) throw new Error(`Slack webhook failed: ${response.status}`);
    return { ok: true };
  } catch (error) {
    console.error('[Slack]', error.message);
    return { ok: false, error: error.message };
  }
}
