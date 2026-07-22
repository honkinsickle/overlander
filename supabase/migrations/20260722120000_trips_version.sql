-- Optimistic-concurrency version on public.trips.
--
-- public.trips.payload is written by a non-transactional read-modify-write
-- (updateUserTripPayload); two concurrent writes lost-update each other today,
-- and this bites on every waypoint add/remove (two whole-payload writes each).
-- `version` lets the RMW guard its write (.eq("version", v)) and detect a
-- conflict (0 rows affected) instead of silently clobbering.
--
-- `default 0` backfills existing rows (9 on PROD). No behavior change until the
-- app reads/writes the column. Lands on TEST first; PROD is a separate step.
alter table public.trips
  add column if not exists version integer not null default 0;
