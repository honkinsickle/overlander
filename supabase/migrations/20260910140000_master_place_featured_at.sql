-- ============================================================================
-- master_place.featured_at — editorial "Pin of the Week" curation stamp.
--
-- Records when a place was last chosen as a Pin of the Week so the selector
-- can (a) exclude already-featured places (never repeat one) and (b) weight
-- new picks toward geographic/category diversity relative to recent picks.
--
-- SNAPSHOT / CURATION COLUMN — same posture as master_place.state
-- (20260821010000) and master_place.photo_url (20260821070000): it is NOT a
-- precedence-resolved, source-derived field, so it is deliberately NOT wired
-- into recompute_master_place(). recompute only rewrites the columns in its
-- own field arrays, so it will neither set nor clear featured_at — the stamp
-- survives every recompute untouched. It is written only through the setter
-- helper below (the sole-writer invariant on master_place is about the
-- source-resolved fields; editorial snapshot columns have documented
-- precedent for a dedicated writer). Seeding field_precedence to make this a
-- recomputed field is a product decision reserved for Adam
-- (CLAUDE.md §"When uncertain") — flagged, deliberately not decided here.
--
-- Nullable: NULL = never featured (the common case).
-- ============================================================================

set search_path = public;

alter table public.master_place add column if not exists featured_at timestamptz;

comment on column public.master_place.featured_at is
  'Editorial "Pin of the Week" curation stamp: when this place was last featured on Instagram. NULL = never featured. NOT recompute-maintained — a curation snapshot written only via set_master_place_featured_at(). Used by the Pin of the Week selector to never-repeat and to weight diversity.';

-- Partial index for the "recent picks" / never-repeat queries (only featured rows).
create index if not exists master_place_featured_at_idx
  on public.master_place (featured_at desc)
  where featured_at is not null;

-- ---------------------------------------------------------------------------
-- set_master_place_featured_at() — the ONLY writer of featured_at.
--
-- Stamps featured_at = now() for one place and returns the value set. Raises
-- if the id does not exist so a caller can never silently mark nothing.
--
-- NOT SECURITY DEFINER, matching backfill_state_for_ids() /
-- backfill_master_place_photo_url(): master_place has RLS enabled with no
-- policies, so only the service role can actually write through this.
-- ---------------------------------------------------------------------------
create or replace function public.set_master_place_featured_at(p_master_place_id uuid)
returns timestamptz
language plpgsql
as $$
declare
  v_featured_at timestamptz;
begin
  update public.master_place
     set featured_at = now()
   where id = p_master_place_id
   returning featured_at into v_featured_at;

  if not found then
    raise exception 'set_master_place_featured_at: no master_place with id %', p_master_place_id;
  end if;

  return v_featured_at;
end;
$$;

comment on function public.set_master_place_featured_at(uuid) is
  'Stamp master_place.featured_at = now() for one place (Pin of the Week). Sole writer of featured_at. Raises if the id is unknown.';
