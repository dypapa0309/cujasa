import { dbDelete, dbList, safeLogActivity } from './supabaseService.js';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RETENTION_DAYS = Math.max(1, Number(process.env.ACTIVITY_LOG_RETENTION_DAYS || 1));
const DEFAULT_BATCH_LIMIT = Math.max(50, Math.min(Number(process.env.ACTIVITY_LOG_CLEANUP_BATCH_LIMIT || 500), 2000));
const DEFAULT_MAX_BATCHES = Math.max(1, Math.min(Number(process.env.ACTIVITY_LOG_CLEANUP_MAX_BATCHES || 10), 50));

function cutoffFor(retentionDays = DEFAULT_RETENTION_DAYS) {
  return new Date(Date.now() - Math.max(1, Number(retentionDays) || DEFAULT_RETENTION_DAYS) * ONE_DAY_MS);
}

export async function cleanupOldActivityLogs({
  mode = 'dry-run',
  retentionDays = DEFAULT_RETENTION_DAYS,
  limit = DEFAULT_BATCH_LIMIT,
  maxBatches = DEFAULT_MAX_BATCHES
} = {}) {
  const apply = mode === 'apply';
  const cutoff = cutoffFor(retentionDays);
  const cappedLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_LIMIT, 2000));
  const cappedBatches = Math.max(1, Math.min(Number(maxBatches) || DEFAULT_MAX_BATCHES, 50));
  const deletedRows = [];
  let previewRows = [];
  let batchCount = 0;

  for (let batch = 0; batch < cappedBatches; batch += 1) {
    const rows = await dbList('activity_logs', {}, {
      select: 'id,created_at,action,level',
      lt: { created_at: cutoff.toISOString() },
      order: 'created_at',
      ascending: true,
      limit: cappedLimit
    });
    batchCount += 1;
    if (!apply) {
      previewRows = rows;
      break;
    }
    for (const row of rows) {
      await dbDelete('activity_logs', { id: row.id });
      deletedRows.push(row);
    }
    if (rows.length < cappedLimit) break;
  }

  if (apply) {
    if (deletedRows.length) {
      await safeLogActivity({
        action: 'activity_logs_cleanup',
        level: 'info',
        message: `오래된 활동 로그 ${deletedRows.length}개 삭제`,
        payload: {
          retentionDays,
          cutoff: cutoff.toISOString(),
          limit: cappedLimit,
          maxBatches: cappedBatches,
          batchCount,
          deletedCount: deletedRows.length
        }
      });
    }
  }
  const targets = apply ? deletedRows : previewRows;

  return {
    mode: apply ? 'apply' : 'dry-run',
    retentionDays,
    cutoff: cutoff.toISOString(),
    limit: cappedLimit,
    maxBatches: cappedBatches,
    batchCount,
    targetCount: targets.length,
    deletedCount: apply ? deletedRows.length : 0,
    targetIds: targets.map((row) => row.id)
  };
}
