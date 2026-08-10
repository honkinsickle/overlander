-- ============================================================================
-- Six-state footprint helpers (Part 2 of the six-state PROD trim, 2026-08-10).
--
-- WA / OR / CA / AZ / NV / UT scope predicate used by:
--   1. The source_record deactivation script (out-of-scope rows flipped
--      is_active=false; migration only defines the helpers, the actual
--      UPDATE runs in a separate operator-driven step).
--   2. The master_place_search_export view (separate migration below).
--
-- No state polygon shapefile lives in the repo (searched: TIGER, PADUS, no
-- match). Falls back to bboxes via ST_MakeEnvelope for five states; WA uses
-- a stepped polygon to exclude Vancouver Island. A 49.00° north cap on the
-- WA bbox admits the southern tip of Vancouver Island via the Strait of
-- Juan de Fuca (Cowichan Valley, etc.). The stepped polygon caps the
-- western portion of WA at 48.40°N — that's just above Cape Flattery
-- (48.385°N, the WA mainland's northwestern tip) and just below Vancouver
-- Island's southern shore (~48.30-48.65°N). Trade: keeps virtually all of
-- WA (Olympic Peninsula included), excludes Vancouver Island cleanly.
--
-- Bboxes captured 2026-08-09 from Wikipedia state bounding-box data +
-- earlier session's phase3-six-state-scope.ts.
--
-- STABLE, IMMUTABLE-idempotent — same geometry every call, deterministic.
-- ============================================================================

set search_path = public;

create or replace function public.six_state_scope()
returns geometry
language sql
immutable
parallel safe
as $$
  select st_union(array[
    -- WA — LOAD-BEARING NORTHERN EDGE.
    --
    -- A flat 49.00°N north cap on the WA bbox admits Vancouver Island and
    -- the Gulf Islands, which sit SOUTH of the 49th parallel. The 49th
    -- parallel is the border only on the MAINLAND; west of Point Roberts
    -- the border descends through Haro Strait into the middle of the
    -- Strait of Juan de Fuca (~48.3°N).
    --
    -- This polygon steps the north edge down to lat 48.40°N west of
    -- -123.00°W. That keeps Cape Flattery (48.385°N, -124.72°W) — WA's
    -- northwestern tip — INSIDE, and drops Victoria BC (-123.36°W,
    -- 48.43°N) and the rest of Vancouver Island's southern shore
    -- (48.30-48.65°N along -125°W) OUTSIDE.
    --
    -- Without this step, 26+ BC rows from the Cowichan Valley area
    -- (measured on PROD 2026-08-09 before the trim) would be admitted
    -- into a "six-state" scope. Vertices below trace, counter-clockwise
    -- from SW: south edge → east side → north edge across ID/BC line to
    -- Puget Sound → step S to strait → strait-line W → close.
    --
    -- Note: sibling migration 20260810130000 defines six_state_footprint()
    -- with a MORE accurate WA polygon (follows Haro Strait's descent
    -- through five vertices). This function's WA polygon is coarser
    -- (single step), retained for parity with the view predicate applied
    -- in 20260810180200. Follow-up cleanup: unify on six_state_footprint()
    -- (see the PR body).
    st_geomfromtext(
      'POLYGON((
        -124.85 45.55,
        -116.90 45.55,
        -116.90 49.00,
        -123.00 49.00,
        -123.00 48.40,
        -124.85 48.40,
        -124.85 45.55
      ))', 4326
    ),
    -- OR: clean, no Canada leak
    st_makeenvelope(-124.75, 42.00, -116.45, 46.30, 4326),
    -- CA: clean
    st_makeenvelope(-124.50, 32.53, -114.13, 42.01, 4326),
    -- AZ: clean; four-corners meridian at -109.045°
    st_makeenvelope(-114.82, 31.33, -109.05, 37.00, 4326),
    -- NV: bbox includes a sliver of CA around Lake Tahoe (~1-2% overshoot)
    st_makeenvelope(-120.01, 35.00, -114.04, 42.00, 4326),
    -- UT: clean; four-corners meridian at -109.045°
    st_makeenvelope(-114.05, 37.00, -109.04, 42.00, 4326)
  ]);
$$;

comment on function public.six_state_scope is
  'Union of six-state planning footprint (WA/OR/CA/AZ/NV/UT) as a single geometry. Bbox-based fallback (no state polygon shapefile in the repo). WA uses a stepped polygon to exclude Vancouver Island. Used by the six-state trim source_record trim + master_place_search_export view predicate.';

-- Count helper: returns { out_of_scope_count, in_scope_count, active_total }
-- for source_record rows where is_active = true, so the operator can verify
-- before running the UPDATE.
create or replace function public.count_source_records_out_of_scope()
returns table(out_of_scope_count bigint, in_scope_count bigint, active_total bigint)
language sql
stable
as $$
  select
    (select count(*) from public.source_record
      where is_active = true
        and not st_intersects(geometry, public.six_state_scope())),
    (select count(*) from public.source_record
      where is_active = true
        and st_intersects(geometry, public.six_state_scope())),
    (select count(*) from public.source_record
      where is_active = true);
$$;

comment on function public.count_source_records_out_of_scope is
  'Pre-trim verification: how many active source_records fall outside the six-state footprint. Returns (out, in, total) so the operator can verify the split before running the actual UPDATE.';

-- Cross-boundary co-link check: how many master_places have BOTH in-scope
-- and out-of-scope source_records linked. Should be 0 per the prior
-- session's measurement; verify before the trim.
create or replace function public.count_cross_boundary_master_places()
returns bigint
language sql
stable
as $$
  select count(*)::bigint from (
    select mp.id
    from public.master_place mp
    join public.source_record sr_in
      on sr_in.master_place_id = mp.id
     and sr_in.is_active = true
     and st_intersects(sr_in.geometry, public.six_state_scope())
    join public.source_record sr_out
      on sr_out.master_place_id = mp.id
     and sr_out.is_active = true
     and not st_intersects(sr_out.geometry, public.six_state_scope())
    group by mp.id
  ) x;
$$;

comment on function public.count_cross_boundary_master_places is
  'Verifies zero master_places straddle the footprint boundary. If > 0, the trim would orphan some in-scope MPs whose only source is out-of-scope; investigate before running the UPDATE.';
