import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, countRows, createDb, promote, runAs } from './harness.js';

let db: PGlite;
let citizen: string, citizen2: string, worker: string, staff: string, admin: string, admin2: string;
let seedCounts: { categories: number; profiles: number; reports: number; users: number };

const setRole = (who: string, target: string, role: string, reason: string | null = 'because') =>
  runAs(db, { userId: who }, () =>
    db.query(`select role from public.admin_set_user_role($1, $2::public.user_role, $3)`, [target, role, reason]),
  );

beforeAll(async () => {
  db = await createDb();
  seedCounts = {
    categories: await countRows(db, 'select 1 from public.categories'),
    profiles: await countRows(db, 'select 1 from public.profiles'),
    reports: await countRows(db, 'select 1 from public.reports'),
    users: await countRows(db, 'select 1 from auth.users'),
  };
  citizen = await addUser(db);
  citizen2 = await addUser(db);
  worker = await addUser(db);
  staff = await addUser(db);
  admin = await addUser(db);
  admin2 = await addUser(db);
  await promote(db, worker, 'worker');
  await promote(db, staff, 'staff');
  await promote(db, admin, 'admin');
  await promote(db, admin2, 'admin');
}, 90_000);

describe('seed data', () => {
  it('creates only reference categories: no users, profiles or reports', () => {
    expect(seedCounts).toEqual({ categories: 4, profiles: 0, reports: 0, users: 0 });
  });
});

describe('signup and role safety', () => {
  it('gives every new signup the citizen role, ignoring role in user metadata', async () => {
    const id = await addUser(db, { meta: { role: 'admin', full_name: '  Asha Verma  ' } });
    const r = await db.query<{ role: string; full_name: string; is_active: boolean }>(
      `select role, full_name, is_active from public.profiles where id = $1`,
      [id],
    );
    expect(r.rows[0]).toEqual({ role: 'citizen', full_name: 'Asha Verma', is_active: true });
  });

  it('does not break signup when metadata is junk', async () => {
    const id = await addUser(db, { meta: { full_name: 'x'.repeat(500), role: ['admin'] } });
    const r = await db.query<{ n: number }>(`select char_length(full_name)::int as n from public.profiles where id = $1`, [id]);
    expect(r.rows[0]!.n).toBe(100);
  });

  it('citizen cannot change own role', async () => {
    await expect(
      runAs(db, { userId: citizen }, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [citizen])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('citizen cannot reactivate/deactivate self or change id', async () => {
    await expect(
      runAs(db, { userId: citizen }, () => db.query(`update public.profiles set is_active = false where id = $1`, [citizen])),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runAs(db, { userId: citizen }, () => db.query(`update public.profiles set id = $2 where id = $1`, [citizen, randomUUID()])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('service_role cannot change roles directly either (trigger guard)', async () => {
    await expect(
      runAs(db, { role: 'service_role' }, () => db.query(`update public.profiles set role = 'admin' where id = $1`, [citizen])),
    ).rejects.toMatchObject({ code: 'CP403' });
  });

  it('nobody can insert or delete profiles through the API', async () => {
    await expect(
      runAs(db, { userId: citizen }, () =>
        db.query(`insert into public.profiles (id, role) values ($1, 'admin')`, [randomUUID()]),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runAs(db, { userId: admin }, () => db.query(`delete from public.profiles where id = $1`, [citizen])),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('profiles RLS', () => {
  it('citizen can edit own safe fields but not invalid data', async () => {
    const ok = await runAs(db, { userId: citizen }, () =>
      db.query(`update public.profiles set full_name = 'Ravi', phone = '+919876543210', ward = 'Ward 7' where id = $1`, [citizen]),
    );
    expect(ok.affectedRows).toBe(1);
    await expect(
      runAs(db, { userId: citizen }, () => db.query(`update public.profiles set phone = 'abc' where id = $1`, [citizen])),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it("citizen cannot edit someone else's profile (0 rows affected)", async () => {
    const r = await runAs(db, { userId: citizen }, () =>
      db.query(`update public.profiles set full_name = 'Hacked' where id = $1`, [citizen2]),
    );
    expect(r.affectedRows).toBe(0);
  });

  it('citizen and worker see only their own profile; staff and admin see all', async () => {
    expect(await runAs(db, { userId: citizen }, () => countRows(db, 'select 1 from public.profiles'))).toBe(1);
    expect(await runAs(db, { userId: worker }, () => countRows(db, 'select 1 from public.profiles'))).toBe(1);
    expect(await runAs(db, { userId: staff }, () => countRows(db, 'select 1 from public.profiles'))).toBeGreaterThan(5);
    expect(await runAs(db, { userId: admin }, () => countRows(db, 'select 1 from public.profiles'))).toBeGreaterThan(5);
  });

  it('anonymous (not logged in) role has no access at all', async () => {
    await expect(
      runAs(db, { role: 'anon' }, () => db.query(`select * from public.profiles`)),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('admin role management and audit trail', () => {
  it('rejects role changes from citizen, worker and staff', async () => {
    for (const who of [citizen, worker, staff]) {
      await expect(setRole(who, citizen2, 'staff')).rejects.toMatchObject({ code: 'CP403' });
    }
  });

  it('rejects unauthenticated callers', async () => {
    await expect(
      runAs(db, { userId: null }, () => db.query(`select * from public.admin_set_user_role($1, 'staff', 'x')`, [citizen2])),
    ).rejects.toMatchObject({ code: 'CP401' });
    await expect(
      runAs(db, { role: 'anon' }, () => db.query(`select * from public.admin_set_user_role($1, 'staff', 'x')`, [citizen2])),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('lets an admin change a role, and writes who/what/why to the audit log', async () => {
    const target = await addUser(db);
    const r = await setRole(admin, target, 'worker', 'Joined sanitation team');
    expect(r.rows[0]).toEqual({ role: 'worker' });
    const log = await db.query(
      `select changed_by, field, old_value, new_value, reason from public.profile_audit_log where target_user_id = $1`,
      [target],
    );
    expect(log.rows).toEqual([
      { changed_by: admin, field: 'role', old_value: 'citizen', new_value: 'worker', reason: 'Joined sanitation team' },
    ]);
  });

  it('requires a reason, a real target, and blocks changing your own role', async () => {
    await expect(setRole(admin, citizen2, 'worker', '  ')).rejects.toMatchObject({ code: 'CP422' });
    await expect(setRole(admin, randomUUID(), 'worker')).rejects.toMatchObject({ code: 'CP404' });
    await expect(setRole(admin, admin, 'citizen')).rejects.toMatchObject({ code: 'CP409' });
  });

  it('audits even the first-admin bootstrap done from the SQL editor (changed_by is null)', async () => {
    const r = await db.query(
      `select changed_by, old_value, new_value from public.profile_audit_log where target_user_id = $1`,
      [admin],
    );
    expect(r.rows).toEqual([{ changed_by: null, old_value: 'citizen', new_value: 'admin' }]);
  });

  it('admin can deactivate a user (audited); staff cannot', async () => {
    const target = await addUser(db);
    await expect(
      runAs(db, { userId: staff }, () => db.query(`select * from public.admin_set_user_active($1, false, 'x')`, [target])),
    ).rejects.toMatchObject({ code: 'CP403' });
    await runAs(db, { userId: admin }, () =>
      db.query(`select * from public.admin_set_user_active($1, false, 'Left the department')`, [target]),
    );
    const r = await db.query(
      `select p.is_active, a.field, a.new_value from public.profiles p
         join public.profile_audit_log a on a.target_user_id = p.id where p.id = $1`,
      [target],
    );
    expect(r.rows).toEqual([{ is_active: false, field: 'is_active', new_value: 'false' }]);
  });

  it('only admins can read the audit log', async () => {
    expect(await runAs(db, { userId: admin }, () => countRows(db, 'select 1 from public.profile_audit_log'))).toBeGreaterThan(0);
    for (const who of [citizen, worker, staff]) {
      expect(await runAs(db, { userId: who }, () => countRows(db, 'select 1 from public.profile_audit_log'))).toBe(0);
    }
    await expect(
      runAs(db, { userId: admin }, () => db.query(`delete from public.profile_audit_log`)),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      runAs(db, { role: 'service_role' }, () => db.query(`update public.profile_audit_log set reason = 'edited'`)),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('a second admin exists as expected (fixture sanity)', async () => {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.profiles where role = 'admin' and id = any($1)`, [[admin, admin2]]);
    expect(r.rows[0]!.n).toBe(2);
  });
});

describe('table security settings', () => {
  const tables = ['profiles', 'profile_audit_log', 'categories', 'reports', 'report_status_history', 'worker_assignments'];

  it('has RLS enabled on every table', async () => {
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(
      `select relname, relrowsecurity from pg_class
        where relnamespace = 'public'::regnamespace and relname = any($1)`,
      [tables],
    );
    expect(r.rows).toHaveLength(tables.length);
    expect(r.rows.every((x) => x.relrowsecurity)).toBe(true);
  });

  it('gives the anon role no table privileges at all', async () => {
    for (const t of tables) {
      for (const priv of ['select', 'insert', 'update', 'delete', 'truncate']) {
        const r = await db.query<{ ok: boolean }>(`select has_table_privilege('anon', $1, $2) as ok`, [`public.${t}`, priv]);
        expect(r.rows[0]!.ok, `anon ${priv} on ${t}`).toBe(false);
      }
    }
  });

  it('nobody (authenticated, anon, service_role) can modify or delete history/audit rows', async () => {
    for (const role of ['authenticated', 'anon', 'service_role']) {
      for (const t of ['report_status_history', 'profile_audit_log']) {
        for (const priv of ['insert', 'update', 'delete', 'truncate']) {
          const r = await db.query<{ ok: boolean }>(`select has_table_privilege($1, $2, $3) as ok`, [role, `public.${t}`, priv]);
          expect(r.rows[0]!.ok, `${role} ${priv} on ${t}`).toBe(false);
        }
      }
    }
  });
});
