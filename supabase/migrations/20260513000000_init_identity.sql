-- Identity sprint, Day 1.
-- Three tables behind RLS:
--   users           — profile row, 1:1 with auth.users, owner-only
--   reference_trips — canonical seed trips, public-read, service-write
--   trips           — user-owned forks, owner-only
--
-- The full Trip / Day / Waypoint shape lives in `payload jsonb` so the
-- TS types in lib/trips/types.ts stay authoritative. Switching to a
-- normalized schema is a non-goal for this sprint.

set search_path = public;

-- ─── users ────────────────────────────────────────────────────────────
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  rig_name    text,
  rig_type    text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users_select_self"
  on public.users for select
  using (auth.uid() = id);

create policy "users_insert_self"
  on public.users for insert
  with check (auth.uid() = id);

create policy "users_update_self"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ─── reference_trips ──────────────────────────────────────────────────
create table if not exists public.reference_trips (
  id              text primary key,
  title           text not null,
  payload         jsonb not null,
  source_version  text not null,
  updated_at      timestamptz not null default now()
);

alter table public.reference_trips enable row level security;

-- Public read so anon viewers can hit /trip/la-to-deadhorse without auth.
create policy "reference_trips_public_read"
  on public.reference_trips for select
  using (true);

-- No insert / update / delete policies → only the service-role key
-- (which bypasses RLS) can write. Seed script uses service role.

-- ─── trips ────────────────────────────────────────────────────────────
create table if not exists public.trips (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null references public.users(id) on delete cascade,
  reference_id  text references public.reference_trips(id) on delete set null,
  title         text not null,
  state         text not null default 'draft'
                  check (state in ('draft', 'active', 'logged')),
  payload       jsonb not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.trips enable row level security;

create policy "trips_select_owner"
  on public.trips for select
  using (auth.uid() = owner_id);

create policy "trips_insert_owner"
  on public.trips for insert
  with check (auth.uid() = owner_id);

create policy "trips_update_owner"
  on public.trips for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "trips_delete_owner"
  on public.trips for delete
  using (auth.uid() = owner_id);

create index if not exists trips_owner_idx on public.trips(owner_id);

-- ─── updated_at trigger ───────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists set_updated_at on public.users;
create trigger set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.reference_trips;
create trigger set_updated_at
  before update on public.reference_trips
  for each row execute function public.set_updated_at();

drop trigger if exists set_updated_at on public.trips;
create trigger set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();
