import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, opArgs, uuid, type Actor } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const CAT = uuid(500);
const RID = uuid(900);

const reportRow = (over: Record<string, unknown> = {}) => ({
  id: RID, citizen_id: uuid(1), category_id: CAT, title: 'Overflowing bin', description: 'Bin has been overflowing for days',
  address_text: 'Near Gandhi Chowk', latitude: null, longitude: null, ward: null, status: 'submitted', priority: 'normal',
  photo_paths: [], created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', resolved_at: null,
  category: { id: CAT, slug: 'overflowing-bins', name: 'Overflowing bins' }, citizen: { id: uuid(1), full_name: 'Asha' }, ...over,
});

const valid = { categoryId: CAT, title: 'Overflowing bin', description: 'Bin has been overflowing for days', addressText: 'Near Gandhi Chowk' };

function setup(rowFor: (who: Actor | null) => Record<string, unknown> | null = (who) => reportRow({ citizen_id: who?.id ?? uuid(1) })) {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  world.onCall((call, who) => {
    if (call.kind === 'rpc' && call.name === 'change_report_status') {
      const a = call.rpcArgs as { p_new_status: string };
      return { data: reportRow({ status: a.p_new_status }) };
    }
    if (call.kind === 'from' && call.name === 'reports') {
      if (hasOp(call, 'insert')) return { data: reportRow({ ...(opArgs(call, 'insert')![0] as object), category: null }) };
      if (hasOp(call, 'update')) return { data: reportRow({ ...(opArgs(call, 'update')![0] as object) }) };
      if (hasOp(call, 'range')) return { data: [reportRow(), reportRow({ id: uuid(901), photo_paths: [`${uuid(1)}/a.jpg`] })], count: 7 };
      return { data: rowFor(who) };
    }
    if (call.kind === 'from' && call.name === 'report_status_history') {
      return {
        data: [
          { id: 1, old_status: null, new_status: 'submitted', changed_by: who?.id, note: 'Report submitted', is_internal: false, created_at: '2026-10-01T10:00:00.000Z', changer: { id: who?.id, full_name: 'Me' } },
          { id: 2, old_status: 'submitted', new_status: 'under_review', changed_by: uuid(77), note: null, is_internal: false, created_at: '2026-10-02T10:00:00.000Z', changer: null },
          { id: 3, old_status: 'under_review', new_status: 'under_review', changed_by: uuid(77), note: 'internal', is_internal: true, created_at: '2026-10-02T11:00:00.000Z', changer: { id: uuid(77), full_name: 'Officer' } },
        ],
      };
    }
    return undefined;
  });
  return { world, app };
}
const auth = (w: ReturnType<typeof makeWorld>, a: Actor) => ({ Authorization: w.bearer(a) });

describe('POST /reports', () => {
  it('creates a report owned by the caller and returns 201 with category', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports').set('Authorization', world.bearer(c)).send({ ...valid, ward: 'Ward 3', latitude: 12.97, longitude: 77.59 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Overflowing bin', status: 'submitted' });
    const ins = world.calls.find((x) => hasOp(x, 'insert'))!;
    expect(opArgs(ins, 'insert')![0]).toMatchObject({ citizen_id: c.id, category_id: CAT, ward: 'Ward 3', latitude: 12.97, longitude: 77.59, photo_paths: [] });
    expect(ins.as).toBe(c.token);
  });

  it.each([
    [{ citizenId: uuid(2) }], [{ citizen_id: uuid(2) }], [{ status: 'resolved' }], [{ priority: 'urgent' }], [{ resolvedAt: '2026-01-01' }],
  ])('refuses to let the client choose protected fields %j', async (extra) => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, ...extra });
    expect(res.status).toBe(422);
    expect(world.calls.some((x) => hasOp(x, 'insert'))).toBe(false);
  });

  it('requires a verified e-mail and never inserts otherwise', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen', { emailVerified: false });
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send(valid);
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/verify your email/i);
    expect(world.calls.some((x) => hasOp(x, 'insert'))).toBe(false);
  });

  it.each(['worker', 'staff', 'admin'] as const)('forbids %s from filing reports', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).post('/api/v1/reports').set(auth(world, a)).send(valid)).status).toBe(403);
    expect(world.dataCalls()).toHaveLength(0);
  });

  it.each([
    [{ title: 'ab' }], [{ title: 'x'.repeat(151) }], [{ description: 'short' }], [{ addressText: 'a' }], [{ categoryId: 'nope' }],
    [{ latitude: 12.9 }], [{ longitude: 77.5 }], [{ latitude: 91, longitude: 0 }], [{ latitude: 0, longitude: 181 }],
    [{ photoPaths: ['a', 'b', 'c', 'd'].map((x) => `${uuid(1)}/${x}.jpg`) }], [{ photoPaths: ['../../etc/passwd'] }],
  ])('validates %j', async (extra) => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, ...extra });
    expect(res.status).toBe(422);
    expect(world.calls.some((x) => hasOp(x, 'insert'))).toBe(false);
  });

  it('rejects photo paths that belong to someone else', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, photoPaths: [`${uuid(2)}/x.jpg`] });
    expect(res.status).toBe(422);
  });

  it('accepts photo paths in the caller’s own folder', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    world.files.add(`${c.id}/a.jpg`); // uploaded earlier via a signed upload URL
    const res = await request(app).post('/api/v1/reports').set(auth(world, c)).send({ ...valid, photoPaths: [`${c.id}/a.jpg`] });
    expect(res.status).toBe(201);
  });

  it('maps database function/constraint errors', async () => {
    const w = makeWorld();
    const c = w.addActor('citizen');
    let code = 'CP422';
    w.onCall((call) => (hasOp(call, 'insert') ? { error: { code, message: 'category is not available' } } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    expect((await request(app).post('/api/v1/reports').set(auth(w, c)).send(valid)).status).toBe(422);
    code = '42501';
    expect((await request(app).post('/api/v1/reports').set(auth(w, c)).send(valid)).status).toBe(403);
    code = '23503';
    expect((await request(app).post('/api/v1/reports').set(auth(w, c)).send(valid)).status).toBe(422);
  });
});

describe('GET /reports', () => {
  it('returns summaries with pagination meta and no long text', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).get('/api/v1/reports?page=2&limit=5').set(auth(world, c));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ page: 2, limit: 5, total: 7 });
    expect(res.body.data[0]).not.toHaveProperty('description');
    expect(res.body.data[1].photoCount).toBe(1);
    const call = world.calls.find((x) => hasOp(x, 'range'))!;
    expect(opArgs(call, 'range')).toEqual([5, 9]);
    expect(call.as).toBe(c.token); // user-scoped client => RLS decides what is visible
  });

  it('applies filters and sorting', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const qs = `status=assigned&priority=high&categoryId=${CAT}&ward=Ward%203&q=100%25&createdFrom=2026-10-01&createdTo=2026-10-31&sort=priority`;
    const res = await request(app).get(`/api/v1/reports?${qs}`).set(auth(world, s));
    expect(res.status).toBe(200);
    const c = world.calls.find((x) => hasOp(x, 'range'))!;
    expect(hasOp(c, 'eq', 'status', 'assigned')).toBe(true);
    expect(hasOp(c, 'eq', 'priority', 'high')).toBe(true);
    expect(hasOp(c, 'eq', 'category_id', CAT)).toBe(true);
    expect(hasOp(c, 'eq', 'ward', 'Ward 3')).toBe(true);
    expect(hasOp(c, 'or', 'title.ilike."%100%",address_text.ilike."%100%"')).toBe(true);
    expect(hasOp(c, 'gte', 'created_at', '2026-10-01T00:00:00.000Z')).toBe(true);
    expect(hasOp(c, 'lt', 'created_at', '2026-11-01T00:00:00.000Z')).toBe(true);
    expect(c.ops.filter((o) => o.op === 'order').map((o) => o.args[0])).toEqual(['priority', 'created_at', 'id']);
  });

  it.each(['status=done', 'priority=asap', 'page=0', 'limit=500', 'createdFrom=yesterday', 'sort=random', 'categoryId=1'])('rejects %s', async (qs) => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    expect((await request(app).get(`/api/v1/reports?${qs}`).set(auth(world, c))).status).toBe(422);
  });
});

describe('GET /reports/:id', () => {
  it('returns detail', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, c));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: RID, description: 'Bin has been overflowing for days', category: { name: 'Overflowing bins' } });
  });
  it('is 404 when the report is missing or not visible (RLS returns nothing)', async () => {
    const { app, world } = setup(() => null);
    const c = world.addActor('citizen');
    expect((await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, c))).status).toBe(404);
  });
  it('rejects a malformed id', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    expect((await request(app).get('/api/v1/reports/abc').set(auth(world, c))).status).toBe(422);
  });
});

describe('PATCH /reports/:id (owner edit)', () => {
  it('updates only the provided fields while status is submitted', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, c)).send({ title: 'New title here', latitude: null, longitude: null });
    expect(res.status).toBe(200);
    const up = world.calls.find((x) => hasOp(x, 'update'))!;
    expect(opArgs(up, 'update')![0]).toEqual({ title: 'New title here', latitude: null, longitude: null });
  });
  it('returns 409 and does not update once the report is being processed', async () => {
    const { app, world } = setup((who) => reportRow({ citizen_id: who?.id, status: 'assigned' }));
    const c = world.addActor('citizen');
    const res = await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, c)).send({ title: 'New title here' });
    expect(res.status).toBe(409);
    expect(world.calls.some((x) => hasOp(x, 'update'))).toBe(false);
  });
  it('is 404 for a report owned by someone else', async () => {
    const { app, world } = setup(() => reportRow({ citizen_id: uuid(2) }));
    const c = world.addActor('citizen');
    expect((await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, c)).send({ title: 'New title here' })).status).toBe(404);
  });
  it('forbids staff/workers/admin and rejects protected or empty bodies', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    expect((await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, s)).send({ title: 'New title here' })).status).toBe(403);
    const c = world.addActor('citizen');
    for (const body of [{}, { status: 'resolved' }, { priority: 'urgent' }, { citizenId: uuid(2) }, { latitude: 5 }]) {
      expect((await request(app).patch(`/api/v1/reports/${RID}`).set(auth(world, c)).send(body)).status).toBe(422);
    }
    expect(world.calls.some((x) => hasOp(x, 'update'))).toBe(false);
  });
});

describe('POST /reports/:id/cancel', () => {
  it('calls the database function as the citizen and returns the report', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).post(`/api/v1/reports/${RID}/cancel`).set(auth(world, c)).send({ note: 'Fixed by neighbours' });
    expect(res.status).toBe(200);
    const rpc = world.calls.find((x) => x.kind === 'rpc')!;
    expect(rpc.rpcArgs).toEqual({ p_report_id: RID, p_new_status: 'cancelled', p_note: 'Fixed by neighbours' });
    expect(rpc.as).toBe(c.token);
  });
  it('maps invalid transition to 409 and unknown report to 404', async () => {
    const w = makeWorld();
    const c = w.addActor('citizen');
    let err = { code: 'CP409', message: 'invalid status change from assigned to cancelled' };
    w.onCall((call) => (call.kind === 'rpc' ? { error: err } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    const a = await request(app).post(`/api/v1/reports/${RID}/cancel`).set(auth(w, c)).send({});
    expect(a.status).toBe(409);
    err = { code: 'CP404', message: 'report not found' };
    expect((await request(app).post(`/api/v1/reports/${RID}/cancel`).set(auth(w, c)).send({})).status).toBe(404);
  });
  it.each(['worker', 'staff', 'admin'] as const)('forbids %s before touching the database', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).post(`/api/v1/reports/${RID}/cancel`).set(auth(world, a)).send({})).status).toBe(403);
    expect(world.calls.some((x) => x.kind === 'rpc')).toBe(false);
  });
});

describe('GET /reports/:id/history', () => {
  it('hides staff identities from citizens', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    const res = await request(app).get(`/api/v1/reports/${RID}/history`).set(auth(world, c));
    expect(res.status).toBe(200);
    expect(res.body.data[0].changedBy).toEqual({ id: c.id, fullName: 'Me' });
    expect(res.body.data[1].changedBy).toBeNull();
  });
  it('shows actors and internal flags to staff', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const res = await request(app).get(`/api/v1/reports/${RID}/history`).set(auth(world, s));
    expect(res.body.data[2]).toMatchObject({ isInternal: true, note: 'internal', changedBy: { id: uuid(77), fullName: 'Officer' } });
  });
  it('is 404 when the report is not visible', async () => {
    const { app, world } = setup(() => null);
    const c = world.addActor('citizen');
    expect((await request(app).get(`/api/v1/reports/${RID}/history`).set(auth(world, c))).status).toBe(404);
    expect(world.calls.some((x) => x.name === 'report_status_history')).toBe(false);
  });
});

describe('GET /reports: multi-status, address search, staff extras', () => {
  const rows = (staff: boolean) => ({
    data: [
      reportRow({
        id: uuid(901),
        ...(staff
          ? { citizen: { id: uuid(1), full_name: 'Asha Rao' }, worker_assignments: [{ id: uuid(70), is_active: true, worker: { id: uuid(80), full_name: 'Worker One' } }] }
          : { citizen: undefined }),
      }),
    ],
    count: 1,
  });
  const make = () => {
    const world = makeWorld();
    const app = createApp(testEnv(), { supabase: world.gateway });
    world.onCall((call, who) => (call.name === 'reports' && hasOp(call, 'range') ? rows(who?.role === 'staff' || who?.role === 'admin') : undefined));
    return { world, app };
  };

  it('accepts several statuses separated by commas (de-duplicated)', async () => {
    const { app, world } = make();
    const c = world.addActor('citizen');
    const res = await request(app).get('/api/v1/reports?status=assigned,in_progress,assigned').set(auth(world, c));
    expect(res.status).toBe(200);
    const call = world.calls.find((x) => hasOp(x, 'range'))!;
    expect(hasOp(call, 'in', 'status', ['assigned', 'in_progress'])).toBe(true);
    expect(call.ops.some((o) => o.op === 'eq' && o.args[0] === 'status')).toBe(false);
  });

  it.each(['status=assigned,bogus', 'status=,', 'status='])('rejects %s', async (qs) => {
    const { app, world } = make();
    const c = world.addActor('citizen');
    expect((await request(app).get(`/api/v1/reports?${qs}`).set(auth(world, c))).status).toBe(422);
  });

  it('searches title OR address and strips characters that could alter the filter', async () => {
    const { app, world } = make();
    const c = world.addActor('citizen');
    const q = encodeURIComponent('main road),status.eq.resolved,(x"%_*');
    expect((await request(app).get(`/api/v1/reports?q=${q}`).set(auth(world, c))).status).toBe(200);
    const call = world.calls.find((x) => hasOp(x, 'range'))!;
    const arg = opArgs(call, 'or')![0] as string;
    expect(arg).toBe('title.ilike."%main road status.eq.resolved x%",address_text.ilike."%main road status.eq.resolved x%"');
    expect(arg.match(/,/g)).toHaveLength(1); // only the structural comma between the two conditions
  });

  it('staff/admin lists include citizen name and current worker; citizens do not', async () => {
    const { app, world } = make();
    const s = world.addActor('staff');
    const rs = await request(app).get('/api/v1/reports').set(auth(world, s));
    expect(rs.body.data[0]).toMatchObject({ citizen: { id: uuid(1), fullName: 'Asha Rao' }, assignedWorker: { id: uuid(80), fullName: 'Worker One' } });
    const sc = world.calls.find((x) => hasOp(x, 'range') && x.as === s.token)!;
    expect(String(opArgs(sc, 'select')![0])).toContain('worker_assignments');
    expect(hasOp(sc, 'eq', 'worker_assignments.is_active', true)).toBe(true);

    const c = world.addActor('citizen');
    const rc = await request(app).get('/api/v1/reports').set(auth(world, c));
    expect(rc.body.data[0]).not.toHaveProperty('citizen');
    expect(rc.body.data[0]).not.toHaveProperty('assignedWorker');
    const cc = world.calls.find((x) => hasOp(x, 'range') && x.as === c.token)!;
    expect(String(opArgs(cc, 'select')![0])).not.toContain('worker_assignments');
  });

  it('uses explicit foreign-key hints for profile embeds (avoids ambiguous PostgREST relationships)', async () => {
    const { app, world } = make();
    const s = world.addActor('staff');
    await request(app).get('/api/v1/reports').set(auth(world, s));
    await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, s));
    const selects = world.calls.filter((x) => x.name === 'reports').map((x) => String(opArgs(x, 'select')?.[0] ?? ''));
    for (const sel of selects.filter((x) => x.includes('profiles'))) {
      expect(sel).not.toMatch(/profiles\(/); // every profiles embed has a !fk hint
    }
    expect(selects.some((x) => x.includes('reports_citizen_id_fkey'))).toBe(true);
  });
});

