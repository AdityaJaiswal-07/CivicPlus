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
