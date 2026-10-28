# CivicPlus+ database design (Phase 2 + 2b)

## Tables

| Table | Purpose | Key constraints |
|---|---|---|
| `profiles` | 1 row per auth user (auto-created, role `citizen`) | PK = `auth.users.id`; phone regex; lengths; `is_active` |
| `profile_audit_log` | Who changed a role / active flag, old -> new, reason | no FKs (outlives users); admin-read only |
| `categories` | Complaint categories (admin managed) | unique slug, unique lower(name) |
| `reports` | Complaints | FK citizen + category; lat -90..90, lng -180..180, both-or-neither; max 3 photos; `resolved_at` iff `resolved` |
| `report_status_history` | Append-only trail (who, when, from, to, note) | FK report (cascade), FK user (restrict) |
| `worker_assignments` | Assignment log | **unique index: one active assignment per report** |

Enums: `user_role` (citizen, worker, staff, admin), `report_status`, `report_priority` (low, normal, high, urgent).

Location: `address_text` required; `latitude`/`longitude` optional but must come as a pair; `ward` optional.
Photos: `photo_paths text[]` holds storage paths `<citizen_id>/<file>`; the files live in the private `report-photos` bucket (migration 8).
Notes: normal history notes (rejection reason, reopen reason, "Assigned to worker") are visible to the citizen who owns the report. **Internal notes** (`report_status_history.is_internal = true`, migration 7) are visible to staff/admin only.

## Status workflow (enforced inside `change_report_status` / `assign_report`)

```
submitted -> under_review | rejected | cancelled(owner only)
under_review -> rejected            (or assigned via assign_report)
assigned -> in_progress
in_progress -> resolved
resolved -> under_review            (reopen, note required, releases worker)
rejected, cancelled: final
```
`assigned` is reached only through `assign_report` (which also reassigns). Rejection and reopening need a note.

## Permission matrix

| Action | citizen | worker | staff | admin |
|---|---|---|---|---|
| Read own profile / edit name, phone, ward, avatar | yes | yes | yes | yes |
| Read all profiles | no | no | yes | yes |
| Change role or active flag | no | no | no | yes (function, reason, audited, not self) |
| Read categories | yes | yes | yes | yes |
| Create / edit categories | no | no | no | yes (no delete; deactivate) |
| File a report (verified email, active) | yes | no | no | no |
| Edit own report content | only while `submitted` | no | no | no |
| Read reports | own | assigned to them | all | all |
| Cancel report | own, while `submitted` | no | no | no |
| Review / reject / reopen / set priority | no | no | yes | yes |
| Assign / reassign worker | no | no | yes | yes |
| in_progress / resolved | no | assigned only | yes | yes |
| Read status history (public rows) | of visible reports | of visible reports | all | all |
| Read **internal** notes | **never** | **never** | all | all |
| Add internal note | no | no | yes | yes |
| See reports needing reassignment (view) | no | no | yes | yes |
| Read assignments | no | own | all | all |
| Read audit log | no | no | no | yes |
| Delete anything via API | no | no | no | no |

## Security design

- **Signup:** trigger `on_auth_user_created` always writes role `citizen`; `raw_user_meta_data` is never used for role.
- **Protected columns:** `role`, `is_active`, `citizen_id`, `status`, `priority`, `resolved_at` have no UPDATE grant for `authenticated`, **and** guard triggers block them for everyone except the function owner. The check uses `current_user`, which a client cannot spoof (unlike session variables).
- **No RLS recursion:** policies call `SECURITY DEFINER` helpers (`app.current_user_role()` etc.) that read `profiles` as the table owner, so no policy queries a table whose policy queries it back. `FORCE ROW LEVEL SECURITY` is deliberately not used.
- **Privilege escalation:** helpers live in the non-exposed `app` schema with `search_path = ''`; all functions revoke `PUBLIC`/`anon` execute; roles can only change through `admin_set_user_role`; an admin cannot change their own role or active flag (prevents self-lockout and silent self-promotion).
- **Atomicity:** report + history + assignment changes happen inside one function call = one transaction, with `SELECT ... FOR UPDATE` on the report row to serialise concurrent changes.
- **Audit trails:** history and audit log have no write path for `authenticated`, `anon` or `service_role`; triggers add a second block.
- **Inactive users** get no role, so every policy denies them.
- **404 vs 403:** callers who cannot see a report get `CP404`, so existence is not leaked.

## Internal notes (migration 7)

- `report_status_history.is_internal boolean not null default false`. Existing rows stay public.
- Created only by `add_internal_note(p_report_id, p_note)` (staff/admin; note required, max 500 chars). The row keeps the report's current status as both `old_status` and `new_status` (a table CHECK enforces "internal => has a note and no status change"). The report itself is not modified.
- The `history_select` policy was replaced: a row is readable only if its report is readable **and** (`not is_internal` **or** caller is staff/admin). Citizens and workers can never read internal rows, through any query shape. There is no direct write path (same append-only guarantees as all history).
- API rule for Phase 4+: always read history through the user-scoped client so this policy applies. Never read history with the service-role client and forward it to citizens/workers.
- Internal notes are not editable or deletable (append-only).

## Reassignment review for deactivated workers (migration 7)

- Nothing is reassigned automatically. A report **needs review** when its status is `assigned` or `in_progress` and its active assignment belongs to a user who is no longer an active worker (deactivated: `worker_deactivated`; role changed away from worker: `worker_role_changed`).
- Exposed as view `public.reports_needing_reassignment` (`security_invoker`, staff/admin only: returns zero rows for everyone else, `anon` has no privilege). Columns: report id, title, status, priority, ward, address, assignment id/time, worker id/name/role/active, `review_reason`.
- It is **derived, not stored**, so it cannot go stale: the entry disappears by itself when staff call `assign_report` with an active worker, when the report is resolved or reopened, or if the worker is reactivated.
- A deactivated worker already has no role, so they lose all access immediately (reports, history, assignments, status changes return 401/empty).
- Reactivating a worker restores their access to still-assigned reports, and the review entry disappears. Staff may prefer to reassign first.

## Error codes for the API layer (Phase 3)

| SQLSTATE | Meaning | HTTP |
|---|---|---|
| `CP401` | not authenticated / inactive | 401 |
| `CP403` | not allowed | 403 |
| `CP404` | not found (or not visible) | 404 |
| `CP409` | invalid transition / duplicate | 409 |
| `CP422` | invalid input | 422 |
| `42501` | RLS / privilege denied | 403 |
| `23505` / `23514` / `23503` | unique / check / FK violation | 409 / 422 / 422 |

## Functions the backend will call (via `supabase.rpc` with the user's token)

`change_report_status(p_report_id, p_new_status, p_note)`, `assign_report(p_report_id, p_worker_id, p_note)`, `set_report_priority(p_report_id, p_priority)`, `admin_set_user_role(p_user_id, p_role, p_reason)`, `admin_set_user_active(p_user_id, p_active, p_reason)`, `add_internal_note(p_report_id, p_note)`, `dashboard_summary(p_days)`. Views: `reports_needing_reassignment`.

## Storage (migration 8)
- Bucket `report-photos`: private, 5 MB, `image/jpeg|png|webp`. **No policies on `storage.objects`**: clients cannot read or write objects directly. The API creates signed upload URLs (server-chosen path) and short-lived signed read URLs with the service-role key, after proving visibility through RLS.

## Dashboard (migration 9)
- `public.dashboard_summary(p_days int default 30) returns jsonb`: staff/admin only (`CP403` otherwise, `CP401` inactive, `CP422` bad days). Aggregates only, no personal data.

## Known limits / later phases
- Orphaned uploads are not cleaned up automatically (see PROJECT_STATUS.md).
- Deactivating a worker does not auto-reassign; staff use `reports_needing_reassignment` and `assign_report` (see above).
