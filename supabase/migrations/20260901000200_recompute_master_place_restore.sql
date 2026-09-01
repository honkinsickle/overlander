-- ============================================================================
-- Restore recompute_master_place() — undo the five fixes silently reverted by
-- 20260831100000_operational_status.sql, while KEEPING that migration's one
-- correct addition (operational_status resolution).
--
-- WHAT HAPPENED (docs/measurements/2026-09-01-recompute-master-place-
-- regression-audit.md): 20260831100000's function body is byte-for-byte the
-- 2026-05-27 original (20260527130000) plus two hunks adding
-- operational_status to two arrays — verified by diffing the two files without
-- stripping comments. It was authored by copying the OLDEST definition, so one
-- CREATE OR REPLACE reverted three months of accumulated fixes across seven
-- code sites:
--
--   1. Clear-branch for the 9 nullable resolved fields  (Step 3)   20260819180000
--   2. Clear-branch for geometry_polygon                (Step 5)   20260819180000
--   3. Deterministic tie-break, geometry                (Step 4)   20260601010000
--   4. Deterministic tie-break, geometry_polygon        (Step 5)   20260601010000
--   5. is_searchable derivation                         (Step 6)   20260602000000
--   6. mvum_corridor                                    (Step 6.5) 20260603010000
--   7. Containment / place_relationships rewrite        (Step 7)   20260601040000
--
-- WHAT EACH RESTORED PIECE DOES:
--   1+2. When a field's last active source goes away, resolve_field() correctly
--        returns no candidate. The pre-fix code's guarded `if` then skipped the
--        UPDATE, stranding the OLD value in master_place forever. The clear
--        branch writes an explicit NULL instead. canonical_name /
--        primary_category / geometry are excluded — all NOT NULL, so there is
--        no NULL to clear them to; that exclusion is deliberate and preserved.
--   3+4. Steps 4 and 5 pick geometry with their own inline queries against
--        source_record (NOT via resolve_field, whose own tie-break survived).
--        Ordering by fp.priority alone leaves co-equal-priority sources in
--        arbitrary order, so the chosen geometry could differ run to run.
--        The full key is priority, then source_quality_score desc nulls last,
--        then source_id asc.
--   5.   is_searchable is a DERIVED fact, recomputed every call: land_status
--        rows are excluded from search, everything else (incl. a NULL category,
--        via `is distinct from`) stays searchable. Without it, a row that
--        becomes land_status keeps a stale is_searchable and leaks into
--        master_place_search_export and Typesense.
--   6.   mvum_corridor: a dispersed_camping place within 30 m (geography — the
--        ::geography casts are load-bearing, without them the unit is degrees)
--        of an open MVUM route sits on the designated-open motorized network.
--        NULL for every other category, because the concept doesn't apply.
--   7.   Containment: rewrite this place's contained_in edges in both roles it
--        can play (child of a covering polygon; parent of points it covers).
--        Stateless delete-then-reinsert so polygon/point changes converge.
--
-- KEPT FROM 20260831100000: operational_status in v_jsonb_fields and
-- v_text_columns, verbatim. This migration restores what that one broke; it
-- does not revert it.
--
-- TWO DELIBERATE ADDITIONS beyond a pure merge, both flagged in the PR:
--   a. operational_status added to v_clearable_fields — see the inline comment.
--   b. Step 2's source_count excludes generated-content source records — see
--      the inline comment and 20260901000100.
--
-- TEST FIRST. PROD application is a separate, explicitly authorized step.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'
-- ============================================================================

set search_path = public;

drop function if exists public.recompute_master_place(uuid);

create function public.recompute_master_place(p_master_place_id uuid)
returns void
language plpgsql
as $function$
declare
  -- The 12 JSONB-resolved fields. geometry + geometry_polygon get separate
  -- code paths below since they're PostGIS types, not JSONB.
  -- operational_status is carried over from 20260831100000 — that migration's
  -- ONE correct addition, preserved verbatim here.
  v_jsonb_fields text[] := array[
    'canonical_name', 'primary_category', 'description',
    'amenities', 'hours', 'contact', 'access', 'services',
    'capacity', 'seasonality', 'cell_signal',
    'operational_status'
  ];
  -- Fields that go into TEXT columns (need jsonb→text extraction).
  v_text_columns text[] := array[
    'canonical_name', 'primary_category', 'description',
    'operational_status'
  ];
  -- Fields eligible for an explicit clear when resolve_field() returns no
  -- candidate. canonical_name and primary_category are deliberately absent —
  -- both are NOT NULL columns on master_place, so there is no NULL to clear
  -- them to (see this migration's header). geometry (Step 4, also NOT NULL)
  -- is handled outside this loop and carries the same exception.
  --
  -- DEVIATION, FLAGGED: operational_status is added to this list. It is not in
  -- 20260819180000 (it did not exist yet) and not in 20260831100000 (which had
  -- no clear branch at all), so it is in neither source definition. It is a
  -- nullable text column resolved through field_precedence exactly like the
  -- other nine, so omitting it would leave operational_status carrying the
  -- precise clear-bug 20260819180000 exists to fix: a USFS site that reopens
  -- (its CLOSED status withdrawn) would keep a stale CLOSED forever and stay
  -- filtered out of every display surface. Included deliberately; see the PR.
  v_clearable_fields text[] := array[
    'description', 'amenities', 'hours', 'contact', 'access',
    'services', 'capacity', 'seasonality', 'cell_signal',
    'operational_status'
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
  -- Generated-content records (see 20260901000100) are a delivery mechanism for
  -- LLM/template text through the normal precedence path, NOT evidence that a
  -- real-world source describes this place. Counting them would inflate
  -- source_count — exported to Typesense as `n` and used as a gate by
  -- master_place_search_export / pois_along_corridor — for every place that
  -- has generated text. Excluded so the reroute is behaviour-neutral.
  select count(*)
    into v_source_count
  from public.source_record
  where master_place_id = p_master_place_id
    and is_active = true
    and not public.is_generated_source(source_id);

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
