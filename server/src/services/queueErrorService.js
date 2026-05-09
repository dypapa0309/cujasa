export function classifyQueueError(message = '') {
  const value = String(message || '');
  if (/REPLY_LINK_MODE_REQUIRED/i.test(value)) {
    return {
      category: 'reply_link_mode_required',
      severity: 'warn',
      title: '댓글 링크 모드 복구 가능',
      message: '댓글 링크 모드 설정 누락으로 막힌 예약입니다. 복구 후 다시 업로드할 수 있습니다.'
    };
  }
  if (/REPLY_LINK_FAILURE_UNRESOLVED/i.test(value)) {
    return {
      category: 'reply_warning',
      severity: 'warn',
      title: '댓글 링크 복구 대기',
      message: '본문은 올라갔고 쿠팡 링크 댓글만 복구하면 됩니다.'
    };
  }
  if (/COUPANG_PRODUCT_MISSING|상품 매칭 누락|링크 글.*상품|tracking link.*missing|트래킹 링크/i.test(value)) {
    return {
      category: 'coupang_link_missing',
      severity: 'error',
      title: '쿠팡 상품 매칭 누락',
      message: '링크 포함 글로 예약됐지만 연결된 쿠팡 상품 또는 트래킹 링크가 없습니다. 상품 추천을 다시 실행한 뒤 재시도해주세요.'
    };
  }
  if (/is_transient"?\s*:\s*true|code"?\s*:\s*2|unexpected error has occurred|retry your request later/i.test(value)) {
    return {
      category: 'retry_available',
      severity: 'warn',
      title: 'Threads 일시 오류',
      message: 'Threads 쪽 일시 오류로 업로드가 끝나지 않았어요. 현재 연결 상태를 확인한 뒤 다시 시도할 수 있어요.'
    };
  }
  if (/THREADS_TOKEN_MISSING|Threads access token is required|계정 관리에서 Threads 연결|OAuth|access token|Cannot parse access token|token|토큰 갱신|다시 연결|재연결|code"?\s*:\s*190|code 190/i.test(value)) {
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
  if (category === 'manual_required') {
    const classified = classifyQueueError(fallbackMessage);
    if (classified.category !== 'manual_required') return classified;
    return {
      category,
      severity: 'error',
      title: '수동 확인 필요',
      message: fallbackMessage || '원인을 확인해야 하는 실패 항목입니다.'
    };
  }
  if (category === 'retry_available') {
    return {
      category,
      severity: 'warn',
      title: '다시 시도 가능',
      message: '이전 업로드가 끝나지 않은 기록이에요. 현재 연결 상태를 확인한 뒤 본문 게시 여부를 보고 다시 시도할 수 있어요.'
    };
  }
  if (category === 'reply_link_mode_required') {
    return {
      category,
      severity: 'warn',
      title: '댓글 링크 모드 복구 가능',
      message: '댓글 링크 모드 설정 누락으로 막힌 예약입니다. 복구 후 다시 업로드할 수 있습니다.'
    };
  }
  if (category === 'recheck_required') {
    return {
      category,
      severity: 'warn',
      title: '게시 여부 확인 필요',
      message: '이전 실패 기록이에요. 본문이 이미 올라갔는지 확인하거나 필요하면 다시 시도해 주세요.'
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
  if (category === 'link_missing_published') {
    return {
      category,
      severity: 'warn',
      title: '링크 없이 발행된 과거 기록',
      message: '과거 업로드에서 본문만 발행되고 쿠팡 링크가 붙지 않은 기록입니다. 새 예약에는 개선된 링크 처리 방식이 적용됩니다.'
    };
  }
  return { ...classifyQueueError(fallbackMessage), category: category || classifyQueueError(fallbackMessage).category };
}

export function normalizeQueueClassification(row = {}, options = {}) {
  const fallbackMessage = row.error_message || row.message || '';
  const messageClassification = classifyQueueError(fallbackMessage);
  let category = row.error_category || messageClassification.category;

  if (category === 'manual_required' && messageClassification.category !== 'manual_required') {
    category = messageClassification.category;
  }
  if (category === 'threads_reconnect_required' && options.currentThreadsOk) {
    category = options.reconnectedCategory || 'retry_available';
  }

  return classificationForCategory(category, fallbackMessage);
}

export function isThreadsReconnectQueueError(row = {}) {
  const classified = normalizeQueueClassification(row);
  return classified.category === 'threads_reconnect_required';
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
  const classified = normalizeQueueClassification(row);
  return {
    ...row,
    error_category: classified.category,
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
  if (action === 'reply_link_failure_repaired') return '댓글 링크 복구 완료';
  if (action === 'reply_link_failure_repair_failed') return '댓글 링크 복구 실패';
  if (action === 'reply_link_mode_queue_recovered') return '댓글 링크 모드 큐 복구';
  if (action === 'post_style_blocked' || action === 'queue_guardrail_skipped') return '콘텐츠 후보 제외';
  if (action === 'operations_safety_pause') return '운영 안전 점검으로 일시중지';
  if (action === 'operations_link_setup_hold') return '실상품 링크 확인 대기';
  if (action === 'emergency_pipeline_stopped') return '긴급 중지';
  if (action === 'pipeline_background_already_running') return '자동화 중복 실행 방지';
  if (action === 'pipeline_failed_paused' || action === 'automation_start_failed_paused') return '예약 생성 실패로 일시중지';
  if (action === 'pipeline_queue_created') return '예약 큐 생성';
  if (action === 'queue_link_slots_shortage') return '실상품 링크 부족';
  if (action === 'queue_link_slots_shortage_partial') return '일부 링크 후보만 예약';
  if (action === 'threads_oauth_connected') return 'Threads 연결됨';
  if (action === 'upload_completed') return '업로드 완료';
  return null;
}

export function adminActivityMessage(action, message = '') {
  if (action === 'upload_failed') return classifyQueueError(message).message;
  if (action === 'upload_reply_failed') return '본문 업로드는 완료됐고, 댓글/링크 답글만 재시도하면 됩니다.';
  if (action === 'reply_link_failure_repaired') return message || '기존 Threads 게시글에 쿠팡 링크 댓글을 다시 등록했습니다.';
  if (action === 'reply_link_failure_repair_failed') return message || '댓글 링크 복구에 실패했습니다. 반복되면 수동 확인이 필요합니다.';
  if (action === 'reply_link_mode_queue_recovered') return message || '댓글 링크 모드 설정 누락으로 막힌 큐를 재시도 가능 상태로 복구했습니다.';
  if (action === 'post_style_blocked' || action === 'queue_guardrail_skipped') return message || '계정 규칙에 맞지 않아 제외되었습니다.';
  if (action === 'operations_safety_pause') return message || '운영 안전 점검으로 자동화를 일시중지했습니다.';
  if (action === 'operations_link_setup_hold') return message || '실상품 쿠팡 링크 확인 전까지 링크 글 예약을 보류했습니다.';
  if (action === 'emergency_pipeline_stopped') return message || '쿠팡 요청 제한 보호를 위해 긴급 중지했습니다.';
  if (action === 'pipeline_background_already_running') return message || '이미 실행 중인 예약 작업이 있어 중복 실행을 막았습니다.';
  if (action === 'pipeline_failed_paused' || action === 'automation_start_failed_paused') return message || '예약 생성 실패로 자동화를 일시중지했습니다.';
  if (action === 'queue_link_slots_shortage') return message || '링크 글에 사용할 실제 쿠팡 상품이 부족합니다.';
  if (action === 'queue_link_slots_shortage_partial') return message || '수익화 가능한 상품 링크 후보만 예약했습니다.';
  return null;
}
