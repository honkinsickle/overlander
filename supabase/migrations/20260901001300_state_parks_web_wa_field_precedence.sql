-- field_precedence for the `state_parks_web_wa` source (parks.wa.gov visitor content).
--
-- Per-state source_id (separate from CA's `state_parks_web`).
-- Same priority tiers as CA — independent rows, not shared.
--
-- Description: priority 2 (alongside USFS/RIDB, below NPS).
-- Hours: priority 3 (alongside RIDB, below Google/NPS).
-- Contact (phone + email + address): priority 3.
-- Amenities: priority 5 (between Google and OSM).
--
-- operational_status: NO ROW — WA has no explicit open/closed status
-- field, unlike CA. Not inferred from rules/alerts.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('description',  'state_parks_web_wa', 2),
  ('hours',        'state_parks_web_wa', 3),
  ('contact',      'state_parks_web_wa', 3),
  ('amenities',    'state_parks_web_wa', 5);
