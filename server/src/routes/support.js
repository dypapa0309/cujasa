import { Router } from 'express';
import { createCustomerErrorReport } from '../services/supportReportService.js';

const router = Router();

router.post('/error-report', async (req, res, next) => {
  try {
    res.status(201).json(await createCustomerErrorReport(req.user, req.body || {}));
  } catch (e) { next(e); }
});

export default router;
