export function classifyQueueError(message = '') {
  const value = String(message || '');
  if (/COUPANG_PRODUCT_MISSING|상품 매칭 누락|링크 글.*상품|tracking link.*missing|트래킹 링크/i.test(value)) {
    return {
      category: 'coupang_link_missing',
      severity: 'error',
      title: '쿠팡 상품 매칭 누락',
      message: '링크 포함 글로 예약됐지만 연결된 쿠팡 상품 또는 트래킹 링크가 없습니다. 상품 추천을 다시 실행한 뒤 재시도해주세요.'
    };
  }
  if (/THREADS_TOKEN_MISSING|Threads access token is required|계정 관리에서 Threads 연결|OAuth|access token|Cannot parse access token|token|code"?\s*:\s*190|code 190/i.test(value)) {
    return {
      category: 'threads_reconnect_required',
      severity: 'error',
      title: 'Threads 토큰 만료/재연결 필요',
      message: 'Threads 연결이 만료되었거나 사용할 수 없습니다. 다시 연결하기 전까지 업로드를 시도하지 않습니다.'
    };
  }
  if (/reply container failed|reply publish failed/i.test(value)) {
    return {
      category: 'reply_warning',
      severity: 'warn',
      title: '댓글/링크 답글 실패',
      message: '본문 업로드는 완료됐지만 댓글 또는 링크 답글 등록에 실패했습니다.'
    };
  }
  if (/Post blocked by content guardrails|post_style_blocked|guardrail|톤 불일치|content guardrails/i.test(value)) {
    return {
      category: 'content_blocked',
      severity: 'warn',
      title: '콘텐츠 후보 제외',
      message: '계정의 톤/금지어/콘텐츠 규칙과 맞지 않아 업로드 대상에서 제외되었습니다.'
    };
  }
  return {
    category: 'manual_required',
    severity: 'error',
    title: '수동 확인 필요',
    message: value || '원인을 확인해야 하는 실패 항목입니다.'
  };
}

export function classificationForCategory(category, fallbackMessage = '') {
  if (category === 'retry_available') {
    return {
      category,
      severity: 'warn',
      title: '재연결 후 재시도 가능',
      message: 'Threads 재연결이 완료되었습니다. 이 항목은 본문 게시 여부를 확인한 뒤 다시 업로드할 수 있습니다.'
    };
  }
  if (category === 'recheck_required') {
    return {
      category,
      severity: 'warn',
      title: '재연결 후 확인 필요',
      message: '재연결 전에 실패한 기록입니다. 본문 게시 여부를 확인하거나 재시도해주세요.'
    };
  }
  if (category === 'threads_reconnect_required') {
    return {
      category,
      severity: 'error',
      title: 'Threads 토큰 만료/재연결 필요',
      message: 'Threads 연결이 만료되었거나 사용할 수 없습니다. 다시 연결하기 전까지 업로드를 시도하지 않습니다.'
    };
  }
  if (category === 'reply_warning') {
    return {
      category,
      severity: 'warn',
      title: '댓글/링크 답글 실패',
      message: '본문 업로드는 완료됐지만 댓글 또는 링크 답글 등록에 실패했습니다.'
    };
  }
  if (category === 'content_blocked') {
    return {
      category,
      severity: 'warn',
      title: '콘텐츠 후보 제외',
      message: '계정의 톤/금지어/콘텐츠 규칙과 맞지 않아 업로드 대상에서 제외되었습니다.'
    };
  }
  if (category === 'coupang_link_missing') {
    return {
      category,
      severity: 'error',
      title: '쿠팡 상품 매칭 누락',
      message: '링크 포함 글로 예약됐지만 연결된 쿠팡 상품 또는 트래킹 링크가 없습니다. 상품 추천을 다시 실행한 뒤 재시도해주세요.'
    };
  }
  return { ...classifyQueueError(fallbackMessage), category: category || classifyQueueError(fallbackMessage).category };
}

export function decorateQueueRow(row = {}) {
  if (!row.error_message && !row.error_category) {
    return {
      ...row,
      error_category: row.error_category || null,
      friendly_title: null,
      friendly_message: null,
      friendly_severity: null
    };
  }
  const classified = row.error_category
    ? classificationForCategory(row.error_category, row.error_message)
    : classifyQueueError(row.error_message);
  return {
    ...row,
    error_category: row.error_category || classified.category,
    friendly_title: classified.title,
    friendly_message: classified.message,
    friendly_severity: classified.severity
  };
}

export function decorateQueueRows(rows = []) {
  return rows.map(decorateQueueRow);
}

export function postModeLabel(postMode = 'auto') {
  if (postMode === 'link') return '쿠팡 링크 글';
  if (postMode === 'no_link') return '일반 글';
  return '기존 예약 글';
}

export function adminActivityLabel(action, message = '') {
  if (action === 'upload_failed') return classifyQueueError(message).title;
  if (action === 'upload_reply_failed') return '댓글/링크 답글 실패';
  if (action === 'post_style_blocked' || action === 'queue_guardrail_skipped') return '콘텐츠 후보 제외';
  return null;
}

export function adminActivityMessage(action, message = '') {
  if (action === 'upload_failed') return classifyQueueError(message).message;
  if (action === 'upload_reply_failed') return '본문 업로드는 완료됐고, 댓글/링크 답글만 재시도하면 됩니다.';
  if (action === 'post_style_blocked' || action === 'queue_guardrail_skipped') return message || '계정 규칙에 맞지 않아 제외되었습니다.';
  return null;
}
