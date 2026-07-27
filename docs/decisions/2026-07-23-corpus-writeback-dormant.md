# Corpus write-back (`enqueueResolvedPlaces`) is built and deliberately dormant — do not delete it

> ## ⚠️ SUPERSEDED IN PART — 2026-07-27
>
> **The factual premise below is stale. `enqueueResolvedPlaces` no longer has zero
> callers; it has two**, and has had since it was wired at the two TEST-guarded
> persist points:
>
> - `generateExpeditionTripAction` (`web/src/lib/plan/expedition-actions.ts`) —
>   after a successful persist
> - the NL re-plan path (`web/src/lib/itinerary/edit-actions.ts`) — same shape
>
> `[grep: three hits repo-wide — the definition and these two call sites]`.
> `ingest.ts`'s own module docstring now says so explicitly: *"**WIRED** at the two
> TEST-guarded persist points … each AFTER its successful persist"* `[read source]`.
> Both callers refuse unless the project resolves to TEST, so this still only ever
> writes on TEST — but "dormant" is the wrong word for it now. Measured 2026-07-27:
> TEST carries 47 `google_resolved` `source_record` rows; PROD carries zero
> `[queried catalog, TEST + PROD]`.
>
> **What still holds:** everything below about *why* the write is
> `source_record`-only, why promotion to `master_place` stays a manual
> `materialize`, why the shape is grounded, and why the function must not be
> deleted. The reasoning is intact. Only the call-count claim is wrong.
>
> **Why this correction is recorded rather than the original being edited:** this
> ADR was cited as authoritative during the 2026-07-27 client-boundary
> investigation and produced a wrong conclusion — the investigation nearly
> declared half its own scope moot on the strength of "zero callers". A decision
> record that asserts a call count is a claim with a shelf life, and this one
> outlived its accuracy silently. See `docs/LOG.md` 2026-07-27.
>
> **Also settled on 2026-07-27, and relevant to any future wiring decision:**
> `upsert_source_record` (the RPC this function calls) is SECURITY INVOKER, and
> `source_record` has RLS enabled with **zero policies**. So write-back works only
> under a service-role client; a `GRANT` to `authenticated` would not help.
> Details: `docs/BACKLOG.md` §Client boundary.

**Status:** Decided 2026-07-23; **call-count premise superseded 2026-07-27 (see
above)**. `enqueueResolvedPlaces` (`web/src/lib/itinerary/ingest.ts`) is built,
correct, tested-shaped, and was at the time of writing wired to nothing. It is not
dead code and must not be deleted as such. Promotion of what it would write is a
manual, human-gated step by design.
**Date:** 2026-07-23.

---

## What was decided

The itinerary generator resolves the place names it proposes against Google, and a
function exists to persist those resolutions back into the data layer —
`enqueueResolvedPlaces`. The decision is to **leave it wired to nothing**: it is
reachable, its behavior is settled, but no code path calls it. Write-back is
dormant, not absent, and turning it on is a deliberate future act, not a missing
connection.

## Why it is a `source_record`-only write, promoted by hand

`enqueueResolvedPlaces` upserts each resolved place as a **`source_record`** under
`source_id = "google_resolved"`, via the existing idempotent `upsert_source_record`
RPC (idempotent on `(source_id, external_id = google:<place_id>)`). It **moves
nothing in `master_place`** and does **not** trigger entity resolution. Promotion
into `master_place` is a separate, manual `npm run -w data materialize` — a human
decision. So even fully wired, write-back only *accumulates raw resolved records*;
they graduate to the searchable unit when a person runs materialize. This is the
same additive, human-gated posture as every other corpus source (CLAUDE.md
§STANDING RULES: corpus materialize is additive only).

## Why this is the grounded shape

The chain is honest end to end: **the model proposes a name, Google resolves it,
and only what actually resolved is kept** — with real provenance
(`source_id = google_resolved`, `external_id = google:<place_id>`). Nothing the
model *invented* is persisted; a name that doesn't resolve produces no row. That
satisfies grounding (every field real or absent, never invented) at the write
boundary, which is exactly why the write is safe to build and leave dormant: the
records it would create are trustworthy by construction.

## Why dormant rather than deleted, or rather than wired

- **Not deleted.** Deleting it as "dead code" would throw away a correct,
  grounded capture path that the corpus-first future (see
  [search-architecture-resolved](2026-07-23-search-architecture-resolved.md))
  will want. Its zero-caller state is a *decision*, not an oversight; a reviewer
  removing it would be undoing that decision without knowing it existed. This ADR
  is the record that stops that.
- **Not yet wired.** Wiring it would capture **only the places trips actually
  touch**, and **Google-only**. That makes it **strongest in the US corridor**
  (where trips concentrate and Google is dense) and **weakest north of Fort
  Nelson**, where OSM — not Google — is the reliable stack. So switched on today
  it would deepen the corpus exactly where it is already deepest and add little
  where coverage is thin. It is a corridor-densification tool, not a
  corridor-*extension* tool.

## What would revisit this

Wire `enqueueResolvedPlaces` in when (a) trip-touched, Google-resolved
densification of the US corridor is the goal — its natural strength — or (b) it is
paired with an OSM-first ingestion path for the northern corridor so write-back is
not the only source where Google is the wrong stack. Either way, wiring it changes
*capture*, never *promotion*: `master_place` still advances only on a manual
materialize. If that manual gate is ever removed, revisit this decision first — the
dormancy and the human gate are one design, not two.
