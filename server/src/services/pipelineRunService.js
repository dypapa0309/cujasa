import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

const LOCK_TTL_MS = 2 * 60 * 60 * 1000;

function now() {
  return new Date();
}

function isFreshRunning(run) {
  if (!run || run.status !== 'running') return false;
  return new Date(run.expires_at).getTime() > now().getTime();
}

export async function expireStalePipelineRuns(accountId = null) {
  const runs = await dbList('pipeline_runs', accountId ? { account_id: accountId, status: 'running' } : { status: 'running' });
  const expired = [];
  for (const run of runs) {
    if (new Date(run.expires_at).getTime() <= now().getTime()) {
      const [updated] = await dbUpdate('pipeline_runs', { id: run.id }, {
        status: 'expired',
        finished_at: now().toISOString(),
        error_message: 'pipeline lock expired'
      });
      expired.push(updated);
    }
  }
  return expired;
}

export async function getRunningPipeline(accountId) {
  await expireStalePipelineRuns(accountId);
  const runs = await dbList('pipeline_runs', { account_id: accountId, status: 'running' }, { order: 'started_at', ascending: false, limit: 1 });
  return isFreshRunning(runs[0]) ? runs[0] : null;
}

export async function startPipelineRun(account, requestedBy = 'system') {
  await expireStalePipelineRuns(account.id);
  const running = await getRunningPipeline(account.id);
  if (running) {
    const error = new Error('이미 예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.');
    error.status = 409;
    error.pipelineRun = running;
    throw error;
  }

  try {
    return await dbInsert('pipeline_runs', {
      project_id: account.project_id,
      account_id: account.id,
      requested_by: requestedBy,
      status: 'running',
      started_at: now().toISOString(),
      expires_at: new Date(now().getTime() + LOCK_TTL_MS).toISOString(),
      result: {
        percent: 0,
        stage: 'starting',
        label: '예약 작업을 준비하고 있습니다'
      }
    });
  } catch (insertError) {
    const error = new Error('이미 예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.');
    error.status = 409;
    error.cause = insertError;
    throw error;
  }
}

export async function updatePipelineRunProgress(runId, progress = {}) {
  if (!runId) return null;
  const current = await dbGet('pipeline_runs', { id: runId });
  const previous = current?.result && typeof current.result === 'object' ? current.result : {};
  const percent = Math.max(0, Math.min(100, Number(progress.percent ?? previous.percent ?? 0)));
  const [updated] = await dbUpdate('pipeline_runs', { id: runId }, {
    result: {
      ...previous,
      ...progress,
      percent,
      updatedAt: now().toISOString()
    }
  });
  return updated;
}

export async function finishPipelineRun(runId, status, patch = {}) {
  if (!runId) return null;
  const [updated] = await dbUpdate('pipeline_runs', { id: runId }, {
    status,
    finished_at: now().toISOString(),
    ...patch
  });
  return updated;
}

export async function latestPipelineRun(accountId) {
  await expireStalePipelineRuns(accountId);
  const rows = await dbList('pipeline_runs', { account_id: accountId }, { order: 'started_at', ascending: false, limit: 1 });
  return rows[0] || null;
}
