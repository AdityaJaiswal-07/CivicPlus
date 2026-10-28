import type { Response } from 'express';

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
}

export interface SuccessBody<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ErrorBody {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  options: { status?: number; meta?: PaginationMeta } = {},
): Response {
  const body: SuccessBody<T> = { success: true, data };
  if (options.meta) body.meta = options.meta;
  return res.status(options.status ?? 200).json(body);
}

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Response {
  const requestId = res.locals.requestId as string | undefined;
  const body: ErrorBody = { success: false, error: { code, message } };
  if (details !== undefined) body.error.details = details;
  if (requestId) body.error.requestId = requestId;
  return res.status(status).json(body);
}
