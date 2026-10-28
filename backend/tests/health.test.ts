import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('health endpoint', () => {
  it('GET /api/v1/health returns the success envelope', async () => {
    const res = await request(testApp()).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.service).toBe('civicplus-backend');
    expect(typeof res.body.data.timestamp).toBe('string');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /health works without the version prefix', async () => {
    const res = await request(testApp()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
  });

  it('does not reveal the framework via X-Powered-By', async () => {
    const res = await request(testApp()).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
