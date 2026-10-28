import type { RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';

interface Schemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

interface Validated {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/**
 * Validate body / query / params with Zod. Parsed (trimmed, coerced, defaulted)
 * values are stored on res.locals, because Express 5 makes req.query read-only.
 * Failures become 422 VALIDATION_ERROR through the shared error handler.
 */
export function validate(schemas: Schemas): RequestHandler {
  return (req, res, next) => {
    try {
      const out: Validated = {};
      if (schemas.params) out.params = schemas.params.parse(req.params);
      if (schemas.query) out.query = schemas.query.parse(req.query);
      if (schemas.body) out.body = schemas.body.parse(req.body ?? {});
      res.locals.valid = out;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const validBody = <T>(res: Response): T => (res.locals.valid as Validated).body as T;
export const validQuery = <T>(res: Response): T => (res.locals.valid as Validated).query as T;
export const validParams = <T>(res: Response): T => (res.locals.valid as Validated).params as T;
