-- ============================================================================
-- state_boundaries — real per-state polygon geometry, replacing the ad-hoc
-- bounding-box state classifier used throughout the 2026-08-21 session.
--
-- WHY. docs/measurements/2026-08-21-state-boundary-bug-blast-radius.md
-- found 2,779 corpus-wide state-assignment errors under the bbox method
-- (79% traced to Nevada's box alone, median 49.4 miles off the true
-- border, worst case ~113 miles into California). Root cause, confirmed
-- not assumed: Nevada's real bounding ENVELOPE nearly matches its box
-- exactly — the defect isn't size, it's shape. Nevada's true border is
-- diagonal/notched (following roughly the Sierra Nevada crest down to the
-- Colorado River), so no axis-aligned rectangle can fit it without either
-- cutting off real Nevada or swallowing a neighbor. This applies to
-- varying degrees to all six states this corpus covers — this migration
-- replaces the bbox approach entirely, not just for Nevada.
--
-- DATA SOURCE. US Census Bureau TIGER/Line 2023 national state boundary
-- file (https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip)
-- — full-resolution TIGER/Line, not the generalized 500k cartographic
-- boundary product (deliberately: this fix should not trade one
-- approximation for a lighter one). US Census Bureau data is a work of
-- the US federal government (17 U.S.C. §105) — public domain, no license
-- restriction. Converted shapefile -> GeoJSON via ogr2ogr (GDAL, already
-- present on this machine — no new npm dependency), reprojected to
-- EPSG:4326 to match this corpus's existing geometry SRID. Loaded via
-- the load_state_boundary_geom() RPC below (geometry conversion kept
-- server-side, mirroring the existing geometry_polygon handling in
-- recompute_master_place — st_geomfromgeojson + st_multi + st_setsrid).
--
-- SCOPE: the six states this corpus's ingestion targets (CA, AZ, NV, UT,
-- WA, OR). Idaho and other neighbors are NOT loaded — a point that's
-- genuinely in Idaho (or anywhere outside these six) correctly resolves
-- to NULL from resolve_state(), not forced into one of the six. See §7
-- of the fix report for how many rows this affects.
-- ============================================================================

set search_path = public;

create table public.state_boundaries (
  state_code text primary key,       -- 'CA', 'AZ', 'NV', 'UT', 'WA', 'OR'
  state_name text not null,
  geom geometry(MultiPolygon, 4326) not null
);

create index state_boundaries_geom_idx on public.state_boundaries using gist (geom);

alter table public.state_boundaries enable row level security;
-- Zero write policies (service-role only, matches every other corpus
-- reference table). A read policy is added since this is reference
-- geometry, not corpus content — safe for any role to read.
create policy state_boundaries_public_read on public.state_boundaries
  for select using (true);

comment on table public.state_boundaries is
  'Real per-state boundary polygons (US Census TIGER/Line 2023, full resolution), for the six states this corpus targets. Replaces the ad-hoc bounding-box state classifier used in session scripts before 2026-08-21 — see docs/measurements/2026-08-21-state-boundary-bug-blast-radius.md.';

-- Loader RPC: keeps the GeoJSON -> PostGIS geometry conversion server-side,
-- the same pattern recompute_master_place already uses for
-- geometry_polygon. Idempotent (upsert on state_code) so a re-run of the
-- loading script doesn't duplicate rows.
create or replace function public.load_state_boundary_geom(
  p_state_code text,
  p_state_name text,
  p_geojson jsonb
)
returns void
language plpgsql
as $$
declare
  v_geom geometry;
begin
  v_geom := st_geomfromgeojson(p_geojson::text);
  if st_geometrytype(v_geom) = 'ST_Polygon' then
    v_geom := st_multi(v_geom);
  end if;
  v_geom := st_setsrid(v_geom, 4326);

  insert into public.state_boundaries (state_code, state_name, geom)
  values (p_state_code, p_state_name, v_geom)
  on conflict (state_code) do update set
    state_name = excluded.state_name,
    geom = excluded.geom;
end;
$$;

comment on function public.load_state_boundary_geom(text, text, jsonb) is
  'One-time data-loading RPC for state_boundaries. Not part of any ongoing pipeline — called once by data/scripts/load-state-boundaries-2026-08-21.ts.';

-- resolve_state(): the replacement for the ad-hoc bbox classifier.
-- Real point-in-polygon via ST_Contains, not another rectangle. Returns
-- NULL (not a guess) when the point falls outside all six loaded state
-- boundaries — callers must handle NULL explicitly, matching the "flag
-- rather than force" instruction for unresolvable rows.
create or replace function public.resolve_state(p_geom geometry)
returns text
language sql
stable
parallel safe
as $$
  select state_code
  from public.state_boundaries
  where st_contains(geom, p_geom)
  limit 1;
$$;

comment on function public.resolve_state(geometry) is
  'Real point-in-polygon state resolution against state_boundaries (US Census TIGER/Line). Returns NULL when the point is outside all six loaded states — never forces an assignment. Replaces the ad-hoc bounding-box classifyState() copied across 2026-08-21 session scripts.';

-- master_place.state — added for this fix pass's backfill so before/after
-- is a real, queryable snapshot, not just a one-off script's console
-- output. Nullable (some rows are genuinely outside all six states, or
-- not yet backfilled). Deliberately NOT wired into recompute_master_place
-- in this migration — that would make state a first-class recomputed
-- field alongside geometry/category/etc., which is a bigger, ongoing-
-- pipeline decision this task didn't ask for and CLAUDE.md's schema
-- invariants caution against making unprompted. This column is a
-- point-in-time backfill snapshot; a future session would need to decide
-- whether to wire it into recompute so new/moved rows stay current.
alter table public.master_place add column if not exists state text;

comment on column public.master_place.state is
  'Real state assignment (US Census TIGER/Line via resolve_state()), backfilled 2026-08-21. NOT auto-recomputed by recompute_master_place — a one-time backfill snapshot, not a live-maintained field. NULL = genuinely outside the six states this corpus targets, or not yet backfilled.';
