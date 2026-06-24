import 'dotenv/config';
import { runDailyPipelineOnce } from '../services/schedulerRunService.js';

const mode = process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'scheduled';
const triggeredBy = process.argv.find((arg) => arg.startsWith('--triggered-by='))?.split('=')[1] || 'external_scheduler';

try {
  const result = await runDailyPipelineOnce({ triggeredBy, mode });
  console.log('[DailyPipelineTask] completed', JSON.stringify(result));
  process.exitCode = result?.status === 'failed' ? 1 : 0;
} catch (error) {
  console.error('[DailyPipelineTask] failed', error);
  process.exitCode = 1;
}
