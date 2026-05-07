import 'dotenv/config';
import { dbList } from '../services/supabaseService.js';

const limit = Math.max(1, Math.min(1000, Number(process.argv[2] || 500)));
const candidateActions = new Set([
  'workspace_assistant_fallback',
  'workspace_assistant_ai_timeout',
  'workspace_assistant_wrong_panel'
]);

function uniqueByMessage(rows = []) {
  const seen = new Set();
  const candidates = [];
  for (const row of rows) {
    const message = String(row.message || '').trim();
    if (!message || seen.has(message)) continue;
    seen.add(message);
    candidates.push({
      message,
      action: '',
      productId: row.payload?.currentProduct || row.payload?.inferredProduct || 'cujasa',
      sourceAction: row.action,
      observedIntent: row.payload?.intent || '',
      observedAction: row.payload?.action || '',
      note: 'Fill expected action/productId before promoting this candidate to a test fixture.'
    });
  }
  return candidates;
}

const rows = await dbList('activity_logs', {}, {
  order: 'created_at',
  ascending: false,
  limit
});

const candidates = uniqueByMessage(rows.filter((row) => candidateActions.has(row.action)));
console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  sourceLimit: limit,
  count: candidates.length,
  candidates
}, null, 2));
