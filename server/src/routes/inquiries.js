import { Router } from 'express';
import { dbInsert, dbList } from '../services/supabaseService.js';

const router = Router();

router.post('/', async (req, res, next) => {
  try {
    const { name, phone, plan, source } = req.body;
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'name, phone 필수' });
    }
    const inquiry = await dbInsert('purchase_inquiries', {
      name: name.trim(),
      phone: phone.trim(),
      plan: plan || 'onetime',
      source: source || 'cujasa',
    });
    res.status(201).json(inquiry);
  } catch (e) { next(e); }
});

router.get('/', async (req, res, next) => {
  try {
    const rows = await dbList('purchase_inquiries', {}, { order: 'created_at', ascending: false });
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
