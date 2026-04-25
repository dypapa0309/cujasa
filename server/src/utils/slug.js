import crypto from 'node:crypto';

export function shortCode(size = 8) {
  return crypto.randomBytes(size).toString('base64url').slice(0, size);
}
