import { Router } from 'express';
import { z } from 'zod';
import { getAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, validBody, validParams, validQuery } from '../middleware/validate.js';
import { PRIORITIES, REPORT_STATUSES } from '../types/domain.js';
import { toHistoryDto, toReportDetail, type HistoryRow, type ReportRow } from '../types/reports.js';
import { firstRow, mapDbError, unwrap, unwrapRequired } from '../utils/dbError.js';
import { paginationQuery, rangeFor } from '../utils/pagination.js';
import { sendSuccess } from '../utils/response.js';
import { fetchReportOr404, idParams } from './reports.js';

const note = z.string().trim().max(500);

/** `assigned` only via /assign, `cancelled` only via the citizen's /cancel, `submitted` never. */
export const statusBody = z
  .object({ status: z.enum(['under_review', 'rejected', 'in_progress', 'resolved']), note: note.optional() })
  .strict();
export const assignBody = z.object({ workerId: z.uuid(), note: note.optional() }).strict();
export const priorityBody = z.object({ priority: z.enum(PRIORITIES) }).strict();
export const internalNoteBody = z.object({ note: z.string().trim().min(1, 'A note is required').max(500) }).strict();
const reviewQuery = z.object({ ...paginationQuery });

interface ReviewRow {
  report_id: string;
  title: string;
  status: string;
  priority: string;
  ward: string | null;
  address_text: string;
  report_created_at: string;
  assignment_id: string;
  assigned_at: string;
  worker_id: string;
  worker_name: string | null;
  worker_role: string;
  worker_is_active: boolean;
  review_reason: 'worker_deactivated' | 'worker_role_changed';
}

/**
 * Workflow actions. Every one is a database function that re-checks the caller's role,
 * locks the report row, validates the transition and writes history in one transaction.
 * The route-level requireRole is only a fast first gate. Mounted BEFORE the generic
 * reports router so that /needs-reassignment is not swallowed by /:id.
 */
export function createReportActionsRouter(): Router {
  const router = Router();

  // Report counts per status for what THIS user can see (RLS: citizen own, worker assigned, staff/admin all).
  router.get('/counts', async (_req, res) => {
    const a = getAuth(res);
    const entries = await Promise.all(
      REPORT_STATUSES.map(async (s) => {
        const r = await a.db.from('reports').select('id', { count: 'exact', head: true }).eq('status', s);
        if (r.error) throw mapDbError(r.error);
        return [s, r.count ?? 0] as const;
      }),
    );
    const byStatus = Object.fromEntries(entries);
    sendSuccess(res, { total: entries.reduce((n, [, c]) => n + c, 0), byStatus });
  });

  // Reports whose active worker was deactivated / demoted: staff must reassign (nothing is automatic).
  router.get('/needs-reassignment', requireRole('staff', 'admin'), validate({ query: reviewQuery }), async (_req, res) => {
    const a = getAuth(res);
    const q = validQuery<z.infer<typeof reviewQuery>>(res);
    const [from, to] = rangeFor(q.page, q.limit);
    const result = await a.db
      .from('reports_needing_reassignment')
      .select('*', { count: 'exact' })
      .order('report_created_at', { ascending: true })
      .order('report_id', { ascending: true })
      .range(from, to);
    const rows = unwrap<ReviewRow[]>(result) ?? [];
    sendSuccess(
      res,
      rows.map((r) => ({
        reportId: r.report_id,
        title: r.title,
        status: r.status,
        priority: r.priority,
        ward: r.ward,
        addressText: r.address_text,
        reportCreatedAt: r.report_created_at,
        assignmentId: r.assignment_id,
        assignedAt: r.assigned_at,
        worker: { id: r.worker_id, fullName: r.worker_name, role: r.worker_role, isActive: r.worker_is_active },
        reason: r.review_reason,
      })),
      { meta: { page: q.page, limit: q.limit, total: result.count ?? rows.length } },
    );
  });

  // Worker (assigned), staff, admin. The DB decides who may make which transition.
  router.patch('/:id/status', requireRole('worker', 'staff', 'admin'), validate({ params: idParams, body: statusBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof statusBody>>(res);
    const r = await a.db.rpc('change_report_status', { p_report_id: id, p_new_status: b.status, p_note: b.note ?? null });
    unwrapRequired<ReportRow>({ data: firstRow<ReportRow>(r.data), error: r.error });
    sendSuccess(res, toReportDetail(await fetchReportOr404(a.db, id)));
  });

  // Staff/admin. Also used to REassign (previous worker is released automatically).
  router.post('/:id/assign', requireRole('staff', 'admin'), validate({ params: idParams, body: assignBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof assignBody>>(res);
    const r = await a.db.rpc('assign_report', { p_report_id: id, p_worker_id: b.workerId, p_note: b.note ?? null });
    unwrapRequired<ReportRow>({ data: firstRow<ReportRow>(r.data), error: r.error });
    sendSuccess(res, toReportDetail(await fetchReportOr404(a.db, id)));
  });

  router.patch('/:id/priority', requireRole('staff', 'admin'), validate({ params: idParams, body: priorityBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof priorityBody>>(res);
    const r = await a.db.rpc('set_report_priority', { p_report_id: id, p_priority: b.priority });
    unwrapRequired<ReportRow>({ data: firstRow<ReportRow>(r.data), error: r.error });
    sendSuccess(res, toReportDetail(await fetchReportOr404(a.db, id)));
  });

  // Staff-only notes that citizens and workers can never read.
  router.post('/:id/internal-notes', requireRole('staff', 'admin'), validate({ params: idParams, body: internalNoteBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof internalNoteBody>>(res);
    const r = await a.db.rpc('add_internal_note', { p_report_id: id, p_note: b.note });
    const row = unwrapRequired<HistoryRow>({ data: firstRow<HistoryRow>(r.data), error: r.error });
    sendSuccess(res, toHistoryDto(row, { userId: a.userId, role: a.role }), { status: 201 });
  });

  return router;
}
