-- Phase 3: corridor status column
-- Spec §3.1 — each corridor row tracks its ingest lifecycle so re-runs
-- and parallel segment work can be reasoned about. Additive only;
-- existing rows backfill to 'pending'.

set search_path = public;

alter table public.ingestion_corridor
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'ingesting', 'complete'));

create index if not exists ingestion_corridor_status_idx
  on public.ingestion_corridor (status);

comment on column public.ingestion_corridor.status is
  'Lifecycle: pending → ingesting → complete. Set by ingest-corridor driver.';

-- Idempotency support for deploy-corridor.ts — the script keys upserts on
-- corridor name (segment_a_la_pnw, etc.). create unique index is the
-- idempotent form of a uniqueness constraint.
create unique index if not exists ingestion_corridor_name_uniq
  on public.ingestion_corridor (name);

-- ──────────────────────────────────────────────────────────────────────
-- source_record_view: lat/lng-exposed projection for clients that can't
-- call PostGIS functions inline (PostgREST). Read-only; the canonical
-- source_record.geometry column remains the source of truth.
-- Used by data/scripts/ingest-corridor.ts to fetch enrichment
-- candidates within a bbox.
-- ──────────────────────────────────────────────────────────────────────
create or replace view public.source_record_view as
select
  id,
  source_id,
  external_id,
  name,
  inferred_category,
  master_place_id,
  st_x(geometry) as lng,
  st_y(geometry) as lat,
  source_quality_score,
  is_active
from public.source_record
where is_active = true;

comment on view public.source_record_view is
  'Projection of source_record with lng/lat as plain columns for PostgREST clients.';
