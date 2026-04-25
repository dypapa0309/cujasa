export function safeJsonParse(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf('{');
    const end = value.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(value.slice(start, end + 1));
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}
