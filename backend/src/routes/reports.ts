import { Router } from 'express';
import { z } from 'zod';
import type { Db, SupabaseGateway } from '../config/supabase.js';
import { getAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, validBody, validParams, validQuery } from '../middleware/validate.js';
import { PRIORITIES, REPORT_STATUSES } from '../types/domain.js';
import {
  HISTORY_SELECT,
  REPORT_DETAIL_SELECT,
  REPORT_LIST_SELECT,
  REPORT_STAFF_LIST_SELECT,
  toHistoryDto,
  toReportDetail,
  toReportSummary,
  type HistoryRow,
  type ReportRow,
} from '../types/reports.js';
import { AppError } from '../utils/AppError.js';
import { firstRow, unwrap, unwrapRequired } from '../utils/dbError.js';
import { paginationQuery, rangeFor } from '../utils/pagination.js';
import { sendError, sendSuccess } from '../utils/response.js';
import rateLimit from 'express-rate-limit';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, createPhotoService, type PhotoService, type PhotoType } from '../services/photos.js';

export const idParams = z.object({ id: z.uuid() });

const title = z.string().trim().min(3).max(150);
const description = z.string().trim().min(10).max(2000);
const addressText = z.string().trim().min(3).max(300);
const ward = z.union([z.string().trim().min(1).max(100), z.null()]);
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
/** Storage paths look like `<citizen id>/<file>`; the folder rule is also enforced by a DB trigger. */
export const photoPath = z
  .string()
  .regex(/^[0-9a-fA-F-]{36}\/[A-Za-z0-9._-]{1,120}$/, 'Invalid photo path')
  .refine((p) => !p.includes('..'), 'Invalid photo path');
const photoPaths = z.array(photoPath).max(3, 'At most 3 photos per report');
const note = z.string().trim().max(500);

const pairOk = (v: { latitude?: number | null | undefined; longitude?: number | null | undefined }) =>
  (v.latitude === undefined) === (v.longitude === undefined) && (v.latitude === null) === (v.longitude === null);
const PAIR_MSG = { message: 'latitude and longitude must be provided together', path: ['latitude'] };

export const createReportBody = z
  .object({
    categoryId: z.uuid(),
    title,
    description,
    addressText,
    latitude: latitude.optional(),
    longitude: longitude.optional(),
    ward: ward.optional(),
    photoPaths: photoPaths.default([]),
  })
  .strict()
  .refine(pairOk, PAIR_MSG);

export const updateReportBody = z
  .object({
    categoryId: z.uuid().optional(),
    title: title.optional(),
    description: description.optional(),
    addressText: addressText.optional(),
    latitude: latitude.nullable().optional(),
    longitude: longitude.nullable().optional(),
    ward: ward.optional(),
    photoPaths: photoPaths.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Provide at least one field to update' })
  .refine(pairOk, PAIR_MSG);

export const cancelBody = z.object({ note: note.optional() }).strict();

const day = z.iso.date();
export const listQuery = z.object({
  ...paginationQuery,
  /** One status, or several separated by commas: `assigned,in_progress`. */
  status: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))])
    .pipe(z.array(z.enum(REPORT_STATUSES)).min(1))
    .optional(),
  priority: z.enum(PRIORITIES).optional(),
  categoryId: z.uuid().optional(),
  ward: z.string().trim().min(1).max(100).optional(),
  q: z.string().trim().min(1).max(100).optional(),
  createdFrom: day.optional(),
  createdTo: day.optional(),
  sort: z.enum(['newest', 'oldest', 'priority']).default('newest'),
});

function nextDayIso(d: string): string {
  const t = new Date(`${d}T00:00:00.000Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString();
}

/** Fetch one report as seen by this user (RLS decides visibility). Null = missing OR not allowed. */
export async function fetchReport(db: Db, id: string): Promise<ReportRow | null> {
  return unwrap<ReportRow>(await db.from('reports').select(REPORT_DETAIL_SELECT).eq('id', id).maybeSingle());
}

export async function fetchReportOr404(db: Db, id: string): Promise<ReportRow> {
  const r = await fetchReport(db, id);
  if (!r) throw AppError.notFound('Report not found');
  return r;
}

export const uploadUrlBody = z
  .object({
    contentType: z.enum(Object.keys(PHOTO_TYPES) as [PhotoType, ...PhotoType[]]),
    sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  })
  .strict();

export function createReportsRouter(gateway: SupabaseGateway | null, storageBucket = 'report-photos'): Router {
  const router = Router();
  const photos: PhotoService = createPhotoService(gateway, storageBucket);
  const withPhotos = async <T extends { photoPaths: string[] }>(dto: T) => ({ ...dto, photos: await photos.signUrls(dto.photoPaths) });

  // Minting upload URLs is limited per user (not per IP), on top of the global limiter.
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (_req, res) => (res.locals.auth as { userId: string }).userId,
    handler: (_req, res) => {
      sendError(res, 429, 'RATE_LIMITED', 'Too many photo uploads, please try again later');
    },
  });

  // ---- step 1 of attaching photos: get a one-time upload URL for a server-chosen path
  router.post('/photos/upload-url', requireRole('citizen'), uploadLimiter, validate({ body: uploadUrlBody }), async (_req, res) => {
    const a = getAuth(res);
    if (!a.emailVerified) throw AppError.forbidden('Please verify your email address before uploading photos');
    const b = validBody<z.infer<typeof uploadUrlBody>>(res);
    sendSuccess(res, await photos.createUploadUrl(a.userId, b.contentType), { status: 201 });
  });

  // ---- create (citizens only)
  router.post('/', requireRole('citizen'), validate({ body: createReportBody }), async (_req, res) => {
    const a = getAuth(res);
    const b = validBody<z.infer<typeof createReportBody>>(res);
    if (!a.emailVerified) throw AppError.forbidden('Please verify your email address before filing a report');
    if (b.photoPaths.some((p) => !p.toLowerCase().startsWith(`${a.userId.toLowerCase()}/`))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Photos must be uploaded by you', [{ path: 'photoPaths', message: 'Invalid photo path' }]);
    }
    await photos.assertExist(a.userId, b.photoPaths);
    const row = unwrapRequired<ReportRow>(
      await a.db
        .from('reports')
        .insert({
          citizen_id: a.userId, // always the caller, never from the body
          category_id: b.categoryId,
          title: b.title,
          description: b.description,
          address_text: b.addressText,
          latitude: b.latitude ?? null,
          longitude: b.longitude ?? null,
          ward: b.ward ?? null,
          photo_paths: b.photoPaths,
        })
        .select(REPORT_DETAIL_SELECT)
        .single(),
    );
    sendSuccess(res, await withPhotos(toReportDetail(row)), { status: 201 });
  });

  // ---- list: RLS already limits rows (citizen: own, worker: assigned, staff/admin: all)
  router.get('/', validate({ query: listQuery }), async (_req, res) => {
    const a = getAuth(res);
    const q = validQuery<z.infer<typeof listQuery>>(res);
    const staff = a.role === 'staff' || a.role === 'admin';
    let query = a.db.from('reports').select(staff ? REPORT_STAFF_LIST_SELECT : REPORT_LIST_SELECT, { count: 'exact' });
    if (staff) query = query.eq('worker_assignments.is_active', true); // embedded rows only: keeps unassigned reports
    if (q.status) query = q.status.length === 1 ? query.eq('status', q.status[0]!) : query.in('status', q.status);
    if (q.priority) query = query.eq('priority', q.priority);
    if (q.categoryId) query = query.eq('category_id', q.categoryId);
    if (q.ward) query = query.eq('ward', q.ward);
    if (q.q) {
      // Title OR address. Characters that mean something in PostgREST's filter grammar or in LIKE are
      // replaced by spaces first, so user text can never change the structure of the filter.
      const term = q.q.replace(/[,()"\\%_*:]/g, ' ').replace(/\s+/g, ' ').trim();
      if (term) query = query.or(`title.ilike."%${term}%",address_text.ilike."%${term}%"`);
    }
    if (q.createdFrom) query = query.gte('created_at', `${q.createdFrom}T00:00:00.000Z`);
    if (q.createdTo) query = query.lt('created_at', nextDayIso(q.createdTo));
    if (q.sort === 'priority') {
      query = query.order('priority', { ascending: false }).order('created_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: q.sort === 'oldest' });
    }
    const [from, to] = rangeFor(q.page, q.limit);
    const result = await query.order('id', { ascending: true }).range(from, to);
    const rows = unwrap<ReportRow[]>(result) ?? [];
    sendSuccess(res, rows.map(toReportSummary), { meta: { page: q.page, limit: q.limit, total: result.count ?? rows.length } });
  });

  // ---- detail
  router.get('/:id', validate({ params: idParams }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const report = await fetchReportOr404(a.db, id);
    // Visibility was already proven by RLS above; only now are read URLs signed (service role).
    const dto = await withPhotos(toReportDetail(report));
    if (a.role === 'citizen') {
      sendSuccess(res, dto);
      return;
    }
    // Workers see their own assignment; staff/admin also see the worker's name and the review flag.
    const asg = unwrap<{ id: string; worker_id: string; assigned_at: string; note: string | null }>(
      await a.db.from('worker_assignments').select('id, worker_id, assigned_at, note').eq('report_id', id).eq('is_active', true).maybeSingle(),
    );
    let workerName: string | null = null;
    let needsReassignment: boolean | undefined;
    if (a.role === 'staff' || a.role === 'admin') {
      if (asg) {
        const w = unwrap<{ full_name: string | null }>(await a.db.from('profiles').select('full_name').eq('id', asg.worker_id).maybeSingle());
        workerName = w?.full_name ?? null;
      }
      const flagged = unwrap<{ report_id: string }>(await a.db.from('reports_needing_reassignment').select('report_id').eq('report_id', id).maybeSingle());
      needsReassignment = flagged !== null;
    }
    sendSuccess(res, {
      ...dto,
      assignment: asg ? { id: asg.id, workerId: asg.worker_id, workerName, assignedAt: asg.assigned_at, note: asg.note } : null,
      ...(needsReassignment !== undefined ? { needsReassignment } : {}),
    });
  });

  // ---- owner edits own report, only while still "submitted"
  router.patch('/:id', requireRole('citizen'), validate({ params: idParams, body: updateReportBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof updateReportBody>>(res);
    if (b.photoPaths?.some((p) => !p.toLowerCase().startsWith(`${a.userId.toLowerCase()}/`))) {
      throw new AppError(422, 'VALIDATION_ERROR', 'Photos must be uploaded by you', [{ path: 'photoPaths', message: 'Invalid photo path' }]);
    }
    const current = await fetchReportOr404(a.db, id);
    if (current.citizen_id !== a.userId) throw AppError.notFound('Report not found');
    if (current.status !== 'submitted') {
      throw AppError.conflict('This report can no longer be edited because it is already being processed');
    }

    const added = (b.photoPaths ?? []).filter((p) => !current.photo_paths.includes(p));
    await photos.assertExist(a.userId, added);

    const patch: Record<string, unknown> = {};
    if (b.categoryId !== undefined) patch.category_id = b.categoryId;
    if (b.title !== undefined) patch.title = b.title;
    if (b.description !== undefined) patch.description = b.description;
    if (b.addressText !== undefined) patch.address_text = b.addressText;
    if (b.latitude !== undefined) patch.latitude = b.latitude;
    if (b.longitude !== undefined) patch.longitude = b.longitude;
    if (b.ward !== undefined) patch.ward = b.ward;
    if (b.photoPaths !== undefined) patch.photo_paths = b.photoPaths;

    // RLS (owner + status = submitted) is the real guard; a lost race ends up as 404/409 below.
    const row = unwrap<ReportRow>(await a.db.from('reports').update(patch).eq('id', id).select(REPORT_DETAIL_SELECT).maybeSingle());
    if (!row) throw AppError.conflict('This report can no longer be edited because it is already being processed');
    await photos.remove(current.photo_paths.filter((p) => b.photoPaths !== undefined && !b.photoPaths.includes(p)));
    sendSuccess(res, await withPhotos(toReportDetail(row)));
  });

  // ---- owner cancels (database function enforces: owner only, status must be "submitted")
  router.post('/:id/cancel', requireRole('citizen'), validate({ params: idParams, body: cancelBody }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const b = validBody<z.infer<typeof cancelBody>>(res);
    const r = await a.db.rpc('change_report_status', { p_report_id: id, p_new_status: 'cancelled', p_note: b.note ?? null });
    unwrapRequired<ReportRow>({ data: firstRow<ReportRow>(r.data), error: r.error });
    sendSuccess(res, toReportDetail(await fetchReportOr404(a.db, id)));
  });

  // ---- status history (RLS hides internal notes from citizens and workers)
  router.get('/:id/history', validate({ params: idParams }), async (_req, res) => {
    const a = getAuth(res);
    const { id } = validParams<z.infer<typeof idParams>>(res);
    const visible = unwrap<{ id: string }>(await a.db.from('reports').select('id').eq('id', id).maybeSingle());
    if (!visible) throw AppError.notFound('Report not found');
    const rows =
      unwrap<HistoryRow[]>(
        await a.db.from('report_status_history').select(HISTORY_SELECT).eq('report_id', id).order('created_at', { ascending: true }).order('id', { ascending: true }),
      ) ?? [];
    sendSuccess(res, rows.map((r) => toHistoryDto(r, { userId: a.userId, role: a.role })));
  });

  return router;
}
