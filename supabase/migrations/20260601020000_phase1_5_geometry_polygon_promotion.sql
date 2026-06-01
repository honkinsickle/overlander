-- geometry_polygon promotion for parks_canada, bc_parks, alberta_parks.
--
-- Prerequisite for Phase 3b polygon containment work. Currently only NPS has a
-- field_precedence row for geometry_polygon, so PC/BC/Alberta park polygons sit
-- in normalized_payload.geometry_polygon but never promote to master_place.geometry_polygon.
-- That blocks polygon-containment ER from finding amenities inside Canadian parks.
--
-- Priority assignments:
--   parks_canada = 1 (peer with NPS — federal jurisdictional authority, geographic disjointness makes the tie safe)
--   bc_parks     = 2 (provincial below federal, geographic disjointness from PC makes the tie-with-PC-and-NPS safe)
--   alberta_parks = 3 (third in the disjoint-safe Canadian sortation)
--
-- The 1/2/3 values among Canadian sources are arbitrary — the geographic disjointness
-- means ties never fire on real data, and the priority numbers exist only for tertiary-key
-- total ordering. The field_precedence PK on (field_name, source_id) is already enforced;
-- what was deferred per PR #67's design decisions is a hypothetical UNIQUE(field_name, priority)
-- constraint, so duplicate priorities across sources for the same field are not rejected
-- (which is exactly what lets nps=1 and parks_canada=1 coexist here). The numbers reflect a
-- rough "federal before provincial" intent, not real authority differences.

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('geometry_polygon', 'parks_canada',  1),
  ('geometry_polygon', 'bc_parks',      2),
  ('geometry_polygon', 'alberta_parks', 3);
