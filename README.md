# CivicPlus+ (CleanCity) — complete project

Citizens report waste problems with photos, workers handle assigned tasks, and municipal staff/admins review, prioritise and assign reports.

```
CivicPlus/
├── frontend/   React 19 + Vite SPA (citizen / worker / staff+admin portals)
├── backend/    Node 22 + Express 5 + TypeScript API, SQL migrations, tests
├── database/   all_migrations.sql (the 9 migrations in one file, for the SQL Editor)
├── docs/       integration notes, test status, known gaps
└── README.md
```

Architecture: the browser signs in with **Supabase Auth** (public URL + anon key only). It sends the access token to the **Express API**, which verifies it, loads the role from the database, and calls Supabase **with the user's own token** so Row Level Security and SQL functions enforce permissions. The service-role key lives **only** in `backend/.env`, never in the frontend.

## 1. Requirements
- Node.js 20+ (22 recommended) and npm
- A Supabase project (free tier is fine). **You must create one yourself**; no credentials are included.

## 2. Create and prepare Supabase
1. Create a new, empty project at supabase.com.
2. Apply the migrations (new empty project only): either paste `database/all_migrations.sql` into **SQL Editor → Run**, or use the CLI as described in `backend/supabase/README.md`. Migrations only create objects; none drops or resets data.
3. **Authentication → Providers → Email:** for quick local testing you may turn **Confirm email** off; keep it on for real use (the database requires a verified email before a citizen can file a report).
4. **Authentication → URL Configuration:** Site URL `http://localhost:5173`; add redirect URLs `http://localhost:5173/citizen/login` and `http://localhost:5173/reset-password`.
5. Copy from **Project Settings → API:** the project URL, the `anon` key and the `service_role` key.

## 3. Configure environment
```bash
cp backend/.env.example backend/.env       # URL, anon key, SERVICE ROLE key (server only)
cp frontend/.env.example frontend/.env.local   # API URL, Supabase URL, anon key (public values only)
```
| File | Variable | Value |
|---|---|---|
| backend/.env | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | from Supabase |
| backend/.env | `SUPABASE_SERVICE_ROLE_KEY` | **secret**, server only |
| backend/.env | `ALLOWED_ORIGINS` | must include the frontend origin (default includes `http://localhost:5173`) |
| frontend/.env.local | `VITE_API_BASE_URL` | `http://localhost:4000/api/v1` |
| frontend/.env.local | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | same URL and anon key |

## 4. Install and run
```bash
npm run install:all         # or: (cd backend && npm install) && (cd frontend && npm install)
npm run dev:backend         # http://localhost:4000/api/v1/health
npm run dev:frontend        # http://localhost:5173   (second terminal)
```
No lockfiles are included (they could not be generated offline); `npm install` creates them.

## 5. Accounts and roles
- `/citizen/register` always creates a **citizen**. Roles are never taken from the client.
- **First admin (once):** register normally, confirm your email if required, then in the SQL Editor:
  `update public.profiles set role = 'admin' where id = '<your auth user id>';` (find the id under Authentication → Users).
- Log in at `/staff/login` as admin → **Users** tab to promote other registered accounts to `worker` or `staff` (a reason is required and audited). Workers log in at `/worker/login`.
- Suggested manual test: citizen files a report with a photo → admin/staff opens it, sets priority, assigns the worker → worker starts and resolves it → citizen sees the timeline; staff adds an internal note (citizen must not see it).

## 6. Tests and builds
```bash
npm run typecheck && npm test && npm run build && npm run lint
```
The backend's database tests use an in-process PostgreSQL (PGlite); nothing touches a live Supabase project.

## 7. What was verified (read `docs/INTEGRATION_STATUS.md`)
Verified only with sandbox substitutes (the npm registry was unreachable): esbuild bundling, unit tests under a bun/vitest shim, shimmed backend tests, a real PostgreSQL 16 check of the SQL, and a Chromium smoke test of the frontend against a mocked API. **The real `npm install`, `vitest`, `tsc`, `vite build` and `eslint`, and everything against a real Supabase project, have NOT been run.** Run section 6 first and report any failures.

## 8. Deployment
Not done. See `backend/docs/DEPLOYMENT.md` and `backend/docs/SECURITY.md`. Never commit `.env` files.

Further docs: `backend/docs/API.md` (endpoint contract), `backend/docs/DATABASE.md` (schema, roles, RLS), `backend/PROJECT_STATUS.md` (history and gap register G1–G15 plus F1–F10).
