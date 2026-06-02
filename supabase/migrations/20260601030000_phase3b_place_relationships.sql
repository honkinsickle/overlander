-- Phase 3b: place_relationships
-- Parent/child containment relationships between master_places, computed via
-- polygon containment (ST_Covers) in recompute_master_place (added in a later
-- migration). A child amenity "contained_in" a parent park. This is a
-- relationship, not a merge — both master_places remain distinct rows.
--
-- Design locked 2026-05-31; see data/entity-resolution/README.md
-- "Polygon containment: federate orphan amenities into containing parks".
--
-- This migration is schema-only. No function changes, no data. The
-- recompute_master_place containment logic and the one-time backfill land
-- in subsequent migrations/scripts.
--
-- CHECK constraints are explicitly named: future migrations that expand the
-- relationship_type enum (adjacent_to, managed_by, ...) need stable names to
-- ALTER cleanly across environments. Auto-generated names are unpredictable.

set search_path = public;

create table if not exists public.place_relationships (
  child_master_place_id  uuid not null references public.master_place(id) on delete cascade,
  parent_master_place_id uuid not null references public.master_place(id) on delete cascade,
  relationship_type      text not null
    constraint place_relationships_type_chk check (relationship_type in ('contained_in')),
  computed_at            timestamptz not null default now(),

  primary key (child_master_place_id, parent_master_place_id, relationship_type),
  constraint place_relationships_no_self_ref_chk check (child_master_place_id <> parent_master_place_id)
);

-- Bidirectional query support (locked design): parent→children and child→parents.
create index if not exists place_relationships_parent_idx
  on public.place_relationships (parent_master_place_id, relationship_type);

create index if not exists place_relationships_child_idx
  on public.place_relationships (child_master_place_id, relationship_type);

alter table public.place_relationships enable row level security;
