import { Router } from 'express';
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from '../services/accountService.js';
import { dbInsert, dbList } from '../services/supabaseService.js';

const router = Router();

router.get('/', async (req, res, next) => {
  try {
    const all = await listAccounts();
    if (req.user?.type === 'user') {
      return res.json(all.filter((a) => req.user.allowedAccountIds.includes(a.id)));
    }
    res.json(all);
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    if (req.user?.type === 'user') {
      const current = await dbList('user_accounts', { user_id: req.user.userId });
      if (current.length >= req.user.maxAccounts) {
        const error = new Error(`계정은 최대 ${req.user.maxAccounts}개까지 생성할 수 있습니다. 추가 계정은 별도 문의해주세요.`);
        error.status = 403;
        throw error;
      }
    }
    const account = await createAccount(req.body);
    if (req.user?.type === 'user') {
      await dbInsert('user_accounts', { user_id: req.user.userId, account_id: account.id });
    }
    res.status(201).json(account);
  } catch (e) { next(e); }
});

router.get('/:accountId', async (req, res, next) => {
  try {
    const account = await getAccount(req.params.accountId);
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(account);
  } catch (e) { next(e); }
});

router.patch('/:accountId', async (req, res, next) => {
  try {
    if (req.user?.type === 'user' && !req.user.allowedAccountIds.includes(req.params.accountId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json(await updateAccount(req.params.accountId, req.body));
  } catch (e) { next(e); }
});

router.delete('/:accountId', async (req, res, next) => {
  try {
    if (req.user?.type === 'user') return res.status(403).json({ error: 'Admin only' });
    await deleteAccount(req.params.accountId);
    res.status(204).end();
  } catch (e) { next(e); }
});

export default router;
