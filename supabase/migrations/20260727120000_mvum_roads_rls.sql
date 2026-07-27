-- mvum_roads: bring into line with every sibling reference table — RLS enforced,
-- access explicit.
--
-- `public.mvum_roads` was created by 20260603010000_phase2_mvum_corridor.sql
-- without `enable row level security`, while master_place, source_record,
-- place_match, legality_overlay and field_precedence all enable it. No migration
-- has touched it since, so it never picked the setting up.
--
-- Consumers are service-role ONLY, so no policy is required:
--   - data/ingestion/lib/db.ts `upsertMvumRoad` -> RPC upsert_mvum_road, via
--     getDb() = createClient(url, SUPABASE_SERVICE_ROLE_KEY)
--   - data/scripts/load-mvum-roads.ts (`npm run -w data mvum:load`), same client
--   - recompute_master_place, which reads mvum_roads to set mvum_corridor. It is
--     SECURITY INVOKER, but its only caller is the ingestion path above, running
--     as service_role — which bypasses RLS.
-- Nothing in web/src reads this table (the `mvumCorridor` field it renders is a
-- derived column on master_place, not a read of mvum_roads).
--
-- So: RLS on with ZERO policies — service-role-only by omission, the same
-- posture as reference_trips' write side. The revokes are not redundant with
-- RLS: they are defence in depth, because a future default-privilege grant
-- would otherwise silently re-widen the table.

alter table public.mvum_roads enable row level security;

-- Deliberately NO policies. Any future non-service-role consumer must add one
-- explicitly, which is the point.

revoke all on public.mvum_roads from anon, authenticated;

-- upsert_mvum_road is SECURITY INVOKER, so once the table grants are gone it
-- would already fail for anon. Removing EXECUTE as well means it is not a
-- reachable entry point at all. Signature confirmed from pg_proc:
--   upsert_mvum_road(p_rte_cn text, p_geojson jsonb)
--
-- MIGRATION-AUTHORING NOTE — revoking function EXECUTE needs BOTH forms, and
-- each alone is insufficient. Two mechanisms can grant it, and a revoke only
-- clears the one it names:
--   * Postgres grants EXECUTE on every new function to PUBLIC by default.
--     `revoke ... from anon, authenticated` does not touch that grant.
--   * A project may ALSO carry explicit per-role grants (pg_proc.proacl showing
--     `anon=X/postgres`). `revoke ... from public` does not touch those.
-- Our two projects differed in exactly this way, so either form alone left
-- EXECUTE in place on one of them while appearing to succeed — a revoke against
-- a grant a role never individually held is a silent no-op, not an error.
-- Revoke both, then grant back to the single role that needs it, and verify
-- against pg_proc.proacl rather than trusting the DDL.
-- Intended end state: proacl = postgres=X/postgres | service_role=X/postgres
revoke execute on function public.upsert_mvum_road(text, jsonb) from public;
revoke execute on function public.upsert_mvum_road(text, jsonb) from anon, authenticated;
grant execute on function public.upsert_mvum_road(text, jsonb) to service_role;

comment on table public.mvum_roads is
  'Phase 2 PR-C reference data: USFS MVUM open-route geometry, corridor-scoped, keyed on rte_cn. Read by recompute_master_place to set master_place.mvum_corridor. Never a master_place; never in Typesense. RLS ENABLED WITH NO POLICIES — service-role writes only (data/ ingestion), matching every sibling reference table.';
