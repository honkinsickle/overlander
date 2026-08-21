-- field_precedence for the `state_parks` source (state-managed park GIS).
--
-- Identity fields: priority 4 (below nps/google/ridb/usfs at 1-3, above OSM
-- at 5). At priority 4, state_parks may tie with existing community sources on
-- some fields; ties are broken by source_quality_score (state_parks 0.7 > OSM
-- 0.4).
--
-- Sparse operational fields: appended at next-unused priority so state_parks
-- can fill these when it is the only source with data (e.g. AZ campsite
-- amenities) without ever outranking a richer/live source.
--
-- hours, contact, services, cell_signal: NO ROWS — state park GIS layers do
-- not carry structured data for these fields.
--
-- description: NO ROW — descriptions will come from a future visitor-website
-- source (state_parks_web, pending a separate investigation), not from this
-- GIS source.

INSERT INTO public.field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name',   'state_parks', 4),
  ('primary_category', 'state_parks', 4),
  ('geometry',         'state_parks', 4),
  ('geometry_polygon', 'state_parks', 4),
  ('amenities',        'state_parks', 8),
  ('access',           'state_parks', 6),
  ('capacity',         'state_parks', 5),
  ('seasonality',      'state_parks', 6);
