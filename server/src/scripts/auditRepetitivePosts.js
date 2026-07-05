import 'dotenv/config';
import { dbGet, dbList, dbUpdate, logActivity } from '../services/supabaseService.js';
import { assessContentPatternQuality } from '../utils/contentPatternQuality.js';
import { scorePostEngagement, scorePostSimilarity } from '../utils/postEngagementScoring.js';
import { evaluatePostQualityGate } from '../utils/postQualityGate.js';

const args = new Set(process.argv.slice(2));
const accountId = valueAfter('--account-id');
const statuses = csvArg('--statuses', 'posted,scheduled,retry,draft');
const queueStatuses = statuses.filter((status) => !['draft', 'queued'].includes(status));
const postStatuses = statuses.filter((status) => ['draft', 'queued', 'posted'].includes(status));
const scanLimit = Math.max(1, Math.min(Number(valueAfter('--limit') || 2000), 5000));
const rawDays = valueAfter('--days');
const allTime = args.has('--all-time') || rawDays === '0';
const days = allTime ? null : Math.max(1, Math.min(Number(rawDays || 30), 365));
const includeHidden = args.has('--include-hidden');
const includeBody = args.has('--include-body');
const summaryOnly = args.has('--summary-only');
const includeCrossAccount = !args.has('--no-cross-account');
const apply = args.has('--apply');
const markDraftsManual = args.has('--mark-drafts-manual') || args.has('--archive-drafts');
const hidePosted = args.has('--hide-posted');
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const cutoffMs = days ? Date.now() - days * MS_PER_DAY : 0;

const accountCache = new Map();
const postCache = new Map();

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : '';
}

function csvArg(flag, fallback) {
  return String(valueAfter(flag) || fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalizeBodyForExact(body = '') {
  return String(body || '')
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim()
    .toLowerCase();
}

function bodyPreview(body = '') {
  return String(body || '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

function recordTimeMs(record = {}) {
  return new Date(record.postedAt || record.scheduledAt || record.updatedAt || record.createdAt || 0).getTime();
}

function withinWindow(record = {}) {
  if (!cutoffMs) return true;
  const time = recordTimeMs(record);
  return Number.isFinite(time) && time >= cutoffMs;
}

async function getAccount(id) {
  if (!id) return null;
  if (!accountCache.has(id)) {
    accountCache.set(id, await dbGet('accounts', { id }).catch(() => null));
  }
  return accountCache.get(id);
}

async function getPost(id) {
  if (!id) return null;
  if (!postCache.has(id)) {
    postCache.set(id, await dbGet('posts', { id }).catch(() => null));
  }
  return postCache.get(id);
}

async function queueRecords() {
  if (!queueStatuses.length) return [];
  const rows = await dbList('post_queue', accountId ? { account_id: accountId } : {}, {
    order: 'updated_at',
    ascending: false,
    limit: scanLimit,
    in: { status: queueStatuses }
  });
  const records = [];
  for (const row of rows) {
    if (!includeHidden && row.customer_hidden_at) continue;
    const [post, account] = await Promise.all([
      getPost(row.post_id),
      getAccount(row.account_id)
    ]);
    const record = {
      source: 'queue',
      status: row.status,
      accountId: row.account_id,
      accountName: account?.name || null,
      accountHandle: account?.account_handle || null,
      queueId: row.id,
      postId: row.post_id,
      topicId: row.topic_id || post?.topic_id || null,
      postStatus: post?.status || null,
      body: post?.body || '',
      scheduledAt: row.scheduled_at || null,
      postedAt: row.posted_at || null,
      createdAt: row.created_at || post?.created_at || null,
      updatedAt: row.updated_at || post?.updated_at || null,
      customerHidden: Boolean(row.customer_hidden_at),
      issues: []
    };
    if (withinWindow(record)) records.push(record);
  }
  return records;
}

async function postOnlyRecords(seenPostIds = new Set()) {
  if (!postStatuses.length) return [];
  const rows = await dbList('posts', accountId ? { account_id: accountId } : {}, {
    order: 'updated_at',
    ascending: false,
    limit: scanLimit,
    in: { status: postStatuses }
  });
  const records = [];
  for (const post of rows) {
    if (seenPostIds.has(post.id)) continue;
    const account = await getAccount(post.account_id);
    const record = {
      source: 'post',
      status: post.status,
      accountId: post.account_id,
      accountName: account?.name || null,
      accountHandle: account?.account_handle || null,
      queueId: null,
      postId: post.id,
      topicId: post.topic_id || null,
      postStatus: post.status,
      body: post.body || '',
      scheduledAt: null,
      postedAt: post.posted_at || null,
      createdAt: post.created_at || null,
      updatedAt: post.updated_at || null,
      customerHidden: false,
      issues: []
    };
    if (withinWindow(record)) records.push(record);
  }
  return records;
}

function addIssue(record, issue) {
  record.issues.push(issue);
}

function addIndividualIssues(record) {
  const body = String(record.body || '');
  if (!body.trim()) {
    addIssue(record, { type: 'missing_body', severity: 'high' });
    return;
  }
  const patternQuality = assessContentPatternQuality(body);
  if (patternQuality.repetitiveMatches?.length) {
    addIssue(record, {
      type: 'repetitive_template',
      severity: 'high',
      ruleIds: patternQuality.repetitiveMatches.map((match) => match.id),
      labels: patternQuality.repetitiveMatches.map((match) => match.label)
    });
  }
  const engagement = scorePostEngagement(body);
  const qualityGate = evaluatePostQualityGate(engagement);
  const repetitionReasons = (qualityGate.reasons || []).filter((reason) => /반복|유사/.test(reason));
  if (repetitionReasons.length && !record.issues.some((issue) => issue.type === 'repetitive_template')) {
    addIssue(record, {
      type: 'quality_gate_repetition',
      severity: 'medium',
      reasons: repetitionReasons,
      score: engagement.engagementScore
    });
  }
}

function compareAccountRecords(records = []) {
  const groups = new Map();
  for (const record of records) {
    if (!record.accountId || !record.body) continue;
    if (!groups.has(record.accountId)) groups.set(record.accountId, []);
    groups.get(record.accountId).push(record);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => recordTimeMs(a) - recordTimeMs(b));
    for (let index = 1; index < sorted.length; index += 1) {
      const current = sorted[index];
      let bestNearDuplicate = null;
      const currentExact = normalizeBodyForExact(current.body);
      if (!currentExact || currentExact.length < 20) continue;
      for (let priorIndex = 0; priorIndex < index; priorIndex += 1) {
        const prior = sorted[priorIndex];
        const priorExact = normalizeBodyForExact(prior.body);
        if (!priorExact || priorExact.length < 20) continue;
        if (currentExact === priorExact) {
          bestNearDuplicate = {
            type: 'exact_duplicate_account',
            severity: 'critical',
            matchedRecordId: prior.recordId,
            matchedPostId: prior.postId,
            matchedQueueId: prior.queueId,
            matchedStatus: prior.status
          };
          break;
        }
        const similarity = scorePostSimilarity(current.body, [prior.body]);
        if (!similarity.duplicateRisk) continue;
        if (!bestNearDuplicate || similarity.duplicateSignal > bestNearDuplicate.duplicateSignal) {
          bestNearDuplicate = {
            type: 'near_duplicate_account',
            severity: 'high',
            duplicateSignal: similarity.duplicateSignal,
            duplicateSimilarity: similarity.maxSimilarity,
            duplicateTokenOverlap: similarity.maxTokenOverlap,
            matchedRecordId: prior.recordId,
            matchedPostId: prior.postId,
            matchedQueueId: prior.queueId,
            matchedStatus: prior.status
          };
        }
      }
      if (bestNearDuplicate) addIssue(current, bestNearDuplicate);
    }
  }
}

function compareGlobalExactDuplicates(records = []) {
  if (!includeCrossAccount) return;
  const groups = new Map();
  for (const record of records) {
    const key = normalizeBodyForExact(record.body);
    if (!key || key.length < 20) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => recordTimeMs(a) - recordTimeMs(b));
    const first = sorted[0];
    for (const record of sorted.slice(1)) {
      if (record.accountId === first.accountId) continue;
      addIssue(record, {
        type: 'exact_duplicate_global',
        severity: 'high',
        matchedRecordId: first.recordId,
        matchedPostId: first.postId,
        matchedQueueId: first.queueId,
        matchedAccountId: first.accountId,
        matchedStatus: first.status
      });
    }
  }
}

function recommendedAction(record) {
  if (!record.issues.length) return null;
  if (record.source === 'queue' && ['scheduled', 'retry'].includes(record.status)) return 'regenerate_queue';
  if (record.source === 'post' && ['draft', 'queued'].includes(record.status)) return 'mark_post_manual_required';
  if (record.status === 'posted') return 'review_hide_or_delete_posted';
  if (record.status === 'manual_required') return 'manual_review_before_requeue';
  return 'manual_review';
}

function draftCleanupTargets(records = []) {
  return records.filter((record) => (
    record.source === 'post'
    && ['draft', 'queued'].includes(record.status)
    && record.postId
    && record.issues.some((issue) => issue.type !== 'missing_body')
  ));
}

function postedHideTargets(records = []) {
  return records.filter((record) => (
    record.source === 'queue'
    && record.status === 'posted'
    && record.queueId
    && !record.customerHidden
    && record.issues.some((issue) => issue.type !== 'missing_body')
  ));
}

async function applyDraftCleanup(issueRecords = []) {
  const targets = draftCleanupTargets(issueRecords);
  const base = {
    enabled: markDraftsManual,
    apply,
    targetCount: targets.length,
    updatedCount: 0,
    skippedCount: 0,
    updatedPostIds: []
  };
  if (!markDraftsManual || !apply) return base;
  for (const target of targets) {
    const post = await getPost(target.postId);
    const metadata = {
      ...(post?.metadata || {}),
      repetitionAudit: {
        flaggedAt: new Date().toISOString(),
        source: 'auditRepetitivePosts',
        previousStatus: target.status,
        issues: target.issues.map((issue) => ({
          type: issue.type,
          severity: issue.severity,
          ruleIds: issue.ruleIds || undefined,
          matchedPostId: issue.matchedPostId || undefined
        }))
      }
    };
    const [updated] = await dbUpdate('posts', { id: target.postId, status: target.status }, {
      status: 'manual_required',
      metadata
    });
    if (updated) {
      base.updatedCount += 1;
      base.updatedPostIds.push(target.postId);
    } else {
      base.skippedCount += 1;
    }
  }
  return base;
}

async function applyPostedHide(issueRecords = []) {
  const targets = postedHideTargets(issueRecords);
  const base = {
    enabled: hidePosted,
    apply,
    targetCount: targets.length,
    updatedCount: 0,
    skippedCount: 0,
    hiddenQueueIds: []
  };
  if (!hidePosted || !apply) return base;
  const byAccount = new Map();
  for (const target of targets) {
    const [updated] = await dbUpdate('post_queue', { id: target.queueId, status: 'posted' }, {
      customer_hidden_at: new Date().toISOString(),
      customer_hidden_reason: 'repetitive_post_audit_hidden'
    });
    if (updated) {
      base.updatedCount += 1;
      base.hiddenQueueIds.push(target.queueId);
      if (!byAccount.has(target.accountId)) byAccount.set(target.accountId, { accountName: target.accountName, rows: [] });
      byAccount.get(target.accountId).rows.push(updated);
    } else {
      base.skippedCount += 1;
    }
  }
  for (const [targetAccountId, item] of byAccount.entries()) {
    await logActivity({
      account_id: targetAccountId,
      action: 'repetitive_post_history_hidden',
      level: 'info',
      message: `${item.rows.length}개의 반복 이력 포스트를 고객 화면에서 숨겼습니다.`,
      payload: {
        accountName: item.accountName,
        count: item.rows.length,
        reason: 'repetitive_post_audit_hidden'
      }
    }).catch(() => null);
  }
  return base;
}

function countBy(items = [], keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function summarize(records = []) {
  const issueRecords = records.filter((record) => record.issues.length);
  const issueCounts = countBy(issueRecords.flatMap((record) => record.issues), (issue) => issue.type);
  const byStatus = {};
  for (const record of records) {
    byStatus[record.status] ||= { total: 0, issueRecords: 0 };
    byStatus[record.status].total += 1;
    if (record.issues.length) byStatus[record.status].issueRecords += 1;
  }
  const accountRows = [];
  const byAccount = new Map();
  for (const record of records) {
    const key = record.accountId || 'unknown';
    if (!byAccount.has(key)) byAccount.set(key, []);
    byAccount.get(key).push(record);
  }
  for (const accountRecords of byAccount.values()) {
    const issueRows = accountRecords.filter((record) => record.issues.length);
    if (!accountRecords.length) continue;
    accountRows.push({
      accountId: accountRecords[0].accountId,
      accountName: accountRecords[0].accountName,
      accountHandle: accountRecords[0].accountHandle,
      total: accountRecords.length,
      issueRecords: issueRows.length,
      issueCounts: countBy(issueRows.flatMap((record) => record.issues), (issue) => issue.type)
    });
  }
  accountRows.sort((a, b) => b.issueRecords - a.issueRecords || b.total - a.total);
  return {
    totalRecords: records.length,
    issueRecords: issueRecords.length,
    issueCount: issueRecords.reduce((sum, record) => sum + record.issues.length, 0),
    issueCounts,
    byStatus,
    accounts: accountRows
  };
}

function printableRecord(record) {
  const base = {
    recordId: record.recordId,
    source: record.source,
    status: record.status,
    accountId: record.accountId,
    accountName: record.accountName,
    accountHandle: record.accountHandle,
    queueId: record.queueId,
    postId: record.postId,
    topicId: record.topicId,
    scheduledAt: record.scheduledAt,
    postedAt: record.postedAt,
    updatedAt: record.updatedAt,
    customerHidden: record.customerHidden,
    recommendedAction: recommendedAction(record),
    bodyPreview: bodyPreview(record.body),
    issues: record.issues
  };
  if (includeBody) base.body = record.body;
  return base;
}

async function main() {
  const queues = await queueRecords();
  const seenPostIds = new Set(queues.map((record) => record.postId).filter(Boolean));
  const posts = await postOnlyRecords(seenPostIds);
  const records = [...queues, ...posts].map((record, index) => ({
    recordId: `${record.source}:${record.queueId || record.postId || index}`,
    ...record
  }));

  for (const record of records) addIndividualIssues(record);
  compareAccountRecords(records);
  compareGlobalExactDuplicates(records);

  const issueRecords = records
    .filter((record) => record.issues.length)
    .sort((a, b) => recordTimeMs(b) - recordTimeMs(a));
  const cleanup = {
    drafts: await applyDraftCleanup(issueRecords),
    posted: await applyPostedHide(issueRecords)
  };
  const output = {
    mode: 'repetitive-post-audit',
    generatedAt: new Date().toISOString(),
    accountId: accountId || null,
    statuses,
    days,
    allTime,
    includeHidden,
    includeCrossAccount,
    apply,
    scanLimit,
    cleanup,
    ...summarize(records),
    records: summaryOnly ? undefined : issueRecords.map(printableRecord)
  };

  if (summaryOnly) delete output.records;
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    mode: 'repetitive-post-audit',
    error: error.message || String(error)
  }, null, 2));
  process.exitCode = 1;
});
