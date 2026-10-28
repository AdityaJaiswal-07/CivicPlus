import { AppError, type ErrorCode } from './AppError.js';

export interface DbErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

/** Our SQL functions raise these custom SQLSTATEs (see docs/DATABASE.md). */
const FUNCTION_CODES: Record<string, [number, ErrorCode]> = {
  CP401: [401, 'UNAUTHORIZED'],
  CP403: [403, 'FORBIDDEN'],
  CP404: [404, 'NOT_FOUND'],
  CP409: [409, 'CONFLICT'],
  CP422: [422, 'VALIDATION_ERROR'],
};

const INVALID_DATA_CODES = new Set(['23514', '23503', '23502', '22P02', '22001', '22023', '22003', '22007', '22008']);

/** Messages raised by our own SQL functions are written for users; keep them short. */
function functionMessage(message: string | null | undefined): string {
  const m = (message ?? '').trim();
  return m ? m.slice(0, 200) : 'Request could not be completed';
}

/**
 * Translate a Supabase/PostgREST/Postgres error into an AppError.
 * Anything unknown becomes a generic 500 so database internals never reach clients;
 * the original error is kept on `cause` for server-side logging.
 */
export function mapDbError(err: DbErrorLike): AppError {
  const code = err.code ?? '';

  const fn = FUNCTION_CODES[code];
  if (fn) return new AppError(fn[0], fn[1], functionMessage(err.message));

  if (code === '42501') return AppError.forbidden();
  if (code === 'PGRST116') return AppError.notFound();
  if (code === 'PGRST301' || code === 'PGRST303') return AppError.unauthorized('Session is invalid or expired');
  if (code === '23505') return AppError.conflict('A record with these details already exists');
  if (INVALID_DATA_CODES.has(code)) {
    return new AppError(422, 'VALIDATION_ERROR', 'The submitted data is not valid');
  }

  // No SQLSTATE at all usually means the network call itself failed.
  if (code === '' && /fetch|network|ECONN|ETIMEDOUT/i.test(err.message ?? '')) {
    return AppError.unavailable('Database is temporarily unavailable');
  }

  const out = new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side');
  out.cause = { code, message: err.message };
  return out;
}

/** Shape shared by every supabase-js response; `data` is cast by the caller. */
export interface DbResult {
  data: unknown;
  error: DbErrorLike | null;
}

/** Return `data`, or throw the mapped AppError. `data` may still be null (e.g. maybeSingle). */
export function unwrap<T>(res: DbResult): T | null {
  if (res.error) throw mapDbError(res.error);
  return (res.data ?? null) as T | null;
}

/** Like unwrap, but a missing row is a 404. */
export function unwrapRequired<T>(res: DbResult, notFoundMessage = 'Resource not found'): T {
  const data = unwrap<T>(res);
  if (data === null) throw AppError.notFound(notFoundMessage);
  return data;
}

/** RPC calls returning one composite value can come back as an object or a 1-row array. */
export function firstRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null;
  return (data as T | null | undefined) ?? null;
}
