export async function uploadPost({ account, post, cta, trackingLink }) {
  const baseUrl = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const url = `${baseUrl}/mock/threads/${post.id}`;
  const body = [post.body, cta?.cta_text, trackingLink ? `${baseUrl}/r/${trackingLink.code}` : null]
    .filter(Boolean)
    .join('\n\n');
  console.log('[MOCK THREADS UPLOAD]', { account: account.name, body, url });
  return { postUrl: url, raw: { mock: true } };
}
