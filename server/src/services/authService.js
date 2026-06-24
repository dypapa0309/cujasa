import crypto from 'node:crypto';
import { verifyPassword, hashPassword } from '../utils/password.js';
import { DEFAULT_PRODUCT_ID, PRODUCTS } from '../config/products.js';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from './supabaseService.js';
import { redactBillingSettings } from './redactionService.js';
import { createAccount } from './accountService.js';
import { throwIfProductServiceClosed } from '../utils/productAvailability.js';
import { authorizeLoginDevice } from './deviceSessionService.js';

const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const AUTH_PRODUCTS_TIMEOUT_MS = Number(process.env.AUTH_PRODUCTS_TIMEOUT_MS || 1500);
const AUTH_DEVICE_TIMEOUT_MS = Number(process.env.AUTH_DEVICE_TIMEOUT_MS || 3000);
const REGISTER_USERNAME_RE = /^[a-zA-Z0-9._-]{3,30}$/;
const REGISTER_PHONE_RE = /^\+?[0-9]{8,20}$/;
const REGISTER_PRODUCT_IDS = new Set(PRODUCTS.filter((product) => product.status !== 'inactive').map((product) => product.id));

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

function parseExtraAdminCredentials() {
  return String(process.env.ADMIN_EXTRA_CREDENTIALS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator <= 0) return null;
      return {
        login: entry.slice(0, separator).trim().toLowerCase(),
        passwordHash: entry.slice(separator + 1).trim()
      };
    })
    .filter((entry) => entry?.login && entry.passwordHash);
}

export function isAdminLoginCandidate(email = '') {
  if (!isAuthConfigured()) return false;
  const login = String(email || '').trim().toLowerCase();
  if (!login) return false;
  const primaryLogin = process.env.ADMIN_EMAIL.trim().toLowerCase();
  return login === primaryLogin || parseExtraAdminCredentials().some((credential) => credential.login === login);
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

function normalizeUsername(username = '') {
  return String(username).trim().toLowerCase();
}

function internalEmailForUsername(username) {
  return `${username}@local.cujasa`;
}

function normalizePhone(phone = '') {
  return String(phone).trim().replace(/[\s-]/g, '');
}

function normalizeRegisterProductId(productId = DEFAULT_PRODUCT_ID) {
  const normalized = String(productId || DEFAULT_PRODUCT_ID).trim().toLowerCase();
  return REGISTER_PRODUCT_IDS.has(normalized) ? normalized : null;
}

async function findUserByLogin(login = '') {
  const normalized = String(login || '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes('@')) {
    const byEmail = await dbGet('users', { email: normalized });
    if (byEmail) return byEmail;
  }
  try {
    const byUsername = await dbGet('users', { username: normalized });
    if (byUsername) return byUsername;
  } catch {
    // username column may not exist until the free-trial migration is applied.
  }
  return normalized.includes('@') ? null : dbGet('users', { email: normalized });
}

async function sessionForUser(user, options = {}) {
  const products = await listUserProductsForSession(user.id);
  const device = options.device || null;
  const token = makeToken({
    sub: user.email,
    username: user.username || null,
    role: 'user',
    userId: user.id,
    maxAccounts: user.max_accounts,
    products: products.map((product) => product.productId),
    ...(device?.device_id || device?.deviceId ? { deviceId: device.device_id || device.deviceId } : {}),
    ...(device?.id ? { deviceSessionId: device.id } : {})
  });
  return {
    token,
    type: 'user',
    email: user.email,
    username: user.username || null,
    userId: user.id,
    maxAccounts: user.max_accounts,
    products,
    ...(device ? { device: { id: device.id, type: device.device_type || device.deviceType } } : {})
  };
}

async function listUserProductsForSession(userId) {
  const fallback = [defaultProductGrant()];
  let timer = null;
  try {
    return await Promise.race([
      listUserProducts(userId),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[auth] products lookup timed out after ${AUTH_PRODUCTS_TIMEOUT_MS}ms`);
          resolve(fallback);
        }, AUTH_PRODUCTS_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function authorizeLoginDeviceWithTimeout(options) {
  let timer = null;
  try {
    return await Promise.race([
      authorizeLoginDevice(options),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('기기 인증 서버 응답이 지연되고 있습니다. 잠시 후 다시 시도해주세요.');
          error.status = 503;
          error.code = 'AUTH_DEVICE_TIMEOUT';
          reject(error);
        }, AUTH_DEVICE_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function verifyToken(token = '') {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const unsigned = `${header}.${body}`;
  const expected = sign(unsigned);
  if (Buffer.byteLength(signature) !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function loginAdmin(email, password) {
  if (!isAuthConfigured()) {
    const error = new Error('Admin auth is not configured');
    error.status = 503;
    throw error;
  }
  const login = email?.trim().toLowerCase();
  const primaryLogin = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const adminCredentials = [
    { login: primaryLogin, passwordHash: process.env.ADMIN_PASSWORD_HASH },
    ...parseExtraAdminCredentials()
  ];
  const matched = adminCredentials.find((credential) => credential.login === login);
  const passwordMatches = matched && verifyPassword(password || '', matched.passwordHash);
  if (!matched || !passwordMatches) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  const token = makeToken({ sub: matched.login, role: 'admin' });
  return { token, type: 'admin', email: matched.login };
}

function defaultProductGrant() {
  const product = PRODUCTS.find((item) => item.id === DEFAULT_PRODUCT_ID);
  return {
    productId: DEFAULT_PRODUCT_ID,
    status: 'active',
    role: 'customer',
    name: product?.name || 'CUJASA',
    description: product?.description || '쿠팡 파트너스 자동화 콘솔',
    appUrl: product?.appUrl || 'https://app.jasain.kr',
    landingUrl: product?.landingUrl || 'https://jasain.kr/cujasa'
  };
}

export async function listAvailableProducts() {
  const configuredProducts = PRODUCTS.map((product) => ({
    id: product.id,
    name: product.name,
    description: product.description,
    app_url: product.appUrl,
    landing_url: product.landingUrl,
    status: product.status || 'active'
  }));
  try {
    const rows = await dbList('jasain_products', {}, { order: 'name', ascending: true });
    const merged = new Map(configuredProducts.map((product) => [product.id, product]));
    rows.forEach((product) => {
      merged.set(product.id, {
        ...merged.get(product.id),
        ...product
      });
    });
    return [...merged.values()];
  } catch {
    return configuredProducts;
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
    const activeGrants = includeSettings ? grants : grants.filter((grant) => grant.status !== 'suspended');
    if (activeGrants.length === 0) return [];
    return activeGrants.map((grant) => {
      const product = productById[grant.product_id] || {};
      const settings = grant.settings && typeof grant.settings === 'object' ? grant.settings : {};
      const settingsSummary = redactBillingSettings(settings);
      const mapped = {
        productId: grant.product_id,
        status: grant.status,
        role: grant.role,
        name: product.name || grant.product_id,
        description: product.description,
        appUrl: product.app_url,
        landingUrl: product.landing_url,
        settingsSummary
      };
      if (includeSettings) {
        mapped.settings = settingsSummary;
      }
      return mapped;
    });
  } catch {
    return [defaultProductGrant()];
  }
}

export async function grantUserProduct(userId, productId = DEFAULT_PRODUCT_ID, patch = {}) {
  const product = PRODUCTS.find((item) => item.id === productId);
  if (product && !(await dbGet('jasain_products', { id: product.id }))) {
    try {
      await dbInsert('jasain_products', {
        id: product.id,
        name: product.name,
        description: product.description,
        app_url: product.appUrl,
        landing_url: product.landingUrl,
        status: product.status || 'active',
        updated_at: new Date().toISOString()
      });
    } catch (error) {
      if (!String(error?.message || '').toLowerCase().includes('duplicate')) throw error;
    }
  }
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
    if (productId === 'cujasa' && Object.prototype.hasOwnProperty.call(settingsPatch, key)) {
      const value = String(settingsPatch[key] ?? '').trim();
      if (!value) continue;
      next[key] = value;
    }
  }
  if (Object.prototype.hasOwnProperty.call(settingsPatch, 'usage')) {
    const patchUsage = settingsPatch.usage && typeof settingsPatch.usage === 'object' ? settingsPatch.usage : {};
    const raw = patchUsage[productId] && typeof patchUsage[productId] === 'object' ? patchUsage[productId] : patchUsage;
    const usageRoot = next.usage && typeof next.usage === 'object' ? next.usage : {};
    const currentUsage = usageRoot[productId] && typeof usageRoot[productId] === 'object' ? usageRoot[productId] : {};
    const limit = Number.isFinite(Number(raw.limit)) ? Math.max(0, Number(raw.limit)) : Number(currentUsage.limit ?? 5);
    const used = Number.isFinite(Number(raw.used)) ? Math.max(0, Number(raw.used)) : Number(currentUsage.used ?? 0);
    next.usage = {
      ...usageRoot,
      [productId]: {
        limit: Math.max(0, limit),
        used: Math.max(0, used)
      }
    };
  }
  const grantPatch = { settings: next };
  if (Object.prototype.hasOwnProperty.call(settingsPatch, 'billing')) {
    const rawBilling = settingsPatch.billing && typeof settingsPatch.billing === 'object' ? settingsPatch.billing : {};
    const plan = ['free', 'onetime', 'monthly', 'suspended'].includes(rawBilling.plan) ? rawBilling.plan : 'free';
    const now = new Date();
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const in365Days = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const billing = {
      plan,
      status: plan === 'suspended' ? 'suspended' : plan === 'free' ? 'none' : 'active',
      paidUntil: plan === 'monthly' ? (rawBilling.paidUntil || in30Days) : plan === 'onetime' ? (rawBilling.paidUntil || in365Days) : null,
      updatedAt: now.toISOString()
    };
    next.billing = billing;
    grantPatch.settings = next;
    grantPatch.status = plan === 'suspended' ? 'suspended' : 'active';
    if (productId === DEFAULT_PRODUCT_ID) {
      const userPatch = plan === 'suspended'
        ? { status: 'suspended' }
        : {
          status: 'active',
          plan,
          billing_status: billing.status,
          paid_until: billing.paidUntil
        };
      await dbUpdate('users', { id: userId }, userPatch);
    }
  }
  const [updated] = await dbUpdate('user_products', { user_id: userId, product_id: productId }, grantPatch);
  return updated;
}

export async function loginUser(email, password, options = {}) {
  const user = await findUserByLogin(email);
  if (!user) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  if (user.status === 'suspended') {
    const error = new Error(user.archived_at ? 'Account archived' : 'Account suspended');
    error.status = 403;
    throw error;
  }
  if (!verifyPassword(password || '', user.password_hash)) {
    const error = new Error('Invalid email or password');
    error.status = 401;
    throw error;
  }
  const device = await authorizeLoginDeviceWithTimeout({ user, device: options.device || {}, req: options.req });
  return sessionForUser(user, { device });
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

export async function registerFreeUser({ username, password, passwordConfirm, buyerName, buyer_name, phone, privacyConsent, privacy_consent, productId, product_id }, options = {}) {
  const normalizedUsername = normalizeUsername(username);
  const normalizedPhone = normalizePhone(phone);
  const selectedProductId = normalizeRegisterProductId(productId ?? product_id);
  if (!REGISTER_USERNAME_RE.test(normalizedUsername)) {
    const error = new Error('아이디는 3~30자의 영문, 숫자, 점, 밑줄, 하이픈만 사용할 수 있습니다.');
    error.status = 400;
    throw error;
  }
  if (!selectedProductId) {
    const error = new Error('사용할 솔루션을 선택해주세요.');
    error.status = 400;
    throw error;
  }
  throwIfProductServiceClosed(selectedProductId);
  if (!REGISTER_PHONE_RE.test(normalizedPhone)) {
    const error = new Error('연락 가능한 전화번호를 입력해주세요.');
    error.status = 400;
    throw error;
  }
  if (privacyConsent !== true && privacy_consent !== true) {
    const error = new Error('개인정보 수집 및 이용에 동의해야 회원가입할 수 있습니다.');
    error.status = 400;
    throw error;
  }
  if (!password || String(password).length < 8) {
    const error = new Error('비밀번호는 8자 이상이어야 합니다.');
    error.status = 400;
    throw error;
  }
  if (password !== passwordConfirm) {
    const error = new Error('비밀번호 확인이 일치하지 않습니다.');
    error.status = 400;
    throw error;
  }
  const existingUsername = await dbGet('users', { username: normalizedUsername }).catch(() => null);
  if (existingUsername) {
    const error = new Error('이미 사용 중인 아이디입니다.');
    error.status = 409;
    throw error;
  }
  const internalEmail = internalEmailForUsername(normalizedUsername);
  const existingEmail = await dbGet('users', { email: internalEmail });
  if (existingEmail) {
    const error = new Error('이미 사용 중인 아이디입니다.');
    error.status = 409;
    throw error;
  }

  const displayName = String(buyerName ?? buyer_name ?? normalizedUsername).trim() || normalizedUsername;
  const user = await dbInsert('users', {
    email: internalEmail,
    username: normalizedUsername,
    password_hash: hashPassword(password),
    buyer_name: displayName,
    phone: normalizedPhone,
    max_accounts: 2,
    status: 'active',
    plan: 'free',
    billing_status: 'none',
    free_post_limit: 5,
    free_post_used: 0,
    privacy_consent_at: new Date().toISOString()
  });

  await grantUserProduct(user.id, selectedProductId, { status: 'active', role: 'customer' });
  if (selectedProductId === DEFAULT_PRODUCT_ID) {
    const account = await createAccount({
      name: normalizedUsername,
      account_handle: '',
      target_audience: '',
      content_scope: '',
      tone: '',
      cta_style: ''
    });
    await dbInsert('user_accounts', { user_id: user.id, account_id: account.id });
  }

  return {
    ok: true,
    message: '회원가입이 완료되었습니다.',
    ...(await sessionForUser(user, options))
  };
}

export async function listUsers({ includeArchived = false } = {}) {
  const users = await dbList('users', {}, { order: 'created_at', ascending: false });
  return includeArchived ? users : users.filter((user) => !user.archived_at);
}

export async function listUserSummaries({ includeArchived = false } = {}) {
  const users = await listUsers({ includeArchived });
  return users.map((user) => ({
    id: user.id,
    email: user.email,
    username: user.username || null,
    buyer_name: user.buyer_name || null,
    buyerName: user.buyer_name || '',
    phone: user.phone || null,
    status: user.status || 'active',
    plan: user.plan || null,
    billing_status: user.billing_status || null,
    max_accounts: user.max_accounts,
    created_at: user.created_at,
    archived_at: user.archived_at || null
  }));
}

export const updateUser = (id, patch) => dbUpdate('users', { id }, patch);

export async function archiveUser(userId, { reason = '', archivedBy = '' } = {}) {
  const user = await dbGet('users', { id: userId });
  if (!user) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  const archivedAt = new Date().toISOString();
  const [updated] = await dbUpdate('users', { id: userId }, {
    status: 'suspended',
    archived_at: archivedAt,
    archived_reason: String(reason || '').trim() || 'admin_archive',
    archived_by: String(archivedBy || '').trim() || 'admin'
  });
  await dbDelete('user_accounts', { user_id: userId });
  const grants = await dbList('user_products', { user_id: userId });
  for (const grant of grants) {
    await dbUpdate('user_products', { id: grant.id }, { status: 'suspended' });
  }
  const tasks = await dbList('setup_tasks', { user_id: userId });
  for (const task of tasks) {
    if (['pending', 'in_progress'].includes(task.status)) {
      await dbUpdate('setup_tasks', { id: task.id }, {
        status: 'canceled',
        notes: [task.notes, `관리자 보관 삭제: ${reason || 'admin_archive'}`].filter(Boolean).join('\n')
      });
    }
  }
  return { ...updated, password_hash: undefined };
}
