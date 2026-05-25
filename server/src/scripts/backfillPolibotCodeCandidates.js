import 'dotenv/config';
import { backfillPolibotKnowledgeSourceCodeCandidates } from '../services/polibotKnowledgeDbService.js';

function parseArgs(argv = []) {
  const args = {
    dryRun: true,
    limit: 1000,
    scope: 'all'
  };
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--apply') args.dryRun = false;
    else if (current === '--dry-run') args.dryRun = true;
    else if (current === '--limit') args.limit = Number(argv[++index] || args.limit);
    else if (current === '--scope') args.scope = argv[++index] || args.scope;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const result = await backfillPolibotKnowledgeSourceCodeCandidates(args);

console.log(JSON.stringify({
  dryRun: result.dryRun,
  scope: result.scope,
  scanned: result.scanned,
  changed: result.changed,
  unchanged: result.unchanged,
  skipped: result.skipped,
  previousCandidateCount: result.previousCandidateCount,
  nextCandidateCount: result.nextCandidateCount,
  removedCandidateCount: result.removedCandidateCount,
  addedCandidateCount: result.addedCandidateCount,
  updates: result.updates.slice(0, 30),
  skippedSamples: result.skippedSamples.slice(0, 12)
}, null, 2));
