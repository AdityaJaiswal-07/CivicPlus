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
