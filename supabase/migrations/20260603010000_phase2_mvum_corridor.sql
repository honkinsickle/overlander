-- ============================================================================
-- Phase 2 PR-C — MVUM corridor enrichment for dispersed_camping places.
--
-- Adds the `mvum_corridor` boolean signal (ADR 2026-06-02 legality model:
-- "optionally refined by an MVUM-corridor boolean"). A dispersed_camping
-- master_place is flagged `mvum_corridor=true` when its point lies within
-- 30 m of an open MVUM (Motor Vehicle Use Map) route — i.e. it sits on the
-- designated-open motorized network. MVP simplification: every MVUM segment
-- is treated as open (no per-vehicle-class / seasonal modeling — deferred per
-- ADR "no per-route/per-vehicle/seasonal MVUM modeling in this phase").
--
-- Three pieces:
--   1. `mvum_roads` reference table — corridor-scoped MVUM line geometry,
--      keyed by `rte_cn` (the stable FS route common number; NOT objectid /
--      globalid, which are per-build surrogates). A route may split into
--      several segments sharing one rte_cn, so geometry is MultiLineString
--      (the loader aggregates a route's segments into one row).
--   2. `upsert_mvum_road(rte_cn, geojson)` — idempotent loader RPC.
--   3. `master_place.mvum_corridor boolean` column + recompute wiring.
--
-- recompute_master_place body below is the LIVE function from migration
-- 20260602000000 (the latest recompute-touching migration; no recompute
-- change has landed since), reproduced verbatim with ONE added step
-- (Step 6.5) that sets mvum_corridor. Diff against `pg_get_functiondef`
-- on the target DB before applying if you want belt-and-suspenders.
--
-- ── CRITICAL: ::geography casts in the ST_DWithin are load-bearing. ──
-- On raw SRID-4326 geometry, ST_DWithin(a, b, 30) reads 30 as DEGREES
-- (~3300 km) and flags EVERY dispersed place. Cast both args to ::geography
-- so the threshold is METERS (30). If the wired flagged count comes back as
-- "all 45" (or 0), it's this units bug, not the data. Validation target:
-- ~11 of the 45 SB-NF dispersed places flag at 30 m.
--
-- APPLY-PATH: recompute_master_place is the SOLE writer of master_place →
-- FULL runbook (per CLAUDE.md / ADR 2026-06-02 implementation notes):
--   1. db:push-verify -- --test
--   2. Recycle PostgREST: NOTIFY pgrst, 'reload schema'  (AFTER the function
--      swap, BEFORE materialize — pooled backends otherwise keep executing the
--      OLD compiled recompute plan, reproducing the Phase-1 stale-pool failure)
--   3. materialize
--   4. Verify a sample dispersed row's mvum_corridor.
-- ============================================================================

set search_path = public;

-- 1. MVUM reference table. Search-excluded, non-place: never materializes to
--    master_place, never enters Typesense. Pure spatial reference data read by
--    recompute. rte_cn is the route common number — stable across builds,
--    unlike objectid/globalid. MultiLineString because a route's segments are
--    aggregated into one row by the loader.
create table if not exists public.mvum_roads (
  rte_cn    text primary key,
  geom      geometry(MultiLineString, 4326) not null,
  loaded_at timestamptz not null default now()
);

create index if not exists mvum_roads_geom_gist
  on public.mvum_roads using gist (geom);

comment on table public.mvum_roads is
  'Phase 2 PR-C: corridor-scoped MVUM open-route line geometry (USFS EDW EDW_MVUM_01 layer 1). Keyed by rte_cn (stable route common number). Reference data for the dispersed_camping mvum_corridor signal — search-excluded, never a master_place. MVP: all segments treated as open.';

-- 2. Idempotent route upsert. Accepts a MultiLineString (or LineString,
--    coerced) GeoJSON. ST_SetSRID stamps 4326. on conflict → replace geom
--    (corridor reloads are idempotent within a bbox).
create or replace function public.upsert_mvum_road(p_rte_cn text, p_geojson jsonb)
returns text
language plpgsql
volatile
as $$
declare
  v_geom geometry;
begin
  v_geom := st_setsrid(st_geomfromgeojson(p_geojson::text), 4326);
  if st_geometrytype(v_geom) = 'ST_LineString' then
    v_geom := st_multi(v_geom);
  end if;
  insert into public.mvum_roads (rte_cn, geom, loaded_at)
  values (p_rte_cn, v_geom, now())
  on conflict (rte_cn) do update
    set geom = excluded.geom, loaded_at = now();
  return p_rte_cn;
end;
$$;

-- 3. Additive column. Nullable, default NULL: the concept only applies to
--    dispersed_camping places (NULL = not-applicable for every other
--    category). No existing row's search/display semantics change.
alter table public.master_place
  add column if not exists mvum_corridor boolean;

comment on column public.master_place.mvum_corridor is
  'Phase 2 PR-C: true if a dispersed_camping place is within 30 m of an open MVUM route (set in recompute_master_place); NULL for non-dispersed categories. MVP — 30 m is a GIS-line proximity heuristic, NOT the legal distance (per-forest, in each forest MVUM order). Always paired with verify_locally.';

-- 4. recompute_master_place: LIVE body (20260602000000) verbatim + Step 6.5.
create or replace function public.recompute_master_place(p_master_place_id uuid)
returns void
language plpgsql
volatile
as $$
declare
  -- The 11 JSONB-resolved fields. geometry + geometry_polygon get separate
  -- code paths below since they're PostGIS types, not JSONB.
  v_jsonb_fields text[] := array[
    'canonical_name', 'primary_category', 'description',
    'amenities', 'hours', 'contact', 'access', 'services',
    'capacity', 'seasonality', 'cell_signal'
  ];
  -- Fields that go into TEXT columns (need jsonb→text extraction).
  v_text_columns text[] := array['canonical_name', 'primary_category', 'description'];

  v_field         text;
  v_resolved      jsonb;
  v_value         jsonb;
  v_source        text;
  v_attribution   jsonb := '{}'::jsonb;
  v_source_count  integer;

  v_geom            geometry;
  v_geom_source     text;
  v_polygon_geojson jsonb;
  v_polygon_source  text;
  v_polygon         geometry;
begin
  -- Step 1: UNION-aggregated fields.
  perform public.recompute_aggregated_fields(p_master_place_id);

  -- Step 2: source_count snapshot.
  select count(*)
    into v_source_count
  from public.source_record
  where master_place_id = p_master_place_id and is_active = true;

  -- Step 3: JSONB-resolved fields. resolve_field returns {value, source}.
  -- Skip if no source provided a value. Build the attribution map as we go.
  foreach v_field in array v_jsonb_fields loop
    v_resolved := public.resolve_field(p_master_place_id, v_field);
    v_value    := v_resolved -> 'value';
    v_source   := v_resolved ->> 'source';

    if v_value is not null and v_value != 'null'::jsonb then
      v_attribution := v_attribution || jsonb_build_object(v_field, v_source);

      if v_field = any(v_text_columns) then
        -- TEXT columns: extract jsonb scalar to text via `#>>'{}'`.
        execute format(
          'update public.master_place set %I = $1 where id = $2',
          v_field
        ) using (v_value #>> '{}'), p_master_place_id;
      else
        -- JSONB columns: store as-is.
        execute format(
          'update public.master_place set %I = $1 where id = $2',
          v_field
        ) using v_value, p_master_place_id;
      end if;
    end if;
  end loop;

  -- Step 4: geometry (PostGIS Point) — read source_record.geometry directly,
  -- not from normalized_payload. Precedence comes from the 'geometry' rows
  -- in field_precedence.
  select sr.geometry, sr.source_id
    into v_geom, v_geom_source
  from public.source_record sr
  join public.field_precedence fp
    on fp.source_id = sr.source_id
   and fp.field_name = 'geometry'
  where sr.master_place_id = p_master_place_id
    and sr.is_active = true
    and sr.geometry is not null
  order by fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc
  limit 1;

  if v_geom is not null then
    update public.master_place set geometry = v_geom where id = p_master_place_id;
    v_attribution := v_attribution || jsonb_build_object('geometry', v_geom_source);
  end if;

  -- Step 5: geometry_polygon (PostGIS MultiPolygon). Stored as GeoJSON in
  -- source_record.normalized_payload.geometry_polygon (the NPS ingester
  -- writes it there from the /mapdata/parkboundaries endpoint).
  --
  -- Convert via ST_GeomFromGeoJSON, coerce Polygon → MultiPolygon, set SRID
  -- to 4326. Wrap in a sub-block so malformed GeoJSON doesn't fail the whole
  -- recompute.
  select sr.normalized_payload -> 'geometry_polygon', sr.source_id
    into v_polygon_geojson, v_polygon_source
  from public.source_record sr
  join public.field_precedence fp
    on fp.source_id = sr.source_id
   and fp.field_name = 'geometry_polygon'
  where sr.master_place_id = p_master_place_id
    and sr.is_active = true
    and sr.normalized_payload -> 'geometry_polygon' is not null
    and jsonb_typeof(sr.normalized_payload -> 'geometry_polygon') = 'object'
  order by fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc
  limit 1;

  if v_polygon_geojson is not null then
    begin
      v_polygon := st_geomfromgeojson(v_polygon_geojson::text);
      if st_geometrytype(v_polygon) = 'ST_Polygon' then
        v_polygon := st_multi(v_polygon);
      end if;
      v_polygon := st_setsrid(v_polygon, 4326);
      update public.master_place
         set geometry_polygon = v_polygon
       where id = p_master_place_id;
      v_attribution := v_attribution || jsonb_build_object('geometry_polygon', v_polygon_source);
    exception when others then
      raise warning
        'recompute_master_place: geometry_polygon conversion failed for %: %',
        p_master_place_id, sqlerrm;
    end;
  end if;

  -- Step 6: metadata + prominence.
  -- is_searchable derived from the resolved primary_category. land_status →
  -- excluded from search; everything else (incl. a NULL category, via
  -- `is distinct from`) stays searchable.
  update public.master_place set
    attribution      = v_attribution,
    source_count     = v_source_count,
    prominence_score = public.compute_prominence(p_master_place_id),
    last_resolved_at = now(),
    is_searchable    = (primary_category is distinct from 'land_status')
  where id = p_master_place_id;

  -- Step 6.5 (Phase 2 PR-C): mvum_corridor for dispersed_camping places.
  -- A dispersed place within 30 m of an open MVUM route sits on the
  -- designated-open motorized network → mvum_corridor=true. NULL for every
  -- other category (the concept doesn't apply). Runs after Step 3 has
  -- resolved primary_category and Step 4 has set geometry.
  --
  -- ::geography casts → ST_DWithin distance is METERS. WITHOUT them the 30 is
  -- DEGREES (~3300 km) and flags everything (the documented units trap).
  -- 30 m is a GIS-line proximity heuristic flagged as an MVP simplification —
  -- the legal distance is per-forest (each forest's MVUM order), not the line.
  -- At corridor scale mvum_roads is small (~300 rows); the geography distance
  -- seq-scans it. National fill should add a geography GiST index / degree
  -- prefilter to use the index.
  update public.master_place mp
     set mvum_corridor = case
       when mp.primary_category = 'dispersed_camping' then exists (
         select 1
           from public.mvum_roads r
          where st_dwithin(mp.geometry::geography, r.geom::geography, 30)
       )
       else null
     end
   where mp.id = p_master_place_id;

  -- Step 7: containment relationships (Phase 3b polygon containment).
  -- Rewrite this master_place's contained_in edges in both roles it can play.
  -- Stateless delete-then-reinsert per role → geometry changes (polygon
  -- grow/shrink, point move) converge to the correct edge set (see the
  -- design-refinement note in this migration's header).

  -- (a) child role: this place contained_in any park whose polygon covers
  --     its point. Runs for every master_place (amenity or nested park).
  delete from public.place_relationships
   where child_master_place_id = p_master_place_id
     and relationship_type = 'contained_in';

  insert into public.place_relationships
    (child_master_place_id, parent_master_place_id, relationship_type)
  select s.id, p.id, 'contained_in'
  from public.master_place s
  join public.master_place p
    on p.id <> s.id
   and p.geometry_polygon is not null
   and st_covers(p.geometry_polygon, s.geometry)
  where s.id = p_master_place_id
  on conflict (child_master_place_id, parent_master_place_id, relationship_type) do nothing;

  -- (b) parent role: every master_place whose point this polygon covers
  --     becomes contained_in it. Only fires when this place has a polygon.
  if (select geometry_polygon is not null
        from public.master_place
       where id = p_master_place_id) then
    delete from public.place_relationships
     where parent_master_place_id = p_master_place_id
       and relationship_type = 'contained_in';

    insert into public.place_relationships
      (child_master_place_id, parent_master_place_id, relationship_type)
    select c.id, p.id, 'contained_in'
    from public.master_place p
    join public.master_place c
      on c.id <> p.id
     and st_covers(p.geometry_polygon, c.geometry)
    where p.id = p_master_place_id
    on conflict (child_master_place_id, parent_master_place_id, relationship_type) do nothing;
  end if;
end;
$$;
