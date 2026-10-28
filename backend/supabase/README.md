# Applying the CivicPlus+ migrations to a NEW Supabase project

These migrations only **create** things (enums, tables, functions, policies, 4 category rows, one storage bucket). None of them drops, truncates or resets anything. They are meant for a **fresh, empty project**. If a project already has tables named `profiles`, `reports`, etc., a migration will fail with "already exists" and change nothing further in that file: stop and ask before continuing.

Files (run in this order, they are timestamp-named so the CLI does it for you):

| # | File | What it does |
|---|---|---|
| 1 | `20261024130000_enums_and_schema.sql` | enums + private `app` schema |
| 2 | `20261024130100_core_tables.sql` | 6 tables, constraints, indexes |
| 3 | `20261024130200_functions_and_triggers.sql` | helpers, signup trigger, guards, audit |
| 4 | `20261024130300_rpc_functions.sql` | status/assign/role functions |
| 5 | `20261024130400_rls_and_grants.sql` | RLS policies + privileges |
| 6 | `20261024130500_seed_categories.sql` | 4 reference categories |
| 7 | `20261024130600_internal_notes_and_reassignment_review.sql` | staff-only internal notes (`is_internal`, `add_internal_note`), `reports_needing_reassignment` view. Additive: adds one column, one constraint, replaces one read policy. |
| 8 | `20261024130700_storage_report_photos.sql` | private `report-photos` bucket (5 MB, jpeg/png/webp), no storage policies. Leaves an existing bucket untouched. |
| 9 | `20261024130800_dashboard_summary.sql` | `dashboard_summary(days)` function, staff/admin only |

## Option A: Supabase CLI (recommended)

1. Create a new project at supabase.com. Keep the database password in your own password manager.
2. Install the CLI (`npm i -g supabase` or see Supabase docs), then from this folder:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push --dry-run     # shows what WOULD run; changes nothing
   supabase db push               # applies pending migrations
   ```
   The CLI asks for the DB password in your terminal. Never paste it or any key into chat.

## Option B: SQL Editor (no CLI)

Open each file in order, paste into Supabase Dashboard > SQL Editor, and Run. Check for errors after each file before running the next.

## After applying

1. **Dashboard > Authentication > Providers > Email:** turn on **Confirm email**. (RLS also requires a verified email before a citizen can file a report.)
2. **Dashboard > Authentication > URL Configuration:** set Site URL and add your local frontend URL (for example `http://localhost:5173`) to Redirect URLs. Add the deployed URL later.
3. **Create your first admin (one time).** Sign up normally in the app (you become `citizen`), then in the SQL Editor:
   ```sql
   update public.profiles set role = 'admin' where id = '<your-auth-user-id>';
   ```
   This works because the SQL Editor runs as the database owner. It is written to `profile_audit_log` with `changed_by = null`. After that, promote others through the API (admin only, with a reason).
4. Run the checks in `docs/DB_VERIFICATION.md` section "Needs a real Supabase project".
5. Do NOT put the `service_role` key anywhere except the backend server's `.env`.

## Rolling back

Migrations are not auto-reversible. On a fresh project with no data, the simplest rollback is to delete the project and recreate it. If a project has real data, ask first: dropping these tables destroys complaints and history.
