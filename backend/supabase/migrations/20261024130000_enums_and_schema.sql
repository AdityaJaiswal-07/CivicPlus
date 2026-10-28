-- CivicPlus+ Phase 2 / migration 1 of 6
-- Enums and the private "app" schema (helper functions live here, NOT in the
-- API-exposed "public" schema).
-- Safe to run on a NEW project: creates objects only, drops nothing.

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

create type public.user_role as enum ('citizen', 'worker', 'staff', 'admin');

create type public.report_status as enum (
  'submitted',     -- citizen filed it
  'under_review',  -- staff is reviewing it
  'assigned',      -- a worker has been assigned
  'in_progress',   -- worker started work
  'resolved',      -- worker/staff finished it
  'rejected',      -- staff rejected it (note required)
  'cancelled'      -- citizen cancelled it (only while 'submitted')
);

create type public.report_priority as enum ('low', 'normal', 'high', 'urgent');
