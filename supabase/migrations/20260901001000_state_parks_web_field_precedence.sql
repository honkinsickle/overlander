-- field_precedence for the `state_parks_web` source (parks.ca.gov visitor content).
--
-- Complements `state_parks` (GIS boundaries/points) with visitor-facing
-- data scraped from the official website: descriptions, hours, phone,
-- amenities, and operational status.
--
-- Description: priority 2, alongside USFS/RIDB — authoritative for its
-- own parks, below NPS (1) which is the gold standard for park prose.
-- Google (3) is general-purpose and ranks below agency sources.
--
-- Hours: priority 3, alongside RIDB — freeform text ("8am to Sunset"),
-- below Google (1, structured) and NPS (2).
--
-- Contact (phone + address): priority 3, alongside RIDB — direct park
-- phone numbers from the official site.
--
-- Amenities: priority 5, between Google (4) and OSM/state_parks (8) —
-- rich semicolon-separated lists from the site's amenity flags.
--
-- Operational status: priority 2, below USFS (1) — the site's
-- open/closed/restricted status, scraped 2026-09-01.
--
-- Fields intentionally WITHOUT rows here (stored in normalized_payload
-- only, no resolved column): fees, dogs, advisories, region, district.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('description',        'state_parks_web', 2),
  ('hours',              'state_parks_web', 3),
  ('contact',            'state_parks_web', 3),
  ('amenities',          'state_parks_web', 5),
  ('operational_status', 'state_parks_web', 2);
