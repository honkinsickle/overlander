-- ============================================================================
-- Seed field_precedence with rules extracted from the JT 3-way overlap data.
--
-- Derivation: Joshua Tree NP smoke test on 2026-05-27 produced 6 3-way matches
-- (NPS + RIDB + OSM) on bookable federal campgrounds, plus single-source
-- and 2-way data points across 207 source_records. The rules below encode
-- the observed authority pattern per field.
--
-- Special cases (NOT in this table — handled in recompute_master_place()):
--   - alternative_names, secondary_categories, overlander_tags: UNION across
--     all linked source_records, not precedence-resolved.
--   - canonical_name from RIDB: requires Title-Case normalization at ingest
--     time (handled in normalize.ts for the ridb source).
--
-- Priority semantics: LOWER number = HIGHER priority. resolve_field() picks
-- the linked source_record with the lowest priority that has a non-null
-- value for the field.
-- ============================================================================

INSERT INTO field_precedence (field_name, source_id, priority) VALUES

  -- canonical_name: NPS > Google > RIDB > iOverlander > OSM
  -- NPS has the canonical clean names. RIDB needs Title-Case normalization.
  -- OSM is last because of frequent "Unnamed X" and campsite-number names.
  ('canonical_name', 'nps',         1),
  ('canonical_name', 'google',      2),
  ('canonical_name', 'ridb',        3),
  ('canonical_name', 'ioverlander', 4),
  ('canonical_name', 'osm',         5),

  -- primary_category: NPS > Google > RIDB > OSM > iOverlander
  -- NPS taxonomy is most precise for federal places. Google is comprehensive
  -- for businesses. RIDB has 3 broad buckets only.
  ('primary_category', 'nps',         1),
  ('primary_category', 'google',      2),
  ('primary_category', 'ridb',        3),
  ('primary_category', 'osm',         4),
  ('primary_category', 'ioverlander', 5),

  -- geometry (point): NPS > RIDB > Google > iOverlander > OSM
  -- NPS/RIDB at 0m for federal campgrounds; NPS wins on tie (authority).
  -- OSM last because campground nodes often placed at sub-features.
  ('geometry', 'nps',         1),
  ('geometry', 'ridb',        2),
  ('geometry', 'google',      3),
  ('geometry', 'ioverlander', 4),
  ('geometry', 'osm',         5),

  -- geometry_polygon: NPS only. No fallback.
  ('geometry_polygon', 'nps', 1),

  -- description: NPS > RIDB > Google > iOverlander > OSM
  ('description', 'nps',         1),
  ('description', 'ridb',        2),
  ('description', 'google',      3),
  ('description', 'ioverlander', 4),
  ('description', 'osm',         5),

  -- amenities: iOverlander > RIDB > NPS > Google
  -- OSM intentionally excluded — amenity nodes roll up via ER (matcher.ts
  -- amenity-rollup path), not via field_precedence.
  ('amenities', 'ioverlander', 1),
  ('amenities', 'ridb',        2),
  ('amenities', 'nps',         3),
  ('amenities', 'google',      4),

  -- hours: Google > NPS > RIDB > OSM > iOverlander
  -- Google owner-managed, refreshed daily. NPS/RIDB official but slower.
  ('hours', 'google',      1),
  ('hours', 'nps',         2),
  ('hours', 'ridb',        3),
  ('hours', 'osm',         4),
  ('hours', 'ioverlander', 5),

  -- contact (phone, website, email): Google > NPS > RIDB > OSM > iOverlander
  ('contact', 'google',      1),
  ('contact', 'nps',         2),
  ('contact', 'ridb',        3),
  ('contact', 'osm',         4),
  ('contact', 'ioverlander', 5),

  -- access (road_type, vehicle_suitability, fees, reservations): iOverlander > RIDB > NPS > OSM > Google
  ('access', 'ioverlander', 1),
  ('access', 'ridb',        2),
  ('access', 'nps',         3),
  ('access', 'osm',         4),
  ('access', 'google',      5),

  -- services (fuel_type, ev_charging, propane): Google > iOverlander > OSM > RIDB > NPS
  ('services', 'google',      1),
  ('services', 'ioverlander', 2),
  ('services', 'osm',         3),
  ('services', 'ridb',        4),
  ('services', 'nps',         5),

  -- capacity (sites_total, sites_reservable, max_rig_length): RIDB > NPS > iOverlander > OSM
  ('capacity', 'ridb',        1),
  ('capacity', 'nps',         2),
  ('capacity', 'ioverlander', 3),
  ('capacity', 'osm',         4),

  -- seasonality (open_year_round, season_start, season_end): RIDB > NPS > Google > iOverlander > OSM
  ('seasonality', 'ridb',        1),
  ('seasonality', 'nps',         2),
  ('seasonality', 'google',      3),
  ('seasonality', 'ioverlander', 4),
  ('seasonality', 'osm',         5),

  -- cell_signal: iOverlander only.
  ('cell_signal', 'ioverlander', 1);
