import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, categoryId, createDb, createReport, promote, runAs } from './harness.js';

let db: PGlite;
let cat: string, cat2: string;
let citizen: string, worker1: string, worker2: string, staff: string, admin: string;

const as = (who: string, sql: string, params: unknown[] = []) => runAs(db, { userId: who }, () => db.query(sql, params));
const summary = async (who = staff, days = 30) =>
  (await as(who, `select public.dashboard_summary($1) as s`, [days])).rows[0]!.s as Record<string, any>;

beforeAll(async () => {
  db = await createDb();
  cat = await categoryId(db, 'overflowing-bins');
  cat2 = await categoryId(db, 'illegal-dumping');
  citizen = await addUser(db);
  worker1 = await addUser(db);
  worker2 = await addUser(db);
  staff = await addUser(db);
  admin = await addUser(db);
  for (const [id, r] of [[worker1, 'worker'], [worker2, 'worker'], [staff, 'staff'], [admin, 'admin']] as const) await promote(db, id, r);

  const mk = (c: string) => createReport(db, citizen, { citizenId: citizen, categoryId: c });
  const r1 = await mk(cat); // submitted
  const r2 = await mk(cat); // assigned to worker1
  const r3 = await mk(cat2); // resolved by worker2
  const r4 = await mk(cat2); // rejected
  await mk(cat2); // cancelled below
  await as(staff, `select public.assign_report($1, $2, null)`, [r2, worker1]);
  await as(staff, `select public.assign_report($1, $2, null)`, [r3, worker2]);
  await as(worker2, `select public.change_report_status($1, 'in_progress', null)`, [r3]);
  await as(worker2, `select public.change_report_status($1, 'resolved', null)`, [r3]);
  await as(staff, `select public.change_report_status($1, 'rejected', 'Duplicate')`, [r4]);
  await as(citizen, `select public.change_report_status(id, 'cancelled', null) from public.reports where status = 'submitted' and id <> $1 limit 1`, [r1]);
  await db.query(`update public.reports set ward = 'Ward 3' where id in ($1, $2)`, [r1, r2]);
}, 90_000);

describe('public.dashboard_summary', () => {
  it('computes totals, statuses, priorities and categories', async () => {
    const s = await summary();
    expect(s.totals).toEqual({ all: 5, open: 2, awaitingAssignment: 1, resolved: 1, rejected: 1, cancelled: 1 });
    expect(s.byStatus).toEqual({ submitted: 1, under_review: 0, assigned: 1, in_progress: 0, resolved: 1, rejected: 1, cancelled: 1 });
    expect(s.openByPriority).toEqual({ low: 0, normal: 2, high: 0, urgent: 0 });
    const names = Object.fromEntries(s.byCategory.map((c: any) => [c.name, [c.total, c.open]]));
    expect(names['Overflowing bins']).toEqual([2, 2]);
    expect(names['Illegal dumping']).toEqual([3, 0]);
    expect(s.topWards).toEqual([{ ward: 'Ward 3', total: 2, open: 2 }]);
  });

  it('computes the period figures and a zero-filled daily series', async () => {
    const s = await summary(admin, 7);
    expect(s.periodDays).toBe(7);
    expect(s.createdInPeriod).toBe(5);
    expect(s.resolvedInPeriod).toBe(1);
    expect(typeof s.avgResolutionHours).toBe('number');
    expect(s.createdPerDay).toHaveLength(7);
    expect(s.createdPerDay.reduce((n: number, d: any) => n + d.count, 0)).toBe(5);
  });

  it('reports worker workload for active workers only', async () => {
    const s = await summary();
    const byId = Object.fromEntries(s.workerWorkload.map((w: any) => [w.workerId, w.openAssigned]));
    expect(byId[worker1]).toBe(1);
    expect(byId[worker2]).toBe(0);
    await as(admin, `select * from public.admin_set_user_active($1, false, 'left')`, [worker1]);
    const s2 = await summary();
    expect(s2.workerWorkload.map((w: any) => w.workerId)).not.toContain(worker1);
    expect(s2.needsReassignment).toBe(1);
    await as(admin, `select * from public.admin_set_user_active($1, true, 'back')`, [worker1]);
    expect((await summary()).needsReassignment).toBe(0);
  });

  it('exposes no personal data (no names of citizens, addresses or e-mails)', async () => {
    const text = JSON.stringify(await summary());
    expect(text).not.toContain('@example.test');
    expect(text).not.toContain('Gandhi Chowk');
    expect(text).not.toContain(citizen);
  });

  it('is staff/admin only', async () => {
    await expect(summary(citizen)).rejects.toMatchObject({ code: 'CP403' });
    await expect(summary(worker1)).rejects.toMatchObject({ code: 'CP403' });
    await expect(runAs(db, { role: 'anon' }, () => db.query(`select public.dashboard_summary(30)`))).rejects.toMatchObject({ code: '42501' });
  });

  it('denies deactivated staff and validates days', async () => {
    await expect(summary(staff, 0)).rejects.toMatchObject({ code: 'CP422' });
    await expect(summary(staff, 366)).rejects.toMatchObject({ code: 'CP422' });
    const s2 = await addUser(db);
    await promote(db, s2, 'staff');
    await as(admin, `select * from public.admin_set_user_active($1, false, 'x')`, [s2]);
    await expect(summary(s2)).rejects.toMatchObject({ code: 'CP401' });
  });
});
