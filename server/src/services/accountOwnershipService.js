import { dbList } from './supabaseService.js';

function norm(value) {
  return String(value || '').trim().toLowerCase();
}

function normHandle(value) {
  return norm(value).replace(/^@/, '');
}

function compactTokens(value) {
  return norm(value)
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function userIdentityTokens(user) {
  const email = norm(user?.email);
  const emailLocal = email.includes('@') ? email.split('@')[0] : email;
  const buyerName = norm(user?.buyer_name || user?.buyerName);
  return unique([
    ...compactTokens(emailLocal),
    ...compactTokens(buyerName),
    emailLocal
  ]);
}

function accountIdentityTokens(account) {
  const handle = normHandle(account?.account_handle);
  const threadsUserId = normHandle(account?.threads_user_id);
  const name = norm(account?.name);
  return unique([
    ...compactTokens(name),
    ...compactTokens(handle),
    ...compactTokens(threadsUserId),
    handle,
    threadsUserId
  ]);
}

function scoreOwner(user, account) {
  const reasons = [];
  const uTokens = userIdentityTokens(user);
  const aTokens = accountIdentityTokens(account);
  const handle = normHandle(account?.account_handle);
  const name = norm(account?.name);
  let score = 0;

  for (const token of uTokens) {
    if (!token) continue;
    if (handle && handle === token) {
      score += 90;
      reasons.push(`핸들 일치(${token})`);
      continue;
    }
    if (name && name.includes(token)) {
      score += 55;
      reasons.push(`계정명 포함(${token})`);
      continue;
    }
    const aMatch = aTokens.find((aToken) => aToken.includes(token) || token.includes(aToken));
    if (aMatch && Math.min(token.length, aMatch.length) >= 4) {
      score += 25;
      reasons.push(`유사 토큰(${token}~${aMatch})`);
    }
  }

  const confidence = score >= 85 ? 'high' : score >= 50 ? 'medium' : 'low';
  return { score, confidence, reasons: unique(reasons) };
}

function classifyAssignment({ currentScore, bestCandidateScore, diff, overAssigned }) {
  if (bestCandidateScore >= 85 && currentScore <= 20) return '확정 분리 가능';
  if (bestCandidateScore >= 60 && currentScore <= 10 && diff >= 35) return '확정 분리 가능';
  if (overAssigned && currentScore <= 10) return '검토 필요';
  if (bestCandidateScore >= 45 && diff >= 20) return '검토 필요';
  return '정상';
}

function assignmentKey(userId, accountId) {
  return `${userId}:${accountId}`;
}

export function buildMisassignmentReportRows({ users, accounts, userAccounts, ignoredKeys = new Set() }) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  const assignmentCountByUser = new Map();
  for (const link of userAccounts) {
    assignmentCountByUser.set(link.user_id, (assignmentCountByUser.get(link.user_id) || 0) + 1);
  }
  const rows = [];

  for (const link of userAccounts) {
    if (ignoredKeys.has(assignmentKey(link.user_id, link.account_id))) continue;
    const user = usersById.get(link.user_id);
    const account = accountsById.get(link.account_id);
    if (!user || !account) continue;

    const current = scoreOwner(user, account);
    const candidates = users
      .map((candidate) => ({ user: candidate, ...scoreOwner(candidate, account) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const bestOther = candidates.find((item) => item.user.id !== user.id) || null;
    const top = bestOther && bestOther.score > best.score ? bestOther : best;
    const topOther = top?.user?.id === user.id ? bestOther : top;
    const bestCandidateScore = topOther?.score || 0;
    const diff = bestCandidateScore - current.score;
    const assignedCount = assignmentCountByUser.get(user.id) || 0;
    const maxAccounts = Number(user.max_accounts || user.maxAccounts || 0);
    const overAssigned = maxAccounts > 0 && assignedCount > maxAccounts;
    const classification = classifyAssignment({ currentScore: current.score, bestCandidateScore, diff, overAssigned });

    rows.push({
      linkId: link.id,
      userId: user.id,
      userEmail: user.email,
      buyerName: user.buyer_name || '',
      accountId: account.id,
      accountName: account.name,
      accountHandle: account.account_handle || '',
      threadsUserId: account.threads_user_id || '',
      currentScore: current.score,
      currentReasons: current.reasons,
      assignedCount,
      maxAccounts,
      overAssigned,
      recommendedOwner: topOther
        ? {
            userId: topOther.user.id,
            userEmail: topOther.user.email,
            buyerName: topOther.user.buyer_name || '',
            score: topOther.score,
            reasons: topOther.reasons
          }
        : null,
      diff,
      classification
    });
  }

  return rows;
}

export async function buildMisassignmentReport() {
  const [users, accounts, userAccounts, audits] = await Promise.all([
    dbList('users'),
    dbList('accounts'),
    dbList('user_accounts'),
    dbList('account_conflict_audits').catch(() => [])
  ]);
  const ignoredKeys = markedOkKeysFromAudits(audits);
  const rows = buildMisassignmentReportRows({ users, accounts, userAccounts, ignoredKeys });
  return {
    separable: rows.filter((row) => row.classification === '확정 분리 가능'),
    needsReview: rows.filter((row) => row.classification === '검토 필요'),
    healthy: rows.filter((row) => row.classification === '정상')
  };
}

export function isLikelyOwner(user, account) {
  return scoreOwner(user, account).score >= 30;
}

export function markedOkKeysFromAudits(audits = []) {
  return new Set(
    audits
      .filter((audit) => audit.conflict_type === 'assignment_marked_ok' && !audit.resolved_at)
      .map((audit) => audit.conflict_key)
  );
}

export function suspiciousAssignmentsForUser({ userId, users, accounts, userAccounts, ignoredKeys = new Set() }) {
  return buildMisassignmentReportRows({ users, accounts, userAccounts, ignoredKeys })
    .filter((row) => row.userId === userId && row.classification !== '정상');
}

export function shouldHideAssignment(row) {
  return row?.classification === '확정 분리 가능' || row?.classification === '검토 필요';
}
