import { Router } from 'express';
import { createUser, listUsers, updateUser } from '../services/authService.js';
import { dbDelete, dbGet, dbInsert, dbList } from '../services/supabaseService.js';
import { hashPassword } from '../utils/password.js';

const router = Router();

// 관리자만 접근 가능
function adminOnly(req, res, next) {
  if (req.user?.type !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

router.use(adminOnly);

// 구매자 목록
router.get('/users', async (req, res, next) => {
  try {
    const users = await listUsers();
    const result = await Promise.all(users.map(async (u) => {
      const ua = await dbList('user_accounts', { user_id: u.id });
      const accounts = await Promise.all(ua.map((x) => dbGet('accounts', { id: x.account_id })));
      return { ...u, password_hash: undefined, accounts: accounts.filter(Boolean) };
    }));
    res.json(result);
  } catch (e) { next(e); }
});

// 구매자 생성
router.post('/users', async (req, res, next) => {
  try {
    const { email, password, maxAccounts = 4 } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email, password 필수' });
    const user = await createUser(email, password, maxAccounts);
    res.status(201).json({ ...user, password_hash: undefined });
  } catch (e) { next(e); }
});

// 구매자 수정 (상태, 계정 한도)
router.patch('/users/:id', async (req, res, next) => {
  try {
    const { status, maxAccounts, password } = req.body;
    const patch = {};
    if (status) patch.status = status;
    if (maxAccounts != null) patch.max_accounts = maxAccounts;
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

export default router;
