const THREADS_API = 'https://graph.threads.net/v1.0';

export async function uploadPost({ account, post, cta, trackingLink }) {
  const token = account.threads_access_token;
  if (!token || process.env.MOCK_UPLOAD === 'true') {
    const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url = `${baseUrl}/mock/threads/${post.id}`;
    const body = [post.body, cta?.cta_text, trackingLink ? `${baseUrl}/r/${trackingLink.code}` : null]
      .filter(Boolean)
      .join('\n\n');
    console.log('[MOCK THREADS UPLOAD]', { account: account.name, body, url });
    return { postUrl: url, raw: { mock: true } };
  }

  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const text = [post.body, cta?.cta_text, trackingLink ? `${baseUrl}/r/${trackingLink.code}` : null]
    .filter(Boolean)
    .join('\n\n');

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

  const handle = account.account_handle?.replace('@', '') || 'unknown';
  const postUrl = `https://www.threads.net/@${handle}/post/${postId}`;
  return { postUrl, raw: { creationId, postId } };
}
