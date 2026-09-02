-- field_precedence for the `oregon_state_parks` source (stateparks.oregon.gov visitor content).
--
-- Per-state source_id, separate from CA's `state_parks_web` and WA's
-- `state_parks_web_wa`. Same priority tiers as CA/WA — independent
-- rows, not shared.
--
-- Description: priority 2 (alongside USFS/RIDB, below NPS).
-- Amenities: priority 5 (between Google and OSM).
-- Operational status: priority 2 (below USFS at 1). OR has three explicit
--   status values (Open / Reduction in Services/Facilities / Temporarily
--   Closed); the ingester writes only the non-Open values as
--   RESTRICTED / CLOSED.
--
-- Fields intentionally WITHOUT rows here (OR CSV lacks the data — not a
-- policy choice):
--   - hours:  OR has no dedicated hours column in the source data
--   - contact: OR has no phone/address column (some numbers appear inside
--              description prose, but extracting them is out of scope for
--              this ingester)
--
-- Fields stored in normalized_payload only (no resolved column, no
-- precedence row): overnight, reservable, first_come, day_use_fee,
-- reservation_url, history, accessible, park_id, photo caption/count.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('description',        'oregon_state_parks', 2),
  ('amenities',          'oregon_state_parks', 5),
  ('operational_status', 'oregon_state_parks', 2);
