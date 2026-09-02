-- field_precedence for the `nevada_state_parks` source (parks.nv.gov visitor content).
--
-- Per-state source_id, following the OR precedent (`oregon_state_parks`).
-- Same priority tier as CA/WA/OR for description.
--
-- Description: priority 2 (alongside USFS/RIDB/OR, below NPS).
--
-- Fields intentionally WITHOUT rows here (NV data lacks the field
-- entirely — not a policy choice):
--   - hours:              column present in the source JSON but 0/28 populated
--                         ("No Hours section on these pages" per the upstream
--                         README).
--   - contact:            column present in the source JSON but 0/28 populated.
--   - amenities:          no amenities column in the source data.
--   - operational_status: no status column in the source data.
--
-- Fields deferred to a future re-scrape (upstream scraper bug — see BACKLOG.md):
--   - fees: 28/28 populated but with the site nav-menu string, not real
--     fee amounts. Raw text parked in normalized_payload.provenance.fees_raw
--     as a marker for the follow-up scrape; never surfaced.
--
-- Fields stored in normalized_payload only (no resolved column, no
-- precedence row): advisories (residual after statewide-banner strip),
-- slug, provenance.photo_source.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('description', 'nevada_state_parks', 2);
