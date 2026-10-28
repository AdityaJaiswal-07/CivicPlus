import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createErrorHandler, notFoundHandler } from '../src/middleware/errorHandler.js';
import { AppError } from '../src/utils/AppError.js';
import { testApp } from './helpers.js';

function buildErrorApp() {
  const app = express();
  app.use(express.json({ limit: '1kb' }));
  app.get('/app-error', () => {
    throw AppError.forbidden();
  });
  app.get('/zod-error', () => {
    z.object({ title: z.string().min(3) }).parse({ title: 'x' });
  });
  app.get('/boom', () => {
    throw new Error('secret database password leaked');
  });
  app.post('/echo', (req, res) => res.json(req.body));
  app.use(notFoundHandler);
  app.use(createErrorHandler({ logErrors: false }));
  return app;
}

describe('error responses', () => {
  it('returns a consistent 404 envelope for unknown routes', async () => {
    const res = await request(testApp()).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.requestId).toBeTruthy();
  });

  it('maps AppError to its status and code', async () => {
    const res = await request(buildErrorApp()).get('/app-error');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action' },
    });
  });

  it('maps Zod errors to 422 VALIDATION_ERROR with details', async () => {
    const res = await request(buildErrorApp()).get('/zod-error');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('title');
  });

  it('hides internal error details on 500', async () => {
    const res = await request(buildErrorApp()).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });

  it('returns 400 INVALID_JSON for malformed JSON bodies', async () => {
    const res = await request(buildErrorApp())
      .post('/echo')
      .set('Content-Type', 'application/json')
      .send('{"broken":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for oversized bodies', async () => {
    const res = await request(buildErrorApp())
      .post('/echo')
      .send({ text: 'a'.repeat(5000) });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 429 RATE_LIMITED in the standard envelope when the limit is exceeded', async () => {
    const app = testApp({ RATE_LIMIT_MAX: '2' });
    await request(app).get('/health');
    await request(app).get('/health');
    const res = await request(app).get('/health');
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});
