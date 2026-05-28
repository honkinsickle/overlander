-- Phase 2.5 — Part B Option 3: hard-guard the destructive reset.
--
-- Context: the Phase 3a vitest suite calls reset_phase3a_test_state(),
-- which DELETEs every row in master_place and place_match. With the S1
-- decision (one Supabase project for everything), a stray test run wipes
-- real data — this has already happened once.
--
-- Fix: alter the function to refuse unless a row exists in test_marker.
-- Production projects never have a row in test_marker. Test projects
-- (provisioned via Phase 2.5 Option 1 — deferred to a future migration)
-- insert one at setup time. The guard fails closed: if the table is
-- empty, the function raises and no data is touched.
--
-- This is the SQL load-bearing guard. There is also a TS-side env-var
-- check in data/entity-resolution/phase3a.test.ts (belt-and-suspenders).
-- Either layer is sufficient; both layers ensure that bypassing one
-- doesn't suffice to clobber real data.

set search_path = public;

-- Sentinel table. A row marks the project as a test project. Boolean PK
-- with check(id) restricts the table to at most one row, so there's no
-- ambiguity about what "marked" means.

create table if not exists public.test_marker (
  id              boolean       primary key default true check (id),
  established_at  timestamptz   not null    default now(),
  note            text
);

comment on table public.test_marker is
  'Sentinel for destructive-test guard. A row in this table marks the '
  'project as a test project; reset_phase3a_test_state() refuses to run '
  'unless a row is present. Real (dev/production) projects must NEVER '
  'have a row here. See Phase 2.5 spec Part B.';

-- RLS: enabled, no policies. Service-role only (which is who calls
-- the reset function anyway). Anon/authenticated cannot see or modify
-- the marker.

alter table public.test_marker enable row level security;

create or replace function public.reset_phase3a_test_state()
returns void
language plpgsql
volatile
as $$
declare
  v_is_test boolean;
begin
  -- Refuse to fire on real data. The marker table is empty on every
  -- project that hasn't explicitly been provisioned as a test target.
  select true into v_is_test from public.test_marker limit 1;
  if v_is_test is null then
    raise exception
      'reset_phase3a_test_state aborted: this project is not marked as a test project. '
      'No row exists in public.test_marker. To run destructive tests, point at an isolated '
      'test project (Phase 2.5 spec Part B Option 1) — never against production data.';
  end if;

  -- Note: `where true` is required because Supabase enforces a
  -- "DELETE requires a WHERE clause" safeguard at the database level.
  update public.source_record set master_place_id = null where master_place_id is not null;
  delete from public.place_match where true;
  delete from public.master_place where true;
end;
$$;

comment on function public.reset_phase3a_test_state is
  'Destructive: deletes every row in master_place + place_match and '
  'unlinks source_record. Refuses to run unless test_marker has a row. '
  'Phase 2.5 Part B Option 3 guard.';
