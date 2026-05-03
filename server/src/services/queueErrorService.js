export function classifyQueueError(message = '') {
  const value = String(message || '');
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
