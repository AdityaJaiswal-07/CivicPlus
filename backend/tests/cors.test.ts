import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

describe('CORS', () => {
  it('allows a configured origin', async () => {
    const res = await request(testApp()).get('/health').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('rejects an origin that is not configured', async () => {
    const res = await request(testApp()).get('/health').set('Origin', 'https://evil.example.com');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_ORIGIN_NOT_ALLOWED');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight for an allowed origin', async () => {
    const res = await request(testApp())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('supports adding a deployed origin through env', async () => {
    const app = testApp({ ALLOWED_ORIGINS: 'http://localhost:5173,https://app.example.com' });
    const res = await request(app).get('/health').set('Origin', 'https://app.example.com');
    expect(res.status).toBe(200);
  });
});
