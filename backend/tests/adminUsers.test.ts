import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, opArgs, uuid } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const profile = (n: number, role = 'worker') => ({
  id: uuid(n), full_name: `Person ${n}`, phone: null, ward: null, avatar_url: null, role, is_active: true,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
});

function setup() {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  world.onCall((call) => {
    if (call.kind === 'rpc' && call.name === 'admin_set_user_role') {
      const a = call.rpcArgs as { p_user_id: string; p_role: string };
      return { data: { ...profile(7, a.p_role), id: a.p_user_id } };
    }
    if (call.kind === 'rpc' && call.name === 'admin_set_user_active') {
      const a = call.rpcArgs as { p_user_id: string; p_active: boolean };
      return { data: { ...profile(7), id: a.p_user_id, is_active: a.p_active } };
    }
    if (call.kind === 'from' && call.name === 'profiles' && hasOp(call, 'range')) {
      return { data: [profile(21), profile(22)], count: 42 };
    }
    return undefined;
  });
  return { world, app };
}

describe('GET /admin/users', () => {
  it('lets staff list users (without e-mails) and applies filters and pagination', async () => {
    const { app, world } = setup();
    const staff = world.addActor('staff');
    const res = await request(app)
      .get('/api/v1/admin/users?role=worker&isActive=true&q=50%25_x&page=2&limit=10')
      .set('Authorization', world.bearer(staff));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, limit: 10, total: 42 });
    expect(res.body.data[0]).not.toHaveProperty('email');
    const call = world.calls.find((c) => c.name === 'profiles' && hasOp(c, 'range'))!;
    expect(hasOp(call, 'eq', 'role', 'worker')).toBe(true);
    expect(hasOp(call, 'eq', 'is_active', true)).toBe(true);
    expect(hasOp(call, 'ilike', 'full_name', '%50\\%\\_x%')).toBe(true);
    expect(opArgs(call, 'range')).toEqual([10, 19]);
  });

  it('shows e-mail addresses to admin only, read with the service-role client', async () => {
    const { app, world } = setup();
    world.setAdminEmail(uuid(21), 'person21@example.test');
    const admin = world.addActor('admin');
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', world.bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBe('person21@example.test');
    expect(res.body.data[1].email).toBeNull();
  });

  it('still works for admin if the service-role key is not configured (no e-mails)', async () => {
    const { app, world } = setup();
    world.disableAdminClient();
    const admin = world.addActor('admin');
    const res = await request(app).get('/api/v1/admin/users').set('Authorization', world.bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data[0].email).toBeNull();
  });

  it('denies citizens and workers without querying the database', async () => {
    const { app, world } = setup();
    for (const role of ['citizen', 'worker'] as const) {
      const a = world.addActor(role);
      const before = world.dataCalls().length;
      expect((await request(app).get('/api/v1/admin/users').set('Authorization', world.bearer(a))).status).toBe(403);
      expect(world.dataCalls().length).toBe(before);
    }
  });

  it.each(['role=boss', 'page=0', 'limit=101', 'limit=abc', 'isActive=yes', 'q='])('rejects bad query %s', async (qs) => {
    const { app, world } = setup();
    const staff = world.addActor('staff');
    expect((await request(app).get(`/api/v1/admin/users?${qs}`).set('Authorization', world.bearer(staff))).status).toBe(422);
  });
});

describe('PATCH /admin/users/:id/role', () => {
  it('lets admin change a role through the SQL function', async () => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    const res = await request(app)
      .patch(`/api/v1/admin/users/${uuid(7)}/role`)
      .set('Authorization', world.bearer(admin))
      .send({ role: 'staff', reason: 'Promoted to supervisor' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: uuid(7), role: 'staff' });
    const rpc = world.calls.find((c) => c.kind === 'rpc')!;
    expect(rpc.as).toBe(admin.token);
    expect(rpc.rpcArgs).toEqual({ p_user_id: uuid(7), p_role: 'staff', p_reason: 'Promoted to supervisor' });
  });

  it.each(['citizen', 'worker', 'staff'] as const)('forbids %s before calling the database', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    const res = await request(app)
      .patch(`/api/v1/admin/users/${uuid(7)}/role`)
      .set('Authorization', world.bearer(a))
      .send({ role: 'admin', reason: 'let me in' });
    expect(res.status).toBe(403);
    expect(world.calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it.each([
    [{ role: 'admin' }],
    [{ reason: 'x' }],
    [{ role: 'superuser', reason: 'x' }],
    [{ role: 'staff', reason: '   ' }],
    [{ role: 'staff', reason: 'x'.repeat(301) }],
    [{ role: 'staff', reason: 'ok', extra: true }],
  ])('validates body %j', async (body) => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    expect((await request(app).patch(`/api/v1/admin/users/${uuid(7)}/role`).set('Authorization', world.bearer(admin)).send(body)).status).toBe(422);
  });

  it('rejects a non-UUID id', async () => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    expect((await request(app).patch('/api/v1/admin/users/123/role').set('Authorization', world.bearer(admin)).send({ role: 'staff', reason: 'x' })).status).toBe(422);
  });

  it('maps SQL function errors: self-change 409, unknown user 404', async () => {
    const w = makeWorld();
    const admin = w.addActor('admin');
    w.onCall((c) => {
      if (c.kind !== 'rpc') return undefined;
      const a = c.rpcArgs as { p_user_id: string };
      return a.p_user_id === admin.id
        ? { error: { code: 'CP409', message: 'you cannot change your own role' } }
        : { error: { code: 'CP404', message: 'user not found' } };
    });
    const app = createApp(testEnv(), { supabase: w.gateway });
    const self = await request(app).patch(`/api/v1/admin/users/${admin.id}/role`).set('Authorization', w.bearer(admin)).send({ role: 'citizen', reason: 'test' });
    expect(self.status).toBe(409);
    expect(self.body.error.message).toBe('you cannot change your own role');
    const gone = await request(app).patch(`/api/v1/admin/users/${uuid(5)}/role`).set('Authorization', w.bearer(admin)).send({ role: 'citizen', reason: 'test' });
    expect(gone.status).toBe(404);
  });
});

describe('PATCH /admin/users/:id/active', () => {
  it('lets admin deactivate a user', async () => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    const res = await request(app)
      .patch(`/api/v1/admin/users/${uuid(7)}/active`)
      .set('Authorization', world.bearer(admin))
      .send({ isActive: false, reason: 'Left the department' });
    expect(res.status).toBe(200);
    expect(res.body.data.isActive).toBe(false);
    expect(world.calls.find((c) => c.kind === 'rpc')!.rpcArgs).toEqual({ p_user_id: uuid(7), p_active: false, p_reason: 'Left the department' });
  });

  it('forbids staff and requires a boolean and a reason', async () => {
    const { app, world } = setup();
    const staff = world.addActor('staff');
    expect((await request(app).patch(`/api/v1/admin/users/${uuid(7)}/active`).set('Authorization', world.bearer(staff)).send({ isActive: false, reason: 'x' })).status).toBe(403);
    const admin = world.addActor('admin');
    for (const body of [{ isActive: 'no', reason: 'x' }, { isActive: false }, { reason: 'x' }]) {
      expect((await request(app).patch(`/api/v1/admin/users/${uuid(7)}/active`).set('Authorization', world.bearer(admin)).send(body)).status).toBe(422);
    }
  });
});
