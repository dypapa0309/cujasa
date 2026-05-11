import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyQueueError, normalizeQueueClassification } from './queueErrorService.js';

test('classifies Threads code 10 reply failures as reply permission required', () => {
  const message = 'Threads reply container failed: {"error":{"message":"Application does not have permission for this action","type":"THApiException","code":10}}';

  const classified = classifyQueueError(message);

  assert.equal(classified.category, 'reply_permission_required');
  assert.equal(classified.severity, 'error');
  assert.match(classified.title, /댓글 권한/);
});

test('normalizes posted reply permission warnings away from generic reply warning', () => {
  const message = 'Threads reply publish failed: {"error":{"message":"Application does not have permission for this action","code":10}}';

  const classified = normalizeQueueClassification({
    status: 'posted',
    error_category: 'reply_warning',
    error_message: message
  });

  assert.equal(classified.category, 'reply_permission_required');
});

test('normalizes stored retry_available code 10 failures as reply permission required', () => {
  const message = 'Threads reply container failed: {"error":{"message":"Application does not have permission for this action","code":10}}';

  const classified = normalizeQueueClassification({
    status: 'manual_required',
    error_category: 'retry_available',
    error_message: message
  });

  assert.equal(classified.category, 'reply_permission_required');
  assert.equal(classified.severity, 'error');
});

test('classifies invalid Threads reply target separately from retryable failures', () => {
  const message = 'Threads reply publish failed: {"error":{"message":"reply_to_id is not a valid threads_media ID","code":100}}';

  const classified = classifyQueueError(message);

  assert.equal(classified.category, 'threads_reply_target_invalid');
  assert.match(classified.title, /게시글 ID/);
});
