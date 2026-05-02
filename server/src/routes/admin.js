import { Router } from 'express';
import {
  createUser,
  grantUserProduct,
  listAvailableProducts,
  listUserProducts,
  listUsers,
  revokeUserProduct,
  updateUser,
  updateUserProductSettings
} from '../services/authService.js';
import { dbDelete, dbGet, dbInsert, dbList, dbUpdate } from '../services/supabaseService.js';
import { hashPassword } from '../utils/password.js';
import { operationAccountRows, operationSummary } from '../services/operationsService.js';

const router = Router();

// 관리자만 접근 가능
function adminOnly(req, res, next) {
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.use(adminOnly);

router.get('/operations/summary', async (req, res, next) => {
  try { res.json(await operationSummary()); } catch (e) { next(e); }
});

router.get('/operations/accounts', async (req, res, next) => {
  try { res.json(await operationAccountRows()); } catch (e) { next(e); }
});

// 구매자 목록
router.get('/users', async (req, res, next) => {
  try {
    const users = await listUsers();
    const result = await Promise.all(users.map(async (u) => {
      const [ua, products] = await Promise.all([
        dbList('user_accounts', { user_id: u.id }),
        listUserProducts(u.id, { includeSettings: true })
      ]);
      const accounts = await Promise.all(ua.map((x) => dbGet('accounts', { id: x.account_id })));
      return {
        ...u,
        buyerName: u.buyer_name || '',
        password_hash: undefined,
        accounts: accounts.filter(Boolean),
        products
      };
    }));
    res.json(result);
  } catch (e) { next(e); }
});

router.get('/products', async (req, res, next) => {
  try {
    res.json(await listAvailableProducts());
  } catch (e) { next(e); }
});

router.get('/announcements', async (req, res, next) => {
  try {
    res.json(await dbList('announcements', {}, { order: 'created_at', ascending: false }));
  } catch (e) { next(e); }
});

router.post('/announcements', async (req, res, next) => {
  try {
    const { title, message, status = 'draft', starts_at, startsAt, ends_at, endsAt } = req.body || {};
    if (!String(title || '').trim() || !String(message || '').trim()) {
      return res.status(400).json({ error: 'title, message 필수' });
    }
    const row = await dbInsert('announcements', {
      title: String(title).trim(),
      message: String(message).trim(),
      status: ['draft', 'active', 'inactive'].includes(status) ? status : 'draft',
      audience: 'all',
      starts_at: starts_at || startsAt || null,
      ends_at: ends_at || endsAt || null
    });
    res.status(201).json(row);
  } catch (e) { next(e); }
});

router.patch('/announcements/:id', async (req, res, next) => {
  try {
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title || '').trim();
    if (req.body.message !== undefined) patch.message = String(req.body.message || '').trim();
    if (req.body.status !== undefined && ['draft', 'active', 'inactive'].includes(req.body.status)) patch.status = req.body.status;
    if (req.body.starts_at !== undefined || req.body.startsAt !== undefined) patch.starts_at = req.body.starts_at || req.body.startsAt || null;
    if (req.body.ends_at !== undefined || req.body.endsAt !== undefined) patch.ends_at = req.body.ends_at || req.body.endsAt || null;
    if (patch.title === '' || patch.message === '') return res.status(400).json({ error: 'title, message 필수' });
    const [updated] = await dbUpdate('announcements', { id: req.params.id }, patch);
    if (!updated) return res.status(404).json({ error: 'Announcement not found' });
    res.json(updated);
  } catch (e) { next(e); }
});

router.delete('/announcements/:id', async (req, res, next) => {
  try {
    await dbDelete('announcements', { id: req.params.id });
    res.status(204).end();
  } catch (e) { next(e); }
});

// 구매자 생성
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, maxAccounts = 2, buyerName, buyer_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email, password 필수' });
    const user = await createUser(email, password, maxAccounts, buyerName ?? buyer_name ?? '');
    res.status(201).json({ ...user, password_hash: undefined });
  } catch (e) { next(e); }
});

// 구매자 수정 (상태, 계정 한도)
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { status, maxAccounts, password, buyerName, buyer_name } = req.body;
    const patch = {};
    if (status) patch.status = status;
    if (maxAccounts != null) patch.max_accounts = maxAccounts;
    const buyerNameValue = buyerName ?? buyer_name;
    if (buyerNameValue !== undefined) patch.buyer_name = String(buyerNameValue || '').trim() || null;
    if (password) patch.password_hash = hashPassword(password);
    const [updated] = await updateUser(req.params.id, patch);
    res.json({ ...updated, password_hash: undefined });
  } catch (e) { next(e); }
});

// 계정 할당
router.post('/users/:id/accounts', async (req, res, next) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId 필수' });
    const user = await dbGet('users', { id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const existing = await dbList('user_accounts', { user_id: req.params.id });
    if (existing.length >= user.max_accounts) {
      return res.status(403).json({ error: `계정 한도 초과 (최대 ${user.max_accounts}개)` });
    }
    const ua = await dbInsert('user_accounts', { user_id: req.params.id, account_id: accountId });
    res.status(201).json(ua);
  } catch (e) { next(e); }
});

// 계정 할당 해제
router.delete('/users/:id/accounts/:accountId', async (req, res, next) => {
  try {
    await dbDelete('user_accounts', { user_id: req.params.id, account_id: req.params.accountId });
    res.status(204).end();
  } catch (e) { next(e); }
});

router.post('/users/:id/products', async (req, res, next) => {
  try {
    const { productId, status = 'active', role = 'customer' } = req.body;
    if (!productId) return res.status(400).json({ error: 'productId 필수' });
    const user = await dbGet('users', { id: req.params.id });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const grant = await grantUserProduct(req.params.id, productId, { status, role });
    res.status(201).json(grant);
  } catch (e) { next(e); }
});

router.delete('/users/:id/products/:productId', async (req, res, next) => {
  try {
    await revokeUserProduct(req.params.id, req.params.productId);
    res.status(204).end();
  } catch (e) { next(e); }
});

router.patch('/users/:id/products/:productId/settings', async (req, res, next) => {
  try {
    if (req.params.productId !== 'cujasa') {
      return res.status(400).json({ error: 'CUJASA 제품 설정만 지원합니다.' });
    }
    const updated = await updateUserProductSettings(req.params.id, req.params.productId, req.body || {});
    const settings = updated.settings && typeof updated.settings === 'object' ? updated.settings : {};
    res.json({
      productId: req.params.productId,
      settingsSummary: {
        hasCoupangAccessKey: Boolean(settings.coupangAccessKey),
        hasCoupangSecretKey: Boolean(settings.coupangSecretKey),
        hasCoupangPartnerId: Boolean(settings.coupangPartnerId),
        defaultTrackingCode: settings.defaultTrackingCode || ''
      },
      settings: {
        coupangAccessKey: settings.coupangAccessKey || '',
        coupangPartnerId: settings.coupangPartnerId || '',
        defaultTrackingCode: settings.defaultTrackingCode || '',
        hasCoupangSecretKey: Boolean(settings.coupangSecretKey)
      }
    });
  } catch (e) { next(e); }
});

export default router;
