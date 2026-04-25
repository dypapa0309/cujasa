import crypto from 'node:crypto';

export function hashIp(ip = '') {
  return crypto.createHash('sha256').update(`${ip}:${process.env.IP_HASH_SALT || 'cujasa'}`).digest('hex');
}
