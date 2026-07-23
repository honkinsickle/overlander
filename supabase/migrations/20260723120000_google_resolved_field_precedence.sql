-- field_precedence for the `google_resolved` feedback source (spec §8.3, the
-- tier-2 live-resolve write-back class distinct from the rich `google` source).
--
-- google_resolved records are THIN — name + category + coords only (written by
-- web/src/lib/itinerary/ingest.ts, whose normalized_payload carries only
-- canonical_name + primary_category). They must LOSE to every pipeline source
-- on every field they can supply. Priority 90 is far below all seeded sources
-- (1-5), so any co-linked pipeline source always wins; google_resolved only
-- resolves a field when it is the SOLE source on a master_place — which is
-- exactly when its attribution must still be recorded (otherwise a solo
-- live-resolved place promotes with attribution '{}', violating the
-- "never display a field without its attribution" invariant).
--
-- Priority semantics (see 20260527121000): LOWER number = HIGHER priority.

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name',   'google_resolved', 90),
  ('primary_category', 'google_resolved', 90),
  ('geometry',         'google_resolved', 90);
