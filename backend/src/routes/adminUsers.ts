import { Router } from 'express';
import { z } from 'zod';
import type { Db, SupabaseGateway } from '../config/supabase.js';
import { getAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, validBody, validParams, validQuery } from '../middleware/validate.js';
import { PROFILE_COLUMNS, ROLES, toProfileDto, type ProfileRow } from '../types/domain.js';
import { firstRow, unwrap, unwrapRequired } from '../utils/dbError.js';
import { escapeLike, paginationQuery, queryBoolean, rangeFor } from '../utils/pagination.js';
import { sendSuccess } from '../utils/response.js';

const listQuery = z.object({
  ...paginationQuery,
  role: z.enum(ROLES).optional(),
  isActive: queryBoolean.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
const idParams = z.object({ id: z.uuid() });
const reason = z.string().trim().min(1, 'A reason is required').max(300);
const roleBody = z.object({ role: z.enum(ROLES), reason }).strict();
const activeBody = z.object({ isActive: z.boolean(), reason }).strict();

/** Read the e-mail addresses (they live in auth.users, which only the service role can read). */
async function loadEmails(gateway: SupabaseGateway, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  let admin: Db;
  try {
    admin = gateway.adminClient();
  } catch {
    return out; // service-role key not configured: list works without e-mails
  }
  await Promise.all(
    ids.map(async (id) => {
      try {
        const { data } = await admin.auth.admin.getUserById(id);
        out.set(id, data?.user?.email ?? null);
      } catch {
        out.set(id, null);
      }
    }),
  );
  return out;
}

export function createAdminUsersRouter(gateway: SupabaseGateway | null): Router {
  const router = Router();

  // Staff and admin may list (staff need it to find workers); only admin sees e-mails.
  router.get('/', requireRole('staff', 'admin'), validate({ query: listQuery }), async (_req, res) => {
    const a = getAuth(res);
    const q = validQuery<z.infer<typeof listQuery>>(res);

    let query = a.db.from('profiles').select(PROFILE_COLUMNS, { count: 'exact' });
    if (q.role) query = query.eq('role', q.role);
    if (q.isActive !== undefined) query = query.eq('is_active', q.isActive);
    if (q.q) query = query.ilike('full_name', `%${escapeLike(q.q)}%`);
    const [from, to] = rangeFor(q.page, q.limit);
    const res2 = await query.order('created_at', { ascending: false }).order('id', { ascending: true }).range(from, to);
    const rows = unwrap<ProfileRow[]>(res2) ?? [];

    const emails =
      a.role === 'admin' && gateway ? await loadEmails(gateway, rows.map((r) => r.id)) : new Map<string, string | null>();
    const data = rows.map((r) => ({
      ...toProfileDto(r),
      ...(a.role === 'admin' ? { email: emails.get(r.id) ?? null } : {}),
    }));
    sendSuccess(res, data, { meta: { page: q.page, limit: q.limit, total: res2.count ?? rows.length } });
  });

  // The SQL function re-checks "admin only", "not yourself" and "reason required", and writes the audit log.
  router.patch('/:id/role', requireRole('admin'), validate({ params: idParams, body: roleBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof roleBody>>(res);
    const r = await a.db.rpc('admin_set_user_role', { p_user_id: id, p_role: b.role, p_reason: b.reason });
    const row = unwrapRequired<ProfileRow>({ data: firstRow<ProfileRow>(r.data), error: r.error });
    sendSuccess(res, toProfileDto(row));
  });

  router.patch('/:id/active', requireRole('admin'), validate({ params: idParams, body: activeBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof activeBody>>(res);
    const r = await a.db.rpc('admin_set_user_active', { p_user_id: id, p_active: b.isActive, p_reason: b.reason });
    const row = unwrapRequired<ProfileRow>({ data: firstRow<ProfileRow>(r.data), error: r.error });
    sendSuccess(res, toProfileDto(row));
  });

  return router;
}
