# 2026-08-09 — `reference_trips.is_active` (serve flag, additive)

Branch: `feat/reference-trips-is-active`. Migration:
`20260810120000_reference_trips_is_active.sql`. **Applied to TEST; PROD apply
is pending Adam's go.**

## Context

Two canonical trips (`la-to-deadhorse`, `dawson-vancouver-cassiar`) sit outside
the six-state planning region and are being retired from serve, but their
payloads must **stay in the DB** — Cassiar is FROZEN by an earlier decision
(never regenerate or touch), and Deadhorse is a large hand-derived reference
whose payload is not reconstructible on demand. #177 (2026-07-31) de-linked
them from user-facing app surfaces but the URLs still render because
`reference_trips` is anon-readable and `getReferenceTrip` returns whatever the
DB holds.

On TEST the situation is broader: eight rows are dev-era fixtures that were
never product content (`expedition-*`, `yotrippin-demo`, `alaska-south-*`,
`dawson-cassiar-livingplan-test`). Only `la-to-portland` should remain
serviceable there.

Two rejected shapes forced the pattern:
- **Delete the rows.** Rejected. Cassiar's freeze rule forbids touching the
  row; Deadhorse's payload is irreplaceable; TEST dev-era rows are historically
  useful for internal machinery. Deletion is irreversible.
- **Rename the id / move the row.** Rejected. Any id change breaks in-flight
  bookmarks, downstream instruments, and the fork path.

## Decision

Add a `boolean is_active default true` column to `reference_trips`. Filter it
at the **user-facing** read paths only. Preserve the row and its payload; hide
from serve. Additive — every existing row defaults to `true`, so no behavior
changes until an operator flips it.

### Filter callsites (user-facing paths only)
- `web/src/lib/trips/reference.ts` — split `tryFetchFromDb` into
  `tryFetchActiveFromDb` (filters `is_active=true`, used by
  `getReferenceTrip` and `getPersistedReferenceTrip`) and
  `tryFetchFromDbUnfiltered` (used only by `getAlaskaTrip`'s DB-first path).
- `web/src/app/api/trips/fork/route.ts` — `.eq("is_active", true)` on the
  fork lookup so an out-of-scope canonical trip returns 404 rather than
  spawning a fork.

### Explicitly NOT filtered
- **`getAlaskaTrip` internal snapshot-backed fallback** — retains its
  committed-snapshot fallback path so internal machinery (four waypoint-helper
  callers in `repository.ts` around `:94,108,120,181`) survives a hidden
  Deadhorse. `getReferenceTrip`'s user-facing entrypoint still goes through
  the filter.
- **Every other authoring path** — edit-actions upserts/deletes, node-actions
  upserts, `user-trips` reference lookups. Operators flip `is_active=true`
  temporarily when they need to edit a hidden row.

### Signature change accepted
`getReferenceTrip` was `Promise<Trip>`; it is now `Promise<Trip | null>` — a
filtered read of a hidden row is a legitimate miss. The snapshot fallback was
removed from this entrypoint so a hidden id genuinely returns `null` rather
than resurrecting from disk.

### Naming: `is_active` (not `is_published`, not `visibility`)
Chosen to mirror `source_record.is_active`, which is the exact same shape —
"exists in the DB, may or may not participate in serve." A single vocabulary
across both tables reduces cognitive load; the alternative names would
introduce a synonym without carrying any new semantics.

### Index: partial on `is_active = true`
`create index reference_trips_active_idx on reference_trips (is_active) where
is_active = true;` — the serve paths query the true side; a partial index
keeps it small and lookup-cheap.

## PROD apply plan (queued behind Adam's go)

1. `npm run -w data db:push-verify` (PROD linked, `.env` swapped from
   `~/.config/overlander/env-backups/.env.production-backup`). Migration is
   pure DDL + one comment; verifier reports "uncovered" for DDL by design, so
   the operator's eyes on the SQL are the check.
2. `UPDATE public.reference_trips SET is_active = false WHERE id IN
   ('la-to-deadhorse','dawson-vancouver-cassiar');` — batch of two.
3. Verify: unfiltered read shows 3 rows with `is_active=[true,false,false]`
   and Deadhorse's `payload_size` byte-unchanged from a pre-flip snapshot.
   Filtered read (mirroring the server helpers) returns only
   `la-to-portland`.
4. Restore `data/.env` and `supabase link` to TEST from the env backup;
   confirm the CLI ref matches TEST before ending the session.

## Consequences

- **Cassiar's freeze is preserved.** No row touched beyond a boolean flip; the
  payload column is inert.
- **Fork of a hidden id returns 404** rather than the payload — the fork route
  filters `is_active=true`.
- **A hidden reference URL 404s in the app** but the row remains reachable
  service-side (unfiltered admin reads) and via the internal snapshot fallback
  in `getAlaskaTrip`.
- **`REFERENCE_TRIP_IDS` unchanged.** That constant marks reference *behavior*
  (fork CTA, forces `canEdit=false`), not reachability — leaving Deadhorse in
  the list would resurrect its treatment on a serve if the flag were flipped
  back, which is exactly what we want.
- **PROD `search:sync` is NOT triggered by this decision** — reference_trips
  doesn't feed Typesense. The six-state corpus trim (separate decision,
  parallel workstream) will run its own sync.
- **Reversible.** `UPDATE ... SET is_active = true WHERE id = '<id>';` restores
  a row's serve visibility in one statement.
