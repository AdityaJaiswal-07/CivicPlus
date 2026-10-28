# CivicPlus+ (CleanCity) Backend: Project Status

Last updated: 2026-10-24 (Phases 1-2 approved; 2b and 3-8 IMPLEMENTED but verified only with stubs/shims; next step is the stabilization pass, section 12)

## 1. Overview
Civic waste management platform. Citizens report waste problems, track status; workers handle assigned reports; staff/admin manage. Adii owns the backend; a teammate builds the frontend separately (Codex, UI designed in Figma). The backend must not depend on any frontend framework.

Stack: Node.js 22, Express 5, TypeScript (ESM, NodeNext), Zod 4, Vitest 5 + Supertest, Supabase (Postgres, Auth, Storage), helmet, cors, express-rate-limit, dotenv. Dev tools: tsx, PGlite (local Postgres for DB tests).

Working agreements: build in small verified phases and wait for approval between phases; never touch a live Supabase project or ask for secrets in chat; explain to Adii in simple Hinglish; do not claim anything done until verified.

## 2. Approved decisions
- Roles: `citizen`, `worker`, `staff`, `admin`. Signup is always citizen. Only admin changes roles (audited).
- Only staff/admin assign/reassign; workers only see and update reports assigned to them.
- Categories in DB (admin-managed): overflowing bins, missed waste collection, illegal dumping, other.
- Location: address text required; latitude/longitude optional (as a pair); ward optional.
- Photos: max 3 per report, max 5 MB each, private Supabase Storage, no public URLs.
- Supabase email verification supported. Supabase project may not exist yet.
- CORS from env, local first. Deployment-platform independent; Render/Railway instructions after local testing.

## 3. Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: config, env validation, error/response helpers, health, CORS, rate limit, tests | **Done, verified** |
| 2 | SQL migrations, RLS, functions, seed categories, DB tests, docs | **Done, verified locally** (not applied to any real Supabase project) |
| 2b | Migration 7: internal notes + reassignment review | **Implemented, awaiting review** (see section 7 for what was and was not run) |
| 3 | Auth middleware, `requireRole`, profiles, categories, admin user endpoints, DB error mapping | **Implemented** (see section 11 for verification) |
| 4 | Reports API (create/list/detail/edit/cancel/history) | **Implemented** (section 11) |
| 5 | Assignment + status update endpoints | **Implemented** (section 11) |
| 6 | Storage bucket/policies + photo upload | **Implemented** (section 11) |
| 7 | Dashboard statistics | **Implemented** (section 11) |
| 8 | Final docs, hardening, deployment notes | **Implemented** (section 11) |

## 4. Folder structure (exact)
```
civicplus-backend/
├─ .env.example                 placeholders only
├─ .gitignore                   excludes .env*, node_modules, dist, *.zip
├─ PROJECT_STATUS.md            this file
├─ README.md
├─ package.json, package-lock.json
├─ tsconfig.json, tsconfig.build.json, vitest.config.ts
├─ docs/
│  ├─ API.md                    API contract (only /health so far)
│  ├─ DATABASE.md               schema, workflow, permission matrix, security design
│  └─ DB_VERIFICATION.md        local coverage + real-Supabase checklist
├─ supabase/
│  ├─ README.md                 how to apply migrations to a NEW project
│  └─ migrations/ (9 files, see section 6)
├─ src/
│  ├─ app.ts                    createApp(env): helmet, CORS, rate limit, JSON, routes, errors
│  ├─ server.ts                 loads env, starts server, graceful shutdown
│  ├─ config/env.ts             Zod env validation (no secret values in errors)
│  ├─ middleware/requestId.ts, errorHandler.ts
│  ├─ routes/health.ts          GET /health and /api/v1/health
│  └─ utils/AppError.ts, response.ts
└─ tests/
   ├─ helpers.ts, health.test.ts, errors.test.ts, cors.test.ts, env.test.ts
   └─ db/ supabase-stub.sql, harness.ts,
          profiles-and-roles.test.ts, reports-and-assignments.test.ts,
          internal-notes-and-reassignment.test.ts   (Phase 2b)
```
Not in the tree by design: `node_modules/`, `dist/`, `.env`.

## 5. Database summary
Full detail: `docs/DATABASE.md`.

Tables: `profiles`, `profile_audit_log`, `categories`, `reports`, `report_status_history`, `worker_assignments`.

Report statuses: `submitted`, `under_review`, `assigned`, `in_progress`, `resolved`, `rejected`, `cancelled`. Priorities: low, normal, high, urgent.

Transitions: submitted -> under_review | rejected | cancelled(owner); under_review -> rejected; assigned -> in_progress; in_progress -> resolved; resolved -> under_review (reopen, note required). `assigned` only via `assign_report`. Rejection and reopen need a note. rejected/cancelled are final.

Database functions the API will call with the user's token (`supabase.rpc`): `change_report_status`, `assign_report`, `set_report_priority`, `admin_set_user_role`, `admin_set_user_active`, `add_internal_note`. View: `reports_needing_reassignment` (staff/admin).

Error codes from functions: `CP401`->401, `CP403`->403, `CP404`->404, `CP409`->409, `CP422`->422; Postgres `42501`->403, `23505`->409, `23514`/`23503`->422.

Security rules in force:
- Signup trigger always sets role `citizen`; user metadata never sets role.
- `role`, `is_active`, `citizen_id`, `status`, `priority`, `resolved_at` cannot be updated directly (no grant + guard trigger using `current_user`).
- History and audit log are append-only; no write path for authenticated/anon/service_role.
- One active assignment per report (partial unique index).
- RLS on all 6 tables; `anon` has no table privileges; nothing is deletable via the API.
- Policies use SECURITY DEFINER helpers in the private `app` schema (no RLS recursion). No FORCE RLS.
- Inactive users have no role, so everything is denied. Filing a report needs an active citizen with a verified email.
- Admin cannot change own role or active flag.

## 6. Migrations (apply in this order)
1. `20261024130000_enums_and_schema.sql`
2. `20261024130100_core_tables.sql`
3. `20261024130200_functions_and_triggers.sql`
4. `20261024130300_rpc_functions.sql`
5. `20261024130400_rls_and_grants.sql`
6. `20261024130500_seed_categories.sql`
7. `20261024130600_internal_notes_and_reassignment_review.sql` (Phase 2b: adds `report_status_history.is_internal`, replaces policy `history_select`, adds `add_internal_note()` and view `reports_needing_reassignment`; additive, drops nothing except that one policy, which it recreates)
8. `20261024130700_storage_report_photos.sql` (Phase 6: private bucket `report-photos`, 5 MB, jpeg/png/webp, no storage policies; `on conflict do nothing`)
9. `20261024130800_dashboard_summary.sql` (Phase 7: `public.dashboard_summary(days)`, staff/admin only)

Migrations 1-6 are unchanged. They only create objects (nothing dropped or reset), for a fresh project. NOT applied to any Supabase project yet. Steps: `supabase/README.md`. Do not edit these files after they are applied anywhere: add new migrations instead.

## 7. Verification results (re-run for this checkpoint, 2026-10-24)
| Check | Result |
|---|---|
| `npm run typecheck` | Pass, 0 errors |
| `npm test` | Pass: 6 files, 86 tests (22 API tests, 64 database/RLS tests) |
| `npm run build` | Pass |
| Built server smoke test (Phase 1) | `/health`, 404 envelope, CORS rejection, invalid-env exit all behaved as expected |
| Secret scan of project files | No keys/tokens found; no `.env` present |

How DB tests work: PGlite (in-process PostgreSQL 18) + `tests/db/supabase-stub.sql` (fake `auth.users`, `auth.uid()`, roles `anon`/`authenticated`/`service_role`, Supabase-like default grants), then all migrations are applied and each role is impersonated with `SET ROLE`.

### Phase 2b verification (this session, sandbox had no npm registry access)
| Check | Result |
|---|---|
| Adii's local Windows run before migration 7 | Reported by Adii: install OK, typecheck OK, 86/86 tests, build OK |
| Migrations 1-7 applied in order on real PostgreSQL 16 (with the test stub) | Pass, no errors |
| SQL mirror of the new test scenarios on PostgreSQL 16 (internal-note visibility per role, validation, denials, table CHECK, review view for deactivate/demote/in_progress/reassign/reactivate/resolved) | Pass, all assertions |
| `tests/db/internal-notes-and-reassignment.test.ts` (vitest + PGlite) | **Written, NOT run here** |
| Existing 86 tests against migration 7 | **NOT run here** |
| `npm run typecheck` / `npm test` / `npm run build` | **NOT run here** (dependencies could not be installed). Adii must run them locally. |

## 8. Known limitations and open items
Not verified (needs a real Supabase project; checklist in `docs/DB_VERIFICATION.md` section 2):
- Real `auth.users` signup trigger and email confirmation behavior
- Function ownership and default privileges on real Supabase
- PostgREST/API behavior and the security advisor
- End-to-end walk-through with real accounts
- Storage (not implemented yet)

Not built yet: all API endpoints except `/health`; Supabase client code (`@supabase/supabase-js` not installed yet); uploads; dashboard.

Open decisions for Adii:
1. ~~Internal notes~~ DECIDED: never visible to citizens. Implemented in migration 7 (staff/admin only; workers also cannot see them).
2. ~~Worker deactivation~~ DECIDED: no auto-reassign; reports are flagged for staff/admin review. Implemented in migration 7 as a derived view.
3. DECIDED: frontend uses Supabase Auth; Express independently verifies bearer tokens and enforces authorization (Phase 3).

Housekeeping: the folder is not a Git repository yet. `docs/API.md` documents only `/health`.

## 9. Next steps (stabilization pass, section 12)
Phases 3-8 are implemented. Nothing below has been run against real tooling or a real Supabase project: see section 11 for exactly what was and was not verified.

## 10. Continuing in another session or account
1. Start the new session with the project files (ZIP contents) and tell Claude: "Read PROJECT_STATUS.md, README.md and docs/DATABASE.md, then run the stabilization pass in section 12."
2. Run `npm install` (node_modules are not exported; this also updates `package-lock.json`). Recreate `.env` from `.env.example` locally; never share real values.
3. Keep the working agreements in section 1.

## 11. Implementation log and verification register (Adii: build all phases first, stabilize after)

### Verification environment limits (apply to every phase below)
The build sandbox has no access to the npm registry, so `npm install`, real `vitest`, real `express`/`supertest` and `@supabase/supabase-js` are unavailable there. What was run instead:
- **tsc 6.0.3** with loose stubs for the missing packages + real zod v4 types: catches syntax and own-code type errors, NOT library-type mismatches.
- **Shim runner** (`bun test` + a self-written mini Express/supertest): executes the real route/middleware code and the real test files. Indicative only; it is not real Express. Mutation-checked once (disabling `requireRole` makes 7 tests fail).
- **PostgreSQL 16** for SQL migrations.
**Adii must run `npm install` (it will update `package-lock.json`: `@supabase/supabase-js` was added to package.json), `npm run typecheck`, `npm test`, `npm run build` locally.**

### Phase 3 (done)
Files: `src/config/supabase.ts` (gateway: verifyToken / userClient / lazy adminClient), `src/middleware/{auth,requireRole,validate}.ts`, `src/utils/{dbError,pagination}.ts`, `src/types/domain.ts`, `src/routes/{auth,profiles,categories,adminUsers,v1}.ts`; `createApp(env, { supabase })` accepts an injected gateway (tests). `AppError` got `SERVICE_UNAVAILABLE`; error handler now logs 5xx AppErrors. Tests: `tests/{auth,profiles,categories,adminUsers,dbError}.test.ts` + `tests/fakes/supabase.ts` (no credentials needed).
Design notes: the user's own client (their JWT) is used for all data access so RLS applies; the service-role client is used only to read e-mails for the admin user list (and, later, to sign storage URLs). Role is read from `profiles` only.
Results: stubbed tsc: 0 errors in src; shim run: 67 API tests + 20 dbError/pagination tests pass; real vitest/typecheck/build: NOT run.

### Phase 4 (done)
Files: `src/types/reports.ts`, `src/routes/reports.ts` (create, list+filters/sort/pagination, detail, owner edit, cancel, history), tests `tests/reports.test.ts` (48). Security notes: owner id is always the caller (body is `.strict()`); photo paths must be in the caller's folder; unverified e-mail blocked; internal notes hidden by RLS and citizen-facing actor identities hidden; invisible reports are 404.
Results: stubbed tsc clean for src; shim run 48/48 (+67+20 earlier). Real vitest/typecheck/build: NOT run.

### Phase 5 (done)
Files: `src/routes/reportActions.ts` (status, assign/reassign, priority, internal notes, needs-reassignment; mounted before the generic reports router so `/needs-reassignment` is not captured by `/:id`), detail now includes `assignment` / `needsReassignment` by role. Tests: `tests/reportActions.test.ts` (31). Every action calls the DB function with the CALLER's token; route `requireRole` is only a first gate.
Results: stubbed tsc clean for src; shim run: all 7 API test files, 166 tests pass. Real vitest/typecheck/build: NOT run.

### Phase 6 (done)
Migration 8 (private bucket). `src/services/photos.ts` + `POST /reports/photos/upload-url` (server-chosen path `<userId>/<uuid>.<ext>`, signed upload URL via service role, 30/h per user), photo existence check on create/edit, signed read URLs on detail (signed only AFTER the RLS read proved visibility), cleanup of dropped photos. New env `STORAGE_BUCKET`. Tests: `tests/photos.test.ts` (17), `tests/db/storage.test.ts` (3, NOT run: PGlite). Migration 8 + stub applied and checked on real PostgreSQL 16 (private, limits, no policies, anon/authenticated see/insert nothing, re-run keeps settings).

### Phase 7 (done)
Migration 9 `public.dashboard_summary(p_days)` + `GET /dashboard/summary`. Tests: `tests/dashboard.test.ts` (API, shim-run), `tests/db/dashboard.test.ts` (NOT run: PGlite). The function was run on real PostgreSQL 16 with a seeded scenario (totals, status/priority maps, daily series, role/anon/days checks passed).

### Phase 8 (done)
Hardening: write-request rate limit (`WRITE_RATE_LIMIT_MAX`), `Cache-Control: no-store` on `/api`, JSON request logger (no query/headers/bodies), production CORS origins must be https (localhost allowed), unhandled-rejection/exception handlers. Added `Dockerfile`, `.dockerignore`, `.github/workflows/ci.yml` (typecheck, test, build), `docs/DEPLOYMENT.md`, `docs/SECURITY.md`; README/DATABASE/DB_VERIFICATION/supabase README updated. Tests: `tests/hardening.test.ts`, extra env tests.
Results: stubbed tsc clean for src; shim: hardening/env pass except the write-limit test, which needs the real `express-rate-limit` (shim is a no-op).

### Final checks run at the end of this session (2026-10-24)
| Check | Result |
|---|---|
| All 9 migrations applied in order on a brand-new PostgreSQL 16 cluster (with the test stub) | Pass |
| SHA-256 of migrations 1-6 vs the original handoff zip | Identical |
| Shim runner (NOT real Vitest/Express): 11 API/unit test files | 209 pass, 1 fail (write-rate-limit test; shim limiter is a no-op, see G11) |
| tsc 6.0.3 with stubs for missing packages (NOT the project's real `npm run typecheck`) | 0 errors in src and tests (ignoring stub-only noise) |
| Secret scan, `.env` presence | No secrets found, no `.env` |
| Real `npm install`, `npm run typecheck`, `npm test`, `npm run build`, PGlite DB suites, Docker build, anything against Supabase | **NOT run** |

### Integration stage 1 backend changes (approved by Adii)
Multi-status `status=a,b`; `q` now searches title OR address (user text sanitised before it enters the PostgREST `or()` filter); staff/admin lists include `citizen` and `assignedWorker`; new `GET /reports/counts`. **Latent bug fixed:** `profiles` embeds are now disambiguated with FK hints (`reports_citizen_id_fkey`, `worker_assignments_worker_id_fkey`, `report_status_history_changed_by_fkey`; names confirmed on PostgreSQL 16) because `profiles` is reachable from `reports` several ways and real PostgREST would likely have rejected the unhinted embed. Not yet confirmed against real PostgREST (G15). Shim run: 217 API tests pass.

### Unresolved bugs / verification gaps (for the stabilization pass)
| # | Item | Status |
|---|---|---|
| G1 | Real `npm install` / typecheck / vitest / build with new code | Not run (sandbox) |
| G2 | `package-lock.json` stale (supabase-js added) | Run `npm install` |
| G3 | Real Express 5 behaviours not covered by shim: JSON parse errors on routes, query parser, async error forwarding | Not run |
| G4 | supabase-js builder type inference for `.select(PROFILE_COLUMNS)` etc. may need casts under strict TS | Not run |
| G5 | Nothing tested against a real Supabase project (auth.getUser, PostgREST error shapes for custom `CPxxx` SQLSTATEs, rpc return shape object vs array) | Needs approved test project |
| G6 | `/auth/me` etc. do one DB call per request (profile load); no caching | Acceptable for now |
| G7 | Orphaned uploads (URL minted, file uploaded, report never created) stay in the private bucket; no cleanup job | Add scheduled cleanup (e.g. delete objects older than 24h not referenced by any report) |
| G8 | Storage only checks the declared Content-Type, not file contents (no magic-byte scan); no malware scanning | Accepted for now (files are private and served only via signed URLs); consider scanning |
| G9 | Real Supabase Storage API shapes (`createSignedUploadUrl`, `list`, `createSignedUrls`, `remove`) used per docs, never executed | Verify with a test project |
| G11 | Write-rate-limit test (`tests/hardening.test.ts`) and the existing 429 tests rely on the real `express-rate-limit`; shim cannot verify | Run `npm test` |
| G12 | Dockerfile and CI workflow never built/run | Build image locally; push to GitHub |
| G13 | No audit-log read endpoint (`profile_audit_log` is admin-readable in SQL only) | Optional feature |
| G14 | Frontend not connected; CORS/token flow untested with a real browser | Integration test with frontend teammate |
| G15 | PostgREST embed syntax with FK hints, embedded-row filter `worker_assignments.is_active`, and `or()` quoting never executed against real PostgREST | Verify with a test project |
| G10 | `tests/db/*.test.ts` new files (internal notes, storage, dashboard) not run under PGlite/vitest | Run `npm test` |


## 12. Stabilization pass: checklist (do in this order)
1. `npm install` (updates the lockfile for `@supabase/supabase-js`), then `npm run typecheck`, `npm test`, `npm run build`. Fix real type errors (likely spots: supabase-js builder types in `src/routes/*`, `src/services/photos.ts`, `src/config/supabase.ts`; Express 5 handler types).
2. Run the DB suites under PGlite (`npx vitest run tests/db`): new files `internal-notes-and-reassignment`, `storage`, `dashboard` have only been mirrored on real PostgreSQL 16, never run under vitest.
3. Create a NEW test Supabase project (with Adii's approval), apply migrations 1-9, work through `docs/DB_VERIFICATION.md` section 2, then run a real end-to-end walk-through with the frontend.
4. Clear gaps G1-G14 above; add a cleanup job for orphaned uploads (G7).
5. Re-run Docker build and CI.


## 13. Frontend integration (this session)

Frontend repo: `CivicPlus-` (React 19 + Vite). Nothing was committed, pushed, deployed, or connected to a live Supabase project.

**Done (code written):** Supabase Auth + API client + route guards + env config; login/register/forgot/reset pages and a 404 page; citizen report creation (categories from API, validation, signed-URL photo upload), list, detail, timeline, cancel; staff/admin dashboard (list with citizen/worker names, search, status filter, pagination, detail, priority, assign/reassign, reject/review/reopen with notes, internal notes, needs-reassignment tab, CSV export of the loaded page, admin-only Users/Categories/Statistics tabs); worker task list with start/resolve; dead navbar/footer links fixed.
**Backend additions (approved):** multi-status filter, `/reports/counts`, address search, citizen/worker names for staff lists (G15 covers PostgREST verification).

**Verification actually run (all indicative, none is the real toolchain):**
- esbuild bundle of `src/main.jsx` with real React/react-icons resolution: OK.
- `src/lib` unit tests (10) run with bun through a vitest alias: 10/10 pass. Not run with real vitest.
- Playwright/Chromium smoke test (43 checks, 390px viewport) against a **mocked API** and **shimmed** react-router-dom and supabase-js: 43/43 pass. This proves the screens call the documented endpoints with documented bodies; it does not prove the real libraries or the real backend behave the same.

### Frontend gap register
| ID | Gap |
|---|---|
| F1 | `npm install`, `vite build`, `eslint` (react-hooks v7 rules) and real `vitest` never run (registry unreachable). `package-lock.json` is stale. |
| F2 | react-router-dom v7 and supabase-js behaviour only shimmed (`uploadToSignedUrl`, `detectSessionInUrl`, password-reset redirect, email-confirm redirect). |
| F3 | Never run against the real backend or real Supabase (CORS, token verification, RLS, signed upload/read URLs, PostgREST embeds). |
| F4 | Component tests for the dashboards do not exist; only lib tests and the sandbox smoke test (not committed to the repo). |
| F5 | Admin user management uses `window.prompt` for role/reason (functional, not polished). |
| F6 | Users tab shows only the first 20 matching users per page; staff list CSV exports the loaded page only. |
| F7 | Profile editing, settings, notifications and citizen report editing are not in the UI (backend supports profile/report edit). |
| F8 | Supabase dashboard settings still needed: Site URL / redirect URLs (`/citizen/login`, `/reset-password`), email confirmation on, first admin promoted manually. |
| F9 | Line endings: the frontend working tree is CRLF; git shows every file as modified until normalised. |
| F10 | Images/assets were not optimised, and responsive layouts were checked only at 390px in the smoke test (staff table scrolls horizontally inside its own container by design). |
