-- Phase 2 PR-A — USFS field_precedence (dispersed-camping source).
--
-- field_precedence INSERTs ONLY. No function replacement, no schema/column
-- change. So the Phase-1 stale-pooled-function and PostgREST-schema-cache
-- failure modes do NOT apply here: recompute_master_place reads
-- field_precedence at call time, and row inserts don't touch the PostgREST
-- schema cache. Apply ceremony is therefore light: db:push-verify (to dodge
-- the silent-skip class) + confirm the rows landed. No PostgREST recycle.
--
-- USFS-over-OSM default for a federated dispersed site (USFS is the federal
-- authority for its rec sites; OSM is community data). Priorities sit above
-- OSM (canonical_name/description/geometry osm=5/5/5) and peer the federal
-- rec source RIDB where applicable; ties resolve via the 4a tertiary
-- tie-breaker (source_quality_score DESC, source_id ASC).
--
-- NOTE (revisit per PR-A report): canonical_name USFS-over-OSM is provisional.
-- USFS names are often the bureaucratic recarea name ("…Campground",
-- "Dispersed Camping Area N"); OSM may carry the colloquial known name, which
-- can be the better user-facing card title. If the merged-sample eyeball shows
-- USFS surfacing worse names than OSM, lower canonical_name usfs below osm.
-- geometry/description USFS-over-OSM is fine regardless.

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name', 'usfs', 3),
  ('geometry',       'usfs', 2),
  ('description',    'usfs', 2);
