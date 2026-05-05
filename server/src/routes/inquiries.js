import { Router } from 'express';
import { dbInsert, dbList } from '../services/supabaseService.js';
import { createRateLimit, requireAdmin } from '../middleware/rateLimit.js';

const router = Router();
const inquiryRateLimit = createRateLimit({
  scope: 'inquiries',
  windowMs: Number(process.env.INQUIRY_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  maxRequests: Number(process.env.INQUIRY_RATE_LIMIT_MAX || 5)
});

router.post('/', inquiryRateLimit, async (req, res, next) => {
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

router.get('/', requireAdmin, async (req, res, next) => {
  try {
    const rows = await dbList('purchase_inquiries', {}, { order: 'created_at', ascending: false });
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
