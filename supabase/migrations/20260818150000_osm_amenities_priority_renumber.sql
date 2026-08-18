-- ============================================================================
-- Phase 1 — OSM amenities field_precedence: resolve the priority collision
--
-- TEST-ONLY migration. Apply via `npm run -w data db:push-verify -- --test`.
-- Do NOT apply to PROD without a separate, deliberate authorization.
--
-- 20260818140000_osm_amenities_field_precedence.sql set OSM's amenities
-- priority to 5, checked only against the original seed file
-- (20260527121000_phase1_seed_field_precedence.sql, which had exactly four
-- amenities rows: ioverlander=1, ridb=2, nps=3, google=4). Not grepped at
-- design time: 20260530000000_phase1_5_parks_canada_field_precedence.sql
-- already added `('amenities', 'parks_canada', 5)`. OSM's 5 collides with
-- it.
--
-- Confirmed harmless in practice (queried TEST directly, 2026-08-18): zero
-- active source_records exist for parks_canada, bc_parks, or alberta_parks
-- on TEST today, so the collision cannot manifest. And even if it could,
-- parks_canada's source_quality_score (0.95) beats OSM's (0.4,
-- data/ingestion/sources/osm.ts:25) on any tie, so OSM could never win an
-- override against it regardless.
--
-- Fixing anyway because it violates a documented convention, not because it
-- was observed to misbehave. The parks_canada migration's own comment is
-- explicit: "parks_canada=3 (hours) and parks_canada=5 (amenities) keep the
-- unique-priority-per-field convention intact" — every amenities source
-- added since has followed that convention (bc_parks=6, alberta_parks=7).
-- OSM should have taken the next unused number, 8, not reused 5.
--
-- Full current amenities ladder, confirmed by direct query immediately
-- before writing this migration (2026-08-18): ioverlander=1, ridb=2, nps=3,
-- google=4, parks_canada=5, osm=5, bc_parks=6, alberta_parks=7. No row at 8.
--
-- UPDATE, not INSERT — field_precedence's primary key is
-- (field_name, source_id), so the OSM row already exists from the prior
-- migration; this renumbers it in place. This is a pure priority change:
-- OSM was already numerically below every other real (non-collided)
-- amenities source, and after this it still is — nothing about which
-- sources OSM can/cannot override changes, only the collision goes away.
-- ============================================================================

set search_path = public;

update field_precedence
   set priority = 8
 where field_name = 'amenities'
   and source_id = 'osm';
