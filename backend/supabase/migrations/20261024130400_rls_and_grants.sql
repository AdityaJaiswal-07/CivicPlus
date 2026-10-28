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
