import { dbList } from './supabaseService.js';
import { sendOpsAlert } from './notificationService.js';
import { isAutomationRunning } from './accountAutomationService.js';
import { isRealCoupangProduct } from '../utils/productQuality.js';

const ACTIVE_QUEUE_STATUSES = new Set(['scheduled', 'posting', 'retry']);
const PROBLEM_QUEUE_STATUSES = new Set(['failed', 'retry', 'manual_required']);

function accountLabel(account = {}) {
  return `${account.name || '이름 없음'} ${account.account_handle || ''}`.trim();
}

function topLines(rows, formatter, limit = 5) {
  if (!rows.length) return ['없음'];
  const lines = rows.slice(0, limit).map(formatter);
  if (rows.length > limit) lines.push(`외 ${rows.length - limit}건`);
  return lines;
}

function hasCooldown(account = {}) {
  return account.coupang_search_status === 'rate_limited'
    && new Date(account.coupang_search_cooldown_until || 0).getTime() > Date.now();
}

function selectedRealCountForAccount(account, topics, products, postProducts) {
  const topicIds = new Set(topics.filter((topic) => topic.account_id === account.id).map((topic) => topic.id));
  const productsById = new Map(products.filter((product) => product.account_id === account.id).map((product) => [product.id, product]));
  return postProducts.filter((row) => topicIds.has(row.topic_id) && isRealCoupangProduct(productsById.get(row.product_id))).length;
}

export async function buildOpsHealthSummary() {
  const [accounts, queue, topics, products, postProducts] = await Promise.all([
    dbList('accounts'),
    dbList('post_queue'),
    dbList('topics'),
    dbList('coupang_products'),
    dbList('post_products')
  ]);
  const activeAccounts = accounts.filter((account) => account.status === 'active');
  const activeAccountIds = new Set(activeAccounts.map((account) => account.id));
  const runningAccounts = activeAccounts.filter(isAutomationRunning);
  const activeQueue = queue.filter((row) => activeAccountIds.has(row.account_id) && ACTIVE_QUEUE_STATUSES.has(row.status));
  const problemQueue = queue.filter((row) => activeAccountIds.has(row.account_id) && PROBLEM_QUEUE_STATUSES.has(row.status));
  const coupangLimited = activeAccounts.filter(hasCooldown);
  const threadsReconnect = activeAccounts.filter((account) => !account.threads_access_token || account.threads_token_status === 'refresh_failed');
  const linkNeedsProduct = activeAccounts.filter((account) => {
    const linkRatio = Number(account.link_post_ratio || 0);
    if (linkRatio <= 0) return false;
    return selectedRealCountForAccount(account, topics, products, postProducts) === 0;
  });

  return {
    counts: {
      activeAccounts: activeAccounts.length,
      runningAccounts: runningAccounts.length,
      activeQueue: activeQueue.length,
      scheduledQueue: activeQueue.filter((row) => row.status === 'scheduled').length,
      postingQueue: activeQueue.filter((row) => row.status === 'posting').length,
      retryQueue: activeQueue.filter((row) => row.status === 'retry').length,
      problemQueue: problemQueue.length,
      manualRequiredQueue: problemQueue.filter((row) => row.status === 'manual_required').length,
      failedQueue: problemQueue.filter((row) => row.status === 'failed').length,
      coupangLimited: coupangLimited.length,
      threadsReconnect: threadsReconnect.length,
      linkNeedsProduct: linkNeedsProduct.length
    },
    coupangLimited,
    threadsReconnect,
    linkNeedsProduct,
    problemQueue
  };
}

export async function runDailyOpsHealthCheck() {
  const summary = await buildOpsHealthSummary();
  const c = summary.counts;
  const message = [
    `활성 계정 ${c.activeAccounts}개 · 자동화 running ${c.runningAccounts}개`,
    `활성 큐 ${c.activeQueue}개 (scheduled ${c.scheduledQueue}, posting ${c.postingQueue}, retry ${c.retryQueue})`,
    `문제 큐 ${c.problemQueue}개 (failed ${c.failedQueue}, manual_required ${c.manualRequiredQueue})`,
    `쿠팡 제한 ${c.coupangLimited}개 · Threads 재연결 ${c.threadsReconnect}개 · 실상품 필요 ${c.linkNeedsProduct}개`,
    '',
    '[쿠팡 제한]',
    ...topLines(summary.coupangLimited, (account) => `- ${accountLabel(account)} · ${account.coupang_search_cooldown_until || 'cooldown'}`),
    '',
    '[Threads 재연결]',
    ...topLines(summary.threadsReconnect, (account) => `- ${accountLabel(account)}`),
    '',
    '[실상품 링크 필요]',
    ...topLines(summary.linkNeedsProduct, (account) => `- ${accountLabel(account)} · 링크 비율 ${Math.round(Number(account.link_post_ratio || 0) * 100)}%`)
  ].join('\n');

  await sendOpsAlert('daily_ops_healthcheck', {
    title: '일일 운영 헬스체크',
    message,
    code: c.coupangLimited || c.threadsReconnect || c.linkNeedsProduct || c.problemQueue ? 'OPS_ATTENTION' : 'OPS_OK',
    hint: '문제 계정은 관리자 대시보드에서 상세 상태를 확인하세요.',
    payload: { counts: c }
  });
  return summary;
}
