import 'dotenv/config';
import { runIssuePipeline } from '../services/issueService.js';

const startedAt = Date.now();
console.log('[issue-pipeline] start', new Date().toISOString());

try {
  const summary = await runIssuePipeline();
  console.log('[issue-pipeline] done', JSON.stringify({ ...summary, durationMs: Date.now() - startedAt }));
  process.exit(0);
} catch (error) {
  console.error('[issue-pipeline] failed:', error.message);
  process.exit(1);
}
