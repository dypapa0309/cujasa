import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

const LOCK_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_STALE_PROGRESS_MS = 15 * 60 * 1000;
const configuredStaleProgressMs = Number(process.env.PIPELINE_STALE_PROGRESS_MS);
const PIPELINE_STALE_PROGRESS_MS = Number.isFinite(configuredStaleProgressMs) && configuredStaleProgressMs > 0
  ? configuredStaleProgressMs
  : DEFAULT_STALE_PROGRESS_MS;

function now() {
  return new Date();
}

function getResult(run) {
  return run?.result && typeof run.result === 'object' ? run.result : {};
}

function getLastProgressAt(run) {
  const result = getResult(run);
  return result.updatedAt || run?.updated_at || run?.started_at || null;
}

function staleReason(run) {
  if (!run || run.status !== 'running') return null;
  const currentTime = now().getTime();
  if (new Date(run.expires_at).getTime() <= currentTime) {
    return {
      code: 'PIPELINE_LOCK_EXPIRED',
      message: 'pipeline lock expired'
    };
  }
  const lastProgressAt = getLastProgressAt(run);
  if (lastProgressAt && currentTime - new Date(lastProgressAt).getTime() > PIPELINE_STALE_PROGRESS_MS) {
    return {
      code: 'PIPELINE_PROGRESS_STALE',
      message: 'pipeline progress stale'
    };
  }
  return null;
}

function isFreshRunning(run) {
  if (!run || run.status !== 'running') return false;
  return !staleReason(run);
}

export async function expireStalePipelineRuns(accountId = null) {
  const runs = await dbList('pipeline_runs', accountId ? { account_id: accountId, status: 'running' } : { status: 'running' });
  const expired = [];
  for (const run of runs) {
    const reason = staleReason(run);
    if (reason) {
      const currentResult = getResult(run);
      const expiredAt = now().toISOString();
      const [updated] = await dbUpdate('pipeline_runs', { id: run.id }, {
        status: 'expired',
        finished_at: expiredAt,
        error_message: reason.message,
        result: {
          ...currentResult,
          status: 'expired',
          code: reason.code,
          message: reason.message,
          label: '예약 작업 진행이 오래 멈춰 만료 처리했습니다',
          expiredAt
        }
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
  if (current?.status && current.status !== 'running') return current;
  const previous = getResult(current);
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
  const current = await dbGet('pipeline_runs', { id: runId });
  if (current?.status && current.status !== 'running') return current;
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
