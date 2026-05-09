export function isReplyLinkModeEnabled(env = process.env) {
  return String(env.THREADS_REPLY_LINK_MODE_ENABLED ?? 'true').toLowerCase() !== 'false';
}

export function replyLinkModeStatus(env = process.env) {
  return {
    enabled: isReplyLinkModeEnabled(env),
    raw: env.THREADS_REPLY_LINK_MODE_ENABLED ?? null,
    defaulted: env.THREADS_REPLY_LINK_MODE_ENABLED == null
  };
}
