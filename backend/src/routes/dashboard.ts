import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, validQuery } from '../middleware/validate.js';
import { firstRow, unwrapRequired } from '../utils/dbError.js';
import { sendSuccess } from '../utils/response.js';

const summaryQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/** Statistics are computed inside the database (one consistent snapshot). Staff/admin only, re-checked in SQL. */
export function createDashboardRouter(): Router {
  const router = Router();

  router.get('/summary', requireRole('staff', 'admin'), validate({ query: summaryQuery }), async (_req, res) => {
    const a = getAuth(res);
    const { days } = validQuery<z.infer<typeof summaryQuery>>(res);
    const r = await a.db.rpc('dashboard_summary', { p_days: days });
    sendSuccess(res, unwrapRequired<Record<string, unknown>>({ data: firstRow(r.data), error: r.error }));
  });

  return router;
}
