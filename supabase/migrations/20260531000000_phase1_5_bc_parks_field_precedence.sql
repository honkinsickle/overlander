-- ============================================================================
-- Phase 1.5 — BC Parks field_precedence
--
-- Six rows seeding BC Parks' authority per field. BC Parks is the
-- provincial authority for British Columbia's protected areas — one tier
-- below Parks Canada (federal) in the Canadian jurisdiction hierarchy.
--
--   Jurisdictional-authority fields (canonical_name, description,
--   geometry): BC Parks shares priority 1 with NPS and Parks Canada.
--   The ties are operationally safe via geographic / jurisdictional
--   disjointness — a single physical place is provincial OR federal OR
--   US, never two at once, so no master_place ever carries both a
--   bc_parks and an nps / parks_canada source_record. resolve_field()'s
--   current `ORDER BY priority LIMIT 1` (no secondary key) therefore
--   never has to break a bc_parks priority-1 tie in practice.
--
--   Live-update fields (contact, hours, amenities): BC Parks takes the
--   next-unused priority (6) rather than tying a source it is NOT
--   geographically disjoint from. Google (contact=1, hours=1) covers BC,
--   so a tie there WOULD fire on real BC-park master_places and resolve
--   non-deterministically. next-unused keeps Google's fresher live
--   channel ahead of BC Parks and preserves the unique-priority-per-field
--   convention against every non-disjoint source.
--
-- geometry_polygon is intentionally NOT seeded here, matching the Parks
-- Canada migration (which also omitted it). BC park boundary polygons
-- stay in normalized_payload.geometry_polygon and do not yet promote to
-- master_place.geometry_polygon (only nps is in that precedence row). See
-- data/entity-resolution/README.md "geometry_polygon promotion for
-- provincial/federal boundaries" — a shared parks_canada + bc_parks
-- follow-up, not BC-Parks-specific.
--
-- See data/entity-resolution/README.md + the queued field_precedence-
-- determinism PR (resolve_field secondary tie-breaker + UNIQUE
-- (field_name, priority)) for the determinism follow-ups. That UNIQUE
-- constraint will first have to resolve the pre-existing geo-safe
-- priority-1 ties (nps / parks_canada / bc_parks) documented above.
-- ============================================================================

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name', 'bc_parks', 1),
  ('description',    'bc_parks', 1),
  ('geometry',       'bc_parks', 1),
  ('contact',        'bc_parks', 6),
  ('hours',          'bc_parks', 6),
  ('amenities',      'bc_parks', 6);
