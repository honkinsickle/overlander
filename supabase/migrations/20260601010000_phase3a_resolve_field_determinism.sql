-- ============================================================================
-- Phase 3a — field_precedence resolution determinism (4a)
--
-- resolve_field() and the two geometry resolution queries in
-- recompute_master_place() previously ordered only by `fp.priority ASC LIMIT 1`.
-- With no secondary key, a priority *collision* (two linked source_records at
-- the same priority for a field, both with a non-null value) resolves to an
-- arbitrary Postgres-chosen row.
--
-- The seed deliberately shares priorities across geographically-disjoint
-- jurisdictional sources (nps + parks_canada + bc_parks + alberta_parks all at
-- priority 1 for canonical_name / description / geometry; nps + parks_canada at
-- contact=2; parks_canada + ridb at hours=3). Those collisions are safe today
-- ONLY because disjointness means the colliding sources never co-link to one
-- master_place — nothing enforces determinism if that assumption ever breaks
-- (a data error, or a future non-disjoint source seeded at a shared priority).
--
-- This migration makes resolution a total deterministic order with a 3-key
-- tie-breaker applied to all three resolution sites:
--     ORDER BY fp.priority ASC,
--              sr.source_quality_score DESC NULLS LAST,
--              sr.source_id ASC
--   1. priority ASC                  — unchanged primary key.
--   2. source_quality_score DESC     — higher-quality source wins a priority
--      tie. NULLS LAST is defensive only: source_quality_score is NOT NULL
--      (default 0.5), so a null can't actually occur.
--   3. source_id ASC                 — guarantees a total order even when
--      quality also ties. The real jurisdictional collisions tie on quality
--      (nps == parks_canada == 0.95; bc_parks == alberta_parks == 0.90), so
--      without this third key the collision would STILL be non-deterministic.
--
-- Behaviour-preserving on all current data: where priorities are unique the
-- secondary keys are never consulted, and the colliding sources never co-link
-- in practice, so no existing master_place changes. The fix is defensive
-- against future collisions.
--
-- A matching UNIQUE (field_name, priority) constraint was considered and
-- deliberately NOT added: the schema intentionally permits priority sharing
-- across disjoint sources, so a blunt global unique constraint would fight the
-- design (it would force arbitrary distinct priorities on co-equal
-- jurisdictional sources). The tie-breaker provides operational determinism
-- without it. See data/entity-resolution/README.md.
--
-- CREATE OR REPLACE re-issues the full function bodies from
-- 20260527130000_phase3a_recompute_functions.sql verbatim except for the three
-- ORDER BY clauses below.
-- ============================================================================

set search_path = public;

-- ────────────────────────────────────────────────────────────────────────
-- 1. resolve_field — JSONB field resolver (primary fix site).
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.resolve_field(
  p_master_place_id uuid,
  p_field_name text
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_value  jsonb;
  v_source text;
begin
  select
    sr.normalized_payload -> p_field_name,
    sr.source_id
    into v_value, v_source
  from public.source_record sr
  join public.field_precedence fp
    on fp.source_id = sr.source_id
   and fp.field_name = p_field_name
  where sr.master_place_id = p_master_place_id
    and sr.is_active = true
    and sr.normalized_payload -> p_field_name is not null
    and sr.normalized_payload -> p_field_name != 'null'::jsonb
  -- Deterministic tie-breaker: priority first, then higher source quality,
  -- then source_id as a stable final key so co-equal-priority/-quality
  -- sources (e.g. nps vs parks_canada at canonical_name priority 1, both
  -- quality 0.95) resolve identically every time.
  order by fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc
  limit 1;

  return jsonb_build_object('value', v_value, 'source', v_source);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. recompute_master_place — same tie-breaker on the geometry (Point) and
--    geometry_polygon resolution queries (Steps 4 and 5). Body is otherwise
--    identical to 20260527130000.
-- ────────────────────────────────────────────────────────────────────────

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
  update public.master_place set
    attribution      = v_attribution,
    source_count     = v_source_count,
    prominence_score = public.compute_prominence(p_master_place_id),
    last_resolved_at = now()
  where id = p_master_place_id;
end;
$$;
