import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { sendOpsAlert } from './notificationService.js';

const execFileAsync = promisify(execFile);
const currentDir = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(currentDir, '..', '..');
const auditScriptPath = resolve(currentDir, '..', 'scripts', 'auditRepetitivePosts.js');

function parseAuditOutput(stdout = '') {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) throw new Error('Repetition guard produced no output');
  return JSON.parse(trimmed);
}

function cleanupCount(cleanup = {}) {
  return ['drafts', 'queues', 'posted'].reduce((sum, key) => (
    sum + Number(cleanup[key]?.updatedCount || 0)
  ), 0);
}

export async function runRepetitionGuard({
  triggeredBy = 'scheduler',
  statuses = 'scheduled,retry,draft',
  days = 30,
  limit = 3000
} = {}) {
  const args = [
    auditScriptPath,
    '--summary-only',
    '--statuses',
    statuses,
    '--days',
    String(days),
    '--limit',
    String(limit),
    '--mark-drafts-manual',
    '--mark-queues-manual',
    '--apply'
  ];
  const { stdout, stderr } = await execFileAsync(process.execPath, args, {
    cwd: serverRoot,
    env: process.env,
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024
  });
  const audit = parseAuditOutput(stdout);
  const blockedCount = cleanupCount(audit.cleanup);
  const queueBlockedCount = Number(audit.cleanup?.queues?.updatedCount || 0);
  const draftBlockedCount = Number(audit.cleanup?.drafts?.updatedCount || 0);
  if (blockedCount > 0) {
    await sendOpsAlert('repetition_guard_blocked_posts', {
      title: '반복 의심 콘텐츠 자동 차단',
      message: `반복 의심 예약/초안 ${blockedCount}건을 수동 검토로 전환했습니다.`,
      hint: '관리자 큐에서 repetitive_content_guard 항목을 확인하고 재작성 후 재예약하세요.',
      payload: {
        triggeredBy,
        statuses,
        days,
        limit,
        blockedCount,
        queueBlockedCount,
        draftBlockedCount,
        issueRecords: audit.issueRecords,
        issueCounts: audit.issueCounts,
        stderr: stderr?.trim() || undefined
      }
    }).catch(() => null);
  }
  return {
    ok: true,
    status: blockedCount > 0 ? 'blocked_repetitive_content' : 'clean',
    triggeredBy,
    blockedCount,
    queueBlockedCount,
    draftBlockedCount,
    issueRecords: audit.issueRecords,
    issueCounts: audit.issueCounts,
    cleanup: audit.cleanup,
    generatedAt: audit.generatedAt,
    stderr: stderr?.trim() || undefined
  };
}
