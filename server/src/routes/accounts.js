import { Router } from 'express';
import { createAccount, deleteAccount, getAccount, listAccounts, updateAccount } from '../services/accountService.js';

const router = Router();
router.get('/', async (req, res, next) => { try { res.json(await listAccounts()); } catch (e) { next(e); } });
router.post('/', async (req, res, next) => { try { res.status(201).json(await createAccount(req.body)); } catch (e) { next(e); } });
router.get('/:accountId', async (req, res, next) => { try { res.json(await getAccount(req.params.accountId)); } catch (e) { next(e); } });
router.patch('/:accountId', async (req, res, next) => { try { res.json(await updateAccount(req.params.accountId, req.body)); } catch (e) { next(e); } });
router.delete('/:accountId', async (req, res, next) => { try { await deleteAccount(req.params.accountId); res.status(204).end(); } catch (e) { next(e); } });
export default router;
