import { safeSendNotification, sendEmailNotification } from './notificationService.js';
import { dbGet, dbList, logActivity } from './supabaseService.js';

const SUPPORT_REPORT_EMAIL = 'dypapa0309@gmail.com';

function trim(value, max = 1200) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export async function createCustomerErrorReport(user = {}, body = {}) {
  const accountId = body.accountId || body.account_id || null;
  const account = accountId ? await dbGet('accounts', { id: accountId }).catch(() => null) : null;
  if (user?.type === 'user' && accountId && !user.allowedAccountIds?.includes(accountId)) {
    const error = new Error('Access denied');
    error.status = 403;
    throw error;
  }
  const appUser = user?.userId ? await dbGet('users', { id: user.userId }).catch(() => null) : null;
  const queue = body.queueId ? await dbGet('post_queue', { id: body.queueId }).catch(() => null) : null;
  const recentRuns = accountId ? await dbList('pipeline_runs', { account_id: accountId }, { order: 'started_at', ascending: false, limit: 3 }).catch(() => []) : [];
  const payload = {
    recipientEmail: SUPPORT_REPORT_EMAIL,
    userEmail: appUser?.email || user?.email || body.userEmail || null,
    buyerName: appUser?.buyer_name || body.buyerName || null,
    username: appUser?.username || user?.username || null,
    accountId,
    accountName: account?.name || body.accountName || null,
    accountHandle: account?.account_handle || body.accountHandle || null,
    page: trim(body.page || body.path || '', 300),
    message: trim(body.message || body.errorMessage || ''),
    code: trim(body.code || body.errorCode || '', 120),
    note: trim(body.note || '', 800),
    queueId: body.queueId || null,
    pipelineRunId: body.pipelineRunId || body.runId || null,
    browserTime: body.browserTime || null,
    apiSummary: body.apiSummary || null,
    queueStatus: queue?.status || null,
    latestPipelineRuns: recentRuns.map((run) => ({
      id: run.id,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      errorMessage: run.error_message
    }))
  };
  const message = [
    '[CUJASA 고객 오류 신고]',
    `받는 이메일: ${SUPPORT_REPORT_EMAIL}`,
    `고객: ${payload.buyerName || '-'} (${payload.userEmail || '-'})`,
    `계정: ${payload.accountName || '-'} ${payload.accountHandle || ''}`.trim(),
    payload.code ? `코드: ${payload.code}` : null,
    `화면: ${payload.page || '-'}`,
    `내용: ${payload.message || '-'}`,
    payload.note ? `고객 메모: ${payload.note}` : null
  ].filter(Boolean).join('\n');

  const notification = await safeSendNotification('customer_error_reported', message, payload);
  const emailNotification = await sendEmailNotification(
    'customer_error_report_email',
    SUPPORT_REPORT_EMAIL,
    '[CUJASA] 고객 오류 신고',
    message,
    payload
  ).catch(() => null);
  await logActivity({
    account_id: accountId,
    project_id: account?.project_id || null,
    action: 'customer_error_reported',
    level: 'warn',
    message: payload.message || '고객 오류 신고',
    payload
  }).catch(() => null);
  return {
    ok: true,
    recipientEmail: SUPPORT_REPORT_EMAIL,
    notificationId: notification?.id || null,
    emailStatus: emailNotification?.status || 'failed',
    message: '관리자에게 전달했습니다. 확인 후 안내드릴게요.'
  };
}
