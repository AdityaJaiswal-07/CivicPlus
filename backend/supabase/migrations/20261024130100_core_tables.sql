-- CivicPlus+ Phase 2 / migration 2 of 6
-- Core tables, constraints and indexes. Creates objects only.

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  phone       text,
  ward        text,
  avatar_url  text,
  role        public.user_role not null default 'citizen',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_len check (full_name is null or char_length(full_name) between 1 and 100),
  constraint profiles_phone_format  check (phone is null or phone ~ '^\+?[0-9]{7,15}$'),
  constraint profiles_ward_len      check (ward is null or char_length(ward) between 1 and 100),
  constraint profiles_avatar_len    check (avatar_url is null or char_length(avatar_url) <= 500)
);
create index profiles_role_idx on public.profiles (role) where is_active;

-- Who changed a role / active flag, when, from what to what.
-- No foreign keys on purpose: audit rows must outlive the users they describe.
create table public.profile_audit_log (
  id              bigint generated always as identity primary key,
  target_user_id  uuid not null,
  changed_by      uuid,                       -- null = changed from SQL editor / migration
  field           text not null check (field in ('role', 'is_active')),
  old_value       text,
  new_value       text,
  reason          text,
  created_at      timestamptz not null default now()
);
create index profile_audit_log_target_idx on public.profile_audit_log (target_user_id, created_at desc);

-- -------------------------------------------------------------- categories
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint categories_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  constraint categories_name_len    check (char_length(btrim(name)) between 2 and 80),
  constraint categories_desc_len    check (description is null or char_length(description) <= 300)
);
create unique index categories_slug_key on public.categories (slug);
create unique index categories_name_key on public.categories (lower(name));

-- ----------------------------------------------------------------- reports
create table public.reports (
  id           uuid primary key default gen_random_uuid(),
  citizen_id   uuid not null references public.profiles (id) on delete restrict,
  category_id  uuid not null references public.categories (id) on delete restrict,
  title        text not null,
  description  text not null,
  address_text text not null,
  latitude     numeric(9, 6),
  longitude    numeric(9, 6),
  ward         text,
  status       public.report_status not null default 'submitted',
  priority     public.report_priority not null default 'normal',
  photo_paths  text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  constraint reports_title_len     check (char_length(btrim(title)) between 3 and 150),
  constraint reports_desc_len      check (char_length(btrim(description)) between 10 and 2000),
  constraint reports_address_len   check (char_length(btrim(address_text)) between 3 and 300),
  constraint reports_lat_range     check (latitude is null or latitude between -90 and 90),
  constraint reports_lng_range     check (longitude is null or longitude between -180 and 180),
  constraint reports_coords_pair   check ((latitude is null) = (longitude is null)),
  constraint reports_ward_len      check (ward is null or char_length(btrim(ward)) between 1 and 100),
  constraint reports_photo_max     check (cardinality(photo_paths) <= 3),
  constraint reports_resolved_at   check ((status = 'resolved') = (resolved_at is not null))
);
create index reports_citizen_idx  on public.reports (citizen_id, created_at desc);
create index reports_status_idx   on public.reports (status, created_at desc);
create index reports_category_idx on public.reports (category_id);
create index reports_ward_idx     on public.reports (ward, status) where ward is not null;
create index reports_created_idx  on public.reports (created_at desc);

-- ---------------------------------------------------- report_status_history
-- Append-only trail. Rows are written only by trusted database functions.
create table public.report_status_history (
  id          bigint generated always as identity primary key,
  report_id   uuid not null references public.reports (id) on delete cascade,
  old_status  public.report_status,
  new_status  public.report_status not null,
  changed_by  uuid not null references public.profiles (id) on delete restrict,
  note        text,
  created_at  timestamptz not null default now(),
  constraint history_note_len check (note is null or char_length(note) <= 500)
);
create index report_history_report_idx on public.report_status_history (report_id, created_at, id);

-- -------------------------------------------------------- worker_assignments
create table public.worker_assignments (
  id            uuid primary key default gen_random_uuid(),
  report_id     uuid not null references public.reports (id) on delete cascade,
  worker_id     uuid not null references public.profiles (id) on delete restrict,
  assigned_by   uuid not null references public.profiles (id) on delete restrict,
  is_active     boolean not null default true,
  note          text,
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  constraint assignments_note_len   check (note is null or char_length(note) <= 500),
  constraint assignments_active_ts  check (is_active = (unassigned_at is null))
);
-- At most ONE active assignment per report, enforced by the database itself.
create unique index worker_assignments_one_active_per_report
  on public.worker_assignments (report_id) where is_active;
create index worker_assignments_worker_idx on public.worker_assignments (worker_id) where is_active;
create index worker_assignments_report_idx on public.worker_assignments (report_id);
