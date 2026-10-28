# Security overview

Defence in depth: each rule is enforced in the database first, then again in the API.

| Concern | How it is handled | Where |
|---|---|---|
| Who is calling | Frontend uses Supabase Auth. The API sends every bearer token to Supabase Auth for verification (never trusts token contents), then loads the role from `profiles`. | `middleware/auth.ts` |
| Role spoofing | Role/`is_active` only come from the database. Headers/query/body are ignored. Profile/report bodies are `.strict()`, so `role`, `status`, `citizenId` etc. are 422. | routes, tests |
| Privilege escalation | `role`, `is_active`, owner, status, priority have no UPDATE grant + guard triggers; roles change only via an admin-only audited SQL function; admins cannot change themselves. | migrations 3-5 |
| Authorization | RLS on every table; workflow actions are SQL functions that lock the row and check role + transition; the API calls them with the **caller's own token**, so the database sees the real user. Route `requireRole` is just a first gate. | migrations 4-5, `routes/*` |
| Existence leaks | Reports you cannot see are `404`, never `403`. | DB + API |
| Internal notes | `is_internal` rows are hidden by RLS from citizens and workers; citizens never see staff identities. | migration 7 |
| Deactivated users | No role = every policy denies; API returns 403 at login-check. Their open reports are listed for staff review, never silently reassigned. | migration 7 |
| Service-role key | Server env only. Used for: signing storage URLs (after an RLS visibility check), uploading via signed URLs, reading e-mails for the admin list. Never sent to clients, never logged. | `config/supabase.ts` |
| Photos | Private bucket, no storage policies, 5 MB + image types enforced by Storage, server-chosen paths `<userId>/<uuid>.<ext>`, DB trigger checks paths, short-lived signed read URLs. | migration 8, `services/photos.ts` |
| Input | Zod validation on all params/query/body; LIKE wildcards escaped; DB CHECK constraints as a second layer. | `middleware/validate.ts` |
| Errors | Consistent envelope; unknown errors become a generic 500; DB messages/constraint names never reach clients. | `utils/dbError.ts` |
| Abuse | Helmet, strict CORS allow-list from env, global + write rate limits, per-user upload-URL limit, 100 KB JSON limit, `Cache-Control: no-store` on API responses. | `app.ts` |
| Logs | JSON line per request: method, path (no query), status, time, request id. No headers/bodies/tokens. | `middleware/requestLogger.ts` |
| Secrets | `.env*` git-ignored, `.env.example` has placeholders only, env errors never print values. | `config/env.ts` |

## Known limits (see PROJECT_STATUS.md for the full register)
- Upload content type is checked by Storage from the declared type, not by inspecting bytes; no malware scanning.
- Orphaned uploads are not cleaned up automatically.
- Nothing has been tested against a real Supabase project yet.
- Rate limits are per IP and in memory (single instance). Behind several instances use a shared store.
