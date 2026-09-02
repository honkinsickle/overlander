-- Rename two source_ids to match the per-state convention used by
-- oregon_state_parks / nevada_state_parks / arizona_state_parks / utah_state_parks:
--
--   state_parks_web     → california_state_parks
--   state_parks_web_wa  → washington_state_parks
--
-- This is a pure identifier rename. It was verified NOT to change any resolved
-- field value before being written: resolve_field() orders by
--   fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc
-- so source_id is only the THIRD key, and a simulation over every affected
-- master_place found ZERO field-resolutions where any co-linked source ties
-- these two on both priority and quality — the source_id key is never reached.
-- That simulation was validated against master_place.attribution first
-- (TEST 1138/1138 + 560/560, PROD 1023/1023 exact agreement) so it reproduces
-- the present before predicting the future.
-- See data/scripts/source-id-rename-tiebreak-sim.ts.
--
-- external_id is renamed TOO, which the original plan did not call for. Every
-- affected row's external_id begins with the old source name
-- (`state_parks_web:<page_id>`, `state_parks_web_wa:<slug>`) and the ingesters
-- build it from SOURCE_ID. Renaming source_id alone would mean the next ingest
-- writes `california_state_parks:<page_id>`, which collides with nothing and so
-- INSERTS A DUPLICATE of every row rather than upserting — breaking the
-- "idempotent on (source_id, external_id)" invariant. The ingesters are updated
-- in the same commit.
--
-- place_match.resolved_by stamps are renamed for the same consistency reason
-- (`auto:state_parks_web_er` → `auto:california_state_parks_er`).
--
-- Deliberately NOT touched: park data, ER outcomes, place_match status, and the
-- pending manual-review decisions. Row counts must be identical afterwards.

set search_path = public;

-- 1. source_record — source_id and the external_id prefix, together.
update public.source_record
   set source_id   = 'california_state_parks',
       external_id = 'california_state_parks:' || substring(external_id from length('state_parks_web:') + 1)
 where source_id = 'state_parks_web';

update public.source_record
   set source_id   = 'washington_state_parks',
       external_id = 'washington_state_parks:' || substring(external_id from length('state_parks_web_wa:') + 1)
 where source_id = 'state_parks_web_wa';

-- 2. field_precedence.
update public.field_precedence set source_id = 'california_state_parks' where source_id = 'state_parks_web';
update public.field_precedence set source_id = 'washington_state_parks' where source_id = 'state_parks_web_wa';

-- 3. place_match.resolved_by stamps written by the ER scripts.
update public.place_match set resolved_by = 'auto:california_state_parks_er' where resolved_by = 'auto:state_parks_web_er';
update public.place_match set resolved_by = 'auto:washington_state_parks_er' where resolved_by = 'auto:state_parks_web_wa_er';
