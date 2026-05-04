import { Router } from 'express';
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from '../services/accountService.js';
import { dbGet, dbInsert, dbList, logActivity } from '../services/supabaseService.js';
import { runPipelineForAccount } from '../services/pipelineService.js';
import { latestPipelineRun } from '../services/pipelineRunService.js';
import { markedOkKeysFromAudits, shouldHideAssignment, suspiciousAssignmentsForUser } from '../services/accountOwnershipService.js';
import { preflightAccount } from '../services/accountPreflightService.js';
import { assertUserCanOperate } from '../services/billingEntitlementService.js';
import { redactAccount, redactAccounts, stripBlankSensitiveAccountFields } from '../services/redactionService.js';

const router = Router();

function mapPipelineRun(run) {
  if (!run) return null;
  const result = run.result && typeof run.result === 'object' ? run.result : {};
  return {
    id: run.id,
    accountId: run.account_id,
    status: run.status,
    requestedBy: run.requested_by,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    expiresAt: run.expires_at,
    errorMessage: run.error_message,
    progress: {
      percent: Number(result.percent ?? (run.status === 'completed' ? 100 : 0)),
      stage: result.stage || run.status,
      label: result.label || (run.status === 'completed' ? '예약 작업이 완료됐습니다' : '예약 작업 상태를 확인하고 있습니다'),
      topicsTotal: result.topicsTotal ?? result.steps?.topics ?? 0,
      topicsDone: result.topicsDone ?? 0,
      postsCreated: result.postsCreated ?? result.steps?.posts ?? 0,
      queuedCount: result.queuedCount ?? result.steps?.queued ?? 0,
      updatedAt: result.updatedAt || run.updated_at
    },
    result
  };
}

router.get('/', async (req, res, next) => {
  try {
    const all = await listAccounts();
    if (req.user?.type === 'user') {
      const assigned = all.filter((a) => req.user.allowedAccountIds.includes(a.id));
      const [user, users, userAccounts, audits] = await Promise.all([
        dbGet('users', { id: req.user.userId }),
        dbList('users'),
        dbList('user_accounts'),
        dbList('account_conflict_audits').catch(() => [])
      ]);
      const ignoredKeys = markedOkKeysFromAudits(audits);
      const suspicious = suspiciousAssignmentsForUser({ userId: req.user.userId, users, accounts: all, userAccounts, ignoredKeys });
      const hiddenIds = new Set(suspicious.filter(shouldHideAssignment).map((row) => row.accountId));
      if (hiddenIds.size > 0) {
        logActivity({
          level: 'warn',
          action: 'suspected_misassigned_accounts_hidden',
          message: `${user?.email || req.user.email} 계정에서 잘못 배정 의심 계정을 숨김`,
          payload: { userId: req.user.userId, accountIds: [...hiddenIds], suspicious }
        }).catch(() => {});
      }
      return res.json(redactAccounts(assigned.filter((account) => !hiddenIds.has(account.id))));
    }
    res.json(redactAccounts(all));
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.user?.type === 'user') {
      await assertUserCanOperate(req.user.userId);
      const current = await dbList('user_accounts', { user_id: req.user.userId });
      if (current.length >= req.user.maxAccounts) {
        const error = new Error(`계정은 최대 ${req.user.maxAccounts}개까지 생성할 수 있습니다. 추가 계정은 별도 문의해주세요.`);
        error.status = 403;
        throw error;
      }
    }
    const account = await createAccount(stripBlankSensitiveAccountFields(req.body));
    if (req.user?.type === 'user') {
      await dbInsert('user_accounts', { user_id: req.user.userId, account_id: account.id });
    }
    res.status(201).json(redactAccount(account));
  } catch (e) { next(e); }
});

router.get('/:accountId/pipeline-run', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ run: mapPipelineRun(await latestPipelineRun(req.params.accountId)) });
  } catch (e) { next(e); }
});

router.get('/:accountId/preflight', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await preflightAccount(req.params.accountId));
  } catch (e) { next(e); }
});

router.get('/:accountId', async (req, res, next) => {
  try {
    const account = await getAccount(req.params.accountId);
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(redactAccount(account));
  } catch (e) { next(e); }
});

router.patch('/:accountId', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    // 유저는 안전한 필드만 수정 가능
    const body = req.user?.type === 'user'
      ? (({ threads_access_token, daily_post_min, daily_post_max, active_time_windows, min_interval_minutes,
             link_post_ratio, no_link_post_ratio,
             name, account_handle, target_audience, content_scope, tone, cta_style,
             forbidden_topics, forbidden_words,
             coupang_access_key, coupang_secret_key, coupang_partner_id, coupang_tracking_code }) =>
          ({ threads_access_token, daily_post_min, daily_post_max, active_time_windows, min_interval_minutes,
             link_post_ratio, no_link_post_ratio,
             name, account_handle, target_audience, content_scope, tone, cta_style,
             forbidden_topics, forbidden_words,
             coupang_access_key, coupang_secret_key, coupang_partner_id, coupang_tracking_code })
        )(req.body)
      : req.body;
    res.json(redactAccount(await updateAccount(req.params.accountId, stripBlankSensitiveAccountFields(body))));
  } catch (e) { next(e); }
});

router.post('/:accountId/run-pipeline', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    res.json(await runPipelineForAccount(req.params.accountId, { requestedBy: req.user?.email || req.user?.type || 'manual' }));
  } catch (e) { next(e); }
});

router.delete('/:accountId', async (req, res, next) => {
  try {
    if (req.user?.type === 'user') return res.status(403).json({ error: 'Admin only' });
    await deleteAccount(req.params.accountId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
