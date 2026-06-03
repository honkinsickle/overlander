-- ============================================================================
-- Phase 1 — PAD-US land-status: is_searchable column + recompute wiring +
-- search-export filter + padus field_precedence.
--
-- Adds a non-searchable land-status lane (ADR 2026-06-02). Generic land-status
-- master_places (primary_category='land_status') become containment parents +
-- land-manager taggers but are EXCLUDED from search; named units
-- (public_land, etc.) stay searchable. Mechanism: an is_searchable boolean
-- column set inside recompute_master_place (the sole writer of master_place),
-- and master_place_search_export filtered on it.
--
-- recompute_master_place body below is the LIVE function sourced from the test
-- DB via pg_get_functiondef (NOT the phase3b migration file) — diffed and
-- confirmed identical to 20260601040000 except cosmetic pg_get_functiondef
-- normalization (omitted default `volatile`, `$function$` quoting). The ONLY
-- substantive change is the single added Step-6 SET clause:
--   is_searchable = (primary_category is distinct from 'land_status')
-- `is distinct from` keeps a NULL category searchable (safe default).
-- ============================================================================

set search_path = public;

-- 1. Additive column. Default true → every existing row stays searchable
--    (the regression invariant: no existing master_place flips out of search).
alter table public.master_place
  add column if not exists is_searchable boolean not null default true;

-- 2. recompute_master_place: LIVE body verbatim + the single is_searchable line.
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
  -- ADDED (Phase 1 land-status): is_searchable derived from the resolved
  -- primary_category. land_status → excluded from search; everything else
  -- (incl. a NULL category, via `is distinct from`) stays searchable.
  update public.master_place set
    attribution      = v_attribution,
    source_count     = v_source_count,
    prominence_score = public.compute_prominence(p_master_place_id),
    last_resolved_at = now(),
    is_searchable    = (primary_category is distinct from 'land_status')
  where id = p_master_place_id;

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

-- 3. Search export gains the is_searchable filter (re-issued from
--    20260527140000 + the WHERE). land_status rows never reach Typesense.
create or replace view public.master_place_search_export as
select
  mp.id,
  mp.canonical_name,
  mp.alternative_names,
  mp.primary_category,
  mp.secondary_categories,
  mp.overlander_tags,
  mp.description,
  ST_X(mp.geometry)::double precision as lng,
  ST_Y(mp.geometry)::double precision as lat,
  mp.prominence_score,
  mp.source_count,
  mp.amenities,
  mp.updated_at
from public.master_place mp
where mp.is_searchable;

comment on view public.master_place_search_export is
  'Phase 2 Typesense sync source. Projects master_place with geometry split into lng/lat doubles. Phase 1 land-status: filtered to is_searchable (land_status rows excluded).';

-- 4. field_precedence for padus. Priority 10 = clearly lowest: PAD-US is NOT
--    geographically disjoint from NPS (parks are in PAD-US), so a federated
--    park must take its name/description/polygon from the authoritative source
--    (nps=1, PC=1, etc.), never from coarse PAD-US. padus only ever wins when
--    it is the sole source (its own land_status units), where precedence is moot.
INSERT INTO field_precedence (field_name, source_id, priority) VALUES
  ('canonical_name',   'padus', 10),
  ('description',      'padus', 10),
  ('geometry_polygon', 'padus', 10);
