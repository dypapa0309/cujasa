import { Router } from 'express';
import { dbList } from '../services/supabaseService.js';

const router = Router();

router.get('/active', async (req, res, next) => {
  try {
    const now = new Date();
    const rows = await dbList('announcements', { status: 'active', audience: 'all' }, { order: 'created_at', ascending: false, limit: 20 });
    const active = rows.find((row) => {
      const startsAt = row.starts_at ? new Date(row.starts_at) : null;
      const endsAt = row.ends_at ? new Date(row.ends_at) : null;
      return (!startsAt || startsAt <= now) && (!endsAt || endsAt >= now);
    });
    res.json(active || null);
  } catch (e) {
    next(e);
  }
});

export default router;
