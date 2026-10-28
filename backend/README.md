# CivicPlus+ Backend

Node.js + Express + TypeScript API for CivicPlus+ (CleanCity), a civic waste management platform. Data, auth and storage are on Supabase (PostgreSQL, Auth, Storage).

## What the API does
Citizens file and track waste reports (with private photos); workers update reports assigned to them; staff/admin review, prioritise, assign/reassign, add internal notes and see statistics; admin manages roles. Supabase Auth issues tokens; this API verifies them and the database enforces permissions (RLS + SQL functions). Endpoints: see `docs/API.md`.

> Continuing in a new session? Read **`PROJECT_STATUS.md`** first. It has the current status, structure, decisions and exact next steps.

## Requirements
- Node.js 20 or newer (built and tested on Node 22)
- npm
- A Supabase project is **not** needed yet for Phase 1/2 work or for `npm test`

## Local setup

```bash
npm install
cp .env.example .env      # edit values in .env; NEVER commit it
npm run dev               # http://localhost:4000/api/v1/health
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server with reload |
| `npm run typecheck` | TypeScript check |
| `npm test` | All tests (API + local database/RLS tests) |
| `npx vitest run tests/db` | Database/RLS tests only |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build |

## Environment variables

Defined and validated in `src/config/env.ts`; placeholders in `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `4000` | 1 to 65535 |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated frontend origins for CORS. No `*`, no trailing slash. Add the deployed frontend URL here later. |
| `RATE_LIMIT_WINDOW_MS` | `900000` | Rate-limit window |
| `RATE_LIMIT_MAX` | `300` | Requests per IP per window |
| `TRUST_PROXY` | `0` | Set `1` behind Render/Railway |
| `SUPABASE_URL` | none | Required when `NODE_ENV=production` |
| `SUPABASE_ANON_KEY` | none | Required in production |
| `SUPABASE_SERVICE_ROLE_KEY` | none | **Server only.** Required in production. Never put it in frontend code, chat or Git. |
| `STORAGE_BUCKET` | `report-photos` | Private photo bucket (created by migration 8) |
| `WRITE_RATE_LIMIT_MAX` | `120` | Extra limit for POST/PATCH/PUT/DELETE per IP per window |

Keys live only in your local `.env` (or the hosting platform's secret settings). `.env` is git-ignored.

## Database

SQL migrations are in `supabase/migrations/` (9 files, run in filename order). They are **not yet applied** to any Supabase project. How to apply them safely to a new project: `supabase/README.md`. Design and permission matrix: `docs/DATABASE.md`. What is verified locally vs what needs a real project: `docs/DB_VERIFICATION.md`.

## Documentation

| File | Purpose |
|---|---|
| `PROJECT_STATUS.md` | Handoff: status, structure, decisions, next steps |
| `docs/API.md` | API contract for the frontend developer (all implemented endpoints) |
| `docs/DATABASE.md` | Schema, workflow, roles, security design |
| `docs/DB_VERIFICATION.md` | Test coverage and the real-Supabase checklist |
| `supabase/README.md` | Applying migrations to a new Supabase project |
| `docs/DEPLOYMENT.md` | Render / Railway deployment and post-deploy checks |
| `docs/SECURITY.md` | Where each security rule is enforced, known limits |

## Security basics
- Never commit `.env`, keys, tokens or passwords. `.gitignore` already excludes `.env*` (except `.env.example`).
- The service-role key bypasses RLS: backend only, and only where truly needed.
- Frontend uses only the Supabase URL and anon key, plus this API.
