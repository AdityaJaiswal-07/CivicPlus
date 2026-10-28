import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, opArgs, uuid, type Actor } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const CAT = uuid(500);
const RID = uuid(900);
const valid = { categoryId: CAT, title: 'Overflowing bin', description: 'Bin has been overflowing for days', addressText: 'Near Gandhi Chowk' };
const auth = (w: ReturnType<typeof makeWorld>, a: Actor) => ({ Authorization: w.bearer(a) });

const row = (citizen: string, photos: string[], over: Record<string, unknown> = {}) => ({
  id: RID, citizen_id: citizen, category_id: CAT, title: 'Overflowing bin', description: 'Bin has been overflowing for days',
  address_text: 'Near Gandhi Chowk', latitude: null, longitude: null, ward: null, status: 'submitted', priority: 'normal',
  photo_paths: photos, created_at: 'x', updated_at: 'x', resolved_at: null, category: null, citizen: null, ...over,
});

function setup(stored: (who: Actor | null) => ReturnType<typeof row> = (w) => row(w?.id ?? uuid(1), [])) {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  world.onCall((call, who) => {
    if (call.name !== 'reports') return undefined;
    if (hasOp(call, 'insert')) {
      const v = opArgs(call, 'insert')![0] as { citizen_id: string; photo_paths: string[] };
      return { data: row(v.citizen_id, v.photo_paths) };
    }
    if (hasOp(call, 'update')) {
      const cur = stored(who);
      return { data: { ...cur, ...(opArgs(call, 'update')![0] as object) } };
    }
    return { data: stored(who) };
  });
  return { world, app };
}

describe('POST /reports/photos/upload-url', () => {
  it('returns a server-chosen path inside the caller’s own folder, via the service-role client', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, c)).send({ contentType: 'image/png', sizeBytes: 1234 });
    expect(res.status).toBe(201);
    expect(res.body.data.path).toMatch(new RegExp(`^${c.id}/[0-9a-f-]{36}\\.png$`));
    expect(res.body.data).toMatchObject({ method: 'PUT', contentType: 'image/png', maxBytes: 5 * 1024 * 1024 });
    expect(res.body.data.uploadUrl).toContain(res.body.data.path);
    expect(world.storageCalls).toHaveLength(1);
    expect(world.storageCalls[0]).toMatchObject({ op: 'createSignedUploadUrl', bucket: 'report-photos', as: 'service-role' });
  });

  it('never lets the client choose the path', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, c)).send({ contentType: 'image/png', sizeBytes: 10, path: `${uuid(2)}/x.png` });
    expect(res.status).toBe(422);
    expect(world.storageCalls).toHaveLength(0);
  });

  it.each([
    [{ contentType: 'image/gif', sizeBytes: 10 }], [{ contentType: 'application/pdf', sizeBytes: 10 }], [{ contentType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }],
    [{ contentType: 'image/png', sizeBytes: 0 }], [{ contentType: 'image/png' }], [{ sizeBytes: 10 }],
  ])('rejects %j', async (body) => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    expect((await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, c)).send(body)).status).toBe(422);
    expect(world.storageCalls).toHaveLength(0);
  });

  it.each(['worker', 'staff', 'admin'] as const)('forbids %s', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, a)).send({ contentType: 'image/png', sizeBytes: 10 })).status).toBe(403);
    expect(world.storageCalls).toHaveLength(0);
  });

  it('requires a verified e-mail and a token', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen', { emailVerified: false });
    expect((await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, c)).send({ contentType: 'image/png', sizeBytes: 10 })).status).toBe(403);
    expect((await request(app).post('/api/v1/reports/photos/upload-url').send({ contentType: 'image/png', sizeBytes: 10 })).status).toBe(401);
  });

  it('is 503 when the service-role key is not configured', async () => {
    const { app, world } = setup();
    world.disableAdminClient();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports/photos/upload-url').set(auth(world, c)).send({ contentType: 'image/png', sizeBytes: 10 });
    expect(res.status).toBe(503);
  });
});

describe('attaching photos to reports', () => {
  it('create: accepts photos that exist in the caller’s folder and returns signed read URLs', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const path = `${c.id}/a.jpg`;
    world.files.add(path);
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, photoPaths: [path] });
    expect(res.status).toBe(201);
    expect(res.body.data.photos).toEqual([{ path, url: expect.stringContaining('https://storage.test/sign/report-photos/') }]);
  });

  it('create: refuses a photo that was never uploaded (422) and does not insert', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, photoPaths: [`${c.id}/ghost.jpg`] });
    expect(res.status).toBe(422);
    expect(world.calls.some((x) => hasOp(x, 'insert'))).toBe(false);
  });

  it('create without photos does not touch storage', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    expect((await request(app).post('/api/v1/reports').set(auth(world, c)).send(valid)).status).toBe(201);
    expect(world.storageCalls).toHaveLength(0);
  });

  it('edit: verifies only newly added photos and removes dropped ones from storage', async () => {
    let cit = '';
    const { app, world } = setup((who) => row(who?.id ?? cit, [`${who?.id}/old.jpg`, `${who?.id}/keep.jpg`]));
    const c = world.addActor('citizen');
    cit = c.id;
    world.files.add(`${c.id}/old.jpg`).add(`${c.id}/keep.jpg`).add(`${c.id}/new.jpg`);
    const res = await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, c)).send({ photoPaths: [`${c.id}/keep.jpg`, `${c.id}/new.jpg`] });
    expect(res.status).toBe(200);
    const lists = world.storageCalls.filter((x) => x.op === 'list');
    expect(lists).toHaveLength(1); // only new.jpg
    expect(world.storageCalls.find((x) => x.op === 'remove')!.args[0]).toEqual([`${c.id}/old.jpg`]);
    expect(world.files.has(`${c.id}/old.jpg`)).toBe(false);
    expect(world.files.has(`${c.id}/keep.jpg`)).toBe(true);
  });

  it('detail: signs photo URLs for any role that can see the report, with the service role only after RLS lookup', async () => {
    const owner = uuid(1);
    const { app, world } = setup(() => row(owner, [`${owner}/a.jpg`]));
    world.onCall((call) => (call.name === 'worker_assignments' ? { data: null } : call.name === 'reports_needing_reassignment' ? { data: null } : undefined));
    for (const role of ['citizen', 'staff'] as const) {
      const a = world.addActor(role);
      const res = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, a));
      expect(res.status).toBe(200);
      expect(res.body.data.photos[0].url).toContain('https://storage.test/sign/');
    }
    expect(world.storageCalls.every((x) => x.as === 'service-role')).toBe(true);
  });

  it('detail of an invisible report returns 404 and signs nothing', async () => {
    const { app, world } = setup(() => null as never);
    const c = world.addActor('citizen');
    expect((await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, c))).status).toBe(404);
    expect(world.storageCalls).toHaveLength(0);
  });

  it('detail still works (url: null) if storage signing is unavailable', async () => {
    const owner = uuid(1);
    const { app, world } = setup(() => row(owner, [`${owner}/a.jpg`]));
    world.disableAdminClient();
    const c = world.addActor('citizen');
    const res = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, c));
    expect(res.status).toBe(200);
    expect(res.body.data.photos).toEqual([{ path: `${owner}/a.jpg`, url: null }]);
  });
});
