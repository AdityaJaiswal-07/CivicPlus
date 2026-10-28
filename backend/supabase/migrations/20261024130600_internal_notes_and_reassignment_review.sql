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
