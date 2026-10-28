import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { extractBearerToken } from '../src/middleware/auth.js';
import { makeWorld } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

function setup() {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  return { world, app };
}

describe('extractBearerToken', () => {
  it('accepts a normal bearer header', () => {
    expect(extractBearerToken('Bearer abc.def-ghi_1')).toBe('abc.def-ghi_1');
  });
  it.each([undefined, '', 'abc', 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer ' + 'x'.repeat(5000)])(
    'rejects %s',
    (h) => {
      expect(() => extractBearerToken(h as string | undefined)).toThrowError();
    },
  );
});

describe('authentication middleware', () => {
  it('returns 401 when the Authorization header is missing', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for a token Supabase does not accept', async () => {
    const { app } = setup();
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('returns 403 for a deactivated account, even with a valid token', async () => {
    const { app, world } = setup();
    const a = world.addActor('worker', { isActive: false });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', world.bearer(a));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/deactivated/i);
  });

  it('returns 403 when a valid user has no profile row', async () => {
    const { app, world } = setup();
    const a = world.addActor('citizen', { hasProfile: false });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', world.bearer(a));
    expect(res.status).toBe(403);
  });

  it('returns 503 (not a crash) when Supabase is not configured', async () => {
    const app = createApp(testEnv(), { supabase: null });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer abc');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('keeps /health public', async () => {
    const app = createApp(testEnv(), { supabase: null });
    expect((await request(app).get('/api/v1/health')).status).toBe(200);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns identity, verified flag and role from the database', async () => {
    const { app, world } = setup();
    const a = world.addActor('staff', { emailVerified: false });
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', world.bearer(a));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: a.id, email: a.email, emailVerified: false, role: 'staff' });
    expect(res.body.data.profile.role).toBe('staff');
  });

  it('never takes the role from request headers, query or body', async () => {
    const { app, world } = setup();
    const a = world.addActor('citizen');
    const res = await request(app)
      .get('/api/v1/auth/me?role=admin')
      .set('Authorization', world.bearer(a))
      .set('X-User-Role', 'admin')
      .set('X-Role', 'admin');
    expect(res.body.data.role).toBe('citizen');
    // and the citizen is still locked out of admin routes
    const adm = await request(app)
      .get('/api/v1/admin/users')
      .set('Authorization', world.bearer(a))
      .set('X-User-Role', 'admin');
    expect(adm.status).toBe(403);
  });

  it('uses the caller’s own token for database access, not the service role', async () => {
    const { app, world } = setup();
    const a = world.addActor('citizen');
    await request(app).get('/api/v1/auth/me').set('Authorization', world.bearer(a));
    expect(world.calls.every((c) => c.as === a.token)).toBe(true);
  });
});
