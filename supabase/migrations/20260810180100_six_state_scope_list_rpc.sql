-- Helper for the batched source_record deactivation: returns the UUID array
-- of out-of-scope active source_records so the operator can chunk it in
-- application code and issue 500-at-a-time UPDATEs.
--
-- STABLE — the same set every call (until the operator starts flipping
-- is_active; after the trim runs, this returns an empty array). Not
-- destructive.

set search_path = public;

create or replace function public.list_out_of_scope_source_record_ids()
returns uuid[]
language sql
stable
as $$
  select coalesce(array_agg(id order by id), array[]::uuid[])
    from public.source_record
   where is_active = true
     and not st_intersects(geometry, public.six_state_scope());
$$;

comment on function public.list_out_of_scope_source_record_ids is
  'Returns the active source_record IDs that fall outside the six-state footprint (WA/OR/CA/AZ/NV/UT). Used by the operator-driven trim script to chunk the UPDATE. STABLE.';
