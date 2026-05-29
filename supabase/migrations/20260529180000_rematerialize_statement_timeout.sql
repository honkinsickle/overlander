-- Phase 3 corridor scale: raise statement_timeout for materialize_clear_resolution_state.
--
-- Corridor-scale rematerialize (~29K row mutations across update + delete +
-- delete) exceeds the service_role's default 8s statement_timeout; set local
-- scopes a generous 300s allowance to this transaction only.
--
-- CREATE OR REPLACE preserves the function's external contract (same name,
-- signature, return shape, comment). Only the body changes: a `set local
-- statement_timeout` at the top.

set search_path = public;

create or replace function public.materialize_clear_resolution_state()
returns jsonb
language plpgsql
volatile
as $$
declare
  v_source_record_unlinked int;
  v_place_match_deleted    int;
  v_master_place_deleted   int;
begin
  -- Corridor-scale rematerialize (~29K row mutations across update + delete +
  -- delete) exceeds the service_role's default 8s statement_timeout; set local
  -- scopes a generous 300s allowance to this transaction only.
  set local statement_timeout = '300s';

  update public.source_record
    set master_place_id = null
    where master_place_id is not null;
  get diagnostics v_source_record_unlinked = ROW_COUNT;

  delete from public.place_match where true;
  get diagnostics v_place_match_deleted = ROW_COUNT;

  delete from public.master_place where true;
  get diagnostics v_master_place_deleted = ROW_COUNT;

  return jsonb_build_object(
    'source_record_unlinked', v_source_record_unlinked,
    'place_match_deleted',    v_place_match_deleted,
    'master_place_deleted',   v_master_place_deleted
  );
end;
$$;
