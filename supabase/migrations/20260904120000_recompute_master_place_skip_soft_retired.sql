-- recompute_master_place() v0.6 — skip soft-retired mps in Step 7's
-- containment scan. Replaces the v4 (20260903213500) workaround in
-- merge_master_place().
--
-- BUG this fixes (PR #383 finding, 2026-09-03):
--
-- When merge_master_place() calls recompute_master_place(canonical),
-- Step 7's polygon-containment scan enumerates EVERY master_place with
-- geometry — including soft-retired absorbed mps. The absorbed mps still
-- carry their old points and polygons in the DB (merge only sets
-- is_searchable=false + source_count=0; it does not clear geometry).
-- So the scan re-inserts edges like:
--
--   (child = absorbed_mp,  parent = canonical,  type = contained_in)
--     — role (b): canonical's polygon covers absorbed's point.
--   (child = canonical,    parent = absorbed_mp, type = contained_in)
--     — role (a) analog, if absorbed still has a polygon covering canonical.
--
-- v4 of merge_master_place() sweeps these up in a final delete pass after
-- recompute returns. That works for the ONE merge that just ran, but not
-- for the class: any FUTURE recompute on an unrelated canonical whose
-- polygon covers (or is covered by) an old absorbed mp's remaining
-- geometry will re-create the same class of orphan. This migration fixes
-- the class at the root.
--
-- FIX:
--   1. Add filter in Step 7 (a) and (b): the JOINED-side mp must have at
--      least one active source_record. Soft-retired absorbed mps have
--      none (merge repointed all their SRs to the canonical), so they
--      are excluded. Naturally-orphaned mps (all SRs deactivated) are
--      also excluded — they shouldn't be participating in containment
--      either.
--   2. Guard the delete-then-insert in both roles: if the RECOMPUTED mp
--      itself has no active source_records, still DELETE its edges
--      (cleanup) but do NOT insert new ones. Prevents this function from
--      generating fresh edges on a soft-retired mp if called directly.
--
-- Why "active source_record EXISTS" is the right signal:
--   - Precise for the "soft-retired absorbed" case (merge moves all SRs).
--   - Precise for the "naturally orphaned" case (no active data).
--   - Does NOT accidentally exclude land_status mps (they have real SRs;
--     PADUS, USFS boundaries, etc. — they legitimately participate in
--     containment as parents).
--   - Does NOT rely on `is_searchable` (which is set to false by BOTH
--     merge AND the normal land_status branch — can't distinguish).
--   - Does NOT rely on `source_count > 0` (excludes generated-only
--     mps unnecessarily; those are template-only but geographically
--     real).
--   - No schema change needed.
--
-- SCOPE:
--   - Only Step 7 changes. Steps 1-6 remain identical byte-for-byte
--     (source_count computation, field resolution, geometry write,
--     attribution, mvum_corridor).
--   - Comment blocks in Steps 1-6 preserved verbatim from v0.5. The
--     text describing Step 7's design is expanded to record this fix.
--
-- RELATIONSHIP TO merge_master_place v4:
--   - v5 does NOT delete v4. v4's post-recompute cleanup still runs and
--     is now a no-op in the normal case (the bad edges are never
--     inserted). Keeping v4 belt-and-suspenders until the next merge
--     function revision.
--   - The one-shot cleanup script
--     (data/scripts/cleanup-post-recompute-orphans.ts) remains valid for
--     historical data left over from pre-v5 merges but should not be
--     required for merges executed AFTER v5 lands.
--
-- APPLY-PATH:
--   1. npm run -w data db:push-verify -- --test
--   2. NOTIFY pgrst, 'reload schema'   (not strictly needed — no schema
--      change — but keeps parity with the standing recompute-migration
--      recipe.)

set search_path = public;

drop function if exists public.recompute_master_place(uuid);

create function public.recompute_master_place(p_master_place_id uuid)
returns void
language plpgsql
as $function$
declare
  -- (unchanged from v0.5)
  v_jsonb_fields text[] := array[
    'canonical_name', 'primary_category', 'description',
    'amenities', 'hours', 'contact', 'access', 'services',
    'capacity', 'seasonality', 'cell_signal',
    'operational_status'
  ];
  v_text_columns text[] := array[
    'canonical_name', 'primary_category', 'description',
    'operational_status'
  ];
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

  -- v5: cached "does this mp have any active source_records?" flag.
  -- Used to guard Step 7's delete-then-insert.
  v_self_has_active_sr boolean;
begin
  -- Step 1: UNION-aggregated fields.
  perform public.recompute_aggregated_fields(p_master_place_id);

  -- Step 2: source_count snapshot. (Comment preserved from v0.5.)
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

  -- Step 3: JSONB-resolved fields. (Unchanged from v0.5.)
  foreach v_field in array v_jsonb_fields loop
    v_resolved := public.resolve_field(p_master_place_id, v_field);
    v_value    := v_resolved -> 'value';
    v_source   := v_resolved ->> 'source';

    if v_value is not null and v_value != 'null'::jsonb then
      v_attribution := v_attribution || jsonb_build_object(v_field, v_source);

      if v_field = any(v_text_columns) then
        execute format(
          'update public.master_place set %I = $1 where id = $2',
          v_field
        ) using (v_value #>> '{}'), p_master_place_id;
      else
        execute format(
          'update public.master_place set %I = $1 where id = $2',
          v_field
        ) using v_value, p_master_place_id;
      end if;
    elsif v_field = any(v_clearable_fields) then
      execute format(
        'update public.master_place set %I = null where id = $1 and %I is not null',
        v_field, v_field
      ) using p_master_place_id;
    end if;
  end loop;

  -- Step 4: geometry (PostGIS Point). (Unchanged from v0.5.)
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

  -- Step 5: geometry_polygon (PostGIS MultiPolygon). (Unchanged from v0.5.)
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
    update public.master_place
       set geometry_polygon = null
     where id = p_master_place_id
       and geometry_polygon is not null;
  end if;

  -- Step 6: metadata + prominence. (Unchanged from v0.5.)
  update public.master_place set
    attribution      = v_attribution,
    source_count     = v_source_count,
    prominence_score = public.compute_prominence(p_master_place_id),
    last_resolved_at = now(),
    is_searchable    = (primary_category is distinct from 'land_status')
  where id = p_master_place_id;

  -- Step 6.5 (Phase 2 PR-C): mvum_corridor for dispersed_camping places.
  -- (Unchanged from v0.5.)
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
  --
  -- v5 CHANGE: exclude soft-retired mps from both sides of the scan.
  -- See this migration's header for the mechanism. Concretely:
  --   - v_self_has_active_sr: does the RECOMPUTED mp have at least one
  --     active source_record? If not, delete its edges but skip the
  --     re-insert. Prevents this function from generating new edges on
  --     a mp that has been merged away or naturally orphaned.
  --   - The JOINED mp in (a) and (b) is filtered by the same
  --     "has active source_record" existence check.
  --
  -- Rewrite pattern is otherwise unchanged: stateless delete-then-insert
  -- per role → geometry changes converge to the correct edge set.

  select exists (
    select 1
      from public.source_record sr
     where sr.master_place_id = p_master_place_id
       and sr.is_active = true
  ) into v_self_has_active_sr;

  -- (a) child role: this place contained_in any park whose polygon covers
  --     its point. Runs for every master_place (amenity or nested park).
  delete from public.place_relationships
   where child_master_place_id = p_master_place_id
     and relationship_type = 'contained_in';

  if v_self_has_active_sr then
    insert into public.place_relationships
      (child_master_place_id, parent_master_place_id, relationship_type)
    select s.id, p.id, 'contained_in'
    from public.master_place s
    join public.master_place p
      on p.id <> s.id
     and p.geometry_polygon is not null
     and st_covers(p.geometry_polygon, s.geometry)
    where s.id = p_master_place_id
      -- v5: skip soft-retired / orphaned parents.
      and exists (
        select 1 from public.source_record sr
         where sr.master_place_id = p.id
           and sr.is_active = true
      )
    on conflict (child_master_place_id, parent_master_place_id, relationship_type) do nothing;
  end if;

  -- (b) parent role: every master_place whose point this polygon covers
  --     becomes contained_in it. Only fires when this place has a polygon.
  if (select geometry_polygon is not null
        from public.master_place
       where id = p_master_place_id) then
    delete from public.place_relationships
     where parent_master_place_id = p_master_place_id
       and relationship_type = 'contained_in';

    if v_self_has_active_sr then
      insert into public.place_relationships
        (child_master_place_id, parent_master_place_id, relationship_type)
      select c.id, p.id, 'contained_in'
      from public.master_place p
      join public.master_place c
        on c.id <> p.id
       and st_covers(p.geometry_polygon, c.geometry)
      where p.id = p_master_place_id
        -- v5: skip soft-retired / orphaned children.
        and exists (
          select 1 from public.source_record sr
           where sr.master_place_id = c.id
             and sr.is_active = true
        )
      on conflict (child_master_place_id, parent_master_place_id, relationship_type) do nothing;
    end if;
  end if;
end;
$function$;

comment on function public.recompute_master_place(uuid) is
  'v5 (2026-09-04): Step 7 excludes soft-retired mps from the '
  'containment scan on both sides, and skips edge re-insertion when '
  'the recomputed mp itself has no active source_records. Replaces the '
  'v4 (20260903213500_merge_master_place_v4.sql) post-recompute '
  'cleanup workaround at the root. See migration header for full '
  'mechanism.';
