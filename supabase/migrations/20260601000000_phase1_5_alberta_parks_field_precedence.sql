-- Alberta Parks: 6 field_precedence rows scoped to Alberta provincial records.
-- Priority rule: shares priority 1 with NPS/Parks Canada/BC Parks for jurisdictional-
-- authority fields (canonical_name, description, geometry) where geographic disjointness
-- prevents ties from firing — Alberta provincial sites don't overlap with US federal,
-- Canadian federal, or BC provincial geography. For live-update fields (contact, hours,
-- amenities), takes next-unused priority to avoid non-deterministic resolution against
-- Google, which IS geographically present in Alberta.
--
-- Computed next-unused values (verify against live seed state at apply-time pre-flight):
--   contact: 7 (used 1-6 across base seed + PC + BC)
--   hours: 7 (same)
--   amenities: 7 (same)

INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name', 'alberta_parks', 1),
  ('description',    'alberta_parks', 1),
  ('geometry',       'alberta_parks', 1),
  ('contact',        'alberta_parks', 7),
  ('hours',          'alberta_parks', 7),
  ('amenities',      'alberta_parks', 7);
