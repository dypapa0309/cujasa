import crypto from 'node:crypto';

const ITERATIONS = 210000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('base64url');
  return `pbkdf2$${ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(password, storedHash = '') {
  const [scheme, iterations, salt, expected] = storedHash.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterations), KEY_LENGTH, DIGEST).toString('base64url');
  if (Buffer.byteLength(actual) !== Buffer.byteLength(expected)) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
