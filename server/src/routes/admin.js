import { Router } from 'express';
import {
  createUser,
  grantUserProduct,
  listAvailableProducts,
  listUserProducts,
  listUsers,
  revokeUserProduct,
  updateUser,
  updateUserProductSettings
} from '../services/authService.js';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from '../services/supabaseService.js';
import { hashPassword } from '../utils/password.js';
import { cleanupQueueErrors, operationAccountRows, operationEvents, operationSummary } from '../services/operationsService.js';
import { buildOpsHealthSummary, runDailyOpsHealthCheck } from '../services/opsHealthService.js';
import { cleanupUnusedPipelineArtifacts } from '../services/unusedArtifactCleanupService.js';
import { cleanupOldQueueIssues, dismissPastQueueIssuesForAccount } from '../services/queueVisibilityService.js';
import { listSetupTasks, updateSetupTask } from '../services/setupTaskService.js';
import { buildMisassignmentReport } from '../services/accountOwnershipService.js';
import { createManualPayment, expireDueEntitlements } from '../services/billingEntitlementService.js';
import { listPolibotCatalogReview, savePolibotCatalogReviews } from '../services/productWorkspaceService.js';
import { redactAccount, redactAccounts, redactBillingSettings, redactPayment } from '../services/redactionService.js';

const router = Router();

const revealableProductSettingFields = new Set([
  'coupangAccessKey',
  'coupangSecretKey',
  'coupangPartnerId',
  'defaultTrackingCode'
]);

function normalizeHandle(value) {
  return String(value || '').trim().replace(/^@/, '').toLowerCase();
}

function accountLabel(account) {
  return [account?.name, account?.account_handle].filter(Boolean).join(' · ');
}

async function buildAccountConflicts() {
  const [accounts, userAccounts, users] = await Promise.all([
    dbList('accounts'),
    dbList('user_accounts'),
    dbList('users')
  ]);
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const usersById = new Map(users.map((user) => [user.id, user]));
  const conflicts = [];

  const byThreadsUserId = new Map();
  activeAccounts.forEach((account) => {
    if (!account.threads_user_id) return;
    const key = account.threads_user_id;
    byThreadsUserId.set(key, [...(byThreadsUserId.get(key) || []), account]);
  });
  byThreadsUserId.forEach((rows, key) => {
    if (rows.length < 2) return;
    conflicts.push({
      type: 'duplicate_threads_user_id',
      label: '같은 Threads 계정 중복 연결',
      key,
      severity: 'error',
      accounts: rows.map((account) => ({ id: account.id, name: account.name, accountHandle: account.account_handle, label: accountLabel(account) }))
    });
  });

  const byHandle = new Map();
  activeAccounts.forEach((account) => {
    const key = normalizeHandle(account.account_handle);
    if (!key) return;
    byHandle.set(key, [...(byHandle.get(key) || []), account]);
  });
  byHandle.forEach((rows, key) => {
    if (rows.length < 2) return;
    conflicts.push({
      type: 'duplicate_account_handle',
      label: '같은 Threads 핸들 중복 등록',
      key: `@${key}`,
      severity: 'warn',
      accounts: rows.map((account) => ({ id: account.id, name: account.name, accountHandle: account.account_handle, label: accountLabel(account) }))
    });
  });

  const byAssignedAccount = new Map();
  userAccounts.forEach((link) => {
    byAssignedAccount.set(link.account_id, [...(byAssignedAccount.get(link.account_id) || []), link]);
  });
  byAssignedAccount.forEach((links, accountId) => {
    const uniqueUsers = [...new Set(links.map((link) => link.user_id))];
    if (uniqueUsers.length < 2) return;
    const account = accounts.find((item) => item.id === accountId);
    conflicts.push({
      type: 'account_assigned_to_multiple_users',
      label: '한 계정이 여러 고객에게 할당됨',
      key: accountLabel(account) || accountId,
      severity: 'error',
      accounts: account ? [{ id: account.id, name: account.name, accountHandle: account.account_handle, label: accountLabel(account) }] : [],
      users: uniqueUsers.map((userId) => ({ id: userId, email: usersById.get(userId)?.email || userId }))
    });
  });

  return conflicts;
}

// 관리자만 접근 가능
function adminOnly(req, res, next) {
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.use(adminOnly);

router.get('/operations/summary', async (req, res, next) => {
  try { res.json(await operationSummary()); } catch (e) { next(e); }
});

router.get('/operations/accounts', async (req, res, next) => {
  try { res.json(await operationAccountRows()); } catch (e) { next(e); }
});

router.get('/operations/events', async (req, res, next) => {
  try {
    res.json(await operationEvents({
      type: req.query?.type || 'queue_problems',
      limit: req.query?.limit || 200
    }));
  } catch (e) { next(e); }
});

router.post('/operations/cleanup-queue-errors', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
    res.json(await cleanupQueueErrors({ mode }));
  } catch (e) { next(e); }
});

router.post('/operations/cleanup-unused-artifacts', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
    const retentionDays = Number(req.body?.retentionDays || 7);
    const accountId = req.body?.accountId || null;
    res.json(await cleanupUnusedPipelineArtifacts({ mode, retentionDays, accountId }));
  } catch (e) { next(e); }
});

router.post('/operations/cleanup-old-queue-issues', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
    res.json(await cleanupOldQueueIssues({
      mode,
      accountId: req.body?.accountId || null,
      hideAfterDays: Number(req.body?.hideAfterDays || 7),
      deleteAfterHiddenDays: Number(req.body?.deleteAfterHiddenDays || 3)
    }));
  } catch (e) { next(e); }
});

router.post('/operations/accounts/:accountId/dismiss-past-queue-issues', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
    res.json(await dismissPastQueueIssuesForAccount(req.params.accountId, {
      mode,
      reason: req.body?.reason || 'admin_past_issue_cleanup'
    }));
  } catch (e) { next(e); }
});

router.get('/operations/healthcheck', async (req, res, next) => {
  try { res.json(await buildOpsHealthSummary()); } catch (e) { next(e); }
});

router.get('/operations/assistant-metrics', async (req, res, next) => {
  try {
    const rows = await dbList('activity_logs', {}, { order: 'created_at', ascending: false, limit: Number(req.query?.limit || 500) });
    const assistantRows = rows.filter((row) => String(row.action || '').startsWith('workspace_assistant_') || row.action === 'public_rate_limit_hit');
    const workspaceRows = assistantRows.filter((row) => String(row.action || '').startsWith('workspace_assistant_'));
    const durations = workspaceRows
      .map((row) => Number(row.payload?.durationMs))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const countBy = (items, keyFn) => items.reduce((acc, item) => {
      const key = keyFn(item) || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const questionCounts = countBy(
      workspaceRows.filter((row) => ['workspace_assistant_fallback', 'workspace_assistant_ai_timeout'].includes(row.action)),
      (row) => row.message
    );
    res.json({
      counts: {
        total: workspaceRows.length,
        faqHit: workspaceRows.filter((row) => row.action === 'workspace_assistant_faq_hit').length,
        draftCreated: workspaceRows.filter((row) => row.action === 'workspace_assistant_draft_created').length,
        clarification: workspaceRows.filter((row) => row.action === 'workspace_assistant_clarification').length,
        fallback: workspaceRows.filter((row) => row.action === 'workspace_assistant_fallback').length,
        aiTimeout: workspaceRows.filter((row) => row.action === 'workspace_assistant_ai_timeout').length,
        slowAi: workspaceRows.filter((row) => row.action === 'workspace_assistant_slow_ai').length,
        rateLimitHit: assistantRows.filter((row) => row.action === 'public_rate_limit_hit').length
      },
      averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
      fallbackQuestions: Object.entries(questionCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([message, count]) => ({ message, count })),
      recent: assistantRows.slice(0, 30).map((row) => ({
        id: row.id,
        action: row.action,
        level: row.level,
        message: row.message,
        durationMs: row.payload?.durationMs || null,
        product: row.payload?.currentProduct || row.payload?.inferredProduct || null,
        createdAt: row.created_at
      }))
    });
  } catch (e) { next(e); }
});

router.post('/operations/healthcheck/run', async (req, res, next) => {
  try { res.json(await runDailyOpsHealthCheck()); } catch (e) { next(e); }
});

router.get('/setup-tasks', async (req, res, next) => {
  try { res.json(await listSetupTasks()); } catch (e) { next(e); }
});

router.post('/setup-tasks/normalize-onetime', async (req, res, next) => {
  try {
    const tasks = await listSetupTasks();
    const userIds = [...new Set(tasks.map((task) => task.user_id).filter(Boolean))];
    const updated = [];
    for (const userId of userIds) {
      const user = await dbGet('users', { id: userId });
      if (!user) continue;
      const [nextUser] = await dbUpdate('users', { id: userId }, {
        plan: 'onetime',
        billing_status: 'paid',
        paid_until: null,
        max_accounts: Math.max(Number(user.max_accounts || 0), 2)
      });
      await grantUserProduct(userId, 'cujasa', { status: 'active', role: 'customer' });
      updated.push({ id: userId, email: user.email, plan: nextUser?.plan || 'onetime', billingStatus: nextUser?.billing_status || 'paid' });
    }
    res.json({ ok: true, count: updated.length, users: updated });
  } catch (e) { next(e); }
});

router.get('/account-conflicts', async (req, res, next) => {
  try { res.json(await buildAccountConflicts()); } catch (e) { next(e); }
});

router.get('/account-misassignments', async (req, res, next) => {
  try { res.json(await buildMisassignmentReport()); } catch (e) { next(e); }
});

async function auditMisassignment(row, action) {
  try {
    await dbInsert('account_conflict_audits', {
      conflict_type: 'suspected_misassignment',
      conflict_key: `${row.userEmail || row.userId}:${row.accountName || row.accountId}`,
      account_ids: [row.accountId],
      details: { action, row }
    });
  } catch {
    // Older databases may not have the audit table yet. Cleanup should still be usable.
  }
}

router.post('/account-misassignments/cleanup', async (req, res, next) => {
  try {
    const mode = req.body?.mode === 'apply' ? 'apply' : 'dry-run';
    const report = await buildMisassignmentReport();
    const targets = report.separable || [];
    const reviews = report.needsReview || [];
    if (mode === 'apply') {
      for (const row of targets) {
        await dbDelete('user_accounts', { user_id: row.userId, account_id: row.accountId });
        await auditMisassignment(row, 'auto_unassigned');
      }
      for (const row of reviews) await auditMisassignment(row, 'needs_review');
    }
    res.json({ mode, unassigned: mode === 'apply' ? targets.length : 0, targets, needsReview: reviews });
  } catch (e) { next(e); }
});

router.post('/account-misassignments/unassign', async (req, res, next) => {
  try {
    const { userId, accountId } = req.body || {};
    if (!userId || !accountId) return res.status(400).json({ error: 'userId, accountId 필수' });
    await dbDelete('user_accounts', { user_id: userId, account_id: accountId });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/account-misassignments/reassign', async (req, res, next) => {
  try {
    const { fromUserId, toUserId, accountId } = req.body || {};
    if (!toUserId || !accountId) return res.status(400).json({ error: 'toUserId, accountId 필수' });
    const targetUser = await dbGet('users', { id: toUserId });
    if (!targetUser) return res.status(404).json({ error: 'Target user not found' });
    const targetLinks = await dbList('user_accounts', { user_id: toUserId });
    const alreadyTarget = targetLinks.some((row) => row.account_id === accountId);
    if (!alreadyTarget && targetLinks.length >= targetUser.max_accounts) {
      return res.status(403).json({ error: `추천 소유자의 계정 한도 초과 (최대 ${targetUser.max_accounts}개)` });
    }
    const currentOwners = await dbList('user_accounts', { account_id: accountId });
    const otherOwner = currentOwners.find((row) => row.user_id !== fromUserId && row.user_id !== toUserId);
    if (otherOwner) return res.status(409).json({ error: '이미 다른 고객에게 할당된 계정입니다.' });
    if (fromUserId) await dbDelete('user_accounts', { user_id: fromUserId, account_id: accountId });
    const exists = (await dbList('user_accounts', { user_id: toUserId, account_id: accountId }))[0];
    const link = exists || await dbInsert('user_accounts', { user_id: toUserId, account_id: accountId });
    res.json(link);
  } catch (e) { next(e); }
});

router.post('/account-misassignments/mark-ok', async (req, res, next) => {
  try {
    const { userId, accountId, row } = req.body || {};
    if (!userId || !accountId) return res.status(400).json({ error: 'userId, accountId 필수' });
    const audit = await dbInsert('account_conflict_audits', {
      conflict_type: 'assignment_marked_ok',
      conflict_key: `${userId}:${accountId}`,
      account_ids: [accountId],
      details: { row: row || null }
    });
    res.json(audit);
  } catch (e) { next(e); }
});

router.post('/accounts/:accountId/disconnect-threads', async (req, res, next) => {
  try {
    const [updated] = await dbUpdate('accounts', { id: req.params.accountId }, {
      threads_access_token: null,
      threads_user_id: null,
      threads_token_expires_at: null,
      threads_token_status: 'not_connected',
      threads_connected_at: null,
      last_threads_refresh_at: null
    });
    if (!updated) return res.status(404).json({ error: 'Account not found' });
    res.json(redactAccount(updated));
  } catch (e) { next(e); }
});

router.patch('/setup-tasks/:id', async (req, res, next) => {
  try { res.json(await updateSetupTask(req.params.id, req.body || {})); } catch (e) { next(e); }
});

// 구매자 목록
router.get('/users', async (req, res, next) => {
  try {
    const users = await listUsers();
    const result = await Promise.all(users.map(async (u) => {
      const [ua, products] = await Promise.all([
        dbList('user_accounts', { user_id: u.id }),
        listUserProducts(u.id, { includeSettings: true })
      ]);
      const accounts = await Promise.all(ua.map((x) => dbGet('accounts', { id: x.account_id })));
      return {
        ...u,
        buyerName: u.buyer_name || '',
        password_hash: undefined,
        accounts: redactAccounts(accounts.filter(Boolean)),
        products
      };
    }));
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/products', async (req, res, next) => {
  try {
    res.json(await listAvailableProducts());
  } catch (e) { next(e); }
});

router.patch('/products/:id', async (req, res, next) => {
  try {
    const patch = {};
    if (req.body.name !== undefined) patch.name = String(req.body.name || '').trim();
    if (req.body.description !== undefined) patch.description = String(req.body.description || '').trim() || null;
    if (req.body.app_url !== undefined || req.body.appUrl !== undefined) patch.app_url = String(req.body.app_url ?? req.body.appUrl ?? '').trim() || null;
    if (req.body.landing_url !== undefined || req.body.landingUrl !== undefined) patch.landing_url = String(req.body.landing_url ?? req.body.landingUrl ?? '').trim() || null;
    if (req.body.status !== undefined && ['active', 'inactive', 'archived'].includes(req.body.status)) patch.status = req.body.status;
    if (patch.name === '') return res.status(400).json({ error: 'name 필수' });
    const [updated] = await dbUpdate('jasain_products', { id: req.params.id }, patch);
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

router.get('/billing/products', async (req, res, next) => {
  try {
    res.json(await dbList('billing_products', { active: true }, { order: 'amount', ascending: false }));
  } catch (e) { next(e); }
});

router.get('/billing/payments', async (req, res, next) => {
  try {
    const rows = await dbList('billing_payments', {}, { order: 'created_at', ascending: false, limit: 100 });
    res.json(rows.map(redactPayment));
  } catch (e) { next(e); }
});

router.post('/billing/manual-payment', async (req, res, next) => {
  try {
    const { userId, productId, amount, paidAt, memo, buyerName, phone } = req.body || {};
    if (!userId || !productId) return res.status(400).json({ error: 'userId, productId 필수' });
    const payment = await createManualPayment({ userId, productId, amount, paidAt, memo, buyerName, phone });
    res.status(201).json(redactPayment(payment));
  } catch (e) { next(e); }
});

router.post('/billing/expire-due', async (req, res, next) => {
  try {
    const expired = await expireDueEntitlements();
    res.json({ expiredCount: expired.length, expired });
  } catch (e) { next(e); }
});

router.get('/announcements', async (req, res, next) => {
  try {
    res.json(await dbList('announcements', {}, { order: 'created_at', ascending: false }));
  } catch (e) { next(e); }
});

router.post('/announcements', async (req, res, next) => {
  try {
    const { title, message, status = 'draft', starts_at, startsAt, ends_at, endsAt } = req.body || {};
    if (!String(title || '').trim() || !String(message || '').trim()) {
      return res.status(400).json({ error: 'title, message 필수' });
    }
    const row = await dbInsert('announcements', {
      title: String(title).trim(),
      message: String(message).trim(),
      status: ['draft', 'active', 'inactive'].includes(status) ? status : 'draft',
      audience: 'all',
      starts_at: starts_at || startsAt || null,
      ends_at: ends_at || endsAt || null
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch('/announcements/:id', async (req, res, next) => {
  try {
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title || '').trim();
    if (req.body.message !== undefined) patch.message = String(req.body.message || '').trim();
    if (req.body.status !== undefined && ['draft', 'active', 'inactive'].includes(req.body.status)) patch.status = req.body.status;
    if (req.body.starts_at !== undefined || req.body.startsAt !== undefined) patch.starts_at = req.body.starts_at || req.body.startsAt || null;
    if (req.body.ends_at !== undefined || req.body.endsAt !== undefined) patch.ends_at = req.body.ends_at || req.body.endsAt || null;
    if (patch.title === '' || patch.message === '') return res.status(400).json({ error: 'title, message 필수' });
    const [updated] = await dbUpdate('announcements', { id: req.params.id }, patch);
    if (!updated) return res.status(404).json({ error: 'Announcement not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/announcements/:id', async (req, res, next) => {
  try {
    await dbDelete('announcements', { id: req.params.id });
    res.status(204).end();
  } catch (e) { next(e); }
});

// 구매자 생성
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, maxAccounts = 2, buyerName, buyer_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email, password 필수' });
    const user = await createUser(email, password, maxAccounts, buyerName ?? buyer_name ?? '');
    res.status(201).json({ ...user, password_hash: undefined });
  } catch (e) { next(e); }
});

// 구매자 수정 (상태, 계정 한도)
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { status, maxAccounts, password, buyerName, buyer_name } = req.body;
    const patch = {};
    if (status) patch.status = status;
    if (maxAccounts != null) patch.max_accounts = maxAccounts;
    const buyerNameValue = buyerName ?? buyer_name;
    if (buyerNameValue !== undefined) patch.buyer_name = String(buyerNameValue || '').trim() || null;
    if (password) patch.password_hash = hashPassword(password);
    const [updated] = await updateUser(req.params.id, patch);
    res.json({ ...updated, password_hash: undefined });
  } catch (e) { next(e); }
});

router.post('/users/:id/plan', async (req, res, next) => {
  try {
    const { plan } = req.body || {};
    const user = await dbGet('users', { id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const patchByPlan = {
      free: { status: 'active', plan: 'free', billing_status: 'none', paid_until: null },
      onetime: { status: 'active', plan: 'onetime', billing_status: 'paid', paid_until: null },
      monthly: { status: 'active', plan: 'monthly', billing_status: 'active', paid_until: in30Days },
      suspended: { status: 'suspended' }
    };
    const patch = patchByPlan[plan];
    if (!patch) return res.status(400).json({ error: 'plan must be free, onetime, monthly, or suspended' });
    const [updated] = await dbUpdate('users', { id: req.params.id }, patch);
    if (plan === 'suspended') {
      await grantUserProduct(req.params.id, 'cujasa', { status: 'suspended', role: 'customer' });
    } else {
      await grantUserProduct(req.params.id, 'cujasa', { status: 'active', role: 'customer' });
    }
    res.json({ ...updated, password_hash: undefined });
  } catch (e) { next(e); }
});

// 계정 할당
router.post('/users/:id/accounts', async (req, res, next) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId 필수' });
    const user = await dbGet('users', { id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const existing = await dbList('user_accounts', { user_id: req.params.id });
    if (existing.length >= user.max_accounts) {
      return res.status(403).json({ error: `계정 한도 초과 (최대 ${user.max_accounts}개)` });
    }
    const assignedElsewhere = await dbList('user_accounts', { account_id: accountId });
    const otherOwner = assignedElsewhere.find((row) => row.user_id !== req.params.id);
    if (otherOwner) {
      return res.status(409).json({ error: '이미 다른 고객에게 할당된 계정입니다.' });
    }
    const ua = await dbInsert('user_accounts', { user_id: req.params.id, account_id: accountId });
    res.status(201).json(ua);
  } catch (e) { next(e); }
});

// 계정 할당 해제
router.delete('/users/:id/accounts/:accountId', async (req, res, next) => {
  try {
    await dbDelete('user_accounts', { user_id: req.params.id, account_id: req.params.accountId });
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/users/:id/products', async (req, res, next) => {
  try {
    const { productId, status = 'active', role = 'customer' } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId 필수' });
    const user = await dbGet('users', { id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const grant = await grantUserProduct(req.params.id, productId, { status, role });
    res.status(201).json(grant);
  } catch (e) { next(e); }
});

router.delete('/users/:id/products/:productId', async (req, res, next) => {
  try {
    await revokeUserProduct(req.params.id, req.params.productId);
    res.status(204).end();
  } catch (e) { next(e); }
});

router.get('/users/:id/products/:productId/settings/:field', async (req, res, next) => {
  try {
    if (req.params.productId !== 'cujasa') {
      return res.status(400).json({ error: 'CUJASA 제품 설정만 지원합니다.' });
    }
    if (!revealableProductSettingFields.has(req.params.field)) {
      return res.status(400).json({ error: '지원하지 않는 민감 필드입니다.' });
    }
    const grant = await dbGet('user_products', { user_id: req.params.id, product_id: req.params.productId });
    if (!grant) return res.status(404).json({ error: 'Product grant not found' });
    const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
    res.json({ field: req.params.field, value: settings[req.params.field] || '' });
  } catch (e) { next(e); }
});

router.patch('/users/:id/products/:productId/settings', async (req, res, next) => {
  try {
    const updated = await updateUserProductSettings(req.params.id, req.params.productId, req.body || {});
    const settings = updated.settings && typeof updated.settings === 'object' ? updated.settings : {};
    res.json({
      productId: req.params.productId,
      settingsSummary: redactBillingSettings(settings),
      settings: redactBillingSettings(settings)
    });
  } catch (e) { next(e); }
});

router.get('/users/:id/products/polibot/catalog-reviews', async (req, res, next) => {
  try {
    res.json(await listPolibotCatalogReview(req.params.id));
  } catch (e) { next(e); }
});

router.patch('/users/:id/products/polibot/catalog-reviews', async (req, res, next) => {
  try {
    await savePolibotCatalogReviews(req.params.id, req.body?.reviews || {});
    res.json(await listPolibotCatalogReview(req.params.id));
  } catch (e) { next(e); }
});

export default router;
