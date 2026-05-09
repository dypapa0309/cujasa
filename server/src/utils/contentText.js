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

export function hasAccountTokenLeak(value, account = {}) {
  const text = String(value || '');
  if (!text.trim()) return false;
  const blocked = [
    account.account_handle,
    account.name
  ].filter(isLikelyHandle);
  if (blocked.some((token) => {
    const pattern = new RegExp(`(^|\\s)@?${escapeRegex(token).replace(/^@/, '')}(?=\\s|$)`, 'i');
    return pattern.test(text);
  })) {
    return true;
  }
  return /(^|\s)@?[a-z][a-z0-9._-]{2,30}(?=\s|$)/i.test(text) && /\d/.test(text);
}

export function inspectGeneratedPostText(value, account = {}) {
  const text = String(value || '').trim();
  const sanitized = sanitizePostBody(text, account);
  const genericTemplate = [
    /이건\s*은근\s*기준이\s*갈리는\s*선택/i,
    /생활\s*속\s*원인부터\s*잡기를\s*먼저\s*보는\s*사람/i,
    /편하게\s*쓰는\s*쪽을\s*더\s*중요하게\s*보는\s*사람/i,
    /실용성\s*쪽이에요,\s*아니면\s*편한\s*사용감\s*쪽이에요/i,
    /이런\s*거\s*고를\s*때/i,
    /여러분은\s*이런\s*거/i
  ].some((pattern) => pattern.test(text));
  return {
    accountTokenLeak: hasAccountTokenLeak(text, account) || sanitized !== text,
    genericTemplate,
    publishable: Boolean(text) && !genericTemplate && !(hasAccountTokenLeak(text, account) || sanitized !== text),
    sanitized
  };
}
