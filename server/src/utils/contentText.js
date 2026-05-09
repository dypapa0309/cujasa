function clean(value) {
  return String(value || '').trim();
}

function escapeRegex(value) {
  return clean(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isLikelyHandle(value) {
  const text = clean(value).replace(/^@/, '');
  return /^[a-z][a-z0-9._-]{2,30}$/i.test(text) && /\d/.test(text);
}

export function sanitizeContentTitle(value, account = {}) {
  let title = clean(value);
  const blocked = [
    account.account_handle,
    account.name
  ].filter(isLikelyHandle);

  for (const token of blocked) {
    const pattern = new RegExp(`(^|\\s)@?${escapeRegex(token).replace(/^@/, '')}(?=\\s|$)`, 'ig');
    title = title.replace(pattern, ' ');
  }

  title = title
    .replace(/^\s*@?[a-z][a-z0-9._-]{2,30}\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  return title || clean(account.content_scope) || '생활용품 고르는 기준';
}

export function sanitizePostBody(value, account = {}) {
  const blocked = [
    account.account_handle,
    account.name
  ].filter(isLikelyHandle);
  let body = String(value || '');
  for (const token of blocked) {
    const pattern = new RegExp(`(^|\\s)@?${escapeRegex(token).replace(/^@/, '')}(?=\\s|$)`, 'ig');
    body = body.replace(pattern, '$1');
  }
  return body.replace(/^\s*@?[a-z][a-z0-9._-]{2,30}\s+/i, '').trim();
}
