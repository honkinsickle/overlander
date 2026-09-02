-- field_precedence for the `arizona_state_parks` source (azstateparks.com visitor content).
--
-- Per-state source_id, separate from the shared `state_parks` GIS
-- source. Same priority tiers as CA — independent rows, not shared.
--
-- Description: priority 2 (alongside USFS/RIDB, below NPS).
-- Hours: priority 3 (alongside RIDB, below Google/NPS) — 29/33
--   populated, freeform text.
-- Contact: priority 3 — 33/33 populated as a semi-structured blob
--   (phone + address + reservation number).
--
-- Fields intentionally WITHOUT rows here (AZ CSV lacks the data — not
-- a policy choice):
--   - amenities:          AZ pages have no amenity field at all
--   - operational_status: no explicit status field; 3/33 alerts are
--                         unstructured prose, not a status enum
--
-- Fields stored in normalized_payload only (no resolved column, no
-- precedence row): fees, advisories (alerts), summary, copyright,
-- slug, provenance.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('description', 'arizona_state_parks', 2),
  ('hours',       'arizona_state_parks', 3),
  ('contact',     'arizona_state_parks', 3);
