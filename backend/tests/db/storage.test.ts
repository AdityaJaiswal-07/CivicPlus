import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createDb, runAs } from './harness.js';

let db: PGlite;
let user: string;

beforeAll(async () => {
  db = await createDb();
  user = await addUser(db);
  await db.query(`insert into storage.objects (bucket_id, name, owner) values ('report-photos', $1, $2)`, [`${user}/a.jpg`, user]);
}, 90_000);

describe('report-photos bucket (migration 8)', () => {
  it('exists, is private, limited to 5 MB and to jpeg/png/webp', async () => {
    const r = await db.query<{ public: boolean; file_size_limit: string | number; allowed_mime_types: string[] }>(
      `select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'report-photos'`,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.public).toBe(false);
    expect(Number(r.rows[0]!.file_size_limit)).toBe(5 * 1024 * 1024);
    expect([...r.rows[0]!.allowed_mime_types].sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('gives clients no direct access to objects (RLS on, no policies)', async () => {
    const pol = await db.query(`select 1 from pg_policies where schemaname = 'storage'`);
    expect(pol.rows).toHaveLength(0);
    for (const role of ['authenticated', 'anon'] as const) {
      const rows = await runAs(db, { userId: user, role }, () => db.query(`select 1 from storage.objects`));
      expect(rows.rows, role).toHaveLength(0);
      await expect(
        runAs(db, { userId: user, role }, () =>
          db.query(`insert into storage.objects (bucket_id, name, owner) values ('report-photos', 'x/y.jpg', $1)`, [user]),
        ),
      ).rejects.toMatchObject({ code: '42501' });
    }
  });

  it('is safe to re-run: no duplicate bucket and existing settings are not overwritten', async () => {
    await db.query(`update storage.buckets set file_size_limit = 1000 where id = 'report-photos'`);
    const sql = readFileSync(join(import.meta.dirname, '..', '..', 'supabase', 'migrations', '20261024130700_storage_report_photos.sql'), 'utf8');
    await db.exec(sql);
    const r = await db.query<{ file_size_limit: string | number }>(`select file_size_limit from storage.buckets where id = 'report-photos'`);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0]!.file_size_limit)).toBe(1000);
  });
});
