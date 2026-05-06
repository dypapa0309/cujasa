import { Router } from 'express';
import { dbInsert, dbList } from '../services/supabaseService.js';
import { createRateLimit, requireAdmin } from '../middleware/rateLimit.js';
import { sendOpsAlert } from '../services/notificationService.js';

const router = Router();
const inquiryRateLimit = createRateLimit({
  scope: 'inquiries',
  windowMs: Number(process.env.INQUIRY_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  maxRequests: Number(process.env.INQUIRY_RATE_LIMIT_MAX || 5)
});

router.post('/', inquiryRateLimit, async (req, res, next) => {
  try {
    const { name, phone, plan, source, productId, topic, questionPath, message } = req.body || {};
    if (!name?.trim() || !phone?.trim()) {
      return res.status(400).json({ error: 'name, phone 필수' });
    }
    const payload = {
      name: name.trim(),
      phone: phone.trim(),
      plan: plan || 'onetime',
      source: source || 'cujasa',
      product_id: productId || null,
      topic: topic || null,
      question_path: Array.isArray(questionPath) ? questionPath : [],
      message: message || null,
      status: 'new'
    };
    let inquiry;
    try {
      inquiry = await dbInsert('purchase_inquiries', payload);
    } catch (error) {
      if (!/product_id|question_path|message|status|topic|schema cache|column/i.test(error.message || '')) throw error;
      inquiry = await dbInsert('purchase_inquiries', {
        name: payload.name,
        phone: payload.phone,
        plan: payload.plan,
        source: payload.source
      });
    }
    await sendOpsAlert('purchase_inquiry_created', {
      title: '상담 문의 접수',
      code: 'PURCHASE_INQUIRY',
      message: `${payload.name} / ${payload.phone}`,
      hint: payload.topic ? `상담 주제: ${payload.topic}` : '관리자 문의 목록을 확인하세요.',
      payload: {
        inquiryId: inquiry.id,
        productId: payload.product_id,
        topic: payload.topic,
        source: payload.source,
        questionPath: payload.question_path,
        message: payload.message
      }
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
