import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, opArgs, uuid } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const row = (n: number, active = true) => ({
  id: uuid(n), slug: `cat-${n}`, name: `Category ${n}`, description: null, is_active: active, sort_order: n,
});

function setup() {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  world.onCall((call) => {
    if (call.name !== 'categories') return undefined;
    if (hasOp(call, 'insert')) return { data: { ...row(99), ...(opArgs(call, 'insert')![0] as object) } };
    if (hasOp(call, 'update')) return { data: { ...row(1), ...(opArgs(call, 'update')![0] as object) } };
    const onlyActive = hasOp(call, 'eq', 'is_active', true);
    return { data: [row(1), row(2, false)].filter((r) => !onlyActive || r.is_active) };
  });
  return { world, app };
}

describe('GET /categories', () => {
  it('lists active categories by default, in camelCase, for any signed-in role', async () => {
    const { app, world } = setup();
    for (const role of ['citizen', 'worker', 'staff', 'admin'] as const) {
      const a = world.addActor(role);
      const res = await request(app).get('/api/v1/categories').set('Authorization', world.bearer(a));
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        { id: uuid(1), slug: 'cat-1', name: 'Category 1', description: null, isActive: true, sortOrder: 1 },
      ]);
    }
  });

  it('can include inactive categories', async () => {
    const { app, world } = setup();
    const a = world.addActor('citizen');
    const res = await request(app).get('/api/v1/categories?includeInactive=true').set('Authorization', world.bearer(a));
    expect(res.body.data).toHaveLength(2);
  });

  it('rejects a bad includeInactive value and unauthenticated callers', async () => {
    const { app, world } = setup();
    const a = world.addActor('citizen');
    expect((await request(app).get('/api/v1/categories?includeInactive=maybe').set('Authorization', world.bearer(a))).status).toBe(422);
    expect((await request(app).get('/api/v1/categories')).status).toBe(401);
  });
});

describe('category management', () => {
  it('lets admin create and update; everyone else gets 403 before any database call', async () => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    const body = { slug: 'street-lights', name: 'Street lights', sortOrder: 5 };
    const ok = await request(app).post('/api/v1/categories').set('Authorization', world.bearer(admin)).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ slug: 'street-lights', name: 'Street lights', sortOrder: 5 });

    const up = await request(app).patch(`/api/v1/categories/${uuid(1)}`).set('Authorization', world.bearer(admin)).send({ isActive: false });
    expect(up.status).toBe(200);
    expect(up.body.data.isActive).toBe(false);

    for (const role of ['citizen', 'worker', 'staff'] as const) {
      const a = world.addActor(role);
      const before = world.dataCalls().length;
      expect((await request(app).post('/api/v1/categories').set('Authorization', world.bearer(a)).send(body)).status).toBe(403);
      expect((await request(app).patch(`/api/v1/categories/${uuid(1)}`).set('Authorization', world.bearer(a)).send({ name: 'Hacked' })).status).toBe(403);
      expect(world.dataCalls().length).toBe(before);
    }
  });

  it.each([
    [{ slug: 'Bad Slug', name: 'Valid name' }],
    [{ slug: 'ok-slug', name: 'x' }],
    [{ slug: 'ok-slug', name: 'Valid name', extra: 1 }],
    [{ slug: 'ok-slug', name: 'Valid name', sortOrder: -1 }],
  ])('validates category input %j', async (body) => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    expect((await request(app).post('/api/v1/categories').set('Authorization', world.bearer(admin)).send(body)).status).toBe(422);
  });

  it('rejects a malformed id and an empty update', async () => {
    const { app, world } = setup();
    const admin = world.addActor('admin');
    expect((await request(app).patch('/api/v1/categories/not-a-uuid').set('Authorization', world.bearer(admin)).send({ name: 'Valid' })).status).toBe(422);
    expect((await request(app).patch(`/api/v1/categories/${uuid(1)}`).set('Authorization', world.bearer(admin)).send({})).status).toBe(422);
  });

  it('maps a duplicate slug to 409', async () => {
    const w = makeWorld();
    const admin = w.addActor('admin');
    w.onCall((c) => (hasOp(c, 'insert') ? { error: { code: '23505', message: 'duplicate key ... "categories_slug_key"' } } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    const res = await request(app).post('/api/v1/categories').set('Authorization', w.bearer(admin)).send({ slug: 'dup', name: 'Duplicate' });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain('categories_slug_key');
  });
});
