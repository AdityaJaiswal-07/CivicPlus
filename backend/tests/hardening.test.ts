import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { makeWorld } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

describe('API hardening', () => {
  it('marks API responses as non-cacheable', async () => {
    const res = await request(createApp(testEnv(), { supabase: null })).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('applies a stricter limit to writes than to reads', async () => {
    const world = makeWorld();
    const app = createApp(testEnv({ WRITE_RATE_LIMIT_MAX: '2' }), { supabase: world.gateway });
    const a = world.addActor('citizen');
    // reads are not counted against the write limit
    for (let i = 0; i < 5; i++) {
      expect((await request(app).get('/api/v1/auth/me').set('Authorization', world.bearer(a))).status).toBe(200);
    }
    const write = () => request(app).patch('/api/v1/profiles/me').set('Authorization', world.bearer(a)).send({});
    expect((await write()).status).toBe(422);
    expect((await write()).status).toBe(422);
    const third = await write();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('never reflects secrets or stack traces on unexpected errors', async () => {
    const world = makeWorld();
    const a = world.addActor('citizen');
    world.onCall(() => ({ error: { code: 'XX000', message: 'password authentication failed for user "postgres" at db.internal:5432' } }));
    const app = createApp(testEnv(), { supabase: world.gateway });
    const res = await request(app).get('/api/v1/categories').set('Authorization', world.bearer(a));
    expect(res.status).toBe(500);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('password');
    expect(text).not.toContain('db.internal');
    expect(text).not.toContain('at ');
  });
});
