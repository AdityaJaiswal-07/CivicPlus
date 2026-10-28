import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, categoryId, countRows, createDb, createReport, promote, runAs } from './harness.js';

let db: PGlite;
let cat: string;
let citizenA: string, citizenB: string, unverified: string, inactiveCitizen: string;
let worker1: string, worker2: string, inactiveWorker: string, staff: string, admin: string;

const status = (who: string, id: string, s: string, note: string | null = null) =>
  runAs(db, { userId: who }, () =>
    db.query<{ status: string }>(`select status from public.change_report_status($1, $2::public.report_status, $3)`, [id, s, note]),
  );
const assign = (who: string, id: string, worker: string, note: string | null = null) =>
  runAs(db, { userId: who }, () =>
    db.query<{ status: string }>(`select status from public.assign_report($1, $2, $3)`, [id, worker, note]),
  );
const as = (who: string, sql: string, params: unknown[] = []) => runAs(db, { userId: who }, () => db.query(sql, params));
const visible = (who: string, id: string) =>
  runAs(db, { userId: who }, () => countRows(db, 'select 1 from public.reports where id = $1', [id]));
interface HistoryRow {
  old_status: string | null;
  new_status: string;
  changed_by: string;
  note: string | null;
}
const history = async (id: string) =>
  (
    await db.query<HistoryRow>(
      `select old_status, new_status, changed_by, note from public.report_status_history where report_id = $1 order by id`,
      [id],
    )
  ).rows;
const newReport = (who = citizenA) => createReport(db, who, { citizenId: who, categoryId: cat });
const activeAssignments = (id: string) =>
  countRows(db, 'select 1 from public.worker_assignments where report_id = $1 and is_active', [id]);

beforeAll(async () => {
  db = await createDb();
  cat = await categoryId(db);
  citizenA = await addUser(db);
  citizenB = await addUser(db);
  unverified = await addUser(db, { verified: false });
  inactiveCitizen = await addUser(db);
  worker1 = await addUser(db);
  worker2 = await addUser(db);
  inactiveWorker = await addUser(db);
  staff = await addUser(db);
  admin = await addUser(db);
  await promote(db, worker1, 'worker');
  await promote(db, worker2, 'worker');
  await promote(db, inactiveWorker, 'worker');
  await promote(db, staff, 'staff');
  await promote(db, admin, 'admin');
  for (const id of [inactiveCitizen, inactiveWorker]) {
    await runAs(db, { userId: admin }, () => db.query(`select * from public.admin_set_user_active($1, false, 'test')`, [id]));
  }
}, 90_000);

describe('creating reports', () => {
  it('lets a verified citizen file a report and writes the first history row atomically', async () => {
    const id = await newReport();
    const r = await db.query(`select citizen_id, status, priority, resolved_at from public.reports where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ citizen_id: citizenA, status: 'submitted', priority: 'normal', resolved_at: null });
    expect(await history(id)).toEqual([
      { old_status: null, new_status: 'submitted', changed_by: citizenA, note: 'Report submitted' },
    ]);
  });

  it('cannot file a report in someone else’s name', async () => {
    await expect(createReport(db, citizenA, { citizenId: citizenB, categoryId: cat })).rejects.toMatchObject({ code: '42501' });
  });

  it('cannot choose status, priority or resolved_at at creation', async () => {
    for (const col of ['status', 'priority', 'resolved_at']) {
      const value = col === 'status' ? `'resolved'` : col === 'priority' ? `'urgent'` : 'now()';
      await expect(
        as(citizenA, `insert into public.reports (citizen_id, category_id, title, description, address_text, ${col})
                      values ($1, $2, 'Some title', 'A long enough description', 'Some address', ${value})`, [citizenA, cat]),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('blocks unverified-email, deactivated, worker, staff and admin users from filing', async () => {
    for (const who of [unverified, inactiveCitizen, worker1, staff, admin]) {
      await expect(createReport(db, who, { citizenId: who, categoryId: cat }), who).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('blocks anonymous users', async () => {
    await expect(
      runAs(db, { role: 'anon' }, () => db.query(`insert into public.reports (citizen_id, category_id, title, description, address_text) values ($1,$2,'abc','long enough text','addr')`, [citizenA, cat])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('validates coordinates, photo count and photo paths', async () => {
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, latitude: 91, longitude: 10 })).rejects.toMatchObject({ code: '23514' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, latitude: 10, longitude: 181 })).rejects.toMatchObject({ code: '23514' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, latitude: 10, longitude: null })).rejects.toMatchObject({ code: '23514' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, latitude: 26.76, longitude: 83.37 })).resolves.toBeTruthy();

    const p = (n: number) => `${citizenA}/photo${n}.jpg`;
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, photoPaths: [p(1), p(2), p(3), p(4)] })).rejects.toMatchObject({ code: '23514' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, photoPaths: [p(1), p(2), p(3)] })).resolves.toBeTruthy();
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, photoPaths: [`${citizenB}/x.jpg`] })).rejects.toMatchObject({ code: 'CP422' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, photoPaths: [`${citizenA}/../x.jpg`] })).rejects.toMatchObject({ code: 'CP422' });
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: cat, photoPaths: [`${citizenA}/sub/x.jpg`] })).rejects.toMatchObject({ code: 'CP422' });
  });

  it('rejects an unknown or inactive category', async () => {
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: randomUUID() })).rejects.toMatchObject({ code: 'CP422' });
    const other = await categoryId(db, 'other');
    await runAs(db, { userId: admin }, () => db.query(`update public.categories set is_active = false where id = $1`, [other]));
    await expect(createReport(db, citizenA, { citizenId: citizenA, categoryId: other })).rejects.toMatchObject({ code: 'CP422' });
    await runAs(db, { userId: admin }, () => db.query(`update public.categories set is_active = true where id = $1`, [other]));
  });
});

describe('who can see which report', () => {
  it('owner and staff/admin see it; other citizens, anon and unassigned workers do not', async () => {
    const id = await newReport();
    expect(await visible(citizenA, id)).toBe(1);
    expect(await visible(staff, id)).toBe(1);
    expect(await visible(admin, id)).toBe(1);
    expect(await visible(citizenB, id)).toBe(0);
    expect(await visible(worker1, id)).toBe(0);
    await expect(runAs(db, { role: 'anon' }, () => db.query('select * from public.reports'))).rejects.toMatchObject({ code: '42501' });
  });

  it('history follows report visibility', async () => {
    const id = await newReport();
    const q = 'select 1 from public.report_status_history where report_id = $1';
    expect(await runAs(db, { userId: citizenA }, () => countRows(db, q, [id]))).toBe(1);
    expect(await runAs(db, { userId: staff }, () => countRows(db, q, [id]))).toBe(1);
    expect(await runAs(db, { userId: citizenB }, () => countRows(db, q, [id]))).toBe(0);
    expect(await runAs(db, { userId: worker1 }, () => countRows(db, q, [id]))).toBe(0);
  });
});

describe('editing and protected columns', () => {
  it('owner can edit content only while status is submitted', async () => {
    const id = await newReport();
    const ok = await as(citizenA, `update public.reports set title = 'Updated title' where id = $1`, [id]);
    expect(ok.affectedRows).toBe(1);
    await status(staff, id, 'under_review');
    const blocked = await as(citizenA, `update public.reports set title = 'Too late now' where id = $1`, [id]);
    expect(blocked.affectedRows).toBe(0);
  });

  it('other users cannot edit someone else’s report', async () => {
    const id = await newReport();
    expect((await as(citizenB, `update public.reports set title = 'Hijacked' where id = $1`, [id])).affectedRows).toBe(0);
    expect((await as(staff, `update public.reports set title = 'Hijacked' where id = $1`, [id])).affectedRows).toBe(0);
  });

  it('nobody can change owner, status, priority or resolved_at directly', async () => {
    const id = await newReport();
    for (const who of [citizenA, staff, admin, worker1]) {
      for (const set of [`citizen_id = '${citizenB}'`, `status = 'resolved'`, `priority = 'urgent'`, 'resolved_at = now()']) {
        await expect(as(who, `update public.reports set ${set} where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
      }
    }
  });

  it('even service_role cannot change protected columns directly (trigger guard)', async () => {
    const id = await newReport();
    await expect(
      runAs(db, { role: 'service_role' }, () => db.query(`update public.reports set status = 'resolved', resolved_at = now() where id = $1`, [id])),
    ).rejects.toMatchObject({ code: 'CP403' });
    await expect(
      runAs(db, { role: 'service_role' }, () => db.query(`update public.reports set citizen_id = $2 where id = $1`, [id, citizenB])),
    ).rejects.toMatchObject({ code: 'CP403' });
  });

  it('nobody can delete reports through the API', async () => {
    const id = await newReport();
    for (const who of [citizenA, staff, admin]) {
      await expect(as(who, `delete from public.reports where id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    }
  });
});

describe('status history is append-only', () => {
  it('cannot be inserted, updated or deleted by users or service_role', async () => {
    const id = await newReport();
    for (const who of [citizenA, staff, admin]) {
      await expect(as(who, `insert into public.report_status_history (report_id, new_status, changed_by) values ($1, 'resolved', $2)`, [id, who])).rejects.toMatchObject({ code: '42501' });
      await expect(as(who, `update public.report_status_history set note = 'x' where report_id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
      await expect(as(who, `delete from public.report_status_history where report_id = $1`, [id])).rejects.toMatchObject({ code: '42501' });
    }
    await expect(
      runAs(db, { role: 'service_role' }, () => db.query(`update public.report_status_history set note = 'x' where report_id = $1`, [id])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('RLS alone already hides history rows from updates even if a grant is added by mistake', async () => {
    const id = await newReport();
    await db.exec(`grant update on public.report_status_history to authenticated`);
    try {
      const r = await as(citizenA, `update public.report_status_history set note = 'x' where report_id = $1`, [id]);
      expect(r.affectedRows).toBe(0);
    } finally {
      await db.exec(`revoke update on public.report_status_history from authenticated`);
    }
  });

  it('trigger still blocks edits if BOTH a grant and a policy were added by mistake', async () => {
    const id = await newReport();
    await db.exec(`grant update, delete on public.report_status_history to authenticated;
                   create policy tmp_bad_update on public.report_status_history for update to authenticated using (true);
                   create policy tmp_bad_delete on public.report_status_history for delete to authenticated using (true);`);
    try {
      await expect(
        as(citizenA, `update public.report_status_history set note = 'x' where report_id = $1`, [id]),
      ).rejects.toMatchObject({ code: 'CP403' });
      await expect(
        as(citizenA, `delete from public.report_status_history where report_id = $1`, [id]),
      ).rejects.toMatchObject({ code: 'CP403' });
    } finally {
      await db.exec(`drop policy tmp_bad_update on public.report_status_history;
                     drop policy tmp_bad_delete on public.report_status_history;
                     revoke update, delete on public.report_status_history from authenticated;`);
    }
  });
});

describe('citizen cancel', () => {
  it('owner can cancel while submitted; it is recorded and final', async () => {
    const id = await newReport();
    expect((await status(citizenA, id, 'cancelled', 'Duplicate')).rows[0]!.status).toBe('cancelled');
    expect((await history(id)).at(-1)).toMatchObject({ old_status: 'submitted', new_status: 'cancelled', changed_by: citizenA, note: 'Duplicate' });
    await expect(status(staff, id, 'under_review')).rejects.toMatchObject({ code: 'CP409' });
  });

  it('other citizens get 404, staff get 403, and it is too late after review', async () => {
    const id = await newReport();
    await expect(status(citizenB, id, 'cancelled')).rejects.toMatchObject({ code: 'CP404' });
    await expect(status(staff, id, 'cancelled')).rejects.toMatchObject({ code: 'CP403' });
    await status(staff, id, 'under_review');
    await expect(status(citizenA, id, 'cancelled')).rejects.toMatchObject({ code: 'CP409' });
  });
});

describe('staff review, rejection, priority', () => {
  it('staff moves a report to under_review and the history shows who', async () => {
    const id = await newReport();
    await status(staff, id, 'under_review');
    expect((await history(id)).at(-1)).toMatchObject({ old_status: 'submitted', new_status: 'under_review', changed_by: staff });
  });

  it('rejection needs a note; rejected is final', async () => {
    const id = await newReport();
    await expect(status(staff, id, 'rejected')).rejects.toMatchObject({ code: 'CP422' });
    await status(staff, id, 'rejected', 'Not a waste issue');
    await expect(status(staff, id, 'under_review')).rejects.toMatchObject({ code: 'CP409' });
  });

  it('citizens and workers cannot review or reject; "assigned" cannot be set directly', async () => {
    const id = await newReport();
    await expect(status(citizenA, id, 'under_review')).rejects.toMatchObject({ code: 'CP403' });
    await expect(status(citizenA, id, 'resolved')).rejects.toMatchObject({ code: 'CP403' });
    await expect(status(staff, id, 'assigned')).rejects.toMatchObject({ code: 'CP409' });
    await expect(status(staff, id, 'submitted')).rejects.toMatchObject({ code: 'CP409' });
  });

  it('only staff/admin set priority', async () => {
    const id = await newReport();
    await runAs(db, { userId: staff }, () => db.query(`select * from public.set_report_priority($1, 'high')`, [id]));
    const r = await db.query(`select priority from public.reports where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ priority: 'high' });
    await expect(
      runAs(db, { userId: citizenA }, () => db.query(`select * from public.set_report_priority($1, 'urgent')`, [id])),
    ).rejects.toMatchObject({ code: 'CP403' });
  });

  it('unauthenticated callers get 401-style errors', async () => {
    const id = await newReport();
    await expect(runAs(db, { userId: null }, () => db.query(`select * from public.change_report_status($1,'under_review')`, [id]))).rejects.toMatchObject({ code: 'CP401' });
    await expect(runAs(db, { role: 'anon' }, () => db.query(`select * from public.change_report_status($1,'under_review')`, [id]))).rejects.toMatchObject({ code: '42501' });
  });

  it('a failed transition changes nothing (no partial write, no history row)', async () => {
    const id = await newReport();
    const before = (await history(id)).length;
    await expect(status(staff, id, 'resolved')).rejects.toMatchObject({ code: 'CP409' });
    expect((await history(id)).length).toBe(before);
    const r = await db.query(`select status from public.reports where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ status: 'submitted' });
  });
});

describe('worker assignment', () => {
  it('only staff/admin can assign; citizens and workers cannot', async () => {
    const id = await newReport();
    for (const who of [citizenA, citizenB, worker1]) {
      await expect(assign(who, id, worker1)).rejects.toMatchObject({ code: 'CP403' });
    }
    expect((await assign(staff, id, worker1)).rows[0]!.status).toBe('assigned');
    expect((await assign(admin, await newReport(), worker1)).rows[0]!.status).toBe('assigned');
  });

  it('only active workers can be assigned', async () => {
    const id = await newReport();
    await expect(assign(staff, id, citizenB)).rejects.toMatchObject({ code: 'CP422' });
    await expect(assign(staff, id, staff)).rejects.toMatchObject({ code: 'CP422' });
    await expect(assign(staff, id, inactiveWorker)).rejects.toMatchObject({ code: 'CP422' });
    await expect(assign(staff, id, randomUUID())).rejects.toMatchObject({ code: 'CP422' });
    await expect(assign(staff, randomUUID(), worker1)).rejects.toMatchObject({ code: 'CP404' });
  });

  it('records assignment + history together, and workers only see what is assigned to them', async () => {
    const id = await newReport();
    expect(await visible(worker1, id)).toBe(0);
    await assign(staff, id, worker1, 'Please handle today');
    expect(await visible(worker1, id)).toBe(1);
    expect(await visible(worker2, id)).toBe(0);
    expect((await history(id)).at(-1)).toMatchObject({ old_status: 'submitted', new_status: 'assigned', changed_by: staff, note: 'Please handle today' });
    const q = 'select 1 from public.report_status_history where report_id = $1';
    expect(await runAs(db, { userId: worker1 }, () => countRows(db, q, [id]))).toBe(2);
    expect(await runAs(db, { userId: worker2 }, () => countRows(db, q, [id]))).toBe(0);
  });

  it('reassigning keeps exactly one active assignment and moves access to the new worker', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await expect(assign(staff, id, worker1)).rejects.toMatchObject({ code: 'CP409' });
    await assign(admin, id, worker2);
    expect(await activeAssignments(id)).toBe(1);
    expect(await countRows(db, 'select 1 from public.worker_assignments where report_id = $1', [id])).toBe(2);
    expect(await visible(worker1, id)).toBe(0);
    expect(await visible(worker2, id)).toBe(1);
  });

  it('database refuses a second active assignment even if inserted directly', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await expect(
      db.query(`insert into public.worker_assignments (report_id, worker_id, assigned_by) values ($1, $2, $3)`, [id, worker2, staff]),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('assignments cannot be written or read by citizens, and workers see only their own', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await expect(
      as(citizenA, `insert into public.worker_assignments (report_id, worker_id, assigned_by) values ($1,$2,$2)`, [id, citizenA]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      as(staff, `update public.worker_assignments set worker_id = $2 where report_id = $1`, [id, worker2]),
    ).rejects.toMatchObject({ code: '42501' });
    const q = 'select 1 from public.worker_assignments where report_id = $1';
    expect(await runAs(db, { userId: citizenA }, () => countRows(db, q, [id]))).toBe(0);
    expect(await runAs(db, { userId: worker2 }, () => countRows(db, q, [id]))).toBe(0);
    expect(await runAs(db, { userId: worker1 }, () => countRows(db, q, [id]))).toBe(1);
    expect(await runAs(db, { userId: staff }, () => countRows(db, q, [id]))).toBe(1);
  });

  it('cannot assign finished reports', async () => {
    const id = await newReport();
    await status(staff, id, 'rejected', 'Spam');
    await expect(assign(staff, id, worker1)).rejects.toMatchObject({ code: 'CP409' });
  });
});

describe('worker progress and resolution', () => {
  async function inProgress() {
    const id = await newReport();
    await assign(staff, id, worker1);
    await status(worker1, id, 'in_progress', 'On my way');
    return id;
  }

  it('assigned worker moves assigned -> in_progress -> resolved with full history', async () => {
    const id = await inProgress();
    await status(worker1, id, 'resolved', 'Bin emptied');
    const r = await db.query<{ status: string; resolved_at: Date | null }>(`select status, resolved_at from public.reports where id = $1`, [id]);
    expect(r.rows[0]!.status).toBe('resolved');
    expect(r.rows[0]!.resolved_at).not.toBeNull();
    expect((await history(id)).map((h) => [h.old_status, h.new_status, h.changed_by])).toEqual([
      [null, 'submitted', citizenA],
      ['submitted', 'assigned', staff],
      ['assigned', 'in_progress', worker1],
      ['in_progress', 'resolved', worker1],
    ]);
  });

  it('skipping steps is rejected', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await expect(status(worker1, id, 'resolved')).rejects.toMatchObject({ code: 'CP409' });
  });

  it('a worker not assigned to the report cannot touch it (404, nothing leaks)', async () => {
    const id = await newReport();
    await assign(staff, id, worker1);
    await expect(status(worker2, id, 'in_progress')).rejects.toMatchObject({ code: 'CP404' });
    const other = await newReport();
    await expect(status(worker1, other, 'in_progress')).rejects.toMatchObject({ code: 'CP404' });
  });

  it('a worker cannot review, reject, cancel or reopen', async () => {
    const id = await inProgress();
    for (const s of ['under_review', 'rejected', 'cancelled']) {
      await expect(status(worker1, id, s, 'x')).rejects.toMatchObject({ code: 'CP403' });
    }
  });

  it('a worker who was reassigned away loses access immediately', async () => {
    const id = await inProgress();
    await assign(staff, id, worker2);
    await expect(status(worker1, id, 'resolved')).rejects.toMatchObject({ code: 'CP404' });
    expect((await status(worker2, id, 'in_progress')).rows[0]!.status).toBe('in_progress');
  });

  it('staff can reopen a resolved report (note required), which releases the worker', async () => {
    const id = await inProgress();
    await status(worker1, id, 'resolved');
    await expect(status(staff, id, 'under_review')).rejects.toMatchObject({ code: 'CP422' });
    await status(staff, id, 'under_review', 'Citizen says it is still overflowing');
    const r = await db.query(`select status, resolved_at from public.reports where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ status: 'under_review', resolved_at: null });
    expect(await activeAssignments(id)).toBe(0);
    expect(await visible(worker1, id)).toBe(0);
    await assign(staff, id, worker2);
    expect(await activeAssignments(id)).toBe(1);
  });

  it('a citizen cannot resolve or reopen their own report', async () => {
    const id = await inProgress();
    await expect(status(citizenA, id, 'resolved')).rejects.toMatchObject({ code: 'CP403' });
    await status(worker1, id, 'resolved');
    await expect(status(citizenA, id, 'under_review', 'again')).rejects.toMatchObject({ code: 'CP403' });
  });
});

describe('categories administration', () => {
  it('every logged-in role can read categories; anon cannot', async () => {
    for (const who of [citizenA, worker1, staff, admin]) {
      expect(await runAs(db, { userId: who }, () => countRows(db, 'select 1 from public.categories'))).toBeGreaterThanOrEqual(4);
    }
    await expect(runAs(db, { role: 'anon' }, () => db.query('select * from public.categories'))).rejects.toMatchObject({ code: '42501' });
  });

  it('only admin can create or edit categories; nobody can delete', async () => {
    const ins = `insert into public.categories (slug, name) values ('bulky-waste', 'Bulky waste')`;
    for (const who of [citizenA, worker1, staff]) {
      await expect(as(who, ins)).rejects.toMatchObject({ code: '42501' });
    }
    await expect(as(admin, ins)).resolves.toBeTruthy();
    const upd = `update public.categories set name = 'Bulky waste pickup' where slug = 'bulky-waste'`;
    expect((await as(admin, upd)).affectedRows).toBe(1);
    expect((await as(staff, upd)).affectedRows).toBe(0);
    await expect(as(admin, `delete from public.categories where slug = 'bulky-waste'`)).rejects.toMatchObject({ code: '42501' });
  });

  it('rejects duplicate names (case-insensitive) and bad slugs', async () => {
    await expect(as(admin, `insert into public.categories (slug, name) values ('x-dup', 'OVERFLOWING BINS')`)).rejects.toMatchObject({ code: '23505' });
    await expect(as(admin, `insert into public.categories (slug, name) values ('Bad Slug', 'Fine name')`)).rejects.toMatchObject({ code: '23514' });
  });
});
