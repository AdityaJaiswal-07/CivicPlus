import { Router } from 'express';
import type { SupabaseGateway } from '../config/supabase.js';
import { authenticate } from '../middleware/auth.js';
import { createAdminUsersRouter } from './adminUsers.js';
import { createAuthRouter } from './auth.js';
import { createCategoriesRouter } from './categories.js';
import { createDashboardRouter } from './dashboard.js';
import { createProfilesRouter } from './profiles.js';
import { createReportActionsRouter } from './reportActions.js';
import { createReportsRouter } from './reports.js';

/** All authenticated API routes. /health stays public and is mounted separately. */
export function createV1Router(gateway: SupabaseGateway | null, options: { storageBucket?: string } = {}): Router {
  const router = Router();
  const auth = authenticate(gateway);

  router.use('/auth', auth, createAuthRouter());
  router.use('/profiles', auth, createProfilesRouter());
  router.use('/categories', auth, createCategoriesRouter());
  router.use('/reports', auth, createReportActionsRouter());
  router.use('/reports', auth, createReportsRouter(gateway, options.storageBucket));
  router.use('/dashboard', auth, createDashboardRouter());
  router.use('/admin/users', auth, createAdminUsersRouter(gateway));

  return router;
}
