-- Fix recompute_master_place's clear-bug (docs/BACKLOG.md, commit bf73f97).
--
-- BUG: for every precedence-resolved field, the function only ran an UPDATE
-- when resolve_field() returned a candidate (`if v_value is not null ...`).
-- When a field's last active source went away (deactivation, deletion,
-- renormalization), resolve_field() correctly returns no candidate, but the
-- guard skipped the UPDATE entirely — so the OLD value stayed stranded in
-- master_place instead of being cleared. Observed 3 times on TEST 2026-08-18:
-- NPS amenities normalization (14 rows), dump_station NULL-reclassification
-- (78 rows), dump_station hard-delete (89 rows, which proved the function
-- DID run — recompute_aggregated_fields' unconditional writes cleared
-- attribution/secondary_categories correctly on the same call — while the
-- precedence-resolved columns specifically stayed stale). All three were
-- render-harmless by coincidence (source_count = 0, excluded from
-- master_place_search_export), not by design.
--
-- FULL SCAN of the write path (pg_get_functiondef pulled live from TEST,
-- not from a migration file, per this repo's documented file/DB drift
-- history) found 13 guarded write sites total:
--   - Step 3's 11-field loop: canonical_name, primary_category, description,
--     amenities, hours, contact, access, services, capacity, seasonality,
--     cell_signal.
--   - Step 4: geometry.
--   - Step 5: geometry_polygon.
-- recompute_aggregated_fields (alternative_names / secondary_categories /
-- overlander_tags) already uses `coalesce(..., '{}'::text[])` with an
-- unconditional UPDATE — already correct, not touched here. Step 6
-- (attribution/source_count/prominence/is_searchable), Step 6.5
-- (mvum_corridor), and Step 7 (containment) are unconditional — not
-- affected.
--
-- FIX SCOPE — 10 of the 13 sites get an explicit clear; 3 do NOT:
--   canonical_name, primary_category, and geometry are all NOT NULL columns
--   on master_place (confirmed via information_schema.columns against TEST).
--   There is no NULL to clear them to without relaxing the constraint, which
--   is a separate, higher-blast-radius schema decision this migration does
--   NOT make. Their guarded-skip behavior is UNCHANGED by this migration —
--   flagged in docs/BACKLOG.md for Adam, not silently dropped.
--
--   The other 10 (description, amenities, hours, contact, access, services,
--   capacity, seasonality, cell_signal, geometry_polygon) are nullable, and
--   now get an explicit `set field = null` when resolve_field() (or the
--   geometry_polygon lookup) returns no candidate. Plain SQL NULL, not
--   '{}'/'[]' — verified against TEST that 0 of 156,002 master_place rows
--   currently store '{}'/'[]' in any of these columns; NULL is already the
--   sole "no data" convention every other code path expects, so this is not
--   a new state, just closing the gap on the existing one. Each clear is
--   itself guarded on `where ... is not null` so a row with nothing to clear
--   costs no extra write.
--
-- APPLY-PATH (recompute_master_place is the sole writer of master_place —
-- must not be lost, per docs/decisions/2026-06-02-land-status-and-dispersed-
-- camping-sources.md):
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'  -- PostgREST pool staleness: pooled
--      backends can keep running the OLD compiled plan after a bare
--      CREATE OR REPLACE; recycle the pool, a fresh process does NOT help.
--   3. Backfill already-affected rows (separate script, not in this file).

set search_path = public;

drop function if exists public.recompute_master_place(uuid);

create function public.recompute_master_place(p_master_place_id uuid)
returns void
language plpgsql
as $function$
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
  -- Fields eligible for an explicit clear when resolve_field() returns no
  -- candidate. canonical_name and primary_category are deliberately absent —
  -- both are NOT NULL columns on master_place, so there is no NULL to clear
  -- them to (see this migration's header). geometry (Step 4, also NOT NULL)
  -- is handled outside this loop and carries the same exception.
  v_clearable_fields text[] := array[
    'description', 'amenities', 'hours', 'contact', 'access',
    'services', 'capacity', 'seasonality', 'cell_signal'
  ];

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
    elsif v_field = any(v_clearable_fields) then
      -- Clear-bug fix: no active source resolves this field anymore.
      -- Explicitly clear it rather than leaving a stale value stranded.
      -- Guarded on "is not null" so a row with nothing to clear is a no-op.
      execute format(
        'update public.master_place set %I = null where id = $1 and %I is not null',
        v_field, v_field
      ) using p_master_place_id;
    end if;
  end loop;

  -- Step 4: geometry (PostGIS Point) — read source_record.geometry directly,
  -- not from normalized_payload. Precedence comes from the 'geometry' rows
  -- in field_precedence.
  --
  -- NOT NULL column — no clear-bug fix here. If every active source's
  -- geometry disappears, the OLD point is deliberately left in place (there
  -- is no NULL to fall back to without relaxing the constraint). Flagged in
  -- docs/BACKLOG.md alongside canonical_name/primary_category above.
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
  else
    -- Clear-bug fix: nullable column, no active source, no stale-value gap.
    update public.master_place
       set geometry_polygon = null
     where id = p_master_place_id
       and geometry_polygon is not null;
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
$function$;

grant execute on function public.recompute_master_place(uuid) to postgres, anon, authenticated, service_role;

notify pgrst, 'reload schema';
