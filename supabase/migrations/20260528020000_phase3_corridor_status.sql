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
