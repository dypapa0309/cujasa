import 'dotenv/config';
import { runDailyPipelineOnce } from '../services/schedulerRunService.js';

const mode = process.env.SCHEDULER_MODE || process.argv.find((arg) => arg.startsWith('--mode='))?.split('=')[1] || 'scheduled';
const triggeredBy = process.env.SCHEDULER_TRIGGERED_BY || process.argv.find((arg) => arg.startsWith('--triggered-by='))?.split('=')[1] || 'external_scheduler';

const REQUIRED_PIPELINE_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY'];
const missingEnv = REQUIRED_PIPELINE_ENV.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.error(`[DailyPipelineTask] missing required env: ${missingEnv.join(', ')}`);
  process.exitCode = 1;
} else {
  try {
    // This script is the ONLY place daily-pipeline self-kill (P3 invariant 4) is armed: the
    // dedicated Render cron process runs it directly, and the always-on worker's daytime
    // recovery detector forks an isolated child that also runs it — never the shared worker
    // process itself.
    const result = await runDailyPipelineOnce({ triggeredBy, mode, selfKillEnabled: true });
    console.log('[DailyPipelineTask] completed', JSON.stringify(result));
    process.exitCode = result?.status === 'failed' ? 1 : 0;
  } catch (error) {
    console.error('[DailyPipelineTask] failed', error);
    process.exitCode = 1;
  }
}
