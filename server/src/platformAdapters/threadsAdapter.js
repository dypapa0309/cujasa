const THREADS_API = 'https://graph.threads.net/v1.0';
const COUPANG_DISCLOSURE = '[광고] 이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

function hasDisclosure(text) {
  const value = String(text || '');
  return /\[?광고\]?/.test(value) || /쿠팡\s*파트너스.*수수료/.test(value) || /파트너스\s*활동.*수수료/.test(value);
}

function stripLinkCta(text) {
  return String(text || '')
    .split('\n')
    .filter((line) => !/(링크|댓글|최저가|가격은|제품은\s*댓글|아래\s*링크|프로필에)/.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildPostText(post) {
  return stripLinkCta(post.body) || String(post.body || '').trim();
}

function buildReplyText(linkUrl) {
  if (!linkUrl) return COUPANG_DISCLOSURE;
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
  const linkUrl = trackingLink ? `${baseUrl}/r/${trackingLink.code}` : null;
  const replyText = buildReplyText(linkUrl);

  if (process.env.MOCK_UPLOAD === 'true') {
    const url = `${baseUrl}/mock/threads/${post.id}`;
    console.log('[MOCK THREADS UPLOAD]', { account: account.name, body: buildPostText(post, cta), comment: replyText });
    return { postUrl: url, raw: { mock: true } };
  }
  if (!token) {
    const error = new Error('Threads access token is required. 계정 관리에서 Threads 연결을 먼저 완료해주세요.');
    error.code = 'THREADS_TOKEN_MISSING';
    error.permanent = true;
    throw error;
  }

  const text = buildPostText(post, cta);
  if (!text) {
    const error = new Error('Threads post text is empty after content cleanup. 콘텐츠 본문을 다시 생성해주세요.');
    error.code = 'POST_BODY_EMPTY';
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
  if (!hasDisclosure(text) || linkUrl) {
    try {
      await postReply(token, postId, replyText);
    } catch (error) {
      replyWarning = error.message;
      console.warn('[THREADS REPLY WARNING]', { account: account.name, postId, error: error.message });
    }
  }

  const handle = account.account_handle?.replace('@', '') || 'unknown';
  const postUrl = `https://www.threads.net/@${handle}/post/${postId}`;
  return { postUrl, raw: { creationId, postId, ...(replyWarning ? { replyWarning } : {}) } };
}
