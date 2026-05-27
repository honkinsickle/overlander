-- Phase 1: source_record
-- One row per external POI record fetched from a source.
-- Idempotent on (source_id, external_id). Links to master_place via entity resolution.

set search_path = public;

create table if not exists public.source_record (
  id uuid primary key default gen_random_uuid(),

  -- Source identity.
  source_id text not null,
  external_id text not null,

  -- Link to master place (null until entity resolution runs).
  master_place_id uuid references public.master_place(id) on delete set null,

  -- Geometry (denormalized from raw_payload for spatial indexing).
  geometry geometry(Point, 4326) not null,

  -- Canonical name (denormalized for matching speed).
  name text not null,

  -- Inferred category (denormalized).
  inferred_category text,

  -- Raw and normalized payloads.
  raw_payload jsonb not null,
  normalized_payload jsonb not null,

  -- Quality + freshness.
  source_quality_score float not null default 0.5,
  fetch_timestamp timestamptz not null default now(),

  -- Lifecycle.
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (source_id, external_id)
);

create index if not exists source_record_geom_idx
  on public.source_record using gist (geometry);

create index if not exists source_record_master_idx
  on public.source_record (master_place_id);

create index if not exists source_record_source_idx
  on public.source_record (source_id);

create index if not exists source_record_name_trgm_idx
  on public.source_record using gin (name gin_trgm_ops);

create index if not exists source_record_active_idx
  on public.source_record (is_active)
  where is_active = true;

drop trigger if exists set_updated_at on public.source_record;
create trigger set_updated_at
  before update on public.source_record
  for each row execute function public.set_updated_at();

alter table public.source_record enable row level security;
