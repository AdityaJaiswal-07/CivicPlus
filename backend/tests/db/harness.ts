import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const root = join(import.meta.dirname, '..', '..');

export type DbRole = 'authenticated' | 'anon' | 'service_role';

export async function createDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(readFileSync(join(import.meta.dirname, 'supabase-stub.sql'), 'utf8'));
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    await db.exec(readFileSync(join(dir, f), 'utf8'));
  }
  return db;
}

/** Run `fn` as a given database role, with auth.uid() = userId. Always resets afterwards. */
export async function runAs<T>(
  db: PGlite,
  who: { userId?: string | null; role?: DbRole },
  fn: () => Promise<T>,
): Promise<T> {
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [who.userId ?? '']);
  await db.exec(`set role ${who.role ?? 'authenticated'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
}

export async function addUser(
  db: PGlite,
  opts: { verified?: boolean; meta?: Record<string, unknown> } = {},
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
     values ($1, $2, $3, $4::jsonb)`,
    [id, `${id}@example.test`, opts.verified === false ? null : new Date().toISOString(), JSON.stringify(opts.meta ?? {})],
  );
  return id;
}

/** Superuser/SQL-editor path, used only to set up test fixtures. */
export async function promote(db: PGlite, id: string, role: 'worker' | 'staff' | 'admin') {
  await db.query(`update public.profiles set role = $2 where id = $1`, [id, role]);
}

export async function categoryId(db: PGlite, slug = 'overflowing-bins'): Promise<string> {
  const r = await db.query<{ id: string }>(`select id from public.categories where slug = $1`, [slug]);
  return r.rows[0]!.id;
}

export interface ReportInput {
  citizenId: string;
  categoryId: string;
  title?: string;
  latitude?: number | null;
  longitude?: number | null;
  photoPaths?: string[];
}

/** Insert a report AS the given user (through RLS). */
export async function createReport(db: PGlite, who: string, input: ReportInput): Promise<string> {
  const r = await runAs(db, { userId: who }, () =>
    db.query<{ id: string }>(
      `insert into public.reports
         (citizen_id, category_id, title, description, address_text, latitude, longitude, photo_paths)
       values ($1, $2, $3, 'Bin has been overflowing for three days', 'Near Gandhi Chowk', $4, $5, $6)
       returning id`,
      [
        input.citizenId,
        input.categoryId,
        input.title ?? 'Overflowing bin',
        input.latitude ?? null,
        input.longitude ?? null,
        input.photoPaths ?? [],
      ],
    ),
  );
  return r.rows[0]!.id;
}

export async function countRows(db: PGlite, sql: string, params: unknown[] = []): Promise<number> {
  const r = await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) t`, params);
  return r.rows[0]!.n;
}
