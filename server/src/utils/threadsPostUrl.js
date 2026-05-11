export function isNumericThreadsPostUrl(url = '') {
  return /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^/]+\/post\/\d+(?:[/?#].*)?$/i.test(String(url || '').trim());
}

export function isTrustedThreadsPostUrl(url = '') {
  const value = String(url || '').trim();
  if (!value) return false;
  if (/\/mock\/threads\/[^/?#]+/i.test(value)) return true;
  if (!/https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[^/]+\/post\/[^/?#]+/i.test(value)) return false;
  return !isNumericThreadsPostUrl(value);
}

export function threadsPostUrlStatus(url = '') {
  const value = String(url || '').trim();
  if (!value) {
    return {
      trusted: false,
      status: 'missing',
      label: 'Threads 링크 없음',
      nextAction: 'Threads permalink 재조회'
    };
  }
  if (isNumericThreadsPostUrl(value)) {
    return {
      trusted: false,
      status: 'numeric_media_id',
      label: 'Threads 링크 확인 필요',
      nextAction: 'Graph API로 permalink 재조회'
    };
  }
  if (isTrustedThreadsPostUrl(value)) {
    return {
      trusted: true,
      status: 'trusted_permalink',
      label: '게시글 보기',
      nextAction: '조치 없음'
    };
  }
  return {
    trusted: false,
    status: 'unknown_format',
    label: 'Threads 링크 확인 필요',
    nextAction: 'URL 형식 확인'
  };
}

export function extractThreadsPostIdentifier(postUrl = '') {
  const value = String(postUrl || '');
  const match = value.match(/\/post\/([^/?#]+)/i) || value.match(/threads\/([^/?#]+)/i);
  return match?.[1] || '';
}

