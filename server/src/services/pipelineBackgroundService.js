import { runPipelineForAccount } from './pipelineService.js';
import { safeLogActivity } from './supabaseService.js';
import { AUTOMATION_PAUSED, setAutomationStatus } from './accountAutomationService.js';

export function isPipelineFailureResult(result) {
  const queuedCount = result?.queuedCount ?? result?.steps?.queued ?? null;
  if (result?.code === 'NO_REAL_COUPANG_LINKS' || result?.status === 'no_link_candidates') return false;
  return result?.ok === false || result?.status === 'error' || queuedCount === 0;
}

async function pauseAfterPipelineFailure(accountId, { action, requestedBy, result = null, error = null }) {
  await setAutomationStatus(accountId, AUTOMATION_PAUSED).catch(() => null);
  await safeLogActivity({
    account_id: accountId,
    level: error ? 'error' : 'warn',
    action,
    message: error?.message || result?.message || result?.error || '예약 생성 실패로 자동화를 일시중지했습니다.',
    payload: {
      requestedBy,
      ...(result ? { pipelineResult: result } : {}),
      ...(error ? { code: error.code || null, status: error.status || null } : {})
    }
  });
}

export function runPipelineForAccountInBackground(accountId, options = {}) {
  const requestedBy = options.requestedBy || 'manual';
  const failureAction = options.failureAction || 'pipeline_failed_paused';
  const pipelineOptions = {
    requestedBy,
    mode: options.mode || 'start',
    allowInitialLinkDiscovery: options.allowInitialLinkDiscovery ?? true
  };

  setTimeout(() => {
    runPipelineForAccount(accountId, pipelineOptions)
      .then(async (result) => {
        if (isPipelineFailureResult(result)) {
          await pauseAfterPipelineFailure(accountId, {
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
        await pauseAfterPipelineFailure(accountId, {
          action: failureAction,
          requestedBy,
          error
        });
      });
  }, 0);
}
