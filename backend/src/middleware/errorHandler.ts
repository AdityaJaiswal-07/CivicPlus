import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/AppError.js';
import { sendError } from '../utils/response.js';

export const notFoundHandler: RequestHandler = (req: Request, res: Response, _next: NextFunction) => {
  sendError(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`);
};

interface HttpLikeError {
  status?: number;
  statusCode?: number;
  type?: string;
}

export function createErrorHandler(options: { logErrors: boolean }): ErrorRequestHandler {
  return (err: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof AppError) {
      if (err.statusCode >= 500 && options.logErrors) {
        console.error('Server error:', err.code, err.message, err.cause ?? '');
      }
      sendError(res, err.statusCode, err.code, err.message, err.details);
      return;
    }

    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
      sendError(res, 422, 'VALIDATION_ERROR', 'Request validation failed', details);
      return;
    }

    const httpErr = err as HttpLikeError;
    if (httpErr?.type === 'entity.parse.failed') {
      sendError(res, 400, 'INVALID_JSON', 'Request body is not valid JSON');
      return;
    }
    if (httpErr?.type === 'entity.too.large') {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
      return;
    }

    if (options.logErrors) {
      console.error('Unhandled error:', err);
    }
    // Never leak internal error details to clients.
    sendError(res, 500, 'INTERNAL_ERROR', 'Something went wrong on our side');
  };
}
