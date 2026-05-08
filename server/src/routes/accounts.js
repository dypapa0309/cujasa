import { Router } from 'express';
import { archiveAccount, createAccount, deleteAccount, getAccount, listAccounts, listAllAccounts, updateAccount } from '../services/accountService.js';
import { dbGet, dbInsert, dbList, logActivity, safeLogActivity } from '../services/supabaseService.js';
import { expireStalePipelineRuns, getRunningPipeline, latestPipelineRun } from '../services/pipelineRunService.js';
import { runPipelineForAccountInBackground } from '../services/pipelineBackgroundService.js';
import { markedOkKeysFromAudits, shouldHideAssignment, suspiciousAssignmentsForUser } from '../services/accountOwnershipService.js';
import { assertPreflightCanPublish, preflightAccount } from '../services/accountPreflightService.js';
import { assertUserCanOperate } from '../services/billingEntitlementService.js';
import { redactAccount, redactAccounts, stripBlankSensitiveAccountFields } from '../services/redactionService.js';
import { assertUserCanStartTrialAction } from '../services/trialEntitlementService.js';
import { AUTOMATION_PAUSED, AUTOMATION_RUNNING, normalizeAutomationStatus, setAutomationStatus } from '../services/accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const router = Router();

const revealableAccountFields = new Set([
  'coupang_access_key',
  'coupang_secret_key',
  'coupang_partner_id',
  'coupang_tracking_code'
]);

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

async function attachOwnerLabels(accounts = []) {
  const [links, users] = await Promise.all([
    dbList('user_accounts'),
    dbList('users')
  ]);
  const usersById = new Map(users.map((user) => [user.id, user]));
  return accounts.map((account) => {
    const owners = links
      .filter((link) => link.account_id === account.id)
      .map((link) => usersById.get(link.user_id))
      .filter(Boolean)
      .map((user) => ({
        id: user.id,
        buyerName: user.buyer_name || '',
        username: user.username || '',
        email: user.email || '',
        plan: user.plan || 'free',
        status: user.status || 'active'
      }));
    return {
      ...account,
      owner: owners[0] || null,
      owner_label: owners.map((user) => user.buyerName || user.username || user.email).filter(Boolean).join(', ')
    };
  });
}

router.get('/', async (req, res, next) => {
  try {
    const includeArchived = req.user?.type === 'admin' && req.query.includeArchived === '1';
    const all = includeArchived ? await listAllAccounts() : await listAccounts();
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
    res.json(redactAccounts(await attachOwnerLabels(all)));
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
    const payload = stripBlankSensitiveAccountFields(req.body);
    const account = await createAccount(payload);
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
    const mode = req.query.mode === 'start' ? 'start' : undefined;
    res.json(await preflightAccount(req.params.accountId, { mode }));
  } catch (e) { next(e); }
});

router.get('/:accountId/product-summary', async (req, res, next) => {
  try {
    const { accountId } = req.params;
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const [topics, products, selections, posts, queue] = await Promise.all([
      dbList('topics', { account_id: accountId }, { order: 'created_at', ascending: false }),
      dbList('coupang_products', { account_id: accountId }),
      dbList('post_products'),
      dbList('posts', { account_id: accountId }),
      dbList('post_queue', { account_id: accountId })
    ]);
    const postsByTopic = posts.reduce((acc, post) => {
      if (!post.topic_id) return acc;
      if (!acc.has(post.topic_id)) acc.set(post.topic_id, []);
      acc.get(post.topic_id).push(post);
      return acc;
    }, new Map());
    const postTopicById = new Map(posts.map((post) => [post.id, post.topic_id]));
    const queueTopicIds = new Set(queue.map((row) => row.topic_id || postTopicById.get(row.post_id)).filter(Boolean));
    const selectedProductIdsByTopic = selections.reduce((acc, row) => {
      if (!row.topic_id) return acc;
      if (!acc.has(row.topic_id)) acc.set(row.topic_id, new Set());
      acc.get(row.topic_id).add(row.product_id);
      return acc;
    }, new Map());
    const productRowsByTopic = products.reduce((acc, product) => {
      if (!product.topic_id) return acc;
      if (!acc.has(product.topic_id)) acc.set(product.topic_id, []);
      acc.get(product.topic_id).push(product);
      return acc;
    }, new Map());
    const now = Date.now();
    const cleanupCutoff = now - 7 * 24 * 60 * 60 * 1000;
    res.json(topics.map((topic) => {
      const topicProducts = productRowsByTopic.get(topic.id) || [];
      const selectedIds = selectedProductIdsByTopic.get(topic.id) || new Set();
      const realProducts = topicProducts.filter(isRealCoupangProduct);
      const selectedRealCount = realProducts.filter((product) => selectedIds.has(product.id)).length;
      const hasQueue = queueTopicIds.has(topic.id);
      const cleanupCandidate = !hasQueue && new Date(topic.created_at || 0).getTime() < cleanupCutoff;
      const status = selectedRealCount > 0
        ? 'connected'
        : realProducts.length > 0
          ? 'needs_selection'
          : topicProducts.length > 0
            ? 'no_real_products'
            : 'no_products';
      return {
        topicId: topic.id,
        title: topic.title,
        angle: topic.angle,
        createdAt: topic.created_at,
        status,
        productCount: topicProducts.length,
        realCount: realProducts.length,
        selectedCount: selectedIds.size,
        selectedRealCount,
        fallbackCount: topicProducts.length - realProducts.length,
        postCount: (postsByTopic.get(topic.id) || []).length,
        hasQueue,
        cleanupCandidate
      };
    }));
  } catch (e) { next(e); }
});

router.get('/:accountId/sensitive/:field', async (req, res, next) => {
  try {
    const { accountId, field } = req.params;
    if (!revealableAccountFields.has(field)) {
      return res.status(400).json({ error: '지원하지 않는 민감 필드입니다.' });
    }
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const account = await getAccount(accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({ field, value: account[field] || '' });
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
      ? (({ daily_post_min, daily_post_max, active_time_windows, min_interval_minutes,
             link_post_ratio, no_link_post_ratio,
             name, account_handle, target_audience, content_scope, tone, cta_style,
             content_mode, content_intensity, seasonality_enabled, comment_induction_style,
             product_mention_style, emoji_level, safe_debate_enabled, content_style_note,
             forbidden_topics, forbidden_words,
             coupang_access_key, coupang_secret_key, coupang_partner_id, coupang_tracking_code }) =>
          ({ daily_post_min, daily_post_max, active_time_windows, min_interval_minutes,
             link_post_ratio, no_link_post_ratio,
             name, account_handle, target_audience, content_scope, tone, cta_style,
             content_mode, content_intensity, seasonality_enabled, comment_induction_style,
             product_mention_style, emoji_level, safe_debate_enabled, content_style_note,
             forbidden_topics, forbidden_words,
             coupang_access_key, coupang_secret_key, coupang_partner_id, coupang_tracking_code })
        )(req.body)
      : req.body;
    res.json(redactAccount(await updateAccount(req.params.accountId, stripBlankSensitiveAccountFields(body))));
  } catch (e) { next(e); }
});

router.patch('/:accountId/automation', async (req, res, next) => {
  try {
    const { accountId } = req.params;
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);

    const account = await getAccount(accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const requestedStatus = req.body.automationStatus || req.body.status;
    if (![AUTOMATION_RUNNING, AUTOMATION_PAUSED].includes(requestedStatus)) {
      return res.status(400).json({
        error: 'automationStatus must be running or paused',
        code: 'INVALID_AUTOMATION_STATUS'
      });
    }
    const nextStatus = normalizeAutomationStatus(requestedStatus);
    if (nextStatus === AUTOMATION_PAUSED) {
      const updated = await setAutomationStatus(accountId, AUTOMATION_PAUSED);
      await safeLogActivity({
        account_id: accountId,
        level: 'info',
        action: 'automation_paused',
        message: `${account.name} 자동화 중지`,
        payload: { requestedBy: req.user?.email || req.user?.type || 'manual' }
      });
      return res.json({ ok: true, automationStatus: AUTOMATION_PAUSED, account: redactAccount(updated) });
    }

    if (req.user?.type === 'user') await assertUserCanStartTrialAction(req.user.userId);
    const preflight = await preflightAccount(accountId, { mode: 'start' });
    assertPreflightCanPublish(preflight);
    await expireStalePipelineRuns(accountId);

    const updated = await setAutomationStatus(accountId, AUTOMATION_RUNNING);
    await safeLogActivity({
      account_id: accountId,
      level: 'info',
      action: 'automation_started',
      message: `${account.name} 자동화 시작`,
      payload: { requestedBy: req.user?.email || req.user?.type || 'manual' }
    });

    if (req.body.runNow === false) {
      return res.json({ ok: true, automationStatus: AUTOMATION_RUNNING, account: redactAccount(updated), preflight });
    }

    const runningRun = await getRunningPipeline(accountId);
    if (runningRun) {
      return res.status(202).json({
        ok: true,
        automationStatus: AUTOMATION_RUNNING,
        alreadyRunning: true,
        account: redactAccount(updated),
        run: mapPipelineRun(runningRun),
        preflight,
        message: '이미 예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.'
      });
    }

    runPipelineForAccountInBackground(accountId, {
      requestedBy: req.user?.email || req.user?.type || 'manual',
      mode: 'start',
      allowInitialLinkDiscovery: true,
      failureAction: 'automation_start_failed_paused'
    });

    return res.status(202).json({
      ok: true,
      status: 'accepted',
      automationStatus: AUTOMATION_RUNNING,
      alreadyRunning: false,
      account: redactAccount(updated),
      preflight,
      message: '예약 작업을 시작했습니다. 진행 상태를 확인하고 있습니다.'
    });
  } catch (e) { next(e); }
});

router.post('/:accountId/run-pipeline', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (req.user?.type === 'user') await assertUserCanOperate(req.user.userId);
    if (req.user?.type === 'user') await assertUserCanStartTrialAction(req.user.userId);
    const preflight = await preflightAccount(req.params.accountId, { mode: 'start' });
    assertPreflightCanPublish(preflight);
    await expireStalePipelineRuns(req.params.accountId);
    const runningRun = await getRunningPipeline(req.params.accountId);
    if (runningRun) {
      return res.status(202).json({
        ok: true,
        status: 'running',
        alreadyRunning: true,
        run: mapPipelineRun(runningRun),
        preflight,
        message: '이미 예약 작업 실행 중입니다. 완료될 때까지 잠시만 기다려주세요.'
      });
    }
    runPipelineForAccountInBackground(req.params.accountId, {
      requestedBy: req.user?.email || req.user?.type || 'manual',
      mode: 'start',
      allowInitialLinkDiscovery: true,
      failureAction: 'manual_pipeline_failed_paused'
    });
    res.status(202).json({
      ok: true,
      status: 'accepted',
      preflight,
      message: '예약 작업을 시작했습니다. 진행 상태를 확인하고 있습니다.'
    });
  } catch (e) { next(e); }
});

router.delete('/:accountId', async (req, res, next) => {
  try {
    const { accountId } = req.params;
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    const account = await getAccount(accountId);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (req.user?.type === 'admin' && req.query.hard === 'true') {
      if (account.status !== 'archived') {
        return res.status(409).json({ error: '완전 삭제는 보관 계정에서만 가능합니다. 먼저 보관 처리해주세요.' });
      }
      await deleteAccount(accountId);
      await safeLogActivity({
        account_id: accountId,
        project_id: account.project_id,
        level: 'warn',
        action: 'account_permanently_deleted',
        message: `${account.name} 계정 완전 삭제`,
        payload: { requestedBy: req.user?.email || 'admin' }
      });
      return res.status(204).end();
    }

    const archived = await archiveAccount(accountId);
    await safeLogActivity({
      account_id: accountId,
      project_id: account.project_id,
      level: 'warn',
      action: 'account_archived',
      message: `${account.name} 계정 보관 처리`,
      payload: { requestedBy: req.user?.email || req.user?.type || 'manual' }
    });
    res.json(redactAccount(archived));
  } catch (e) { next(e); }
});

export default router;
