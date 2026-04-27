import crypto from 'node:crypto';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 12;

function base64url(input) {
  return Buffer.from(JSON.stringify(input)).toString('base64url');
}

function sign(payload) {
  return crypto.createHmac('sha256', process.env.JWT_SECRET || '').update(payload).digest('base64url');
}

export function isAuthConfigured() {
  return Boolean(process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD_HASH && process.env.JWT_SECRET);
}

export function shouldBypassAuth() {
  return !isAuthConfigured() && process.env.NODE_ENV !== 'production';
}

function makeToken(payload) {
  const header = base64url({ alg: 'HS256', typ: 'JWT' });
  const body = base64url({
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    ...payload
  });
  const unsigned = `${header}.${body}`;
  return `${unsigned}.${sign(unsigned)}`;
}

export function verifyToken(token = '') {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const unsigned = `${header}.${body}`;
  const expected = sign(unsigned);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function loginAdmin(email, password) {
  if (!isAuthConfigured()) {
    const error = new Error('Admin auth is not configured');
    error.status = 503;
    throw error;
  }
  const emailMatches = email?.trim().toLowerCase() === process.env.ADMIN_EMAIL.trim().toLowerCase();
  const passwordMatches = verifyPassword(password || '', process.env.ADMIN_PASSWORD_HASH);
  if (!emailMatches || !passwordMatches) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  const token = makeToken({ sub: process.env.ADMIN_EMAIL, role: 'admin' });
  return { token, type: 'admin', email: process.env.ADMIN_EMAIL };
}

export async function loginUser(email, password) {
  const user = await dbGet('users', { email: email?.trim().toLowerCase() });
  if (!user) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  if (user.status === 'suspended') {
    const error = new Error('Account suspended');
    error.status = 403;
    throw error;
  }
  if (!verifyPassword(password || '', user.password_hash)) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  const token = makeToken({ sub: user.email, role: 'user', userId: user.id, maxAccounts: user.max_accounts });
  return { token, type: 'user', email: user.email, userId: user.id, maxAccounts: user.max_accounts };
}

export async function createUser(email, password, maxAccounts = 4) {
  const existing = await dbGet('users', { email: email.trim().toLowerCase() });
  if (existing) {
    const error = new Error('이미 존재하는 이메일입니다.');
    error.status = 409;
    throw error;
  }
  return dbInsert('users', {
    email: email.trim().toLowerCase(),
    password_hash: hashPassword(password),
    max_accounts: maxAccounts,
    status: 'active'
  });
}

export const listUsers = () => dbList('users', {}, { order: 'created_at', ascending: false });
export const updateUser = (id, patch) => dbUpdate('users', { id }, patch);
