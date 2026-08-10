-- ============================================================================
-- Six-state footprint (WA OR CA AZ NV UT) as a PostGIS geometry, plus a
-- read-only classification view over source_record.
--
-- WHY A FUNCTION AND NOT APP CODE
-- The prior scope pass classified rows by pulling every source_record into
-- Node and testing lng/lat from raw_payload/normalized_payload against JS
-- bboxes. That violates the stack invariant (spatial queries use PostGIS) and
-- it silently depended on a source-shape-aware coordinate extractor — rows
-- whose payload shape the extractor didn't recognise were classified on
-- whatever the fallback happened to be. source_record.geometry is the column
-- recompute_master_place already trusts for precedence; it is the honest
-- input, and PostGIS is the honest test.
--
-- WHAT THE POLYGONS ARE — AND ARE NOT
-- These are BBOXES, not true state polygons. No TIGER or state-boundary
-- dataset exists in this repo (PAD-US carries protected-area boundaries, not
-- state borders), so bboxes are the honest available approximation. Three
-- outer edges are drawn to the REAL border rather than to a rounded envelope,
-- because those are the edges where a rectangle admits another country:
--
--   1. WA NORTH-WEST — the load-bearing fix. A flat northern bound of 49.00
--      reaches across the Strait of Juan de Fuca and swallows Vancouver
--      Island, Victoria and the Gulf Islands, all of which sit SOUTH of the
--      49th parallel. The 49th parallel is the border only on the MAINLAND;
--      west of Point Roberts the border descends through Haro Strait into the
--      middle of the Strait of Juan de Fuca (~48.3). WA's northern edge below
--      follows that descent, so Victoria (-123.36, 48.43) falls OUTSIDE while
--      Port Angeles (-123.43, 48.12) and the San Juan Islands stay INSIDE.
--   2. CA SOUTH — the 1848 treaty line, a diagonal from the Pacific at
--      (-117.125, 32.534) to the Colorado at (-114.72, 32.718). A flat 32.53
--      admits Tijuana.
--   3. AZ SOUTH — the Gadsden line: west leg from the Colorado at
--      (-114.82, 32.494) down to (-112.90, 31.333), then east along 31.333.
--
-- Interior edges (CA/NV, NV/UT, WA/OR, …) are deliberately loose: both sides
-- are in scope, so overlap there costs nothing.
--
-- KNOWN RESIDUAL OVER-INCLUSION (measured, not assumed — see the session
-- report): the western edges extend into the Pacific (ocean, no records), and
-- OR's eastern bound of -116.45 overshoots the true border of -116.46 by
-- ~0.01 degrees. WA's eastern bound is set to -117.04, its true meridian
-- border, so the Idaho strip the earlier bbox set admitted is gone.
--
-- READ-ONLY. Creates a function and a view. Touches no data.
-- ============================================================================

set search_path = public;

create or replace function public.six_state_footprint()
returns geometry
language sql
immutable
parallel safe
as $$
  select st_setsrid(
    st_geomfromtext(
      'MULTIPOLYGON(' ||
      -- WA — northern edge follows the actual border, not a flat 49.00
      '((-124.85 45.54, -124.85 48.50, -123.25 48.28, -123.10 48.70,' ||
      '  -123.02 49.00, -117.04 49.00, -117.04 45.54, -124.85 45.54)),' ||
      -- OR
      '((-124.75 41.99, -124.75 46.30, -116.45 46.30, -116.45 41.99, -124.75 41.99)),' ||
      -- CA — southern edge is the 1848 treaty diagonal
      '((-124.50 42.01, -114.13 42.01, -114.13 32.72, -114.72 32.718,' ||
      '  -117.125 32.534, -124.50 32.534, -124.50 42.01)),' ||
      -- AZ — southern edge is the Gadsden line
      '((-114.82 37.00, -109.045 37.00, -109.045 31.333, -112.90 31.333,' ||
      '  -114.82 32.494, -114.82 37.00)),' ||
      -- NV
      '((-120.01 35.00, -120.01 42.00, -114.04 42.00, -114.04 35.00, -120.01 35.00)),' ||
      -- UT
      '((-114.05 37.00, -114.05 42.00, -109.04 42.00, -109.04 37.00, -114.05 37.00))' ||
      ')'
    ), 4326);
$$;

comment on function public.six_state_footprint() is
  'WA/OR/CA/AZ/NV/UT planning footprint as a MultiPolygon (SRID 4326). Bbox approximation; the three international edges (WA north-west, CA south, AZ south) follow the real border so the shape admits no Canadian or Mexican territory. Interior state edges are deliberately loose.';

-- Classification view. in_footprint is NULL when the row carries no geometry,
-- so "outside the footprint" and "unplaceable" stay distinguishable — a row
-- with no geometry must never be silently swept up in a scope trim.
create or replace view public.source_record_scope as
select
  sr.id,
  sr.source_id,
  sr.master_place_id,
  sr.is_active,
  case
    when sr.geometry is null then null
    else st_within(sr.geometry, public.six_state_footprint())
  end as in_footprint
from public.source_record sr;

comment on view public.source_record_scope is
  'Read-only scope classification for the six-state trim. in_footprint: true = inside, false = outside, NULL = row has no geometry (unplaceable, never auto-trimmed).';

revoke all on public.source_record_scope from anon, authenticated;
