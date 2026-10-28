import cors from 'cors';
import express, { type Express } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from './config/env.js';
import { createSupabaseGateway, type SupabaseGateway } from './config/supabase.js';
import { createErrorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { requestLogger } from './middleware/requestLogger.js';
import { healthRouter } from './routes/health.js';
import { createV1Router } from './routes/v1.js';
import { AppError } from './utils/AppError.js';
import { sendError } from './utils/response.js';

export interface AppDeps {
  /** Override the Supabase gateway (tests). `null` = not configured. Default: built from env. */
  supabase?: SupabaseGateway | null;
}

export function createApp(env: Env, deps: AppDeps = {}): Express {
  const gateway = deps.supabase !== undefined ? deps.supabase : createSupabaseGateway(env);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestId);
  if (env.NODE_ENV !== 'test') app.use(requestLogger());
  app.use(helmet());

  // CORS: only origins listed in ALLOWED_ORIGINS. Requests without an Origin
  // header (curl, server-to-server, health probes) are not browser requests.
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.ALLOWED_ORIGINS.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, 'CORS_ORIGIN_NOT_ALLOWED', 'Origin is not allowed'));
      },
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['X-Request-Id'],
      maxAge: 600,
    }),
  );

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req, res) => {
        sendError(res, 429, 'RATE_LIMITED', 'Too many requests, please try again later');
      },
    }),
  );

  // Stricter limit for anything that changes data.
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.WRITE_RATE_LIMIT_MAX,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS',
      handler: (_req, res) => {
        sendError(res, 429, 'RATE_LIMITED', 'Too many changes in a short time, please slow down');
      },
    }),
  );

  // API responses are personal data: never let browsers or proxies cache them.
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  // Platform health probe (no version prefix) and versioned API route.
  app.use('/health', healthRouter);
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1', createV1Router(gateway, { storageBucket: env.STORAGE_BUCKET }));

  app.use(notFoundHandler);
  app.use(createErrorHandler({ logErrors: env.NODE_ENV !== 'test' }));

  return app;
}
