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

function stripLeadingHandleLikeToken(value) {
  const text = String(value || '');
  const match = text.match(/^\s*@?([a-z][a-z0-9._-]{2,30})(?=\s|$)/i);
  if (!match || !isLikelyHandle(match[1])) return text.trim();
  return text.slice(match[0].length).trim();
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
    .replace(/\s+/g, ' ')
    .trim();
  title = stripLeadingHandleLikeToken(title);

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
  return stripLeadingHandleLikeToken(body);
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
  const leadingToken = text.match(/^\s*@?([a-z][a-z0-9._-]{2,30})(?=\s|$)/i)?.[1] || '';
  return isLikelyHandle(leadingToken);
}

export function inspectGeneratedPostText(value, account = {}) {
  const text = String(value || '').trim();
  const sanitized = sanitizePostBody(text, account);
  const genericTemplate = [
    /이건\s*은근\s*기준이\s*갈리는\s*선택/i,
    /생활\s*속\s*원인부터\s*잡기를\s*먼저\s*보는\s*사람/i,
    /편하게\s*쓰는\s*쪽을\s*더\s*중요하게\s*보는\s*사람/i,
    /실용성\s*쪽이에요,\s*아니면\s*편한\s*사용감\s*쪽이에요/i,
    /실용성\s*쪽이에요.*사용감\s*쪽이에요/i,
    /이런\s*거\s*고를\s*때/i,
    /여러분은\s*이런\s*거/i,
    /사람마다\s*고르는\s*기준이\s*꽤\s*다르/i,
    /상황마다\s*선택이\s*갈릴\s*수밖에\s*없/i,
    /작은\s*기준\s*하나만\s*정해도/i,
    /많이\s*사는\s*것보다\s*["“]?어디에\s*둘지["”]?부터\s*정하면/i,
    /막상\s*살아보면\s*큰\s*기능보다\s*매일\s*손\s*가는\s*자리/i,
    /꺼내고\s*다시\s*두는\s*순간/i,
    /생활\s*속에서\s*.+고를\s*때/i,
    /매번\s*고민하는\s*시간이\s*줄어듭니다/i,
    /처음\s*눈에\s*띄는\s*것보다\s*계속\s*쓸\s*상황/i,
    /정리\s*쉽게\s*하는\s*법,\s*평소에는\s*별거\s*아닌데/i,
    /,\s*평소에는\s*별거\s*아닌데\s*막상\s*필요할\s*때마다/i,
    /댓글\s*(참고|확인|봐|달|남겨|공유|알려|부탁)/i,
    /쿠팡|파트너스|제휴|링크\s*(확인|참고|보기)?/i,
    /요즘\s*인기인/i,
    /후기에서\s*자주\s*보는/i,
    /추천하는\s*(제품|상품|수납함|아이템)\s*있/i,
    /이런\s*기준에서\s*추천하는/i,
    /괜히\s*기분\s*좋아지는\s*이유/i,
    /자주\s*쓰는지\s*\n\s*\d+\.\s*보관이\s*쉬운지\s*\n\s*\d+\.\s*관리/i
  ].some((pattern) => pattern.test(text));
  const aiLikeTone = [
    /경향이\s*있습니다/,
    /영향을\s*미칩니다/,
    /특징이\s*있습니다/,
    /도움이\s*됩니다/,
    /고려해야\s*합니다/,
    /선택하는\s*것이\s*좋습니다/,
    /중요합니다/
  ].some((pattern) => pattern.test(text));
  return {
    accountTokenLeak: hasAccountTokenLeak(text, account) || sanitized !== text,
    genericTemplate,
    aiLikeTone,
    publishable: Boolean(text) && !genericTemplate && !(hasAccountTokenLeak(text, account) || sanitized !== text),
    sanitized
  };
}
