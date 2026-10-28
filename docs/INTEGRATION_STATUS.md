# Integration status

## Frontend ↔ backend map
| Screen | Endpoints used |
|---|---|
| Login / register / reset | Supabase Auth (browser); `GET /auth/me` for the server-side role |
| Citizen report form | `GET /categories`, `POST /reports/photos/upload-url` → Storage signed upload, `POST /reports` |
| Citizen dashboard | `GET /reports`, `GET /reports/counts`, `GET /reports/:id`, `/history`, `POST /reports/:id/cancel` |
| Staff/admin dashboard | `GET /reports`, `/counts`, `/needs-reassignment`, `PATCH /reports/:id/status`, `/priority`, `POST /reports/:id/assign`, `/internal-notes`, `GET /admin/users` |
| Admin tabs | `GET/PATCH /admin/users…`, `GET/POST/PATCH /categories`, `GET /dashboard/summary` |
| Worker dashboard | `GET /reports` (assigned only), `/counts`, `PATCH /reports/:id/status` (`in_progress`, `resolved`) |

CORS: backend allows methods GET/POST/PATCH/PUT/DELETE/OPTIONS and headers Authorization, Content-Type from `ALLOWED_ORIGINS`.

## Verified (sandbox substitutes, indicative only)
- Frontend bundles with esbuild (real React/react-icons; shimmed react-router-dom/supabase-js).
- 10 frontend unit tests pass under bun via a vitest alias.
- 43-check Chromium smoke test at 390px against a mocked API: guards, login errors, portal mismatch, citizen create+photo+cancel, signup sends no role, staff priority/assign/note, admin tabs, worker start/resolve, no console errors, no horizontal scroll.
- Backend: 217 tests pass under a hand-written shim runner (not Vitest); 9 migrations apply on a fresh PostgreSQL 16 with a Supabase stub; type check only with a stubbed `tsc`.

## NOT verified
- Real `npm install`, `vitest`, `tsc`, `vite build`, `eslint` (frontend and backend). Backend tests under `tests/db/` have never run under PGlite.
- Anything against real Supabase: Auth emails/redirects, PostgREST embeds with FK hints, RLS with real JWTs, signed upload/read URLs, the storage bucket, rate limiting with the real library.
- Docker image and CI workflow.
- Real-browser behaviour with the real react-router-dom v7 and supabase-js.

## Known limitations
Admin role/active changes use browser prompts; no profile/settings/report-edit UI; orphaned uploads are not cleaned; no content sniffing of uploads; users list pages at 20; no audit-log endpoint; staff CSV exports the loaded page.
