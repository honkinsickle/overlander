-- Phase 1: master_place
-- Canonical, deduplicated place record. One row per real-world place.
-- Field values are derived from source_records via resolve_field() (added in a later migration).
-- Never written to directly except by recompute_master_place().

set search_path = public;

create table if not exists public.master_place (
  id uuid primary key default uuid_generate_v4(),

  -- Identity (derived from sources, can be overridden manually)
  canonical_name text not null,
  alternative_names text[],

  -- Classification
  primary_category text not null,
  secondary_categories text[],
  overlander_tags text[],

  -- Geometry
  geometry geometry(Point, 4326) not null,
  geometry_polygon geometry(Polygon, 4326),

  -- Resolved fields from the card data matrix.
  -- Populated by recompute_master_place() via resolve_field().
  description text,
  amenities jsonb,
  hours jsonb,
  contact jsonb,
  access jsonb,
  services jsonb,
  capacity jsonb,
  seasonality jsonb,
  cell_signal jsonb,

  -- Provenance: which source contributed which field.
  attribution jsonb not null default '{}'::jsonb,

  -- Computed ranking signal.
  prominence_score float not null default 0,

  -- Metadata.
  source_count integer not null default 0,
  last_resolved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists master_place_geom_idx
  on public.master_place using gist (geometry);

create index if not exists master_place_polygon_idx
  on public.master_place using gist (geometry_polygon)
  where geometry_polygon is not null;

create index if not exists master_place_primary_category_idx
  on public.master_place (primary_category);

create index if not exists master_place_name_trgm_idx
  on public.master_place using gin (canonical_name gin_trgm_ops);

create index if not exists master_place_overlander_tags_idx
  on public.master_place using gin (overlander_tags);

create index if not exists master_place_prominence_idx
  on public.master_place (prominence_score desc);

-- Reuse the set_updated_at() function from 20260513000000_init_identity.sql.
drop trigger if exists set_updated_at on public.master_place;
create trigger set_updated_at
  before update on public.master_place
  for each row execute function public.set_updated_at();

-- RLS: enable with no policies. Service role bypasses; clients have no access yet.
-- Phase 2 will add a public-read policy when the search/card UI ships.
alter table public.master_place enable row level security;
