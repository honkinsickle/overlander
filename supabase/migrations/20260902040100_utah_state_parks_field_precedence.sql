-- field_precedence rows for utah_state_parks visitor-website source.
--
-- description: priority 1 — Adam's explicit call that UT's visitor
--   prose should win over RIDB's more technical text (RIDB is at 2).
--   This is above NPS/parks_canada/bc_parks/alberta_parks (also 1) but
--   those are different states and don't compete for UT parks.
--
-- hours: priority 3 — same tier as AZ/WA/CA/RIDB. UT is the first
--   source to provide hours for UT state parks (RIDB has none).
--
-- contact: priority 4 — below RIDB (3) since RIDB already covers
--   contact for most UT state parks; UT's extracted contact (from the
--   contaminated hours field) is a fallback/supplement.
--
-- No fees row (0/46 populated). No coordinates row (borrowed from GIS).

insert into public.field_precedence (field_name, source_id, priority) values
  ('description', 'utah_state_parks', 1),
  ('hours',       'utah_state_parks', 3),
  ('contact',     'utah_state_parks', 4)
on conflict do nothing;
