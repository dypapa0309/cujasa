import { dbGet, dbList, dbUpdate, logActivity } from './supabaseService.js';
import { normalizeQueueClassification } from './queueErrorService.js';
import { validatePostCandidate } from '../utils/contentGuardrails.js';
import { isRealCoupangProduct, realProductIssues } from '../utils/productQuality.js';
import { evaluateProductTopicMatch } from '../utils/productMatching.js';
import { extractThreadsPostIdentifier, threadsPostUrlStatus } from '../utils/threadsPostUrl.js';
import { fetchThreadsPostPermalink } from '../platformAdapters/threadsAdapter.js';

function statusLabel(value) {
  const status = String(value || '').toLowerCase();
  if (status === 'posted') return '완료';
  if (status === 'scheduled') return '예약';
  if (status === 'posting') return '업로드 중';
  if (status === 'retry') return '재시도 대기';
  if (status === 'manual_required') return '확인 필요';
  if (status === 'failed') return '실패';
  if (status === 'skipped') return '제외';
  return value || '미정';
}

function nextActionFor(classification, row = {}, urlStatus = null) {
  if (urlStatus && !urlStatus.trusted && row.status === 'posted') {
    return urlStatus.nextAction;
  }
  if (classification.category === 'reply_permission_required') {
    return 'Meta 앱 권한 확인 후 Threads 재연결';
  }
  if (classification.category === 'threads_reply_target_invalid') {
    return '게시글 ID/큐 수동 정리';
  }
  if (classification.category === 'reply_repair_blocked') {
    return '게시글 URL, 상품, 트래킹 링크 확인';
  }
  if (classification.category === 'reply_warning') {
    return row.post_url ? '댓글 링크 복구 실행' : 'Threads 게시글 URL 확인';
  }
  if (classification.category === 'coupang_link_missing') {
    return '쿠팡 실상품 재매칭';
  }
  if (classification.category === 'content_blocked') {
    return '본문/금지어/톤 수정';
  }
  if (classification.category === 'threads_reconnect_required') {
    return 'Threads 계정 재연결';
  }
  if (row.status === 'posted') return '조치 없음';
  if (row.status === 'scheduled') return '예약 대기';
  return '운영자 확인';
}

function replyStatus(row, classification, urlStatus = null) {
  const mode = row.post_mode || 'auto';
  if (mode !== 'link') return '댓글 링크 대상 아님';
  if (classification.category === 'reply_permission_required') return '댓글 권한 필요';
  if (classification.category === 'threads_reply_target_invalid') return '댓글 복구 불가';
  if (['reply_warning', 'reply_repair_blocked'].includes(classification.category)) return '댓글 실패';
  if (row.status === 'posted' && row.post_url && urlStatus?.trusted) return '댓글 성공 또는 오류 없음';
  if (row.status === 'posted' && row.post_url && !urlStatus?.trusted) return 'Threads 링크 확인 필요';
  if (['scheduled', 'posting', 'retry'].includes(row.status)) return '댓글 대기';
  return '확인 필요';
}

function compactProduct(product, postProduct = {}, topic = {}, account = {}) {
  if (!product) {
    return {
      ok: false,
      name: null,
      reason: '연결 상품 없음',
      issues: ['missing_product']
    };
  }
  const issues = realProductIssues(product);
  const match = topic?.id ? evaluateProductTopicMatch(product, topic, account) : {
    score: 0,
    matchReasons: [],
    riskReasons: issues,
    linkable: issues.length === 0
  };
  return {
    ok: issues.length === 0 && match.linkable,
    id: product.id,
    productId: product.product_id,
    name: product.product_name,
    price: product.product_price,
    image: product.product_image,
    partnerUrl: product.partner_url || product.product_url,
    reason: postProduct.recommendation_reason || '',
    fitScore: Number(postProduct.fit_score || 0),
    matchScore: match.score,
    matchReasons: match.matchReasons,
    issues: [...new Set([...issues, ...match.riskReasons])]
  };
}

async function productsForTopic(topicId, account) {
  if (!topicId) return [];
  const topic = await dbGet('topics', { id: topicId });
  const rows = await dbList('post_products', { topic_id: topicId }, { order: 'rank', ascending: true });
  const products = [];
  for (const row of rows) {
    const product = row.product_id ? await dbGet('coupang_products', { id: row.product_id }) : null;
    products.push(compactProduct(product, row, topic || {}, account || {}));
  }
  return products;
}

async function decorateQueueRow(row, account) {
  const post = row.post_id ? await dbGet('posts', { id: row.post_id }) : null;
  const topic = row.topic_id ? await dbGet('topics', { id: row.topic_id }) : null;
  const products = await productsForTopic(row.topic_id || post?.topic_id, account);
  const realProducts = products.filter((product) => product.ok);
  const classification = normalizeQueueClassification(row);
  const guardrail = post?.body ? validatePostCandidate(post.body, account, topic || {}) : { allowed: false, reasons: ['post_missing'] };
  const qualityGate = post?.metadata?.qualityGate || post?.metadata?.quality_gate || null;
  const urlStatus = threadsPostUrlStatus(row.post_url);

  return {
    id: row.id,
    postId: row.post_id,
    topicId: row.topic_id || post?.topic_id || null,
    topicTitle: topic?.title || '',
    scheduledAt: row.scheduled_at,
    postedAt: row.posted_at,
    status: row.status,
    statusLabel: statusLabel(row.status),
    postMode: row.post_mode || 'auto',
    quality: {
      ok: Boolean(post?.body) && guardrail.allowed && qualityGate?.passed !== false,
      guardrailAllowed: guardrail.allowed,
      guardrailReasons: guardrail.reasons || [],
      score: qualityGate?.score ?? post?.metadata?.qualityScore ?? null,
      gatePassed: qualityGate?.passed ?? null
    },
    productMatching: {
      ok: realProducts.length > 0,
      count: products.length,
      realCount: realProducts.length,
      products
    },
    upload: {
      bodyUploaded: Boolean(row.post_url || row.status === 'posted'),
      postUrl: urlStatus.trusted ? row.post_url : null,
      storedPostUrl: row.post_url || null,
      urlStatus
    },
    reply: {
      status: replyStatus(row, classification, urlStatus),
      classification
    },
    failure: row.error_message ? {
      category: classification.category,
      title: classification.title,
      message: row.error_message,
      friendlyMessage: classification.message
    } : null,
    nextAction: nextActionFor(classification, row, urlStatus)
  };
}

export async function buildCujasaQueueDiagnostics(accountId, options = {}) {
  const account = await dbGet('accounts', { id: accountId });
  if (!account) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const limit = Math.max(1, Math.min(100, Number(options.limit || 30)));
  const queues = await dbList('post_queue', { account_id: accountId }, { order: 'created_at', ascending: false, limit });
  const rows = [];
  for (const queue of queues) {
    rows.push(await decorateQueueRow(queue, account));
  }
  const summary = {
    total: rows.length,
    linkRows: rows.filter((row) => row.postMode === 'link').length,
    productMatched: rows.filter((row) => row.productMatching.ok).length,
    replyPermissionRequired: rows.filter((row) => row.reply.classification.category === 'reply_permission_required').length,
    replyTargetInvalid: rows.filter((row) => row.reply.classification.category === 'threads_reply_target_invalid').length,
    untrustedPostUrls: rows.filter((row) => row.upload.urlStatus && !row.upload.urlStatus.trusted && row.upload.storedPostUrl).length,
    needsAction: rows.filter((row) => row.failure || ['manual_required', 'failed', 'retry'].includes(row.status)).length
  };
  return {
    account: {
      id: account.id,
      name: account.name,
      handle: account.account_handle,
      threadsLinkDeliveryMode: account.threads_link_delivery_mode,
      threadsTokenStatus: account.threads_token_status || null
    },
    summary,
    rows
  };
}

export async function repairThreadsPostUrls(options = {}) {
  const filters = options.accountId ? { account_id: options.accountId } : {};
  const rows = await dbList('post_queue', filters, { order: 'updated_at', ascending: false, limit: Math.max(1, Math.min(500, Number(options.limit || 250))) });
  const dryRun = options.dryRun !== false;
  const accounts = await dbList('accounts');
  const accountById = new Map(accounts.map((account) => [account.id, account]));
  const changed = [];
  const skipped = [];
  for (const row of rows) {
    const status = threadsPostUrlStatus(row.post_url);
    if (status.trusted || status.status !== 'numeric_media_id') continue;
    const account = accountById.get(row.account_id);
    const postId = extractThreadsPostIdentifier(row.post_url);
    if (!account?.threads_access_token || !postId) {
      skipped.push({ id: row.id, reason: !postId ? 'post_id_missing' : 'threads_token_missing', postUrl: row.post_url });
      continue;
    }
    const result = await fetchThreadsPostPermalink(account, postId).catch((error) => ({ error }));
    if (!result?.postUrl) {
      skipped.push({ id: row.id, reason: result?.error?.message || 'permalink_not_found', postUrl: row.post_url });
      continue;
    }
    const item = { id: row.id, previousPostUrl: row.post_url, nextPostUrl: result.postUrl };
    changed.push(item);
    if (!dryRun) {
      await dbUpdate('post_queue', { id: row.id }, { post_url: result.postUrl });
      await logActivity({
        account_id: row.account_id,
        project_id: row.project_id,
        topic_id: row.topic_id,
        post_id: row.post_id,
        queue_id: row.id,
        action: 'threads_post_url_repaired',
        level: 'info',
        message: result.postUrl,
        payload: item
      }).catch(() => null);
    }
  }
  return {
    ok: true,
    dryRun,
    scanned: rows.length,
    changedCount: changed.length,
    skippedCount: skipped.length,
    changed,
    skipped
  };
}

export async function reclassifyQueueErrors(options = {}) {
  const filters = options.accountId ? { account_id: options.accountId } : {};
  const rows = await dbList('post_queue', filters, { order: 'updated_at', ascending: false, limit: Math.max(1, Math.min(500, Number(options.limit || 250))) });
  const dryRun = options.dryRun !== false;
  const changed = [];
  for (const row of rows) {
    if (!row.error_message && !row.error_category) continue;
    const classification = normalizeQueueClassification(row);
    if (classification.category === row.error_category) continue;
    const item = {
      id: row.id,
      accountId: row.account_id,
      postId: row.post_id,
      previousCategory: row.error_category || null,
      nextCategory: classification.category,
      title: classification.title,
      status: row.status
    };
    changed.push(item);
    if (!dryRun) {
      await dbUpdate('post_queue', { id: row.id }, { error_category: classification.category });
      await logActivity({
        account_id: row.account_id,
        project_id: row.project_id,
        topic_id: row.topic_id,
        post_id: row.post_id,
        queue_id: row.id,
        action: 'queue_error_reclassified',
        level: classification.severity === 'error' ? 'error' : 'warn',
        message: `${item.previousCategory || 'none'} -> ${item.nextCategory}`,
        payload: item
      }).catch(() => null);
    }
  }
  return {
    ok: true,
    dryRun,
    scanned: rows.length,
    changedCount: changed.length,
    changed
  };
}
