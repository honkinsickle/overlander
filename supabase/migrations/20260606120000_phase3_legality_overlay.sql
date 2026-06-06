-- ============================================================================
-- Phase 3 — legality_overlay reference table + upsert RPC.
--
-- Search-excluded legality reference polygons (BC TANTALIS Crown tenures =
-- EXCLUSIONS, later: dissolved private, parks, Wilderness, optional open-Crown
-- base). Read by recompute_master_place (proposed Step 6.6, not in THIS
-- migration) to set a contained dispersed point's legality via
-- most-restrictive-wins. NEVER a master_place; never in Typesense. Mirrors the
-- mvum_roads reference-table pattern.
--
-- Reconciles the repo with prod: as of 2026-06-06 the table + RPC do NOT exist
-- on prod (verified read-only via PostgREST PGRST205 + OpenAPI). This migration
-- is the single source of truth.
--
-- Idempotent + ADDITIVE: create table/index IF NOT EXISTS, create-or-replace
-- the RPC, RLS on the NEW table only. No ALTER/DROP on existing objects.
--
-- Geometry contract: the federated WFS runner (data/ingestion) emits overlay
-- geometry as EWKT ('SRID=4326;POLYGON(...)' / 'MULTIPOLYGON(...)'), so the RPC
-- takes EWKT text (st_geomfromewkt) — not GeoJSON. (The earlier proposal sketch
-- used GeoJSON; EWKT matches the adapter output and avoids a re-encode.)
--
-- APPLY-PATH (NOT applied in this commit): db:push-verify, then (only when the
-- recompute Step 6.6 lands) recycle PostgREST + materialize. This migration is
-- pure DDL — no master_place write, no recompute change — so it can apply
-- independently of any recompute swap.
-- ============================================================================

set search_path = public;

-- 1. Reference table. MultiPolygon (tenures are frequently multi-part); BC
--    native SRID 3005 is reprojected to 4326 at ingest, consistent with the
--    rest of the pipeline. unique (source, source_id) → idempotent upserts.
create table if not exists public.legality_overlay (
  id              uuid primary key default gen_random_uuid(),
  source          text not null,                        -- e.g. 'bc_crown_tenures'
  source_id       text not null,                        -- stable per-source key (OBJECTID / INTRID_SID)
  geom            geometry(MultiPolygon, 4326) not null,
  legality_status text not null
    check (legality_status in ('restricted','allowed','unknown')),
  designation     text,        -- 'crown_tenure' | 'private' | 'wilderness' | 'park' | 'open_crown'
  tenure_type     text,        -- BC TENURE_TYPE / PAD-US Des_Tp / source-native type
  status          text,        -- TENURE_STATUS / lifecycle
  attrs           jsonb not null default '{}'::jsonb,    -- raw provenance attributes
  loaded_at       timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists legality_overlay_geom_gist
  on public.legality_overlay using gist (geom);
create index if not exists legality_overlay_status_idx
  on public.legality_overlay (legality_status);

alter table public.legality_overlay enable row level security;  -- reference data; service-role write only

comment on table public.legality_overlay is
  'Phase 3: search-excluded legality reference polygons (Crown tenures, private, parks, Wilderness, optional open-Crown base). Read by recompute_master_place to set a contained dispersed point''s legality (most-restrictive-wins). Never a master_place; never in Typesense. Mirrors mvum_roads.';

-- 2. Idempotent loader RPC (mirrors upsert_mvum_road). Takes EWKT text (the
--    runner's overlay geom format); coerces Polygon→MultiPolygon, defaults SRID
--    to 4326 when absent. on conflict (source, source_id) → replace.
create or replace function public.upsert_legality_overlay(
  p_source text,
  p_source_id text,
  p_geom_ewkt text,
  p_legality_status text,
  p_designation text default null,
  p_tenure_type text default null,
  p_status text default null,
  p_attrs jsonb default '{}'::jsonb
) returns void
language plpgsql
volatile
as $$
declare
  v_geom geometry;
begin
  v_geom := st_geomfromewkt(p_geom_ewkt);
  if st_srid(v_geom) = 0 then
    v_geom := st_setsrid(v_geom, 4326);
  end if;
  if st_geometrytype(v_geom) = 'ST_Polygon' then
    v_geom := st_multi(v_geom);
  end if;

  insert into public.legality_overlay
    (source, source_id, geom, legality_status, designation, tenure_type, status, attrs, loaded_at, updated_at)
  values
    (p_source, p_source_id, v_geom, p_legality_status, p_designation, p_tenure_type, p_status,
     coalesce(p_attrs, '{}'::jsonb), now(), now())
  on conflict (source, source_id) do update set
    geom            = excluded.geom,
    legality_status = excluded.legality_status,
    designation     = excluded.designation,
    tenure_type     = excluded.tenure_type,
    status          = excluded.status,
    attrs           = excluded.attrs,
    updated_at      = now();
end;
$$;

comment on function public.upsert_legality_overlay(text,text,text,text,text,text,text,jsonb) is
  'Phase 3: idempotent legality_overlay loader. Accepts EWKT geometry (SRID-4326 polygon/multipolygon from the federated WFS runner), coerces Polygon→MultiPolygon. Mirrors upsert_mvum_road. Service-role write only.';
