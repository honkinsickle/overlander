# Place-data resolver consolidation

**Status:** Decided (in a design-review conversation, 2026-08-21) — implementation pending
**Date:** 2026-08-21
**Supersedes (on adoption):** `docs/architecture/place-render-model.md`, specifically its description of the enrichment hydration path (Google `placeId`-keyed `POST /api/places/details`, lines ~297–299), the client cache model (per-component, ephemeral, un-lifted, lines ~310–313 and ~472–473), and the placement of `rating`/`reviewCount`/`priceTier`/`photoUrl` on the tile/enrichment response rather than `master_place` (lines ~600–601). Line numbers per last orientation pass — reconfirm against current file state before editing that doc.

## Context

A data-flow trace across the four surfaces that render place cards (Day Column, Date Detail, Search, Day-scoped browse) found four independent paths instead of one shared one:

- **Day Column** reads `Trip.days` (JSONB on `trips.payload`) only.
- **Date Detail** reads `Trip.days`, plus a live Google Place Details hydration keyed by `placeId` via `POST /api/places/details`.
- **Search** hits `/api/search-area`, fanning out to LIVE (Google + Foursquare — confirmed as the only two live sources) and FEDERATED (Typesense → `master_place`, which also carries RIDB/USFS/BLM as ingested corpus data rather than live fetches).
- **Day-scoped browse** hits a third endpoint, `/api/trip-browse/:tripId/:dayId`. `USE_FEDERATED_POIS` is confirmed off by default, so this surface is live-only in practice today.

Each surface has its own completeness rules, its own cache, its own id assumptions. Two concrete problems result:

- **Data gap:** `master_place` has no `rating`, `reviewCount`, or `priceTier` columns. RIDB, USFS, and BLM data reach surfaces only through `master_place`, not live fetches — how large a share of total surfaced cards that represents hasn't been measured, but it is not a trivial edge case. Federated-sourced cards render thinner than live Google/Foursquare cards as a structural consequence of the missing columns, independent of exact proportion.
- **Id bug:** federated rows get an `mp:`-prefixed id when added to a trip. Date Detail's hydration step looks up by Google `placeId`, so federated adds can't be re-hydrated later.

## Decision

Adopt a single unified place-data path:

1. **`master_place` carries `rating`, `reviewCount`, `priceTier`, `description`, and `photoUrl` as nullable columns on every row** — populated where a source has the data, explicitly null (not absent) where it doesn't. The goal is for the card-rendering layer to stop needing a source-dependent branch to decide whether these fields might be present; it can read fields directly, some of which may be null. (The current implementation of that branch — its exact condition and location — hasn't been confirmed and isn't asserted here.)

2. **A single `resolvePlaces()` service replaces `/api/search-area`, `/api/trip-browse/:tripId/:dayId`, and `POST /api/places/details`.** One signature — accepts ids, or bbox + filters, or day-corridor scope — always returns `BrowsePlace[]` in one canonical shape. Live Google/Foursquare fan-out still happens, but internally, behind this one interface rather than three separate route handlers each doing their own merge.

3. **`master_place.id` becomes the canonical id everywhere.** `Day.waypoints` stores this id regardless of entry surface. External ids (`google_place_id`, `ridb_id`, etc.) become fields the resolver uses internally, never the primary key downstream components branch on. `master_place.id` is a bare `uuid` (`gen_random_uuid()`, `supabase/migrations/20260527120100_phase1_master_place.sql:9`), distinct from both the `mp:<uuid>` tile id (applied only at the projection layer — `web/src/lib/trip-browse/federated.ts:174` — never stored) and `google_place_id`. So the resolver will still need an explicit normalization step between canonical id, the tile-layer `mp:` form, and `google_place_id` lookups — this is now a known requirement, not an open question.

4. **One shared client-side cache** (React Query, keyed by canonical id) that all four surfaces read and write through, replacing Date Detail's local hydration cache and Search's implicit per-request cache. A rating fetched during Search stays warm if the user opens Date Detail for the same place next.

## Explicitly out of scope

The JSONB persistence model (`trips.payload` read-modify-write) is a real, separate architectural question — concurrency, no partial updates — but it is not what produces the sparse-card symptom this decision addresses. It is flagged as known debt and deliberately not addressed here.

## Consequences

- `place-render-model.md` will need a pointer to this ADR once implementation begins, since this decision supersedes its description of the enrichment hydration path, the client cache model, and the placement of `rating`/`reviewCount`/`priceTier`/`photoUrl`.
- No BACKLOG item currently exists for this consolidation; step 1 (the nullable-column migration) is the first piece of implementation and is being scoped as its own task, separate from this ADR.
- `master_place.state` (currently a snapshot not wired into `recompute_master_place` — open item, tracked in STATE.md and the 2026-08-21 review ADR) is a separate, previously-identified gap. It is not known to be related to this consolidation beyond sharing the same table; worth a quick check once the new columns land, but not assumed as a consequence of this decision.

## Sequencing

Step 1 (nullable columns + backfill on `master_place`) is the first implementation step and does not by itself require any of steps 2–4. Steps 2–4 (resolver consolidation, canonical id migration, shared cache) are sequenced after step 1 lands and are not yet started as of this ADR's authoring.
