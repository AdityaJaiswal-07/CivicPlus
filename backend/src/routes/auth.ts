import { Router } from 'express';
import { getAuth } from '../middleware/auth.js';
import { toProfileDto } from '../types/domain.js';
import { sendSuccess } from '../utils/response.js';

/** Mounted behind `authenticate`. */
export function createAuthRouter(): Router {
  const router = Router();

  router.get('/me', (_req, res) => {
    const a = getAuth(res);
    sendSuccess(res, {
      id: a.userId,
      email: a.email,
      emailVerified: a.emailVerified,
      role: a.role,
      profile: toProfileDto(a.profile),
    });
  });

  return router;
}
