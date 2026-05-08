import 'dotenv/config';

const secret = process.env.SCHEDULER_SECRET;
const rawBaseUrl = process.env.SCHEDULER_API_BASE_URL || process.env.API_BASE_URL || process.env.APP_BASE_URL;

if (!secret) {
  console.error('SCHEDULER_SECRET is required for daily pipeline cron.');
  process.exit(1);
}

if (!rawBaseUrl) {
  console.error('SCHEDULER_API_BASE_URL, API_BASE_URL, or APP_BASE_URL is required for daily pipeline cron.');
  process.exit(1);
}

const baseUrl = rawBaseUrl.replace(/\/+$/, '');
const response = await fetch(`${baseUrl}/api/scheduler/daily-pipeline`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-scheduler-secret': secret
  },
  body: JSON.stringify({ triggeredBy: 'render_cron' })
});

const text = await response.text();

if (!response.ok) {
  console.error(`Daily pipeline cron failed with ${response.status}: ${text}`);
  process.exit(1);
}

console.log(text);
