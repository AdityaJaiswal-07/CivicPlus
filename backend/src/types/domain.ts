export const ROLES = ['citizen', 'worker', 'staff', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const REPORT_STATUSES = [
  'submitted',
  'under_review',
  'assigned',
  'in_progress',
  'resolved',
  'rejected',
  'cancelled',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface ProfileRow {
  id: string;
  full_name: string | null;
  phone: string | null;
  ward: string | null;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const PROFILE_COLUMNS = 'id, full_name, phone, ward, avatar_url, role, is_active, created_at, updated_at';

export interface ProfileDto {
  id: string;
  fullName: string | null;
  phone: string | null;
  ward: string | null;
  avatarUrl: string | null;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toProfileDto(row: ProfileRow): ProfileDto {
  return {
    id: row.id,
    fullName: row.full_name,
    phone: row.phone,
    ward: row.ward,
    avatarUrl: row.avatar_url,
    role: row.role,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

export const CATEGORY_COLUMNS = 'id, slug, name, description, is_active, sort_order';

export interface CategoryDto {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function toCategoryDto(row: CategoryRow): CategoryDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
    sortOrder: row.sort_order,
  };
}
