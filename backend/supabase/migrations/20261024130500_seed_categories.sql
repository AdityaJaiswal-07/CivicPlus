-- CivicPlus+ Phase 2 / migration 6 of 6
-- Reference data ONLY: waste complaint categories. No users, no reports.
-- Idempotent: re-running does not duplicate or overwrite admin edits.

insert into public.categories (slug, name, description, sort_order) values
  ('overflowing-bins',   'Overflowing bins',         'Dustbins or containers that are full and spilling over', 10),
  ('missed-collection',  'Missed waste collection',  'Scheduled waste pickup did not happen',                  20),
  ('illegal-dumping',    'Illegal dumping',          'Waste dumped in an unauthorised place',                  30),
  ('other',              'Other waste issue',        'Any other waste-related problem',                        90)
on conflict (slug) do nothing;
