import type { RequestHandler } from 'express';
import type { Role } from '../types/domain.js';
import { AppError } from '../utils/AppError.js';
import { getAuth } from './auth.js';

/** Must run after `authenticate`. The database re-checks the role again on every write. */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (_req, res, next) => {
    try {
      const { role } = getAuth(res);
      if (!allowed.includes(role)) throw AppError.forbidden();
      next();
    } catch (err) {
      next(err);
    }
  };
}
