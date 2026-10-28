# Database verification

## 1. Automated, already runnable locally (no Supabase needed)

```bash
npm test                  # everything
npx vitest run tests/db   # database tests only
```
The tests load `tests/db/supabase-stub.sql` (fake `auth.users`, `auth.uid()`, and the `anon` / `authenticated` / `service_role` roles with Supabase-like default grants) into an in-process PostgreSQL (PGlite), apply every file in `supabase/migrations/` in order, and then act as each role using `SET ROLE` + a fake JWT subject.

Covered:
- Signup always citizen (even with role in metadata); junk metadata does not break signup; seed has no users/reports.
- Citizen cannot change role/active/id; cannot edit others; service_role also blocked by trigger.
- Admin-only role/active changes with reason; audit rows with who/old/new/reason; SQL-editor bootstrap audited; no self-change.
- Reports: own-name only; no status/priority/resolved_at at insert; unverified, inactive, worker, staff, admin, anon cannot file; coordinates, photo count/paths, category validation.
- Visibility: owner, assigned worker, staff/admin; strangers, anon, unassigned workers see nothing; history follows report visibility.
- Protected columns, no deletes, history append-only (also if a grant and policy are added by mistake).
- Cancel / review / reject / reopen / priority rules; invalid and skipped transitions; failed transition writes nothing.
- Assignment: only staff/admin; only active workers; one active assignment (also at DB level); reassignment moves access; reopening releases the worker.
- Categories: read for all roles; admin-only write; no delete; duplicates/bad slugs rejected.
- Phase 2b (`tests/db/internal-notes-and-reassignment.test.ts`): internal notes hidden from owner citizen and assigned worker, visible to staff/admin, role/validation/anon denial, no direct writes, table CHECK; reassignment view for deactivation, demotion, in_progress, reassign, reactivation, resolved, and invisibility to citizens/workers/anon.
- RLS enabled on all 6 tables; `anon` has zero table privileges; nobody can write history/audit.

## 2. Needs a real Supabase project (NOT executed yet)

Run after applying migrations to a NEW project (see `supabase/README.md`):

- [ ] All 9 migrations apply with no errors (dashboard shows the 6 tables, with RLS "enabled").
- [ ] **Signup trigger on the real `auth.users`:** sign up with email/password -> a `profiles` row appears with `role = 'citizen'`. Sign up passing `{"role":"admin"}` in options.data -> still `citizen`.
- [ ] **Email confirmation:** with "Confirm email" ON, an unconfirmed user cannot log in; after confirming, they can file a report. (RLS also checks `email_confirmed_at`.)
- [ ] **Function ownership:** in SQL Editor run `select proname, proowner::regrole from pg_proc where pronamespace in ('app'::regnamespace, 'public'::regnamespace) and prosecdef;` -> owner should be `postgres`. Guard triggers rely on that.
- [ ] **Default privileges:** `select grantee, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='report_status_history';` -> `anon` none; `authenticated` only SELECT; `service_role` only SELECT.
- [ ] **PostgREST/API behaviour:** with a citizen JWT, `GET /rest/v1/reports` returns only their rows; `PATCH` of `status` or `role` fails; `POST /rest/v1/rpc/assign_report` returns an error with code `CP403`.
- [ ] `app` schema is NOT in Settings > API > Exposed schemas (keep only `public`).
- [ ] **Role walk-through** with four real test accounts (create them yourself, never share passwords): citizen files a report; staff assigns a worker; worker moves it to in_progress and resolved; citizen sees full history; a second citizen sees nothing.
- [ ] First-admin bootstrap SQL works and shows in `profile_audit_log`.
- [ ] **Internal notes:** as staff call `rpc/add_internal_note`; then with the owner citizen's JWT `GET /rest/v1/report_status_history?report_id=eq.<id>` must NOT contain it; with the staff JWT it must.
- [ ] **Reassignment view:** deactivate a test worker who has an assigned report; `GET /rest/v1/reports_needing_reassignment` returns the report for staff, and an empty list for a citizen. Check the view is not accessible with the anon key.
- [ ] **Storage:** bucket `report-photos` exists, Public = OFF, size limit 5 MB, allowed types jpeg/png/webp; `select count(*) from pg_policies where schemaname='storage'` shows no policy of ours; with a citizen JWT, `GET /storage/v1/object/report-photos/<path>` and a direct upload both fail; the API's signed upload URL + `uploadToSignedUrl` works; the signed read URL works and expires.
- [ ] **Dashboard:** `rpc/dashboard_summary` works with a staff JWT, fails with a citizen JWT (`CP403`) and with the anon key.
- [ ] Supabase **security advisor** (Dashboard > Advisors) shows no RLS-disabled tables.

## 3. Differences between the local test and real Supabase
PGlite is real PostgreSQL but not Supabase: the `auth` schema, JWT handling, PostgREST, roles' extra privileges, and Storage are stand-ins or absent. That is why section 2 exists.
