-- CivicPlus+ all migrations in order (generated from backend/supabase/migrations). For SQL Editor use on a NEW, EMPTY project only.

-- ===== 20261024130000_enums_and_schema.sql =====
-- CivicPlus+ Phase 2 / migration 1 of 6
-- Enums and the private "app" schema (helper functions live here, NOT in the
-- API-exposed "public" schema).
-- Safe to run on a NEW project: creates objects only, drops nothing.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.user_role as enum ('citizen', 'worker', 'staff', 'admin');

create type public.report_status as enum (
  'submitted',     -- citizen filed it
  'under_review',  -- staff is reviewing it
  'assigned',      -- a worker has been assigned
  'in_progress',   -- worker started work
  'resolved',      -- worker/staff finished it
  'rejected',      -- staff rejected it (note required)
  'cancelled'      -- citizen cancelled it (only while 'submitted')
);

create type public.report_priority as enum ('low', 'normal', 'high', 'urgent');

-- ===== 20261024130100_core_tables.sql =====
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

-- ===== 20261024130200_functions_and_triggers.sql =====
-- CivicPlus+ Phase 2 / migration 3 of 6
-- Helper functions and triggers.
--
-- Security notes
-- * Helper functions are SECURITY DEFINER with an empty search_path. They read
--   public.profiles as the table owner, so RLS policies that call them do NOT
--   recurse into the profiles policies.
-- * Guard triggers deliberately use `current_user` (not a settable session
--   variable). Inside a SECURITY DEFINER function current_user is the function
--   owner ('postgres'); for a direct statement it is the caller's role
--   ('authenticated', 'service_role', ...). A client cannot fake that.

-- ------------------------------------------------------------- updated_at
create function app.set_updated_at() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  new.updated_at := now();
  return new;
end
$fn$;

create trigger profiles_30_updated_at   before update on public.profiles   for each row execute function app.set_updated_at();
create trigger categories_30_updated_at before update on public.categories for each row execute function app.set_updated_at();
create trigger reports_30_updated_at    before update on public.reports    for each row execute function app.set_updated_at();

-- ------------------------------------------- new signup -> citizen profile
-- The role is ALWAYS 'citizen'. raw_user_meta_data is user-controlled and is
-- never used for role. Must never raise, or signup would break.
create function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 100), ''),
    'citizen'
  )
  on conflict (id) do nothing;
  return new;
end
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- --------------------------------------------------------- role helpers
create function app.current_user_role() returns public.user_role
language sql stable security definer set search_path = '' as $fn$
  select p.role from public.profiles p where p.id = (select auth.uid()) and p.is_active
$fn$;

create function app.is_staff_or_admin() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce(app.current_user_role() in ('staff', 'admin'), false)
$fn$;

create function app.is_admin() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce(app.current_user_role() = 'admin', false)
$fn$;

create function app.is_email_verified() returns boolean
language sql stable security definer set search_path = '' as $fn$
  select exists (
    select 1 from auth.users u
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  )
$fn$;

create function app.is_assigned_worker(p_report_id uuid) returns boolean
language sql stable security definer set search_path = '' as $fn$
  select coalesce(app.current_user_role() = 'worker', false)
     and exists (
       select 1 from public.worker_assignments wa
       where wa.report_id = p_report_id
         and wa.worker_id = (select auth.uid())
         and wa.is_active
     )
$fn$;

revoke all on function app.current_user_role(), app.is_staff_or_admin(), app.is_admin(),
  app.is_email_verified(), app.is_assigned_worker(uuid) from public, anon;
grant execute on function app.current_user_role(), app.is_staff_or_admin(), app.is_admin(),
  app.is_email_verified(), app.is_assigned_worker(uuid) to authenticated, service_role;

-- ------------------------------------------- profiles: protect role/active
create function app.guard_profile_update() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if new.id is distinct from old.id then
    raise exception 'profile id cannot be changed' using errcode = 'CP403';
  end if;
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'role and active status can only be changed through the admin functions'
      using errcode = 'CP403';
  end if;
  return new;
end
$fn$;
create trigger profiles_10_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

create function app.audit_profile_change() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  v_reason text := nullif(current_setting('app.change_reason', true), '');
begin
  if new.role is distinct from old.role then
    insert into public.profile_audit_log (target_user_id, changed_by, field, old_value, new_value, reason)
    values (new.id, (select auth.uid()), 'role', old.role::text, new.role::text, v_reason);
  end if;
  if new.is_active is distinct from old.is_active then
    insert into public.profile_audit_log (target_user_id, changed_by, field, old_value, new_value, reason)
    values (new.id, (select auth.uid()), 'is_active', old.is_active::text, new.is_active::text, v_reason);
  end if;
  return null;
end
$fn$;
create trigger profiles_20_audit after update on public.profiles
  for each row execute function app.audit_profile_change();

-- --------------------------------------------------- reports: write guards
-- Ownership, status, priority and resolved_at can only change through the
-- trusted functions in migration 4 (current_user = owner there).
create function app.guard_report_update() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    if new.citizen_id  is distinct from old.citizen_id
       or new.status      is distinct from old.status
       or new.priority    is distinct from old.priority
       or new.resolved_at is distinct from old.resolved_at
       or new.created_at  is distinct from old.created_at
       or new.id          is distinct from old.id then
      raise exception 'owner, status and priority can only be changed through the report functions'
        using errcode = 'CP403';
    end if;
  end if;
  return new;
end
$fn$;
create trigger reports_10_guard before update on public.reports
  for each row execute function app.guard_report_update();

-- Category must be active; photo paths must live in the owner's own folder:
--   <citizen_id>/<file name>   (no nesting, no "..").
create function app.validate_report_row() returns trigger
language plpgsql security definer set search_path = '' as $fn$
declare
  p text;
begin
  if tg_op = 'INSERT' or new.category_id is distinct from old.category_id then
    if not exists (select 1 from public.categories c where c.id = new.category_id and c.is_active) then
      raise exception 'category is not available' using errcode = 'CP422';
    end if;
  end if;
  if tg_op = 'INSERT' or new.photo_paths is distinct from old.photo_paths then
    foreach p in array new.photo_paths loop
      if p is null
         or p !~ '^[0-9a-fA-F-]{36}/[A-Za-z0-9._-]{1,120}$'
         or position('..' in p) > 0
         or lower(split_part(p, '/', 1)) <> lower(new.citizen_id::text) then
        raise exception 'invalid photo path' using errcode = 'CP422';
      end if;
    end loop;
  end if;
  return new;
end
$fn$;
create trigger reports_20_validate before insert or update on public.reports
  for each row execute function app.validate_report_row();

-- First history row, written in the same transaction as the report itself.
create function app.log_report_created() returns trigger
language plpgsql security definer set search_path = '' as $fn$
begin
  insert into public.report_status_history (report_id, old_status, new_status, changed_by, note)
  values (new.id, null, new.status, new.citizen_id, 'Report submitted');
  return null;
end
$fn$;
create trigger reports_40_log_created after insert on public.reports
  for each row execute function app.log_report_created();

-- ------------------------------------------- history: append-only guard
create function app.guard_history_immutable() returns trigger
language plpgsql set search_path = '' as $fn$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'status history is append-only' using errcode = 'CP403';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$fn$;
create trigger report_history_guard before update or delete on public.report_status_history
  for each row execute function app.guard_history_immutable();

-- ===== 20261024130300_rpc_functions.sql =====
-- CivicPlus+ Phase 2 / migration 4 of 6
-- Trusted write functions. Each one: checks the caller from the JWT (auth.uid()),
-- locks the row, validates the rule, and writes report + history in ONE
-- transaction (a function call is atomic: all or nothing).
--
-- Error codes (SQLSTATE) the Express API should map to HTTP:
--   CP401 -> 401   CP403 -> 403   CP404 -> 404   CP409 -> 409   CP422 -> 422
--
-- Allowed status transitions
--   submitted    -> under_review | rejected (staff/admin) | cancelled (owner citizen)
--   under_review -> rejected (staff/admin)
--   assigned     -> in_progress (assigned worker, staff, admin)
--   in_progress  -> resolved    (assigned worker, staff, admin)
--   resolved     -> under_review (staff/admin reopen, note required)
--   'assigned' is reached ONLY through assign_report().
--   rejected and cancelled are final.

create function public.change_report_status(
  p_report_id  uuid,
  p_new_status public.report_status,
  p_note       text default null
) returns public.reports
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role public.user_role := app.current_user_role();
  v_note text := nullif(btrim(p_note), '');
  v_old  public.report_status;
  r      public.reports;
begin
  if v_uid is null or v_role is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note is too long (max 500)' using errcode = 'CP422';
  end if;

  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'CP404';
  end if;

  -- Visibility first: callers who cannot see the report get 404, not 403.
  if v_role = 'citizen' and r.citizen_id <> v_uid then
    raise exception 'report not found' using errcode = 'CP404';
  end if;
  if v_role = 'worker' and not exists (
    select 1 from public.worker_assignments wa
    where wa.report_id = r.id and wa.worker_id = v_uid and wa.is_active
  ) then
    raise exception 'report not found' using errcode = 'CP404';
  end if;

  -- Who may request which target status.
  if p_new_status = 'cancelled' then
    if v_role <> 'citizen' then
      raise exception 'only the citizen who filed the report can cancel it' using errcode = 'CP403';
    end if;
  elsif p_new_status in ('under_review', 'rejected') then
    if v_role not in ('staff', 'admin') then
      raise exception 'only staff or admin can do this' using errcode = 'CP403';
    end if;
  elsif p_new_status in ('in_progress', 'resolved') then
    if v_role not in ('worker', 'staff', 'admin') then
      raise exception 'only the assigned worker, staff or admin can do this' using errcode = 'CP403';
    end if;
  else
    raise exception 'status % cannot be set directly', p_new_status using errcode = 'CP409';
  end if;

  -- Transition rules.
  if not (
       (r.status = 'submitted'    and p_new_status in ('under_review', 'rejected', 'cancelled'))
    or (r.status = 'under_review' and p_new_status = 'rejected')
    or (r.status = 'assigned'     and p_new_status = 'in_progress')
    or (r.status = 'in_progress'  and p_new_status = 'resolved')
    or (r.status = 'resolved'     and p_new_status = 'under_review')
  ) then
    raise exception 'invalid status change from % to %', r.status, p_new_status using errcode = 'CP409';
  end if;

  if v_note is null and (p_new_status = 'rejected' or r.status = 'resolved') then
    raise exception 'a note is required for this change' using errcode = 'CP422';
  end if;

  v_old := r.status;

  update public.reports
     set status      = p_new_status,
         resolved_at = case when p_new_status = 'resolved' then now() else null end
   where id = r.id
   returning * into r;

  -- Reopened: release the old worker so the report can be assigned again.
  if v_old = 'resolved' then
    update public.worker_assignments
       set is_active = false, unassigned_at = now()
     where report_id = r.id and is_active;
  end if;

  insert into public.report_status_history (report_id, old_status, new_status, changed_by, note)
  values (r.id, v_old, p_new_status, v_uid, v_note);

  return r;
end
$fn$;

create function public.assign_report(
  p_report_id uuid,
  p_worker_id uuid,
  p_note      text default null
) returns public.reports
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role public.user_role := app.current_user_role();
  v_note text := nullif(btrim(p_note), '');
  v_old  public.report_status;
  v_prev public.worker_assignments;
  r      public.reports;
begin
  if v_uid is null or v_role is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'only staff or admin can assign reports' using errcode = 'CP403';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'note is too long (max 500)' using errcode = 'CP422';
  end if;

  select * into r from public.reports where id = p_report_id for update;
  if not found then
    raise exception 'report not found' using errcode = 'CP404';
  end if;
  if r.status not in ('submitted', 'under_review', 'assigned', 'in_progress') then
    raise exception 'a % report cannot be assigned', r.status using errcode = 'CP409';
  end if;

  if not exists (
    select 1 from public.profiles p
    where p.id = p_worker_id and p.role = 'worker' and p.is_active
  ) then
    raise exception 'the selected user is not an active worker' using errcode = 'CP422';
  end if;

  select * into v_prev from public.worker_assignments
   where report_id = r.id and is_active for update;
  if found then
    if v_prev.worker_id = p_worker_id then
      raise exception 'this worker is already assigned to the report' using errcode = 'CP409';
    end if;
    update public.worker_assignments
       set is_active = false, unassigned_at = now()
     where id = v_prev.id;
  end if;

  insert into public.worker_assignments (report_id, worker_id, assigned_by, note)
  values (r.id, p_worker_id, v_uid, v_note);

  v_old := r.status;
  update public.reports set status = 'assigned', resolved_at = null
   where id = r.id returning * into r;

  insert into public.report_status_history (report_id, old_status, new_status, changed_by, note)
  values (r.id, v_old, 'assigned', v_uid,
          coalesce(v_note, case when v_prev.id is null then 'Assigned to worker' else 'Reassigned to another worker' end));

  return r;
end
$fn$;

create function public.set_report_priority(
  p_report_id uuid,
  p_priority  public.report_priority
) returns public.reports
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role public.user_role := app.current_user_role();
  r      public.reports;
begin
  if v_uid is null or v_role is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'only staff or admin can set priority' using errcode = 'CP403';
  end if;
  update public.reports set priority = p_priority where id = p_report_id returning * into r;
  if not found then
    raise exception 'report not found' using errcode = 'CP404';
  end if;
  return r;
end
$fn$;

create function public.admin_set_user_role(
  p_user_id uuid,
  p_role    public.user_role,
  p_reason  text
) returns public.profiles
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  p        public.profiles;
begin
  if v_uid is null or app.current_user_role() is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if app.current_user_role() <> 'admin' then
    raise exception 'only admin can change roles' using errcode = 'CP403';
  end if;
  if p_user_id = v_uid then
    raise exception 'you cannot change your own role' using errcode = 'CP409';
  end if;
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception 'a reason (max 300 characters) is required' using errcode = 'CP422';
  end if;

  perform set_config('app.change_reason', v_reason, true);   -- local to this transaction
  update public.profiles set role = p_role where id = p_user_id returning * into p;
  if not found then
    raise exception 'user not found' using errcode = 'CP404';
  end if;
  return p;
end
$fn$;

create function public.admin_set_user_active(
  p_user_id uuid,
  p_active  boolean,
  p_reason  text
) returns public.profiles
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_reason text := nullif(btrim(p_reason), '');
  p        public.profiles;
begin
  if v_uid is null or app.current_user_role() is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if app.current_user_role() <> 'admin' then
    raise exception 'only admin can activate or deactivate users' using errcode = 'CP403';
  end if;
  if p_user_id = v_uid then
    raise exception 'you cannot change your own active status' using errcode = 'CP409';
  end if;
  if v_reason is null or char_length(v_reason) > 300 then
    raise exception 'a reason (max 300 characters) is required' using errcode = 'CP422';
  end if;

  perform set_config('app.change_reason', v_reason, true);
  update public.profiles set is_active = p_active where id = p_user_id returning * into p;
  if not found then
    raise exception 'user not found' using errcode = 'CP404';
  end if;
  return p;
end
$fn$;

-- Only logged-in users may call them (each function re-checks the role itself).
revoke all on function
  public.change_report_status(uuid, public.report_status, text),
  public.assign_report(uuid, uuid, text),
  public.set_report_priority(uuid, public.report_priority),
  public.admin_set_user_role(uuid, public.user_role, text),
  public.admin_set_user_active(uuid, boolean, text)
from public, anon;
grant execute on function
  public.change_report_status(uuid, public.report_status, text),
  public.assign_report(uuid, uuid, text),
  public.set_report_priority(uuid, public.report_priority),
  public.admin_set_user_role(uuid, public.user_role, text),
  public.admin_set_user_active(uuid, boolean, text)
to authenticated;

-- ===== 20261024130400_rls_and_grants.sql =====
-- CivicPlus+ Phase 2 / migration 5 of 6
-- Row Level Security + table/column privileges (least privilege).
--
-- Layers of defence:
--   1. Privileges: anon gets nothing; authenticated gets only listed columns.
--   2. RLS policies: which ROWS each role may touch.
--   3. Guard triggers (migration 3): block protected-column changes even if a
--      grant is ever added by mistake.
-- Table owner (postgres) bypasses RLS; that is how the SECURITY DEFINER
-- functions work. Do NOT use FORCE ROW LEVEL SECURITY on these tables.

alter table public.profiles               enable row level security;
alter table public.profile_audit_log      enable row level security;
alter table public.categories             enable row level security;
alter table public.reports                enable row level security;
alter table public.report_status_history  enable row level security;
alter table public.worker_assignments     enable row level security;

-- ------------------------------------------------------------- privileges
revoke all on public.profiles, public.profile_audit_log, public.categories, public.reports,
  public.report_status_history, public.worker_assignments from anon, authenticated;

-- service_role (backend admin key) may read, but never rewrite the audit trails.
revoke update, delete, truncate on public.report_status_history, public.profile_audit_log from service_role;
revoke insert on public.report_status_history, public.profile_audit_log from service_role;

grant select on public.profiles, public.profile_audit_log, public.categories, public.reports,
  public.report_status_history, public.worker_assignments to authenticated;

grant update (full_name, phone, ward, avatar_url) on public.profiles to authenticated;

grant insert (slug, name, description, is_active, sort_order) on public.categories to authenticated;
grant update (slug, name, description, is_active, sort_order) on public.categories to authenticated;

grant insert (citizen_id, category_id, title, description, address_text, latitude, longitude, ward, photo_paths)
  on public.reports to authenticated;
grant update (category_id, title, description, address_text, latitude, longitude, ward, photo_paths)
  on public.reports to authenticated;

-- --------------------------------------------------------------- profiles
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select app.is_staff_or_admin()));

create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select app.current_user_role()) is not null)
  with check (id = (select auth.uid()));

-- ------------------------------------------------------------------ audit
create policy audit_select_admin on public.profile_audit_log for select to authenticated
  using ((select app.is_admin()));

-- ------------------------------------------------------------- categories
create policy categories_select on public.categories for select to authenticated
  using (true);   -- API shows only is_active ones in pickers; old reports still need their name

create policy categories_insert_admin on public.categories for insert to authenticated
  with check ((select app.is_admin()));

create policy categories_update_admin on public.categories for update to authenticated
  using ((select app.is_admin())) with check ((select app.is_admin()));

-- ---------------------------------------------------------------- reports
create policy reports_select_owner on public.reports for select to authenticated
  using (citizen_id = (select auth.uid()) and (select app.current_user_role()) = 'citizen');

create policy reports_select_worker on public.reports for select to authenticated
  using ((select app.is_assigned_worker(id)));

create policy reports_select_staff on public.reports for select to authenticated
  using ((select app.is_staff_or_admin()));

create policy reports_insert_citizen on public.reports for insert to authenticated
  with check (
    citizen_id = (select auth.uid())
    and (select app.current_user_role()) = 'citizen'
    and (select app.is_email_verified())
  );

-- Citizens may edit their own report only while it is still 'submitted'.
create policy reports_update_owner on public.reports for update to authenticated
  using (
    citizen_id = (select auth.uid())
    and status = 'submitted'
    and (select app.current_user_role()) = 'citizen'
  )
  with check (citizen_id = (select auth.uid()) and status = 'submitted');

-- ---------------------------------------------------------------- history
-- Visible exactly when the parent report is visible (reports RLS applies).
create policy history_select on public.report_status_history for select to authenticated
  using (exists (select 1 from public.reports r where r.id = report_status_history.report_id));

-- ------------------------------------------------------------ assignments
create policy assignments_select_worker on public.worker_assignments for select to authenticated
  using (worker_id = (select auth.uid()) and (select app.current_user_role()) = 'worker');

create policy assignments_select_staff on public.worker_assignments for select to authenticated
  using ((select app.is_staff_or_admin()));

-- No INSERT/UPDATE/DELETE policies exist for history, assignments or audit log:
-- they can only be written by the SECURITY DEFINER functions.
-- No DELETE policy or grant exists on any table: nothing is deletable via the API.

-- ===== 20261024130500_seed_categories.sql =====
-- CivicPlus+ Phase 2 / migration 6 of 6
-- Reference data ONLY: waste complaint categories. No users, no reports.
-- Idempotent: re-running does not duplicate or overwrite admin edits.

insert into public.categories (slug, name, description, sort_order) values
  ('overflowing-bins',   'Overflowing bins',         'Dustbins or containers that are full and spilling over', 10),
  ('missed-collection',  'Missed waste collection',  'Scheduled waste pickup did not happen',                  20),
  ('illegal-dumping',    'Illegal dumping',          'Waste dumped in an unauthorised place',                  30),
  ('other',              'Other waste issue',        'Any other waste-related problem',                        90)
on conflict (slug) do nothing;

-- ===== 20261024130600_internal_notes_and_reassignment_review.sql =====
-- CivicPlus+ Phase 2b / migration 7
-- (1) Staff-only internal notes on the report timeline.
-- (2) Reassignment review for reports whose assigned worker lost access.
--
-- Additive only: nothing is dropped, no data is rewritten, migrations 1-6 are
-- untouched. Existing history rows get is_internal = false (citizen-visible,
-- exactly as before).

-- ============================================================ internal notes
alter table public.report_status_history
  add column is_internal boolean not null default false;

-- An internal entry is a note only: it must carry text and must not change status.
alter table public.report_status_history
  add constraint history_internal_is_note check (
    not is_internal or (note is not null and old_status is not distinct from new_status)
  );

-- Replace the history read policy (migration 5): a row is readable when its
-- report is readable AND (it is not internal OR the caller is staff/admin).
-- Citizens and workers therefore can never read internal rows.
drop policy history_select on public.report_status_history;
create policy history_select on public.report_status_history for select to authenticated
  using (
    exists (select 1 from public.reports r where r.id = report_status_history.report_id)
    and (not is_internal or (select app.is_staff_or_admin()))
  );

-- The only way to create an internal note. Staff/admin only; one transaction.
create function public.add_internal_note(
  p_report_id uuid,
  p_note      text
) returns public.report_status_history
language plpgsql security definer set search_path = '' as $fn$
declare
  v_uid  uuid := (select auth.uid());
  v_role public.user_role := app.current_user_role();
  v_note text := nullif(btrim(p_note), '');
  r      public.reports;
  h      public.report_status_history;
begin
  if v_uid is null or v_role is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'only staff or admin can add internal notes' using errcode = 'CP403';
  end if;
  if v_note is null or char_length(v_note) > 500 then
    raise exception 'a note (max 500 characters) is required' using errcode = 'CP422';
  end if;

  select * into r from public.reports where id = p_report_id;
  if not found then
    raise exception 'report not found' using errcode = 'CP404';
  end if;

  insert into public.report_status_history (report_id, old_status, new_status, changed_by, note, is_internal)
  values (r.id, r.status, r.status, v_uid, v_note, true)
  returning * into h;
  return h;
end
$fn$;

revoke all on function public.add_internal_note(uuid, text) from public, anon;
grant execute on function public.add_internal_note(uuid, text) to authenticated;

-- ============================================== reassignment review (derived)
-- A report needs review when it is still open (assigned / in_progress) and its
-- active assignment points to someone who is no longer an ACTIVE WORKER
-- (deactivated, or role changed away from worker). Nothing is reassigned
-- automatically: staff/admin decide, using assign_report().
--
-- Derived instead of stored, so it can never go stale: it disappears by itself
-- when staff reassign, when the report is resolved/reopened, or if the worker
-- is reactivated.
--
-- security_invoker: the caller's own RLS applies to the underlying tables.
-- The WHERE clause additionally limits the view to staff/admin, so a citizen
-- or worker (who can see their own report rows) gets nothing from it.
create view public.reports_needing_reassignment
with (security_invoker = true) as
select
  r.id                as report_id,
  r.title,
  r.status,
  r.priority,
  r.ward,
  r.address_text,
  r.created_at        as report_created_at,
  wa.id               as assignment_id,
  wa.assigned_at,
  wa.worker_id,
  p.full_name         as worker_name,
  p.role              as worker_role,
  p.is_active         as worker_is_active,
  case when not p.is_active then 'worker_deactivated' else 'worker_role_changed' end as review_reason
from public.reports r
join public.worker_assignments wa on wa.report_id = r.id and wa.is_active
join public.profiles p on p.id = wa.worker_id
where r.status in ('assigned', 'in_progress')
  and (not p.is_active or p.role <> 'worker')
  and (select app.is_staff_or_admin());

revoke all on public.reports_needing_reassignment from public, anon, authenticated, service_role;
grant select on public.reports_needing_reassignment to authenticated;

-- ===== 20261024130700_storage_report_photos.sql =====
-- CivicPlus+ Phase 6 / migration 8
-- Private storage bucket for report photos. Creates one bucket row only.
--
-- Security model
-- * public = false: no public URLs. Files are readable only through short-lived
--   signed URLs that the API issues AFTER checking (via RLS) that the caller can see the report.
-- * Uploads go through signed upload URLs created by the API with the service-role key, for a
--   server-chosen path `<citizen_id>/<uuid>.<ext>`. Clients get no direct storage policy at all.
-- * No policies are created on storage.objects: with RLS on (Supabase default), anon and
--   authenticated can neither read nor write objects directly.
-- * Size and type limits are enforced by Storage itself (5 MB; jpeg, png, webp).
--
-- Never overwrites: if a bucket with this id already exists it is left untouched
-- (check its settings in the dashboard: docs/DB_VERIFICATION.md).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ===== 20261024130800_dashboard_summary.sql =====
-- CivicPlus+ Phase 7 / migration 9
-- Dashboard statistics in ONE read-only function call (consistent snapshot, no N+1 queries from the API).
-- Staff/admin only. SECURITY DEFINER so the aggregates see all rows, which is why the role check
-- is the first thing it does. Returns aggregates only: no citizen names, e-mails or addresses.
-- Adds one function. Changes no table, policy or data.
create function public.dashboard_summary(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = '' as $fn$
declare
  v_role      public.user_role := app.current_user_role();
  v_today     date := (now() at time zone 'UTC')::date;
  v_from_date date;
  v_from      timestamptz;
  v_open      public.report_status[] := array['submitted', 'under_review', 'assigned', 'in_progress']::public.report_status[];
  result      jsonb;
begin
  if (select auth.uid()) is null or v_role is null then
    raise exception 'authentication required' using errcode = 'CP401';
  end if;
  if v_role not in ('staff', 'admin') then
    raise exception 'only staff or admin can view the dashboard' using errcode = 'CP403';
  end if;
  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'days must be between 1 and 365' using errcode = 'CP422';
  end if;

  v_from_date := v_today - (p_days - 1);
  v_from := v_from_date::timestamp at time zone 'UTC';

  select jsonb_build_object(
    'generatedAt', now(),
    'periodDays', p_days,
    'periodStart', v_from_date,
    'totals', (
      select jsonb_build_object(
        'all', count(*),
        'open', count(*) filter (where status = any (v_open)),
        'awaitingAssignment', count(*) filter (where status in ('submitted', 'under_review')),
        'resolved', count(*) filter (where status = 'resolved'),
        'rejected', count(*) filter (where status = 'rejected'),
        'cancelled', count(*) filter (where status = 'cancelled'))
      from public.reports),
    'byStatus', (
      select jsonb_object_agg(s.status::text, coalesce(x.n, 0))
      from unnest(enum_range(null::public.report_status)) as s(status)
      left join (select status, count(*) as n from public.reports group by status) x on x.status = s.status),
    'openByPriority', (
      select jsonb_object_agg(s.priority::text, coalesce(x.n, 0))
      from unnest(enum_range(null::public.report_priority)) as s(priority)
      left join (select priority, count(*) as n from public.reports where status = any (v_open) group by priority) x
        on x.priority = s.priority),
    'byCategory', (
      select coalesce(jsonb_agg(jsonb_build_object('categoryId', t.id, 'name', t.name, 'total', t.total, 'open', t.open)
                                order by t.total desc, t.name), '[]'::jsonb)
      from (select c.id, c.name, count(r.id) as total, count(r.id) filter (where r.status = any (v_open)) as open
              from public.categories c left join public.reports r on r.category_id = c.id
             group by c.id, c.name) t),
    'topWards', (
      select coalesce(jsonb_agg(jsonb_build_object('ward', t.ward, 'total', t.total, 'open', t.open)
                                order by t.total desc, t.ward), '[]'::jsonb)
      from (select ward, count(*) as total, count(*) filter (where status = any (v_open)) as open
              from public.reports where ward is not null
             group by ward order by count(*) desc, ward limit 10) t),
    'createdInPeriod', (select count(*) from public.reports where created_at >= v_from),
    'resolvedInPeriod', (select count(*) from public.reports where status = 'resolved' and resolved_at >= v_from),
    'avgResolutionHours', (
      select round((avg(extract(epoch from (resolved_at - created_at))) / 3600)::numeric, 1)
        from public.reports where status = 'resolved' and resolved_at >= v_from),
    'createdPerDay', (
      select jsonb_agg(jsonb_build_object('date', d.day, 'count', coalesce(x.n, 0)) order by d.day)
      from generate_series(v_from_date, v_today, interval '1 day') as g(ts)
      cross join lateral (select g.ts::date as day) d
      left join (select (created_at at time zone 'UTC')::date as day, count(*) as n
                   from public.reports where created_at >= v_from group by 1) x on x.day = d.day),
    'needsReassignment', (
      select count(distinct r.id)
        from public.reports r
        join public.worker_assignments wa on wa.report_id = r.id and wa.is_active
        join public.profiles p on p.id = wa.worker_id
       where r.status in ('assigned', 'in_progress') and (not p.is_active or p.role <> 'worker')),
    'workerWorkload', (
      select coalesce(jsonb_agg(jsonb_build_object('workerId', t.id, 'fullName', t.full_name, 'openAssigned', t.n)
                                order by t.n desc, t.full_name nulls last, t.id), '[]'::jsonb)
      from (select p.id, p.full_name, count(r.id) as n
              from public.profiles p
              left join public.worker_assignments wa on wa.worker_id = p.id and wa.is_active
              left join public.reports r on r.id = wa.report_id and r.status in ('assigned', 'in_progress')
             where p.role = 'worker' and p.is_active
             group by p.id, p.full_name) t)
  ) into result;

  return result;
end
$fn$;

revoke all on function public.dashboard_summary(integer) from public, anon;
grant execute on function public.dashboard_summary(integer) to authenticated;
