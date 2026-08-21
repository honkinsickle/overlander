-- ============================================================================
-- backfill_state_for_ids() — bulk-update helper for the master_place.state
-- backfill (2026-08-21). A per-row UPDATE loop from the client for ~30k+
-- rows would be slow and violates this repo's own stack invariant
-- ("spatial queries always use PostGIS, never compute distance/geometry
-- logic in app code if the values are in the DB") — this does the whole
-- backfill set-based, server-side, in one call.
--
-- One-time backfill helper, same posture as load_state_boundary_geom():
-- not part of any ongoing pipeline.
-- ============================================================================

set search_path = public;

create or replace function public.backfill_state_for_ids(p_ids uuid[])
returns integer
language sql
as $$
  with updated as (
    update public.master_place mp
       set state = public.resolve_state(mp.geometry)
     where mp.id = any(p_ids)
    returning mp.id
  )
  select count(*)::integer from updated;
$$;

comment on function public.backfill_state_for_ids(uuid[]) is
  'One-time bulk backfill helper for master_place.state via resolve_state(). Not part of any ongoing pipeline — called once by data/scripts/backfill-state-boundaries-2026-08-21.ts.';
