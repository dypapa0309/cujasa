const THREADS_API = 'https://graph.threads.net/v1.0';

function buildPostText(post, cta) {
  return [...[post.body, cta?.cta_text].filter(Boolean), '(광고)'].join('\n\n');
}

async function postReplyLink(token, postId, linkUrl) {
  const replyContainerRes = await fetch(`${THREADS_API}/me/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text: linkUrl, reply_to_id: postId, access_token: token })
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

export async function uploadPost({ account, post, cta, trackingLink }) {
  const token = account.threads_access_token;
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const linkUrl = trackingLink ? `${baseUrl}/r/${trackingLink.code}` : null;

  if (!token || process.env.MOCK_UPLOAD === 'true') {
    const url = `${baseUrl}/mock/threads/${post.id}`;
    console.log('[MOCK THREADS UPLOAD]', { account: account.name, body: buildPostText(post, cta), comment: linkUrl });
    return { postUrl: url, raw: { mock: true } };
  }

  const text = buildPostText(post, cta);

  const containerRes = await fetch(`${THREADS_API}/me/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'TEXT', text, access_token: token })
  });
  if (!containerRes.ok) {
    const err = await containerRes.text();
    throw new Error(`Threads container create failed: ${err}`);
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
    throw new Error(`Threads publish failed: ${err}`);
  }
  const { id: postId } = await publishRes.json();

  if (linkUrl) await postReplyLink(token, postId, linkUrl);

  const handle = account.account_handle?.replace('@', '') || 'unknown';
  const postUrl = `https://www.threads.net/@${handle}/post/${postId}`;
  return { postUrl, raw: { creationId, postId } };
}
