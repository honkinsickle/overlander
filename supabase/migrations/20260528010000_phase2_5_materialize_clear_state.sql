-- Phase 2.5 Part A — operator-initiated resolution-state reset.
--
-- The materialize orchestrator (data/pipeline/materialize.ts) supports
-- a `--rematerialize` flag that clears master_place + place_match and
-- unlinks source_record before re-running ER from scratch. The spec
-- §A.2.2 calls this "the safe rebuild-everything path" — required for
-- deterministic re-runs over the same source corpus.
--
-- This RPC is intentionally UNGUARDED by test_marker. It is gated by
-- the CLI flag itself: the operator must consciously type
-- `--rematerialize` to fire it. Per spec §4: "Destructive modes
-- (--rematerialize) require the explicit flag."
--
-- Contrast with reset_phase3a_test_state() (in
-- 20260527130000_phase3a_recompute_functions.sql, hardened by
-- 20260528000000_phase2_5_guard_destructive_reset.sql): that path can
-- fire automatically from a test runner, so it requires the
-- test_marker sentinel. This path can only fire from an explicit
-- operator invocation, so the flag is the gate.

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
  -- Use `where true` per Supabase's "DELETE requires a WHERE clause"
  -- safeguard. ROW_COUNT captures how many rows we touched.

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

comment on function public.materialize_clear_resolution_state is
  'Phase 2.5 Part A: clears master_place + place_match and unlinks '
  'source_record. Intended for explicit operator-initiated re-runs via '
  'the materialize orchestrator''s --rematerialize flag. NOT a test '
  'helper — for tests, use reset_phase3a_test_state (which is guarded '
  'by the test_marker sentinel).';
