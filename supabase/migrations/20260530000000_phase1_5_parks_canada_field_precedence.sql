-- ============================================================================
-- Phase 1.5 — Parks Canada field_precedence
--
-- Six rows seeding Parks Canada's authority per field, structured per the
-- "P2" design from the 2026-05-30 ER discussion:
--
--   Parks Canada and NPS share priority 1 for the three fields where they
--   have authoritative jurisdiction (canonical_name, description, geometry).
--   Collisions are operationally safe — geographic disjointness prevents
--   both sources from contributing to the same master_place, so the
--   resolve_field() tie (currently ORDER BY priority LIMIT 1, no secondary
--   key) never triggers in practice.
--
--   For fields with live-update value (contact, hours, amenities), Parks
--   Canada sits below sources with currency advantages — Google for contact
--   and hours, iOverlander/RIDB/NPS/Google for amenities. parks_canada=3
--   (hours) and parks_canada=5 (amenities) keep the unique-priority-per-
--   field convention intact.
--
-- See data/entity-resolution/README.md "Ingestion follow-ups from Parks
-- Canada integration" + the queued field_precedence-determinism PR for the
-- ORDER BY tie-breaker + UNIQUE (field_name, priority) follow-up.
-- ============================================================================

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name', 'parks_canada', 1),
  ('description',    'parks_canada', 1),
  ('geometry',       'parks_canada', 1),
  ('contact',        'parks_canada', 2),
  ('hours',          'parks_canada', 3),
  ('amenities',      'parks_canada', 5);
