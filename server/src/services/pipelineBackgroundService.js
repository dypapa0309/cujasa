import { runCorePipeline } from './cujasaCoreService.js';
import { safeLogActivity } from './supabaseService.js';

export function isPipelineFailureResult(result) {
  const queuedCount = result?.queuedCount ?? result?.steps?.queued ?? null;
  if (result?.code === 'NO_REAL_COUPANG_LINKS' || result?.status === 'no_link_candidates') return false;
  return result?.ok === false || result?.status === 'error' || queuedCount === 0;
}

async function recordPipelineFailure(accountId, { action, requestedBy, result = null, error = null }) {
  await safeLogActivity({
    account_id: accountId,
    level: error ? 'error' : 'warn',
    action,
    message: error?.message || result?.message || result?.error || '예약 생성에 실패했습니다. 자동화는 계속 켜둔 상태로 다음 실행에서 재시도합니다.',
    payload: {
      requestedBy,
      automationKeptRunning: true,
      ...(result ? { pipelineResult: result } : {}),
      ...(error ? { code: error.code || null, status: error.status || null } : {})
    }
  });
}

export function runPipelineForAccountInBackground(accountId, options = {}) {
  const requestedBy = options.requestedBy || 'manual';
  const failureAction = options.failureAction || 'pipeline_failed_kept_running';
  const pipelineOptions = {
    requestedBy,
    mode: options.mode || 'start',
    allowInitialLinkDiscovery: options.allowInitialLinkDiscovery ?? true
  };

  setTimeout(() => {
    runCorePipeline(accountId, pipelineOptions)
      .then(async (result) => {
        if (isPipelineFailureResult(result)) {
          await recordPipelineFailure(accountId, {
            action: failureAction,
            requestedBy,
            result
          });
        }
      })
      .catch(async (error) => {
        if (error.status === 409) {
          await safeLogActivity({
            account_id: accountId,
            level: 'info',
            action: 'pipeline_background_already_running',
            message: error.message,
            payload: { requestedBy }
          });
          return;
        }
        await recordPipelineFailure(accountId, {
          action: failureAction,
          requestedBy,
          error
        });
      });
  }, 0);
}
