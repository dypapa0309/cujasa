import 'dotenv/config';

const secret = process.env.SCHEDULER_SECRET;
const rawBaseUrl = process.env.SCHEDULER_API_BASE_URL || process.env.API_BASE_URL || process.env.APP_BASE_URL;
const triggeredBy = process.env.SCHEDULER_TRIGGERED_BY || 'render_cron_repetition_guard';

if (!secret) {
  console.error('SCHEDULER_SECRET is required for repetition guard cron.');
  process.exit(1);
}

if (!rawBaseUrl) {
  console.error('SCHEDULER_API_BASE_URL, API_BASE_URL, or APP_BASE_URL is required for repetition guard cron.');
  process.exit(1);
}

const baseUrl = rawBaseUrl.replace(/\/+$/, '');
const response = await fetch(`${baseUrl}/api/scheduler/repetition-guard`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-scheduler-secret': secret
  },
  body: JSON.stringify({
    triggeredBy,
    statuses: process.env.REPETITION_GUARD_STATUSES || 'scheduled,retry,draft',
    days: Number(process.env.REPETITION_GUARD_DAYS || 30),
    limit: Number(process.env.REPETITION_GUARD_LIMIT || 3000)
  })
});

const text = await response.text();

if (!response.ok) {
  console.error(`Repetition guard cron failed with ${response.status}: ${text}`);
  process.exit(1);
}

console.log(text);

try {
  const parsed = JSON.parse(text);
  if (parsed?.ok === false) {
    console.error(`Repetition guard completed with unsuccessful status: ${parsed.status || 'unknown'}`);
    process.exit(1);
  }
} catch {
  // Response text is already logged above; non-JSON success responses should not fail the cron wrapper.
}
