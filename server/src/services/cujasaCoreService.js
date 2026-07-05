import { dbGet, dbList } from './supabaseService.js';
import { runPipelineForAccount } from './pipelineService.js';
import {
  createDailyQueue,
  processDueQueue,
  recoverReplyLinkModeRequiredQueues,
  recoverStalePostingQueue,
  repairReplyLinkFailures,
  uploadQueueItem
} from './schedulerService.js';

const HEALTH_QUEUE_LIMIT = Math.max(1, Math.min(Number(process.env.CORE_HEALTH_QUEUE_LIMIT || 50), 200));
const HEALTH_ACCOUNT_LIMIT = Math.max(1, Math.min(Number(process.env.CORE_HEALTH_ACCOUNT_LIMIT || 100), 500));
const HEALTH_PROBE_TIMEOUT_MS = Math.max(1000, Number(process.env.CORE_HEALTH_PROBE_TIMEOUT_MS || 3000));

function startedProbe(name) {
  const startedAt = Date.now();
  return (status, extra = {}) => ({
    name,
    status,
    durationMs: Date.now() - startedAt,
    ...extra
  });
}

function dbStatusFromError(error = {}) {
  if (error.code === 'SUPABASE_UNAVAILABLE' || error.status === 503) return 'degraded';
  return 'error';
}

async function probe(name, fn) {
  const done = startedProbe(name);
  let timer = null;
  try {
    return done('ok', {
      data: await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            const error = new Error(`Core health probe timed out after ${HEALTH_PROBE_TIMEOUT_MS}ms`);
            error.status = 503;
            error.code = 'SUPABASE_UNAVAILABLE';
            reject(error);
          }, HEALTH_PROBE_TIMEOUT_MS);
        })
      ])
    });
  } catch (error) {
    return done(dbStatusFromError(error), {
      code: error.code || null,
      message: error.message || String(error)
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function normalizeCoreBlockReason(value = '') {
  const text = String(value || '').toLowerCase();
  if (/supabase|database|timeout|522|connection timed out/.test(text)) return 'db_unavailable';
  if (/reply|comment|permission|code 10|댓글 권한|댓글/.test(text)) return 'reply_permission';
  if (/tracking|link id|tracking_link|트래킹/.test(text)) return 'tracking_missing';
  if (/product|candidate|상품|링크 후보|real coupang/.test(text)) return 'product_missing';
  if (/coupang|throttle|rate limit|api 제한|쿠팡/.test(text)) return 'coupang_throttle';
  if (/schedule|interval|capacity|예약|간격/.test(text)) return 'schedule_capacity';
  return 'unknown';
}

export async function coreHealth() {
  const checkedAt = new Date().toISOString();
  const [users, accounts, queue] = await Promise.all([
    probe('users', async () => {
      const rows = await dbList('users', {}, { select: 'id,status,updated_at', limit: 1 });
      return { reachable: true, sampleCount: rows.length };
    }),
    probe('accounts', async () => {
      const rows = await dbList('accounts', { status: 'active' }, {
        select: 'id,automation_status,threads_access_token,coupang_access_key,coupang_secret_key,coupang_partner_id',
        limit: HEALTH_ACCOUNT_LIMIT
      });
      const connectedThreads = rows.filter((row) => Boolean(row.threads_access_token)).length;
      const coupangReady = rows.filter((row) => row.coupang_access_key && row.coupang_secret_key && row.coupang_partner_id).length;
      const running = rows.filter((row) => row.automation_status === 'running').length;
      return { activeCount: rows.length, running, connectedThreads, coupangReady };
    }),
    probe('post_queue', async () => {
      const rows = await dbList('post_queue', {}, {
        select: 'id,status,scheduled_at,error_category,tracking_link_id,post_url,post_mode,updated_at',
        order: 'scheduled_at',
        ascending: true,
        limit: HEALTH_QUEUE_LIMIT
      });
      const counts = rows.reduce((memo, row) => {
        memo[row.status || 'unknown'] = (memo[row.status || 'unknown'] || 0) + 1;
        return memo;
      }, {});
      const due = rows.filter((row) => ['scheduled', 'retry'].includes(row.status) && new Date(row.scheduled_at || 0) <= new Date()).length;
      const repairCandidates = rows.filter((row) => row.post_url && row.tracking_link_id && ['posted', 'failed', 'retry', 'manual_required'].includes(row.status)).length;
      return { sampleCount: rows.length, due, repairCandidates, counts };
    })
  ]);

  const probes = [users, accounts, queue];
  const status = probes.some((item) => item.status === 'error')
    ? 'error'
    : probes.some((item) => item.status === 'degraded')
      ? 'degraded'
      : 'ok';

  return {
    ok: status === 'ok',
    status,
    checkedAt,
    coreLoop: ['login', 'schedule', 'product_match', 'threads_post', 'own_post_reply_link'],
    policy: {
      linkFirst: true,
      noLinkFallback: 'automation_studio_or_explicit_only',
      replyScope: 'own_posts_only',
      crossAccountReplyLinks: false
    },
    probes
  };
}

export async function runCorePipeline(accountId, options = {}) {
  return runPipelineForAccount(accountId, {
    requestedBy: options.requestedBy || 'core',
    mode: options.mode || 'manual',
    allowInitialLinkDiscovery: options.allowInitialLinkDiscovery ?? true
  });
}

export async function createCoreDailyQueue(accountId, options = {}) {
  return createDailyQueue(accountId, {
    ...options,
    skipReplyReadiness: false
  });
}

export async function processCoreDueQueue(options = {}) {
  return processDueQueue({
    limit: options.limit,
    maxRunMs: options.maxRunMs,
    recoverMaintenance: options.recoverMaintenance !== false,
    repairReplies: options.repairReplies === true
  });
}

export async function uploadCoreQueueItem(queueId) {
  return uploadQueueItem(queueId);
}

async function listStalePostingCandidates({ accountId = null, limit = 20 } = {}) {
  const filters = accountId ? { status: 'posting', account_id: accountId } : { status: 'posting' };
  const rows = await dbList('post_queue', filters, {
    select: 'id,account_id,project_id,post_id,status,updated_at,created_at,retry_count,error_category,error_message',
    order: 'updated_at',
    ascending: true,
    limit
  });
  const staleMs = Math.max(1, Number(process.env.QUEUE_POSTING_STALE_MINUTES || 15)) * 60 * 1000;
  const cutoff = Date.now() - staleMs;
  return rows.filter((row) => new Date(row.updated_at || row.created_at || 0).getTime() <= cutoff);
}

export async function recoverCore({
  accountId = null,
  mode = 'dry-run',
  limit = 20
} = {}) {
  const dryRun = mode !== 'apply';
  const cappedLimit = Math.max(1, Math.min(Number(limit) || 20, 100));
  const [stalePosting, replyMode, replyLinks] = await Promise.all([
    dryRun
      ? listStalePostingCandidates({ accountId, limit: cappedLimit })
      : recoverStalePostingQueue({ accountId, limit: cappedLimit }),
    recoverReplyLinkModeRequiredQueues({ accountId, limit: cappedLimit, dryRun }),
    repairReplyLinkFailures({ accountId, limit: cappedLimit, dryRun })
  ]);

  return {
    ok: true,
    mode: dryRun ? 'dry-run' : 'apply',
    accountId,
    stalePosting: {
      candidateCount: Array.isArray(stalePosting) ? stalePosting.length : Number(stalePosting || 0),
      recoveredCount: dryRun ? 0 : Number(stalePosting || 0),
      candidates: (Array.isArray(stalePosting) ? stalePosting : []).map((row) => ({
        queueId: row.id,
        accountId: row.account_id,
        status: row.status,
        retryCount: row.retry_count || 0,
        updatedAt: row.updated_at || row.created_at || null,
        reason: normalizeCoreBlockReason(row.error_category || row.error_message)
      }))
    },
    replyMode,
    replyLinks
  };
}

export async function coreQueueDetail(queueId) {
  const queue = await dbGet('post_queue', { id: queueId });
  if (!queue) return null;
  return {
    id: queue.id,
    accountId: queue.account_id,
    status: queue.status,
    postMode: queue.post_mode || 'auto',
    hasPostUrl: Boolean(queue.post_url),
    hasTrackingLink: Boolean(queue.tracking_link_id),
    blockReason: normalizeCoreBlockReason(queue.error_category || queue.error_message)
  };
}
