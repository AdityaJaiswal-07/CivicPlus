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
