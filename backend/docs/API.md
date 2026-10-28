# CivicPlus+ API (v1)

Base URL (local): `http://localhost:4000/api/v1`

> Status: **Phase 7**. Implemented: health, auth/me, profiles, categories, admin users, reports (create/list/detail/edit/cancel/history), workflow (status, assign, priority, internal notes, reassignment review), photos, dashboard. Other endpoints are added and documented phase by phase. Nothing is promised until it is marked implemented.

## Authentication

The frontend signs users up / in with **Supabase Auth** (supabase-js) and sends the access token on every API call:

```
Authorization: Bearer <supabase access token>
```

This API does not trust the token's contents. It asks Supabase Auth to verify it on every request, then loads the caller's **role from the database** (`profiles.role`). Role, `is_active` and ownership can never be set from request headers, query or body. Deactivated accounts get `403`. Roles: `citizen`, `worker`, `staff`, `admin`. Names below use camelCase JSON.

## Common response format

Success:
```json
{ "success": true, "data": { }, "meta": { "page": 1, "limit": 20, "total": 57 } }
```
`meta` appears only on paginated list responses.

Error:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": [{ "path": "title", "message": "..." }],
    "requestId": "uuid"
  }
}
```
`details` is optional. Every response carries an `X-Request-Id` header; share it when reporting a bug.

## Error codes

| HTTP | code | Meaning |
|---|---|---|
| 400 | `BAD_REQUEST` / `INVALID_JSON` | Malformed request or JSON body |
| 401 | `UNAUTHORIZED` | Missing or invalid token |
| 403 | `FORBIDDEN` / `CORS_ORIGIN_NOT_ALLOWED` | Not allowed for this role / origin |
| 404 | `NOT_FOUND` | Route or resource not found |
| 409 | `CONFLICT` | State conflict (e.g. invalid status change, duplicate) |
| 413 | `PAYLOAD_TOO_LARGE` | Body too large (JSON limit 100 kb) |
| 422 | `VALIDATION_ERROR` | Body or query failed validation |
| 429 | `RATE_LIMITED` | Too many requests |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
| 503 | `SERVICE_UNAVAILABLE` | Supabase not configured or unreachable |

## CORS

Only origins listed in the server's `ALLOWED_ORIGINS` env var are accepted. Ask the backend owner to add your frontend URL (for example `http://localhost:5173`). Allowed request headers: `Authorization`, `Content-Type`.

## Endpoints

### GET `/health`  (implemented, tested)
- Auth: none
- Also available at `/health` (without prefix) for hosting-platform probes.
- 200 response:
```json
{
  "success": true,
  "data": {
    "status": "ok",
    "service": "civicplus-backend",
    "uptimeSeconds": 12,
    "timestamp": "2026-10-24T07:38:00.000Z"
  }
}
```
- Errors: `429 RATE_LIMITED`, `403 CORS_ORIGIN_NOT_ALLOWED` (browser requests from unlisted origins).


### GET `/auth/me`  (implemented, tested)
- Auth: any signed-in, active user
- 200: `{ id, email, emailVerified, role, profile: Profile }`
- Errors: `401` missing/invalid token, `403` deactivated or no profile, `503`.

### Profile object
`{ id, fullName, phone, ward, avatarUrl, role, isActive, createdAt, updatedAt }` (nullable: fullName, phone, ward, avatarUrl)

### GET `/profiles/me`  (implemented, tested)
- Auth: any role. 200: Profile.

### PATCH `/profiles/me`  (implemented, tested)
- Auth: any role. Only these fields are accepted; any other key (e.g. `role`, `isActive`, `id`) is rejected with `422`.
- Body (all optional, at least one): `fullName` (1-100), `phone` (`+` optional, 7-15 digits), `ward` (1-100), `avatarUrl` (https URL, max 500). Send `""` or `null` to clear a field.
- 200: updated Profile. Errors: `422`, `401`, `403`.

### Category object
`{ id, slug, name, description, isActive, sortOrder }`

### GET `/categories`  (implemented, tested)
- Auth: any role. Query: `includeInactive=true|false` (default false).
- 200: `Category[]` ordered by `sortOrder`, `name`. Use the `id` as `categoryId` when filing a report.

### POST `/categories`  (implemented, tested) - admin
- Body: `slug` (lowercase, hyphens, <=60), `name` (2-80), `description?` (<=300, nullable), `sortOrder?` (0-10000, default 0). 201: Category. Errors: `403`, `409` duplicate slug/name, `422`.

### PATCH `/categories/:id`  (implemented, tested) - admin
- Body (at least one): `slug`, `name`, `description`, `sortOrder`, `isActive`. Categories are never deleted; deactivate instead. 200: Category. Errors: `403`, `404`, `409`, `422`.

### GET `/admin/users`  (implemented, tested) - staff, admin
- Query: `page` (default 1), `limit` (1-100, default 20), `role?`, `isActive?` (`true|false`), `q?` (name search, literal match).
- 200: `Profile[]` + `meta: { page, limit, total }`. **Admin only** also get `email` on each item (read server-side; `null` if unavailable).
- Errors: `403` for citizen/worker, `422`.

### PATCH `/admin/users/:id/role`  (implemented, tested) - admin
- Body: `{ role, reason }` (`reason` 1-300 chars, written to the audit log). Admin cannot change their own role (`409`). 200: Profile. Errors: `403`, `404`, `409`, `422`.

### PATCH `/admin/users/:id/active`  (implemented, tested) - admin
- Body: `{ isActive: boolean, reason }`. Admin cannot change their own status (`409`). Deactivated users lose access immediately; their open assigned reports show up for staff review (see Phase 5). 200: Profile.


## Reports (Phase 4)

**ReportSummary** (list): `{ id, title, addressText, ward, status, priority, category: {id,slug,name}|null, citizenId, photoCount, createdAt, updatedAt, resolvedAt }`
**Report** (detail): ReportSummary + `{ description, latitude, longitude, photoPaths, citizen: {id, fullName}|null }`. `citizen` is `null` unless the caller may read that profile (citizen themself, staff, admin).
**Status values:** `submitted, under_review, assigned, in_progress, resolved, rejected, cancelled`. **Priority:** `low, normal, high, urgent`.
Visibility is enforced by the database (RLS): citizens see only their own reports, workers only reports assigned to them, staff/admin all. A report you cannot see is always `404` (never `403`), so existence is not leaked.

### POST `/reports`  (implemented, tested) - citizen only
- Requires a **verified e-mail** (`403` otherwise). The owner is always the caller.
- Body (unknown keys such as `status`, `priority`, `citizenId` are `422`): `categoryId` (uuid of an active category), `title` (3-150), `description` (10-2000), `addressText` (3-300), `latitude?`/`longitude?` (both or neither; -90..90 / -180..180), `ward?` (1-100), `photoPaths?` (max 3, each a path returned by `/reports/photos/upload-url`; the file must already be uploaded).
- 201: Report. Errors: `403`, `422`.

### GET `/reports`  (implemented, tested) - any role (results scoped by role)
- Query: `page`, `limit` (1-100, default 20), `status` (one value, or several separated by commas, e.g. `assigned,in_progress`), `priority`, `categoryId`, `ward`, `q` (matches **title or address**, case-insensitive; the characters `, ( ) " % _ * :` are ignored), `createdFrom`, `createdTo` (`YYYY-MM-DD`, UTC, inclusive), `sort` = `newest` (default) | `oldest` | `priority`.
- 200: `ReportSummary[]` + `meta`. **Staff/admin** items also include `citizen: {id, fullName}|null` and `assignedWorker: {id, fullName}|null` (current assignment).

### GET `/reports/counts`  (implemented, tested) - any role
- Number of reports per status among the reports the caller can see (citizen: own, worker: assigned to them, staff/admin: all).
- 200: `{ total, byStatus: { submitted, under_review, assigned, in_progress, resolved, rejected, cancelled } }`.

### GET `/reports/:id`  (implemented, tested) - any role that can see it
- 200: Report incl. `photos: [{ path, url }]` (`url` = signed read link valid 1 hour, `null` if storage is temporarily unavailable). `404` if missing or not visible.
- Workers and staff/admin additionally get `assignment: { id, workerId, workerName, assignedAt, note } | null` (`workerName` only for staff/admin). Staff/admin also get `needsReassignment: boolean` (see below). Citizens get neither.

### PATCH `/reports/:id`  (implemented, tested) - owner citizen, only while `submitted`
- Body (at least one): `categoryId`, `title`, `description`, `addressText`, `latitude`+`longitude` (together, or both `null` to clear), `ward`, `photoPaths`.
- 200: Report. `409` once the report is being processed, `404` if not yours.

### POST `/reports/:id/cancel`  (implemented, tested) - owner citizen, only while `submitted`
- Body: `{ note? }` (<=500). 200: Report with `status: "cancelled"`. `409` if no longer cancellable.

### GET `/reports/:id/history`  (implemented, tested) - any role that can see the report
- 200: `[{ id, oldStatus, newStatus, note, isInternal, createdAt, changedBy: {id, fullName}|null }]`, oldest first.
- Citizens and workers never receive internal notes. For citizens `changedBy` is `null` unless they performed the action themselves.


## Workflow (Phase 5)

Allowed status transitions (enforced in the database, atomically, with history written in the same transaction):
`submitted -> under_review | rejected | cancelled(owner)`; `under_review -> rejected`; `assigned -> in_progress`; `in_progress -> resolved`; `resolved -> under_review` (reopen, note required, releases the worker). `assigned` is reached only through `/assign`. `rejected` and `cancelled` are final. A note is required for `rejected` and for reopening.
Common errors: `403` role not allowed, `404` report not visible to you, `409` invalid transition / already assigned, `422` missing note or invalid worker.

### PATCH `/reports/:id/status`  (implemented, tested) - worker (assigned only), staff, admin
- Body: `{ status: "under_review" | "rejected" | "in_progress" | "resolved", note? (<=500) }`. Workers may only do `in_progress` and `resolved` on reports assigned to them; `under_review`/`rejected`/reopen are staff/admin.
- 200: Report. (`assigned` -> use `/assign`; `cancelled` -> `/cancel`.)

### POST `/reports/:id/assign`  (implemented, tested) - staff, admin
- Body: `{ workerId, note? }`. `workerId` must be an **active worker** (list them with `GET /admin/users?role=worker&isActive=true`). Calling it again on an assigned report **reassigns** it (the previous worker is released; one active assignment per report is guaranteed by the database). Works on `submitted`, `under_review`, `assigned`, `in_progress`. 200: Report with `status: "assigned"`.

### PATCH `/reports/:id/priority`  (implemented, tested) - staff, admin
- Body: `{ priority: "low" | "normal" | "high" | "urgent" }`. 200: Report.

### POST `/reports/:id/internal-notes`  (implemented, tested) - staff, admin
- Body: `{ note }` (1-500). Adds a **staff-only** entry to the timeline without changing the status. Citizens and workers can never read it (database-enforced). 201: `{ id, oldStatus, newStatus, note, isInternal: true, createdAt, changedBy }`.

### GET `/reports/needs-reassignment`  (implemented, tested) - staff, admin
- Open reports (`assigned`/`in_progress`) whose worker was **deactivated** or **no longer has the worker role**. Nothing is reassigned automatically: staff reassign via `/assign`, and the entry disappears (also if the report is resolved/reopened or the worker is reactivated). Query: `page`, `limit`.
- 200: `[{ reportId, title, status, priority, ward, addressText, reportCreatedAt, assignmentId, assignedAt, worker: {id, fullName, role, isActive}, reason: "worker_deactivated" | "worker_role_changed" }]` + `meta`.


## Photos (Phase 6)

Photos live in a **private** Supabase Storage bucket (`report-photos`, 5 MB max, jpeg/png/webp). There are no public URLs and the frontend gets no direct storage permissions. Flow:

1. `POST /reports/photos/upload-url` -> `{ path, uploadUrl, token, method: "PUT", contentType, maxBytes, expiresInSeconds }`.
2. Frontend uploads the file to `uploadUrl` (with supabase-js: `supabase.storage.from('report-photos').uploadToSignedUrl(path, token, file)`, same content type).
3. Send the `path` values in `photoPaths` when creating (`POST /reports`) or editing (`PATCH /reports/:id`) the report (max 3). The API checks every file exists in your own folder. Dropped photos are deleted from storage.
4. `GET /reports/:id` returns `photos` with short-lived signed read URLs, only to people allowed to see that report.

### POST `/reports/photos/upload-url`  (implemented, tested) - citizen, verified e-mail
- Body: `{ contentType: "image/jpeg" | "image/png" | "image/webp", sizeBytes: 1..5242880 }`. The server chooses `path` as `<yourUserId>/<random>.<ext>`; it cannot be influenced. Limited to 30 per hour per user. 201 as above. Errors: `403`, `422`, `429`, `503` (storage not configured).
- Note: Storage itself enforces the 5 MB and content-type limits on the actual upload; the declared `sizeBytes` is only an early check.

## Dashboard (Phase 7)

### GET `/dashboard/summary`  (implemented, tested) - staff, admin
- Query: `days` (1-365, default 30).
- 200: `{ generatedAt, periodDays, periodStart, totals: { all, open, awaitingAssignment, resolved, rejected, cancelled }, byStatus: { <status>: n }, openByPriority: { low, normal, high, urgent }, byCategory: [{ categoryId, name, total, open }], topWards: [{ ward, total, open }] (max 10), createdInPeriod, resolvedInPeriod, avgResolutionHours (number|null), createdPerDay: [{ date, count }] (zero-filled), needsReassignment, workerWorkload: [{ workerId, fullName, openAssigned }] }`.
- Aggregates only: no citizen names, e-mails or addresses. Dates are UTC. `open` = submitted, under_review, assigned, in_progress.
