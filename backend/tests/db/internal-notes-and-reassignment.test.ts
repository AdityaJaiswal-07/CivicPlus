import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, categoryId, countRows, createDb, createReport, promote, runAs } from './harness.js';

let db: PGlite;
let cat: string;
let citizenA: string, citizenB: string;
let worker1: string, worker2: string, staff: string, admin: string;

const as = (who: string, sql: string, params: unknown[] = []) =>
  runAs(db, { userId: who }, () => db.query<Record<string, unknown>>(sql, params));
const note = (who: string, id: string, text: string | null) =>
  as(who, `select * from public.add_internal_note($1, $2)`, [id, text]);
const status = (who: string, id: string, s: string, n: string | null = null) =>
  as(who, `select status from public.change_report_status($1, $2::public.report_status, $3)`, [id, s, n]);
const assign = (who: string, id: string, worker: string) =>
  as(who, `select status from public.assign_report($1, $2, null)`, [id, worker]);
const setActive = (who: string, id: string, active: boolean) =>
  as(who, `select * from public.admin_set_user_active($1, $2, 'test')`, [id, active]);
const setRole = (who: string, id: string, role: string) =>
  as(who, `select * from public.admin_set_user_role($1, $2::public.user_role, 'test')`, [id, role]);
const newReport = (who = citizenA) => createReport(db, who, { citizenId: who, categoryId: cat });
const historyFor = (who: string, id: string) =>
  as(who, `select note, is_internal from public.report_status_history where report_id = $1 order by id`, [id]);
const reviewList = (who: string) =>
  as(who, `select report_id, review_reason, worker_id from public.reports_needing_reassignment`);

beforeAll(async () => {
  db = await createDb();
  cat = await categoryId(db);
  citizenA = await addUser(db);
  citizenB = await addUser(db);
  worker1 = await addUser(db);
  worker2 = await addUser(db);
  staff = await addUser(db);
  admin = await addUser(db);
  await promote(db, worker1, 'worker');
  await promote(db, worker2, 'worker');
  await promote(db, staff, 'staff');
  await promote(db, admin, 'admin');
}, 90_000);

describe('internal notes', () => {
  it('lets staff and admin add an internal note without changing the status', async () => {
    const id = await newReport();
    for (const who of [staff, admin]) {
      const r = await note(who, id, '  Caller says the bin is next to a school  ');
      expect(r.rows[0]).toMatchObject({
        report_id: id,
        old_status: 'submitted',
        new_status: 'submitted',
        changed_by: who,
        note: 'Caller says the bin is next to a school',
        is_internal: true,
      });
    }
    const s = await db.query<{ status: string }>(`select status from public.reports where id = $1`, [id]);
    expect(s.rows[0]!.status).toBe('submitted');
  });

  it('hides internal notes from the citizen who owns the report', async () => {
    const id = await newReport();
    await note(staff, id, 'INTERNAL-SECRET');
    const rows = (await historyFor(citizenA, id)).rows;
    expect(rows).toEqual([{ note: 'Report submitted', is_internal: false }]);
    // also not reachable by filtering directly
    expect(
      await runAs(db, { userId: citizenA }, () =>
        countRows(db, `select 1 from public.report_status_history where report_id = $1 and note like '%SECRET%'`, [id]),
      ),
    ).toBe(0);
  });

  it('hides internal notes from the assigned worker', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await note(staff, id, 'INTERNAL-SECRET');
    const rows = (await historyFor(worker1, id)).rows;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.is_internal)).toBe(true);
  });

  it('shows internal notes to staff and admin, alongside normal history', async () => {
    const id = await newReport();
    await note(staff, id, 'INTERNAL-SECRET');
    for (const who of [staff, admin]) {
      const rows = (await historyFor(who, id)).rows;
      expect(rows).toEqual([
        { note: 'Report submitted', is_internal: false },
        { note: 'INTERNAL-SECRET', is_internal: true },
      ]);
    }
  });

  it('keeps showing normal (public) notes to the citizen', async () => {
    const id = await newReport();
    await status(staff, id, 'rejected', 'Not a municipal issue');
    await note(staff, id, 'INTERNAL-SECRET');
    const notes = (await historyFor(citizenA, id)).rows.map((r) => r.note);
    expect(notes).toEqual(['Report submitted', 'Not a municipal issue']);
  });

  it('does not let citizens or workers add internal notes', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    for (const who of [citizenA, worker1]) {
      await expect(note(who, id, 'hello')).rejects.toMatchObject({ code: 'CP403' });
    }
  });

  it('rejects anonymous callers', async () => {
    const id = await newReport();
    await expect(runAs(db, { role: 'anon' }, () => db.query(`select * from public.add_internal_note($1, 'x')`, [id]))).rejects.toThrow();
  });

  it('validates the note and the report', async () => {
    const id = await newReport();
    await expect(note(staff, id, null)).rejects.toMatchObject({ code: 'CP422' });
    await expect(note(staff, id, '   ')).rejects.toMatchObject({ code: 'CP422' });
    await expect(note(staff, id, 'x'.repeat(501))).rejects.toMatchObject({ code: 'CP422' });
    await expect(note(staff, '00000000-0000-0000-0000-000000000000', 'hi')).rejects.toMatchObject({ code: 'CP404' });
  });

  it('denies a deactivated staff member', async () => {
    const s2 = await addUser(db);
    await promote(db, s2, 'staff');
    await setActive(admin, s2, false);
    const id = await newReport();
    await expect(note(s2, id, 'hi')).rejects.toMatchObject({ code: 'CP401' });
  });

  it('cannot be written or edited directly, even by the citizen or service_role', async () => {
    const id = await newReport();
    await note(staff, id, 'INTERNAL-SECRET');
    await expect(
      as(citizenA, `insert into public.report_status_history (report_id, new_status, changed_by, is_internal)
                    values ($1, 'submitted', $2, false)`, [id, citizenA]),
    ).rejects.toThrow();
    await expect(
      runAs(db, { role: 'service_role' }, () =>
        db.query(`update public.report_status_history set is_internal = false where report_id = $1`, [id]),
      ),
    ).rejects.toThrow();
    await expect(
      as(staff, `update public.report_status_history set is_internal = false where report_id = $1`, [id]),
    ).rejects.toThrow();
  });

  it('enforces the table rule: an internal row must be a status-less note', async () => {
    const id = await newReport();
    await expect(
      db.query(
        `insert into public.report_status_history (report_id, old_status, new_status, changed_by, note, is_internal)
         values ($1, 'submitted', 'rejected', $2, 'x', true)`,
        [id, staff],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query(
        `insert into public.report_status_history (report_id, old_status, new_status, changed_by, note, is_internal)
         values ($1, 'submitted', 'submitted', $2, null, true)`,
        [id, staff],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('never marks normal history rows as internal', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.report_status_history where is_internal`);
    // only the notes created by tests above are internal; "Report submitted" rows are not
    const submitted = await db.query<{ n: number }>(
      `select count(*)::int as n from public.report_status_history where note = 'Report submitted' and is_internal`,
    );
    expect(r.rows[0]!.n).toBeGreaterThan(0);
    expect(submitted.rows[0]!.n).toBe(0);
  });
});

describe('reassignment review for deactivated workers', () => {
  it('flags an open report when its worker is deactivated, without reassigning it', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    expect((await reviewList(staff)).rows).not.toContainEqual(expect.objectContaining({ report_id: id }));

    await setActive(admin, w, false);

    for (const who of [staff, admin]) {
      expect((await reviewList(who)).rows).toContainEqual({ report_id: id, review_reason: 'worker_deactivated', worker_id: w });
    }
    // not reassigned, still the same assignment and status
    const a = await db.query(`select worker_id, is_active from public.worker_assignments where report_id = $1`, [id]);
    expect(a.rows).toEqual([{ worker_id: w, is_active: true }]);
    const s = await db.query<{ status: string }>(`select status from public.reports where id = $1`, [id]);
    expect(s.rows[0]!.status).toBe('assigned');
  });

  it('also flags in_progress reports', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    await status(w, id, 'in_progress');
    await setActive(admin, w, false);
    expect((await reviewList(staff)).rows).toContainEqual(expect.objectContaining({ report_id: id }));
  });

  it('the deactivated worker loses all access to the report and cannot update it', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    await setActive(admin, w, false);
    expect(await runAs(db, { userId: w }, () => countRows(db, 'select 1 from public.reports where id = $1', [id]))).toBe(0);
    expect(await runAs(db, { userId: w }, () => countRows(db, 'select 1 from public.report_status_history'))).toBe(0);
    await expect(status(w, id, 'in_progress')).rejects.toMatchObject({ code: 'CP401' });
    expect((await reviewList(w)).rows).toEqual([]);
  });

  it('flags the report when the worker is demoted to another role', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    await setRole(admin, w, 'citizen');
    expect((await reviewList(staff)).rows).toContainEqual({ report_id: id, review_reason: 'worker_role_changed', worker_id: w });
  });

  it('clears the flag when staff reassign to an active worker', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    await setActive(admin, w, false);
    expect((await reviewList(staff)).rows).toContainEqual(expect.objectContaining({ report_id: id }));

    await assign(staff, id, worker2);

    expect((await reviewList(staff)).rows).not.toContainEqual(expect.objectContaining({ report_id: id }));
    const active = await db.query(`select worker_id from public.worker_assignments where report_id = $1 and is_active`, [id]);
    expect(active.rows).toEqual([{ worker_id: worker2 }]);
  });

  it('clears the flag when the worker is reactivated', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport();
    await assign(staff, id, w);
    await setActive(admin, w, false);
    await setActive(admin, w, true);
    expect((await reviewList(staff)).rows).not.toContainEqual(expect.objectContaining({ report_id: id }));
  });

  it('does not flag finished reports (resolved) or reports whose worker is fine', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const resolved = await newReport();
    await assign(staff, resolved, w);
    await status(w, resolved, 'in_progress');
    await status(w, resolved, 'resolved');
    const healthy = await newReport();
    await assign(staff, healthy, worker1);
    await setActive(admin, w, false);
    const ids = (await reviewList(staff)).rows.map((r) => r.report_id);
    expect(ids).not.toContain(resolved);
    expect(ids).not.toContain(healthy);
  });

  it('is invisible to citizens and anon, and never leaks other people’s reports', async () => {
    const w = await addUser(db);
    await promote(db, w, 'worker');
    const id = await newReport(citizenA);
    await assign(staff, id, w);
    await setActive(admin, w, false);
    // the owner can read their own report row, but the review view stays empty for them
    expect((await reviewList(citizenA)).rows).toEqual([]);
    expect((await reviewList(citizenB)).rows).toEqual([]);
    await expect(runAs(db, { role: 'anon' }, () => db.query(`select * from public.reports_needing_reassignment`))).rejects.toMatchObject({
      code: '42501',
    });
  });

  it('can be cleared by staff only through assign_report; the view is read-only', async () => {
    for (const priv of ['insert', 'update', 'delete']) {
      const r = await db.query<{ ok: boolean }>(
        `select has_table_privilege('authenticated', 'public.reports_needing_reassignment', $1) as ok`,
        [priv],
      );
      expect(r.rows[0]!.ok, priv).toBe(false);
    }
  });
});
