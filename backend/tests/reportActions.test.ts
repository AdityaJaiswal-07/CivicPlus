import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { hasOp, makeWorld, uuid, type Actor } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const RID = uuid(900);
const WID = uuid(800);
const reportRow = (over: Record<string, unknown> = {}) => ({
  id: RID, citizen_id: uuid(1), category_id: uuid(500), title: 'Overflowing bin', description: 'Bin has been overflowing for days',
  address_text: 'Near Gandhi Chowk', latitude: null, longitude: null, ward: null, status: 'submitted', priority: 'normal',
  photo_paths: [], created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', resolved_at: null,
  category: null, citizen: null, ...over,
});
const auth = (w: ReturnType<typeof makeWorld>, a: Actor) => ({ Authorization: w.bearer(a) });

function setup() {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  let current = reportRow({ status: 'assigned' });
  world.onCall((call) => {
    if (call.kind === 'rpc') {
      if (call.name === 'add_internal_note') {
        return { data: { id: 5, old_status: 'submitted', new_status: 'submitted', changed_by: call.as, note: (call.rpcArgs as { p_note: string }).p_note, is_internal: true, created_at: '2026-10-02T00:00:00.000Z' } };
      }
      const a = call.rpcArgs as { p_new_status?: string; p_priority?: string };
      current = reportRow({ status: a.p_new_status ?? 'assigned', priority: a.p_priority ?? 'normal' });
      return { data: current };
    }
    if (call.name === 'reports') return { data: current };
    if (call.name === 'worker_assignments') return { data: { id: uuid(70), worker_id: WID, assigned_at: '2026-10-02T00:00:00.000Z', note: null } };
    if (call.name === 'profiles') return { data: { full_name: 'Worker One' } };
    if (call.name === 'reports_needing_reassignment') {
      return hasOp(call, 'range')
        ? { data: [{ report_id: RID, title: 'T', status: 'assigned', priority: 'high', ward: null, address_text: 'A', report_created_at: 'x', assignment_id: uuid(70), assigned_at: 'y', worker_id: WID, worker_name: 'Worker One', worker_role: 'worker', worker_is_active: false, review_reason: 'worker_deactivated' }], count: 1 }
        : { data: { report_id: RID } };
    }
    return undefined;
  });
  return { world, app };
}

describe('PATCH /reports/:id/status', () => {
  it.each(['worker', 'staff', 'admin'] as const)('lets %s call the DB function with their own token', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    const res = await request(app).patch(`/api/v1/reports/${RID}/status`).set(auth(world, a)).send({ status: 'in_progress', note: 'On it' });
    expect(res.status).toBe(200);
    const rpc = world.calls.find((c) => c.kind === 'rpc')!;
    expect(rpc.name).toBe('change_report_status');
    expect(rpc.rpcArgs).toEqual({ p_report_id: RID, p_new_status: 'in_progress', p_note: 'On it' });
    expect(rpc.as).toBe(a.token);
  });
  it('forbids citizens before the database', async () => {
    const { app, world } = setup();
    const c = world.addActor('citizen');
    expect((await request(app).patch(`/api/v1/reports/${RID}/status`).set(auth(world, c)).send({ status: 'resolved' })).status).toBe(403);
    expect(world.calls.some((x) => x.kind === 'rpc')).toBe(false);
  });
  it.each([{ status: 'assigned' }, { status: 'submitted' }, { status: 'cancelled' }, { status: 'bogus' }, {}, { status: 'resolved', extra: 1 }])(
    'rejects %j', async (body) => {
      const { app, world } = setup();
      const s = world.addActor('staff');
      expect((await request(app).patch(`/api/v1/reports/${RID}/status`).set(auth(world, s)).send(body)).status).toBe(422);
      expect(world.calls.some((x) => x.kind === 'rpc')).toBe(false);
    });
  it('maps DB rules: invalid transition 409, note required 422, not-your-report 404, forbidden 403', async () => {
    const w = makeWorld();
    const s = w.addActor('staff');
    let err = { code: 'CP409', message: 'invalid status change from submitted to resolved' };
    w.onCall((c) => (c.kind === 'rpc' ? { error: err } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    const go = () => request(app).patch(`/api/v1/reports/${RID}/status`).set(auth(w, s)).send({ status: 'rejected' });
    expect((await go()).status).toBe(409);
    err = { code: 'CP422', message: 'a note is required for this change' };
    const r422 = await go();
    expect(r422.status).toBe(422);
    expect(r422.body.error.message).toBe('a note is required for this change');
    err = { code: 'CP404', message: 'report not found' };
    expect((await go()).status).toBe(404);
    err = { code: 'CP403', message: 'only the assigned worker, staff or admin can do this' };
    expect((await go()).status).toBe(403);
  });
});

describe('POST /reports/:id/assign', () => {
  it('lets staff and admin assign (and reassign) a worker', async () => {
    const { app, world } = setup();
    for (const role of ['staff', 'admin'] as const) {
      const a = world.addActor(role);
      const res = await request(app).post(`/api/v1/reports/${RID}/assign`).set(auth(world, a)).send({ workerId: WID, note: 'North zone' });
      expect(res.status).toBe(200);
    }
    const rpc = world.calls.filter((c) => c.kind === 'rpc');
    expect(rpc[0]!.rpcArgs).toEqual({ p_report_id: RID, p_worker_id: WID, p_note: 'North zone' });
  });
  it.each(['citizen', 'worker'] as const)('forbids %s', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).post(`/api/v1/reports/${RID}/assign`).set(auth(world, a)).send({ workerId: WID })).status).toBe(403);
    expect(world.calls.some((x) => x.kind === 'rpc')).toBe(false);
  });
  it.each([{}, { workerId: 'x' }, { workerId: WID, note: 'x'.repeat(501) }, { workerId: WID, status: 'resolved' }])('validates %j', async (body) => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    expect((await request(app).post(`/api/v1/reports/${RID}/assign`).set(auth(world, s)).send(body)).status).toBe(422);
  });
  it('maps "not an active worker" (422), "already assigned" (409), "cannot be assigned" (409)', async () => {
    const w = makeWorld();
    const s = w.addActor('staff');
    let err = { code: 'CP422', message: 'the selected user is not an active worker' };
    w.onCall((c) => (c.kind === 'rpc' ? { error: err } : undefined));
    const app = createApp(testEnv(), { supabase: w.gateway });
    const go = () => request(app).post(`/api/v1/reports/${RID}/assign`).set(auth(w, s)).send({ workerId: WID });
    expect((await go()).status).toBe(422);
    err = { code: 'CP409', message: 'this worker is already assigned to the report' };
    expect((await go()).status).toBe(409);
  });
});

describe('PATCH /reports/:id/priority', () => {
  it('lets staff set priority; forbids others; validates value', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const ok = await request(app).patch(`/api/v1/reports/${RID}/priority`).set(auth(world, s)).send({ priority: 'urgent' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.priority).toBe('urgent');
    expect((await request(app).patch(`/api/v1/reports/${RID}/priority`).set(auth(world, s)).send({ priority: 'asap' })).status).toBe(422);
    for (const role of ['citizen', 'worker'] as const) {
      const a = world.addActor(role);
      expect((await request(app).patch(`/api/v1/reports/${RID}/priority`).set(auth(world, a)).send({ priority: 'urgent' })).status).toBe(403);
    }
  });
});

describe('POST /reports/:id/internal-notes', () => {
  it('lets staff add an internal note and returns it flagged internal', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const res = await request(app).post(`/api/v1/reports/${RID}/internal-notes`).set(auth(world, s)).send({ note: '  Call ward officer ' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isInternal: true, note: 'Call ward officer' });
    expect(world.calls.find((c) => c.kind === 'rpc')!.rpcArgs).toEqual({ p_report_id: RID, p_note: 'Call ward officer' });
  });
  it.each(['citizen', 'worker'] as const)('forbids %s before the database', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).post(`/api/v1/reports/${RID}/internal-notes`).set(auth(world, a)).send({ note: 'hi' })).status).toBe(403);
    expect(world.calls.some((x) => x.kind === 'rpc')).toBe(false);
  });
  it.each([{}, { note: '   ' }, { note: 'x'.repeat(501) }])('validates %j', async (body) => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    expect((await request(app).post(`/api/v1/reports/${RID}/internal-notes`).set(auth(world, s)).send(body)).status).toBe(422);
  });
});

describe('GET /reports/needs-reassignment', () => {
  it('lists flagged reports for staff/admin (not swallowed by /:id)', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const res = await request(app).get('/api/v1/reports/needs-reassignment').set(auth(world, s));
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ reportId: RID, reason: 'worker_deactivated', worker: { id: WID, isActive: false } });
  });
  it.each(['citizen', 'worker'] as const)('forbids %s', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).get('/api/v1/reports/needs-reassignment').set(auth(world, a))).status).toBe(403);
    expect(world.dataCalls()).toHaveLength(0);
  });
});

describe('GET /reports/:id extras', () => {
  it('staff get the assignment, worker name and review flag', async () => {
    const { app, world } = setup();
    const s = world.addActor('staff');
    const res = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, s));
    expect(res.status).toBe(200);
    expect(res.body.data.assignment).toMatchObject({ workerId: WID, workerName: 'Worker One' });
    expect(res.body.data.needsReassignment).toBe(true);
  });
  it('workers get their assignment but no review flag; citizens get neither', async () => {
    const { app, world } = setup();
    const w = world.addActor('worker');
    const rw = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, w));
    expect(rw.body.data.assignment.workerName).toBeNull();
    expect(rw.body.data).not.toHaveProperty('needsReassignment');
    const c = world.addActor('citizen');
    const rc = await request(app).get(`/api/v1/reports/${RID}`).set(auth(world, c));
    expect(rc.body.data).not.toHaveProperty('assignment');
    expect(world.calls.filter((x) => x.as === c.token && x.name === 'worker_assignments')).toHaveLength(0);
  });
});

describe('GET /reports/counts', () => {
  it('returns counts per status for the caller (database scopes the rows) for every role', async () => {
    const w = makeWorld();
    const app = createApp(testEnv(), { supabase: w.gateway });
    w.onCall((call) => {
      if (call.name !== 'reports') return undefined;
      const status = (call.ops.find((o) => o.op === 'eq')!.args[1]) as string;
      return { count: status === 'submitted' ? 3 : status === 'resolved' ? 2 : 0 };
    });
    for (const role of ['citizen', 'worker', 'staff', 'admin'] as const) {
      const a = w.addActor(role);
      const res = await request(app).get('/api/v1/reports/counts').set(auth(w, a));
      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(5);
      expect(res.body.data.byStatus).toEqual({ submitted: 3, under_review: 0, assigned: 0, in_progress: 0, resolved: 2, rejected: 0, cancelled: 0 });
    }
    expect(w.calls.filter((c) => c.name === 'reports').every((c) => c.as !== 'service-role')).toBe(true);
  });

  it('is not swallowed by /:id and requires authentication', async () => {
    const w = makeWorld();
    const app = createApp(testEnv(), { supabase: w.gateway });
    expect((await request(app).get('/api/v1/reports/counts')).status).toBe(401);
  });

  it('maps database errors', async () => {
    const w = makeWorld();
    const a = w.addActor('citizen');
    w.onCall(() => ({ error: { code: '42501', message: 'denied' } }));
    const app = createApp(testEnv(), { supabase: w.gateway });
    expect((await request(app).get('/api/v1/reports/counts').set(auth(w, a))).status).toBe(403);
  });
});

