import type { Priority, ReportStatus } from './domain.js';

export const REPORT_COLUMNS =
  'id, citizen_id, category_id, title, description, address_text, latitude, longitude, ward, status, priority, photo_paths, created_at, updated_at, resolved_at';

/** Detail select: the report plus its category and (RLS permitting) the citizen's name. */
// Explicit FK hints: `profiles` is reachable from `reports` in several ways (citizen_id, and through
// worker_assignments), which PostgREST would otherwise reject as an ambiguous embed.
const CITIZEN_EMBED = 'citizen:profiles!reports_citizen_id_fkey(id, full_name)';
export const REPORT_DETAIL_SELECT = `${REPORT_COLUMNS}, category:categories(id, slug, name), ${CITIZEN_EMBED}`;

export const REPORT_LIST_SELECT =
  'id, citizen_id, title, address_text, ward, status, priority, photo_paths, created_at, updated_at, resolved_at, category:categories(id, slug, name)';

/** Staff/admin list: also the citizen's name and the CURRENT assignment (filtered with .eq('worker_assignments.is_active', true)). */
export const REPORT_STAFF_LIST_SELECT = `${REPORT_LIST_SELECT}, ${CITIZEN_EMBED}, worker_assignments(id, is_active, worker:profiles!worker_assignments_worker_id_fkey(id, full_name))`;

export interface CategoryRef {
  id: string;
  slug: string;
  name: string;
}

export interface ReportRow {
  id: string;
  citizen_id: string;
  category_id?: string;
  title: string;
  description?: string;
  address_text: string;
  latitude?: number | null;
  longitude?: number | null;
  ward: string | null;
  status: ReportStatus;
  priority: Priority;
  photo_paths: string[];
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  category?: CategoryRef | null;
  citizen?: { id: string; full_name: string | null } | null;
  worker_assignments?: Array<{ id: string; is_active: boolean; worker: { id: string; full_name: string | null } | null }>;
}

export interface ReportSummaryDto {
  id: string;
  title: string;
  addressText: string;
  ward: string | null;
  status: ReportStatus;
  priority: Priority;
  category: CategoryRef | null;
  citizenId: string;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Staff/admin lists only. */
  citizen?: { id: string; fullName: string | null } | null;
  /** Staff/admin lists only: the current worker, if any. */
  assignedWorker?: { id: string; fullName: string | null } | null;
}

export function toReportSummary(r: ReportRow): ReportSummaryDto {
  const current = r.worker_assignments?.find((a) => a.is_active);
  return {
    id: r.id,
    title: r.title,
    addressText: r.address_text,
    ward: r.ward,
    status: r.status,
    priority: r.priority,
    category: r.category ?? null,
    citizenId: r.citizen_id,
    photoCount: r.photo_paths?.length ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
    ...(r.citizen !== undefined ? { citizen: r.citizen ? { id: r.citizen.id, fullName: r.citizen.full_name } : null } : {}),
    ...(r.worker_assignments !== undefined
      ? { assignedWorker: current?.worker ? { id: current.worker.id, fullName: current.worker.full_name } : null }
      : {}),
  };
}

export interface ReportDetailDto extends ReportSummaryDto {
  description: string;
  latitude: number | null;
  longitude: number | null;
  photoPaths: string[];
  citizen: { id: string; fullName: string | null } | null;
}

export function toReportDetail(r: ReportRow): ReportDetailDto {
  return {
    ...toReportSummary(r),
    description: r.description ?? '',
    latitude: r.latitude ?? null,
    longitude: r.longitude ?? null,
    photoPaths: r.photo_paths ?? [],
    citizen: r.citizen ? { id: r.citizen.id, fullName: r.citizen.full_name } : null,
  };
}

export interface HistoryRow {
  id: number;
  old_status: ReportStatus | null;
  new_status: ReportStatus;
  changed_by: string;
  note: string | null;
  is_internal: boolean;
  created_at: string;
  changer?: { id: string; full_name: string | null } | null;
}

export const HISTORY_SELECT =
  'id, old_status, new_status, changed_by, note, is_internal, created_at, changer:profiles!report_status_history_changed_by_fkey(id, full_name)';

export interface HistoryDto {
  id: number;
  oldStatus: ReportStatus | null;
  newStatus: ReportStatus;
  note: string | null;
  isInternal: boolean;
  createdAt: string;
  /** null when the viewer is not allowed to know who acted (citizens never see staff identities). */
  changedBy: { id: string; fullName: string | null } | null;
}

export function toHistoryDto(r: HistoryRow, viewer: { userId: string; role: string }): HistoryDto {
  const canSeeActor = viewer.role !== 'citizen' || r.changed_by === viewer.userId;
  return {
    id: r.id,
    oldStatus: r.old_status,
    newStatus: r.new_status,
    note: r.note,
    isInternal: r.is_internal,
    createdAt: r.created_at,
    changedBy: canSeeActor ? { id: r.changed_by, fullName: r.changer?.full_name ?? null } : null,
  };
}
