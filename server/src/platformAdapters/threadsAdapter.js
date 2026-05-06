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

export function buildPostText(post, linkUrl = null, deliveryMode = 'reply') {
  const cleanBody = stripLinkCta(post.body);
  if (!cleanBody) return '';
  if (!linkUrl || deliveryMode !== 'body_fallback') return trimToThreadsLimit(cleanBody);

  const footer = `${COUPANG_DISCLOSURE}\n${linkUrl}`;
  const separator = '\n\n';
  const footerLength = charLength(footer);
  if (footerLength + charLength(separator) >= THREADS_TEXT_LIMIT) return footer;

  const bodyLimit = THREADS_TEXT_LIMIT - footerLength - charLength(separator);
  const trimmedBody = charLength(cleanBody) > bodyLimit
    ? `${takeChars(cleanBody, Math.max(0, bodyLimit - 3)).trimEnd()}...`
    : cleanBody;
  return `${trimmedBody.trim()}\n\n${footer}`.trim();
}

function buildReplyText(linkUrl) {
  if (!linkUrl) return '';
  return `${COUPANG_DISCLOSURE}\n\n${linkUrl}`;
}

async function postReply(token, postId, text) {
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

function threadsError(label, body) {
  const message = `${label}: ${body}`;
  const error = new Error(message);
  if (/OAuth|access token|Cannot parse access token|token/i.test(message)) {
    error.code = 'THREADS_TOKEN_INVALID';
    error.permanent = true;
  }
  return error;
}

export async function uploadPost({ account, post, cta, trackingLink }) {
  const token = account.threads_access_token;
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const linkMode = String(process.env.THREADS_COUPANG_LINK_MODE || 'direct').toLowerCase();
  const linkUrl = trackingLink
    ? (linkMode === 'tracking' ? `${baseUrl}/r/${trackingLink.code}` : trackingLink.destination_url)
    : null;
  const replyModeEnabled = process.env.THREADS_REPLY_LINK_MODE_ENABLED === 'true';
  const deliveryMode = replyModeEnabled && account.threads_link_delivery_mode === 'reply' ? 'reply' : 'body_fallback';
  const replyText = linkUrl && deliveryMode === 'reply' ? buildReplyText(linkUrl) : '';

  if (process.env.MOCK_UPLOAD === 'true') {
    const url = `${baseUrl}/mock/threads/${post.id}`;
    console.log('[MOCK THREADS UPLOAD]', { account: account.name, body: buildPostText(post, linkUrl, deliveryMode), comment: replyText || null, linkMode });
    return { postUrl: url, raw: { mock: true, linkDeliveryMode: linkUrl ? deliveryMode : 'none', linkMode } };
  }
  if (!token) {
    const error = new Error('Threads access token is required. 계정 관리에서 Threads 연결을 먼저 완료해주세요.');
    error.code = 'THREADS_TOKEN_MISSING';
    error.permanent = true;
    throw error;
  }

  const text = buildPostText(post, linkUrl, deliveryMode);
  if (!text) {
    const error = new Error('Threads post text is empty after content cleanup. 콘텐츠 본문을 다시 생성해주세요.');
    error.code = 'POST_BODY_EMPTY';
    error.permanent = true;
    throw error;
  }
  if (charLength(text) > THREADS_TEXT_LIMIT) {
    const error = new Error('Threads post text exceeds 500 characters after adding disclosure and link. 콘텐츠 본문을 줄인 뒤 다시 시도해주세요.');
    error.code = 'THREADS_TEXT_TOO_LONG';
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

  let replyWarning = null;
  if (linkUrl) {
    if (deliveryMode === 'reply') {
      try {
        await postReply(token, postId, replyText);
      } catch (error) {
        replyWarning = error.message;
        console.warn('[THREADS REPLY WARNING]', { account: account.name, postId, error: error.message });
      }
    }
    if (deliveryMode === 'reply' && replyWarning) {
      const error = new Error(replyWarning);
      error.code = 'THREADS_REPLY_FAILED';
      error.replyFailed = true;
      error.permanent = true;
      error.postUrl = `https://www.threads.net/@${account.account_handle?.replace('@', '') || 'unknown'}/post/${postId}`;
      error.postId = postId;
      throw error;
    }
  }

  const handle = account.account_handle?.replace('@', '') || 'unknown';
  const postUrl = `https://www.threads.net/@${handle}/post/${postId}`;
  return { postUrl, raw: { creationId, postId, linkDeliveryMode: linkUrl ? deliveryMode : 'none', linkMode } };
}
