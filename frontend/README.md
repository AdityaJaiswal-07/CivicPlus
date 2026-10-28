# CivicPlus+ (CleanCity) — Frontend

React 19 + Vite + react-router. Talks to the CivicPlus+ Express API and uses Supabase Auth in the browser.

## Setup

```bash
npm install
cp .env.example .env   # fill in the three public values; never commit .env
npm run dev            # http://localhost:5173
npm test               # vitest (src/lib)
npm run build
```

| Variable | Meaning |
|---|---|
| `VITE_API_BASE_URL` | Backend base URL, e.g. `http://localhost:4000/api/v1` |
| `VITE_SUPABASE_URL` | Supabase project URL (public) |
| `VITE_SUPABASE_ANON_KEY` | Supabase **anon** key (public). **Never** put the service-role key in the frontend. |

The backend's `ALLOWED_ORIGINS` must include the frontend origin.

## How it works

- `src/lib/api.js` — fetch wrapper (bearer token, `{success,data,meta}` envelope, `ApiError`).
- `src/auth/` — `AuthProvider` (Supabase session + `GET /auth/me`; **the role always comes from the server**) and `RequirePortal` route guards. Guards are a convenience only: the backend and database enforce every permission.
- Portals: citizen → `/citizen/*`; worker → `/worker/*`; staff **and** admin → `/staff/*` (admin gets extra Users, Categories, Statistics tabs).
- Report ID shown to users = `CP-` + first 8 hex characters of the UUID.
- Photos: `POST /reports/photos/upload-url` → upload with `uploadToSignedUrl` → send `photoPaths` when creating the report. The bucket is private; images are shown through short-lived signed URLs.

## Accounts

Public sign-up (`/citizen/register`) **always creates a citizen**. Staff, admin and worker accounts are provisioned by an administrator: the person signs up normally, then an admin changes the role in Users (or in Supabase). The first admin must be promoted directly in the Supabase dashboard (see the backend `supabase/README.md`).

## Status mapping

Pending = submitted + under review · In Progress = assigned + in progress · Resolved · Rejected · Cancelled. Priority `normal` is shown as "Medium".
