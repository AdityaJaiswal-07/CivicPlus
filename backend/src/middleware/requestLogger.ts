import type { RequestHandler } from 'express';

/**
 * One JSON line per request. Logs method, path (no query string, so nothing sensitive in URLs),
 * status, duration and request id. Never logs headers, bodies or tokens.
 */
export function requestLogger(): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
      console.log(
        JSON.stringify({ level: 'info', msg: 'request', requestId: res.locals.requestId, method: req.method, path: req.path, status: res.statusCode, ms }),
      );
    });
    next();
  };
}
