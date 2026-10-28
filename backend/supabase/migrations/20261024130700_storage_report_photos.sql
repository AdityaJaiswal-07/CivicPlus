-- CivicPlus+ Phase 6 / migration 8
-- Private storage bucket for report photos. Creates one bucket row only.
--
-- Security model
-- * public = false: no public URLs. Files are readable only through short-lived
--   signed URLs that the API issues AFTER checking (via RLS) that the caller can see the report.
-- * Uploads go through signed upload URLs created by the API with the service-role key, for a
--   server-chosen path `<citizen_id>/<uuid>.<ext>`. Clients get no direct storage policy at all.
-- * No policies are created on storage.objects: with RLS on (Supabase default), anon and
--   authenticated can neither read nor write objects directly.
-- * Size and type limits are enforced by Storage itself (5 MB; jpeg, png, webp).
--
-- Never overwrites: if a bucket with this id already exists it is left untouched
-- (check its settings in the dashboard: docs/DB_VERIFICATION.md).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('report-photos', 'report-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
