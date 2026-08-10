-- ============================================================================
-- Add is_active column to reference_trips so out-of-scope canonical rows can
-- be hidden from user-facing serve paths without deletion. Matches the
-- source_record.is_active pattern (default true, partial index on true rows).
--
-- Consumers filter on is_active in the user-facing read paths:
--   - /api/trips/fork route (fork API)
--   - lib/trips/reference.ts tryFetchFromDb (shared read helper used by
--     getReferenceTrip + getPersistedReferenceTrip)
--
-- Internal authoring paths (edit-actions upserts/deletes, node-actions
-- upserts, user-trips reference lookups, snapshot-backed getAlaskaTrip)
-- deliberately do NOT filter — an operator flips is_active=true to edit.
--
-- ADDITIVE. No data change. Default true preserves existing behavior for
-- every row until explicitly flipped.
-- ============================================================================

alter table public.reference_trips
  add column if not exists is_active boolean not null default true;

comment on column public.reference_trips.is_active is
  'Serve to users. When false, the row exists (payload preserved) but is hidden from the fork API and reference-trip serve helpers. Internal snapshot-backed getAlaskaTrip keeps its offline fallback path.';

create index if not exists reference_trips_active_idx
  on public.reference_trips (is_active) where is_active = true;
