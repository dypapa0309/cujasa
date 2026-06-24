import 'dotenv/config';
import { runFullPipeline } from '../services/pipelineService.js';

const requestedBy = process.argv.find((arg) => arg.startsWith('--requested-by='))?.split('=')[1] || 'scheduler';

try {
  const result = await runFullPipeline({ requestedBy });
  console.log('[FullPipelineTask] completed', JSON.stringify(result));
} catch (error) {
  console.error('[FullPipelineTask] failed', error);
  process.exitCode = 1;
}
