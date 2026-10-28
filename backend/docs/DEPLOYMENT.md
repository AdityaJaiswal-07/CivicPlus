# Deployment guide (Render or Railway)

The API is a plain Node 22 web service. It is platform independent: it needs environment variables and an outbound connection to Supabase. Do all of this with a **new / test Supabase project first**, never with data you cannot lose.

## 1. Supabase project (one time)
1. Create a project. Keep the DB password in your password manager.
2. Apply the 9 migrations in order: see `supabase/README.md` (CLI `supabase db push`, or paste each file into the SQL Editor). They only create objects.
3. **Authentication > Providers > Email:** keep "Confirm email" **ON** (filing a report requires a verified e-mail).
4. **Authentication > URL Configuration:** set Site URL and Redirect URLs to your frontend URL(s).
5. **Settings > API > Exposed schemas:** only `public` (the private `app` schema must stay unexposed).
6. Confirm Storage has the private bucket `report-photos` (Storage > Buckets; "Public" must be OFF, limit 5 MB).
7. Create the first admin (see `supabase/README.md`, step 3: sign up normally, then run the one-line SQL in the SQL Editor).
8. Walk through the checklist in `docs/DB_VERIFICATION.md` section 2.

## 2. Environment variables (set in the platform's secret settings, never in Git)
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | provided by the platform (Render/Railway set it); default 4000 |
| `ALLOWED_ORIGINS` | your frontend origin(s), comma separated, `https://...`, no trailing slash, no `*` |
| `TRUST_PROXY` | `1` (one proxy hop in front of the app) |
| `SUPABASE_URL` | Project URL (Settings > API) |
| `SUPABASE_ANON_KEY` | anon/public key (safe for browsers) |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role key. **Secret. Server only.** Used only to sign storage URLs and read user e-mails for the admin list. |
| `STORAGE_BUCKET` | `report-photos` |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`, `WRITE_RATE_LIMIT_MAX` | optional tuning (defaults 15 min, 300, 120) |

The server refuses to start in production if the three Supabase variables are missing, and prints only variable **names** in errors, never values.

## 3. Render
- New **Web Service** from the repo. Runtime Node (or Docker using the included `Dockerfile`).
- Build command: `npm ci && npm run build`. Start command: `npm start`.
- Health check path: `/health`.
- Add the environment variables above.

## 4. Railway
- New project from the repo (Nixpacks or the `Dockerfile`). Start command `npm start` (build runs `npm run build`; set it explicitly if needed).
- Add the variables above, enable a public domain, health check path `/health`.

## 5. After the first deploy
1. `GET https://<api-domain>/health` returns `{ "success": true, ... }`.
2. From the frontend origin, sign in with Supabase Auth and call `GET /api/v1/auth/me` with the access token.
3. Run the role walk-through (citizen files a report with a photo; staff assigns; worker resolves; citizen sees the history but not internal notes; deactivate a worker and check `/reports/needs-reassignment`).
4. Check logs: one JSON line per request, no tokens or bodies.

## 6. Rolling back / safety
- Migrations are additive. Never edit an applied migration: add a new one.
- Rotate the service-role key in Supabase if it is ever exposed, then update the platform secret.
- Back up (Supabase dashboard) before applying any future migration to a database that has real data.
