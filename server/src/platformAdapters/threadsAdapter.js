import { isReplyLinkModeEnabled } from '../utils/replyLinkMode.js';
import { inspectGeneratedPostText } from '../utils/contentText.js';

const THREADS_API = 'https://graph.threads.net/v1.0';
const COUPANG_DISCLOSURE = '[광고] 이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';
const THREADS_TEXT_LIMIT = 500;

export function stripLinkCta(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line
      .replace(/자세한\s*건\s*아래\s*링크\s*확인!?/g, '')
      .replace(/아래.*링크.*확인!?/g, '')
      .replace(/댓글.*링크.*확인!?/g, '')
      .replace(/구매.*링크.*확인!?/g, '')
      .replace(/프로필.*링크.*확인!?/g, '')
      .replace(/링크\s*확인!?/g, '')
      .replace(/더\s*많은\s*(팁|정보|내용)이?\s*궁금하다면\.?/g, '')
      .replace(/댓글에서?\s*확인!?/g, '')
      .replace(/구매\s*링크|댓글\s*링크|아래\s*링크|프로필\s*링크/g, '')
      .replace(/최저가|특가|할인\s*(정보|링크)?/g, '')
      .replace(/https?:\/\/\S+/gi, '')
      .trim())
    .filter((line) => line && !/^(링크|댓글|구매|바로\s*가기|확인해?\s*봐)[\s.!?]*$/i.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function charLength(text) {
  return Array.from(String(text || '')).length;
}

function takeChars(text, max) {
  return Array.from(String(text || '')).slice(0, Math.max(0, max)).join('');
}

function trimToThreadsLimit(text) {
  const value = String(text || '').trim();
  if (charLength(value) <= THREADS_TEXT_LIMIT) return value;
  if (THREADS_TEXT_LIMIT <= 3) return takeChars(value, THREADS_TEXT_LIMIT).trim();
  return `${takeChars(value, THREADS_TEXT_LIMIT - 3).trimEnd()}...`;
}

export function buildPostText(post) {
  const cleanBody = stripLinkCta(post.body);
  if (!cleanBody) return '';
  return trimToThreadsLimit(cleanBody);
}

export function buildReplyText(linkUrl) {
  if (!linkUrl) return '';
  return `${COUPANG_DISCLOSURE}\n\n${linkUrl}`;
}

export async function postReply(token, postId, text) {
  const replyContainerRes = await fetch(`${THREADS_API}/me/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, reply_to_id: postId, access_token: token })
  });
  if (!replyContainerRes.ok) {
    const err = await replyContainerRes.text();
    throw new Error(`Threads reply container failed: ${err}`);
  }
  const { id: replyCreationId } = await replyContainerRes.json();

  await new Promise((resolve) => setTimeout(resolve, 2000));

  const replyPublishRes = await fetch(`${THREADS_API}/me/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: replyCreationId, access_token: token })
  });
  if (!replyPublishRes.ok) {
    const err = await replyPublishRes.text();
    throw new Error(`Threads reply publish failed: ${err}`);
  }
}

function buildThreadsPostUrl(account, postId, details = {}) {
  if (details.permalink) return details.permalink;
  const handle = String(details.username || account.account_handle || 'unknown').replace(/^@/, '') || 'unknown';
  return `https://www.threads.net/@${handle}/post/${details.shortcode || postId}`;
}

async function fetchThreadDetails(token, postId) {
  if (!token || !postId) return {};
  const params = new URLSearchParams({
    fields: 'id,permalink,shortcode,username',
    access_token: token
  });
  const detailsRes = await fetch(`${THREADS_API}/${postId}?${params.toString()}`);
  const text = await detailsRes.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!detailsRes.ok || json.error) {
    console.warn('[THREADS PERMALINK WARNING]', { postId, error: json.error?.message || text || `HTTP ${detailsRes.status}` });
    return {};
  }
  return json;
}

export async function uploadReplyOnly({ account, postId, text }) {
  const token = account?.threads_access_token;
  if (process.env.MOCK_UPLOAD === 'true') {
    console.log('[MOCK THREADS REPLY]', { account: account?.name, postId, comment: text || null });
    return { ok: true, raw: { mock: true, postId } };
  }
  if (!token) {
    const error = new Error('Threads access token is required. 계정 관리에서 Threads 연결을 먼저 완료해주세요.');
    error.code = 'THREADS_TOKEN_MISSING';
    error.permanent = true;
    throw error;
  }
  if (!postId || !text) {
    const error = new Error('THREADS_REPLY_REPAIR_MISSING_DATA: 댓글 복구에 필요한 게시글 ID 또는 댓글 본문이 없습니다.');
    error.code = 'THREADS_REPLY_REPAIR_MISSING_DATA';
    error.permanent = true;
    throw error;
  }
  await postReply(token, postId, text);
  return { ok: true, raw: { postId } };
}

function threadsError(label, body) {
  const message = `${label}: ${body}`;
  const error = new Error(message);
  if (/OAuth|access token|Cannot parse access token|token/i.test(message)) {
    error.code = 'THREADS_TOKEN_INVALID';
    error.permanent = true;
  }
  return error;
}

export async function uploadPost({ account, post, cta, trackingLink, sponsoredReplyText = '' }) {
  const token = account.threads_access_token;
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const linkMode = String(process.env.THREADS_COUPANG_LINK_MODE || 'direct').toLowerCase();
  const linkUrl = trackingLink
    ? (linkMode === 'tracking' ? `${baseUrl}/r/${trackingLink.code}` : trackingLink.destination_url)
    : null;
  const replyModeEnabled = isReplyLinkModeEnabled();
  const sponsoredText = !linkUrl ? String(sponsoredReplyText || '').trim() : '';
  const deliveryMode = linkUrl || sponsoredText ? 'reply' : 'none';
  if (linkUrl && (!replyModeEnabled || account.threads_link_delivery_mode !== 'reply')) {
    const error = new Error('THREADS_REPLY_LINK_MODE_REQUIRED: 링크 글은 댓글 링크 모드에서만 업로드할 수 있습니다.');
    error.code = 'THREADS_REPLY_LINK_MODE_REQUIRED';
    error.permanent = true;
    throw error;
  }
  const replyText = linkUrl ? buildReplyText(linkUrl) : sponsoredText;
  const text = buildPostText(post);
  if (!text) {
    const error = new Error('Threads post text is empty after content cleanup. 콘텐츠 본문을 다시 생성해주세요.');
    error.code = 'POST_BODY_EMPTY';
    error.permanent = true;
    throw error;
  }
  const quality = inspectGeneratedPostText(text, account);
  if (!quality.publishable) {
    const error = new Error('POST_BODY_QUALITY_BLOCKED: 계정 아이디 노출 또는 템플릿성 본문이 감지되어 업로드를 중단했습니다.');
    error.code = 'POST_BODY_QUALITY_BLOCKED';
    error.permanent = true;
    error.quality = quality;
    throw error;
  }
  if (charLength(text) > THREADS_TEXT_LIMIT) {
    const error = new Error('Threads post text exceeds 500 characters after adding disclosure and link. 콘텐츠 본문을 줄인 뒤 다시 시도해주세요.');
    error.code = 'THREADS_TEXT_TOO_LONG';
    error.permanent = true;
    throw error;
  }

  if (process.env.MOCK_UPLOAD === 'true') {
    const url = `${baseUrl}/mock/threads/${post.id}`;
    console.log('[MOCK THREADS UPLOAD]', { account: account.name, body: text, comment: replyText || null, linkMode });
    return { postUrl: url, raw: { mock: true, linkDeliveryMode: replyText ? deliveryMode : 'none', linkMode, replyText, sponsoredReply: Boolean(sponsoredText) } };
  }
  if (!token) {
    const error = new Error('Threads access token is required. 계정 관리에서 Threads 연결을 먼저 완료해주세요.');
    error.code = 'THREADS_TOKEN_MISSING';
    error.permanent = true;
    throw error;
  }

  const containerRes = await fetch(`${THREADS_API}/me/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token })
  });
  if (!containerRes.ok) {
    const err = await containerRes.text();
    throw threadsError('Threads container create failed', err);
  }
  const { id: creationId } = await containerRes.json();

  await new Promise((resolve) => setTimeout(resolve, 3000));

  const publishRes = await fetch(`${THREADS_API}/me/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: creationId, access_token: token })
  });
  if (!publishRes.ok) {
    const err = await publishRes.text();
    throw threadsError('Threads publish failed', err);
  }
  const { id: postId } = await publishRes.json();
  const postDetails = await fetchThreadDetails(token, postId);
  const postUrl = buildThreadsPostUrl(account, postId, postDetails);

  let replyWarning = null;
  if (replyText) {
    if (deliveryMode === 'reply') {
      try {
        await postReply(token, postId, replyText);
      } catch (error) {
        replyWarning = error.message;
        console.warn('[THREADS REPLY WARNING]', { account: account.name, postId, error: error.message });
      }
    }
    if (deliveryMode === 'reply' && replyWarning) {
      return {
        postUrl,
        raw: {
          creationId,
          postId,
          postDetails,
          linkDeliveryMode: deliveryMode,
          linkMode,
          replyWarning,
          replyFailed: true,
          sponsoredReply: Boolean(sponsoredText),
          replyText
        }
      };
    }
  }

  return { postUrl, raw: { creationId, postId, postDetails, linkDeliveryMode: replyText ? deliveryMode : 'none', linkMode, sponsoredReply: Boolean(sponsoredText) } };
}
