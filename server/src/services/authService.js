import crypto from 'node:crypto';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { DEFAULT_PRODUCT_ID, PRODUCTS } from '../config/products.js';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';

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

export function isTokenConfigured() {
  return Boolean(process.env.JWT_SECRET);
}

export function shouldBypassAuth() {
  return !isTokenConfigured() && process.env.NODE_ENV !== 'production';
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

function defaultProductGrant() {
  const product = PRODUCTS.find((item) => item.id === DEFAULT_PRODUCT_ID);
  return {
    productId: DEFAULT_PRODUCT_ID,
    status: 'active',
    role: 'customer',
    name: product?.name || 'CUJASA',
    description: product?.description || '쿠팡 파트너스 자동화 콘솔',
    appUrl: product?.appUrl || 'https://cujasa.jasain.kr',
    landingUrl: product?.landingUrl || 'https://jasain.kr/cujasa'
  };
}

export async function listAvailableProducts() {
  try {
    const rows = await dbList('jasain_products', {}, { order: 'name', ascending: true });
    return rows.length > 0 ? rows : PRODUCTS.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      app_url: product.appUrl,
      landing_url: product.landingUrl,
      status: product.status
    }));
  } catch {
    return PRODUCTS.map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      app_url: product.appUrl,
      landing_url: product.landingUrl,
      status: product.status
    }));
  }
}

export async function listUserProducts(userId, { includeSettings = false } = {}) {
  if (!userId) return [];
  try {
    const [grants, products] = await Promise.all([
      dbList('user_products', { user_id: userId }),
      listAvailableProducts()
    ]);
    const productById = Object.fromEntries(products.map((product) => [product.id, product]));
    const activeGrants = grants.filter((grant) => grant.status !== 'suspended');
    if (activeGrants.length === 0) return [];
    return activeGrants.map((grant) => {
      const product = productById[grant.product_id] || {};
      const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
      const mapped = {
        productId: grant.product_id,
        status: grant.status,
        role: grant.role,
        name: product.name || grant.product_id,
        description: product.description,
        appUrl: product.app_url,
        landingUrl: product.landing_url,
        settingsSummary: {
          hasCoupangAccessKey: Boolean(settings.coupangAccessKey),
          hasCoupangSecretKey: Boolean(settings.coupangSecretKey),
          hasCoupangPartnerId: Boolean(settings.coupangPartnerId),
          defaultTrackingCode: settings.defaultTrackingCode || ''
        }
      };
      if (includeSettings) {
        mapped.settings = {
          coupangAccessKey: settings.coupangAccessKey || '',
          coupangPartnerId: settings.coupangPartnerId || '',
          defaultTrackingCode: settings.defaultTrackingCode || '',
          hasCoupangSecretKey: Boolean(settings.coupangSecretKey)
        };
      }
      return mapped;
    });
  } catch {
    return [defaultProductGrant()];
  }
}

export async function grantUserProduct(userId, productId = DEFAULT_PRODUCT_ID, patch = {}) {
  const existing = await dbGet('user_products', { user_id: userId, product_id: productId });
  const payload = {
    status: patch.status || 'active',
    role: patch.role || 'customer',
    ...(patch.settings ? { settings: patch.settings } : {}),
    granted_at: new Date().toISOString()
  };
  if (existing) {
    const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, payload);
    return updated;
  }
  return dbInsert('user_products', { user_id: userId, product_id: productId, ...payload });
}

export async function revokeUserProduct(userId, productId) {
  return dbDelete('user_products', { user_id: userId, product_id: productId });
}

export async function updateUserProductSettings(userId, productId, settingsPatch = {}) {
  const grant = await dbGet('user_products', { user_id: userId, product_id: productId });
  if (!grant) {
    const error = new Error('Product grant not found');
    error.status = 404;
    throw error;
  }
  const current = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
  const next = { ...current };
  const allowed = ['coupangAccessKey', 'coupangSecretKey', 'coupangPartnerId', 'defaultTrackingCode'];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(settingsPatch, key)) {
      const value = String(settingsPatch[key] ?? '').trim();
      if (key === 'coupangSecretKey' && !value) continue;
      next[key] = value;
    }
  }
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, { settings: next });
  return updated;
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
  const products = await listUserProducts(user.id);
  const token = makeToken({
    sub: user.email,
    role: 'user',
    userId: user.id,
    maxAccounts: user.max_accounts,
    products: products.map((product) => product.productId)
  });
  return { token, type: 'user', email: user.email, userId: user.id, maxAccounts: user.max_accounts, products };
}

export async function createUser(email, password, maxAccounts = 2, buyerName = '', options = {}) {
  const existing = await dbGet('users', { email: email.trim().toLowerCase() });
  if (existing) {
    const error = new Error('이미 존재하는 이메일입니다.');
    error.status = 409;
    throw error;
  }
  const user = await dbInsert('users', {
    email: email.trim().toLowerCase(),
    password_hash: hashPassword(password),
    buyer_name: buyerName ? String(buyerName).trim() : null,
    max_accounts: maxAccounts,
    status: 'active',
    billing_status: 'none'
  });
  if (options.grantDefault !== false) {
    try {
      await grantUserProduct(user.id, DEFAULT_PRODUCT_ID);
    } catch {
      // Product grants depend on the JASAIN migration. Do not block account creation if it has not been applied yet.
    }
  }
  return user;
}

export const listUsers = () => dbList('users', {}, { order: 'created_at', ascending: false });
export const updateUser = (id, patch) => dbUpdate('users', { id }, patch);
