import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, opArgs } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

function setup() {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  const citizen = world.addActor('citizen');
  world.onCall((call, who) => {
    if (call.name === 'profiles' && hasOp(call, 'update') && who) {
      const patch = opArgs(call, 'update')![0] as Record<string, unknown>;
      return { data: { ...world.profileOf(who), ...patch } };
    }
    return undefined;
  });
  return { world, app, citizen };
}

describe('GET /profiles/me', () => {
  it('returns the caller’s profile in camelCase', async () => {
    const { app, world, citizen } = setup();
    const res = await request(app).get('/api/v1/profiles/me').set('Authorization', world.bearer(citizen));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: citizen.id, role: 'citizen', isActive: true });
    expect(res.body.data).toHaveProperty('fullName');
  });
  it('requires authentication', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/profiles/me')).status).toBe(401);
  });
});

describe('PATCH /profiles/me', () => {
  const patch = (app: ReturnType<typeof setup>['app'], auth: string, body: unknown) =>
    request(app).patch('/api/v1/profiles/me').set('Authorization', auth).send(body as object);

  it('updates allowed fields, scoped to the caller’s own row', async () => {
    const { app, world, citizen } = setup();
    const res = await patch(app, world.bearer(citizen), { fullName: '  Asha Rao ', phone: '+919876543210', ward: 'Ward 7' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fullName: 'Asha Rao', phone: '+919876543210', ward: 'Ward 7' });
    const call = world.calls.find((c) => c.name === 'profiles' && hasOp(c, 'update'))!;
    expect(opArgs(call, 'update')![0]).toEqual({ full_name: 'Asha Rao', phone: '+919876543210', ward: 'Ward 7' });
    expect(hasOp(call, 'eq', 'id', citizen.id)).toBe(true);
  });

  it('clears a field when given an empty string or null', async () => {
    const { app, world, citizen } = setup();
    const res = await patch(app, world.bearer(citizen), { phone: '', ward: null });
    expect(res.status).toBe(200);
    const call = world.calls.find((c) => hasOp(c, 'update'))!;
    expect(opArgs(call, 'update')![0]).toEqual({ phone: null, ward: null });
  });

  it.each([
    [{ role: 'admin' }],
    [{ isActive: false }],
    [{ is_active: true }],
    [{ id: '00000000-0000-4000-8000-000000000001' }],
    [{ fullName: 'ok', role: 'admin' }],
  ])('rejects protected or unknown fields %j with 422 and never touches the database', async (body) => {
    const { app, world, citizen } = setup();
    const res = await patch(app, world.bearer(citizen), body);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(world.calls.some((c) => hasOp(c, 'update'))).toBe(false);
  });

  it.each([
    [{}],
    [{ phone: 'abc' }],
    [{ phone: '12345' }],
    [{ fullName: 'x'.repeat(101) }],
    [{ avatarUrl: 'http://insecure.example/a.png' }],
    [{ avatarUrl: 'javascript:alert(1)' }],
  ])('rejects invalid input %j', async (body) => {
    const { app, world, citizen } = setup();
    expect((await patch(app, world.bearer(citizen), body)).status).toBe(422);
  });

  it('maps a database rejection to the right status without leaking constraint names', async () => {
    const w = makeWorld();
    const c = w.addActor('citizen');
    w.onCall((call) => (hasOp(call, 'update') ? { error: { code: '23514', message: 'check constraint "profiles_phone_format"' } } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    const res = await patch(app, w.bearer(c), { fullName: 'Valid Name' });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).not.toContain('profiles_phone_format');
  });
});
