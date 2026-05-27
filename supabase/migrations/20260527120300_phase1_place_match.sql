-- Phase 1: place_match
-- The audit trail for entity resolution decisions.
-- Every source_record → master_place linkage is recorded here, including pending and rejected matches.

set search_path = public;

create table if not exists public.place_match (
  id uuid primary key default uuid_generate_v4(),

  source_record_id uuid not null references public.source_record(id) on delete cascade,
  master_place_id  uuid not null references public.master_place(id)  on delete cascade,

  -- Score components for debugging.
  distance_meters float not null,
  name_similarity float not null,
  category_compatibility float not null,
  combined_confidence float not null,

  match_method text not null,                       -- 'deterministic', 'manual', 'llm-assisted'
  status text not null default 'pending'            -- 'pending', 'confirmed', 'rejected'
    check (status in ('pending', 'confirmed', 'rejected')),

  resolved_by text,                                  -- 'auto' or operator email
  resolved_at timestamptz,
  notes text,

  created_at timestamptz not null default now(),

  unique (source_record_id, master_place_id)
);

create index if not exists place_match_source_idx
  on public.place_match (source_record_id);

create index if not exists place_match_master_idx
  on public.place_match (master_place_id);

create index if not exists place_match_status_idx
  on public.place_match (status)
  where status = 'pending';

create index if not exists place_match_confidence_idx
  on public.place_match (combined_confidence desc);

alter table public.place_match enable row level security;
