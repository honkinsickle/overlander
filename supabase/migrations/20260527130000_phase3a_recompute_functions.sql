-- ============================================================================
-- Phase 3a: Core entity resolution — SQL functions
--
-- Implements the four functions deferred from Phase 1 (resolve_field,
-- compute_prominence, recompute_master_place) plus two new helpers
-- (recompute_aggregated_fields, reset_phase3a_test_state).
--
-- See docs/phase-3a-build-spec.md §4 for design.
-- ============================================================================

set search_path = public;

-- ────────────────────────────────────────────────────────────────────────
-- 0. Schema fix: geometry_polygon must support MultiPolygon
--
-- The NPS boundary endpoint returned a MultiPolygon for Joshua Tree (verified
-- in the JT smoke test). Phase 1 declared master_place.geometry_polygon as
-- geometry(Polygon, 4326) which rejects MultiPolygons. master_place is empty
-- (no rows yet — Phase 3a is the first ER run), so the ALTER is a no-op
-- data-wise.
-- ────────────────────────────────────────────────────────────────────────

alter table public.master_place
  alter column geometry_polygon type geometry(MultiPolygon, 4326)
  using st_multi(geometry_polygon);

-- ────────────────────────────────────────────────────────────────────────
-- 1. resolve_field(p_master_place_id, p_field_name) → JSONB
--
-- For a master_place's linked source_records, return the value of the
-- highest-priority source's normalized_payload[field], plus which source
-- contributed it. Returns {value: <jsonb>, source: <text>}.
--
-- Returns {value: null, source: null} if no linked source has a non-null
-- value for the field. Callers should check before applying.
--
-- Per spec §10.2 and Phase 3a §4.1.
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
  order by fp.priority asc
  limit 1;

  return jsonb_build_object('value', v_value, 'source', v_source);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. compute_prominence(p_master_place_id) → FLOAT
--
-- Composite score combining:
--   - source diversity:  COUNT(DISTINCT source_id) * 2.0
--   - review count:      SUM((normalized_payload->>'review_count')::int) * 0.5
--   - official boost:    +3 if any record from nps or ridb
--   - recency penalty:   -1 if newest source older than 12 months
--
-- Returns GREATEST(score, 0) so prominence never goes negative.
--
-- Per spec §10.4 and Phase 3a §4.2.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.compute_prominence(p_master_place_id uuid)
returns float
language plpgsql
stable
as $$
declare
  v_diversity float;
  v_reviews   float;
  v_official  float := 0;
  v_recency   float := 0;
  v_score     float;
begin
  select count(distinct source_id) * 2.0
    into v_diversity
  from public.source_record
  where master_place_id = p_master_place_id and is_active = true;

  select coalesce(sum(coalesce((normalized_payload ->> 'review_count')::integer, 0)), 0) * 0.5
    into v_reviews
  from public.source_record
  where master_place_id = p_master_place_id and is_active = true;

  if exists (
    select 1 from public.source_record
    where master_place_id = p_master_place_id
      and source_id in ('nps', 'ridb')
      and is_active = true
  ) then
    v_official := 3;
  end if;

  if not exists (
    select 1 from public.source_record
    where master_place_id = p_master_place_id
      and is_active = true
      and fetch_timestamp > now() - interval '12 months'
  ) then
    v_recency := -1;
  end if;

  v_score := coalesce(v_diversity, 0) + coalesce(v_reviews, 0) + v_official + v_recency;
  return greatest(v_score, 0);
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 3. recompute_aggregated_fields(p_master_place_id) → VOID
--
-- Handles the three master_place fields that aggregate via UNION across
-- all linked source_records rather than being precedence-resolved:
--
--   - alternative_names    ← distinct source_record.name
--   - secondary_categories ← distinct source_record.inferred_category
--   - overlander_tags      ← flattened union of
--                            normalized_payload.overlander_tags arrays
--
-- See data/entity-resolution/README.md "Aggregated fields" section for the
-- design rationale. The standard resolve_field() returns a single value —
-- wrong shape for these array-typed columns.
--
-- Phase 3a §4.3.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.recompute_aggregated_fields(p_master_place_id uuid)
returns void
language plpgsql
volatile
as $$
declare
  v_alt_names      text[];
  v_secondary_cats text[];
  v_tags           text[];
begin
  -- alternative_names: distinct top-level names across linked source_records.
  select array_agg(distinct name order by name)
    into v_alt_names
  from public.source_record
  where master_place_id = p_master_place_id and is_active = true;

  -- secondary_categories: distinct inferred_categories.
  select array_agg(distinct inferred_category order by inferred_category)
    into v_secondary_cats
  from public.source_record
  where master_place_id = p_master_place_id
    and is_active = true
    and inferred_category is not null;

  -- overlander_tags: flatten and dedupe the JSONB array values.
  -- jsonb_array_elements_text expands the array; the CASE guards against
  -- malformed payloads (non-array values get skipped).
  select array_agg(distinct tag order by tag)
    into v_tags
  from public.source_record sr
  cross join lateral jsonb_array_elements_text(
    case
      when jsonb_typeof(sr.normalized_payload -> 'overlander_tags') = 'array'
      then sr.normalized_payload -> 'overlander_tags'
      else '[]'::jsonb
    end
  ) as tag
  where sr.master_place_id = p_master_place_id and sr.is_active = true;

  update public.master_place set
    alternative_names    = coalesce(v_alt_names,      '{}'::text[]),
    secondary_categories = coalesce(v_secondary_cats, '{}'::text[]),
    overlander_tags      = coalesce(v_tags,           '{}'::text[])
  where id = p_master_place_id;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. recompute_master_place(p_master_place_id) → VOID
--
-- The composite recompute. Called by promote.ts after any match-application
-- mutation. Order of operations:
--
--   1. recompute_aggregated_fields  (UNION-semantic fields)
--   2. JSONB-resolved fields        (11 fields via resolve_field)
--   3. geometry                     (PostGIS Point, source_record.geometry)
--   4. geometry_polygon             (PostGIS MultiPolygon, from
--                                    source_record.normalized_payload.geometry_polygon)
--   5. attribution, source_count, prominence_score, last_resolved_at
--
-- Per spec §10.3 and Phase 3a §4.4. The 13 precedence-managed fields are:
--   canonical_name, primary_category, description, amenities, hours, contact,
--   access, services, capacity, seasonality, cell_signal, geometry, geometry_polygon.
--
-- Three of those (canonical_name, primary_category, description) are TEXT
-- columns; the rest of the JSONB-resolved set are JSONB columns. The function
-- extracts text values via the `#>>'{}'` pattern.
--
-- No SQL triggers — recompute is invoked explicitly by promote.ts. This keeps
-- the data flow visible in app code rather than hidden in trigger side-effects.
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
  order by fp.priority asc
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
  order by fp.priority asc
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

-- ────────────────────────────────────────────────────────────────────────
-- 5. reset_phase3a_test_state() → VOID
--
-- Test isolation helper. Unlinks every source_record from its master_place,
-- deletes every place_match row, and deletes every master_place. Lets the
-- vitest afterEach hook restore a clean ER state without needing real
-- transactional rollback (which Supabase JS client doesn't support cleanly).
--
-- DANGEROUS in production. Test-only.
--
-- Phase 3a §8 (test reset RPC).
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.reset_phase3a_test_state()
returns void
language plpgsql
volatile
as $$
begin
  -- Note: `where true` is required because Supabase enforces a
  -- "DELETE requires a WHERE clause" safeguard at the database level.
  -- Bare `DELETE FROM table;` raises an error even from inside a function.
  update public.source_record set master_place_id = null where master_place_id is not null;
  delete from public.place_match where true;
  delete from public.master_place where true;
end;
$$;
