import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { makeWorld } from './fakes/supabase.js';
import { testEnv } from './helpers.js';

const SUMMARY = { generatedAt: '2026-10-24T00:00:00Z', periodDays: 30, totals: { all: 3, open: 2 }, byStatus: {}, createdPerDay: [] };

function setup(err?: { code: string; message: string }) {
  const world = makeWorld();
  const app = createApp(testEnv(), { supabase: world.gateway });
  world.onCall((c) => (c.kind === 'rpc' && c.name === 'dashboard_summary' ? (err ? { error: err } : { data: SUMMARY }) : undefined));
  return { world, app };
}

describe('GET /dashboard/summary', () => {
  it.each(['staff', 'admin'] as const)('returns the database snapshot for %s using their own token', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    const res = await request(app).get('/api/v1/dashboard/summary?days=7').set('Authorization', world.bearer(a));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(SUMMARY);
    const rpc = world.calls.find((c) => c.kind === 'rpc')!;
    expect(rpc.rpcArgs).toEqual({ p_days: 7 });
    expect(rpc.as).toBe(a.token);
  });

  it('defaults to 30 days', async () => {
    const { app, world } = setup();
    const a = world.addActor('staff');
    await request(app).get('/api/v1/dashboard/summary').set('Authorization', world.bearer(a));
    expect(world.calls.find((c) => c.kind === 'rpc')!.rpcArgs).toEqual({ p_days: 30 });
  });

  it.each(['citizen', 'worker'] as const)('forbids %s before the database', async (role) => {
    const { app, world } = setup();
    const a = world.addActor(role);
    expect((await request(app).get('/api/v1/dashboard/summary').set('Authorization', world.bearer(a))).status).toBe(403);
    expect(world.calls.some((c) => c.kind === 'rpc')).toBe(false);
  });

  it.each(['days=0', 'days=366', 'days=abc', 'days=1.5'])('rejects %s', async (qs) => {
    const { app, world } = setup();
    const a = world.addActor('staff');
    expect((await request(app).get(`/api/v1/dashboard/summary?${qs}`).set('Authorization', world.bearer(a))).status).toBe(422);
  });

  it('requires authentication and maps database denial', async () => {
    const { app, world } = setup({ code: 'CP403', message: 'only staff or admin can view the dashboard' });
    expect((await request(app).get('/api/v1/dashboard/summary')).status).toBe(401);
    const a = world.addActor('staff');
    expect((await request(app).get('/api/v1/dashboard/summary').set('Authorization', world.bearer(a))).status).toBe(403);
  });
});
