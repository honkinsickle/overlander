# 2026-08-13 — Google Places grounding strategy (open question)

## Status

**OPEN.** This ADR documents an unresolved decision, not a resolved one. Its
purpose is to capture the constraints and tradeoffs discovered this session
so the next attempt at deciding starts from the current understanding rather
than re-discovering it. Deferred to a future session. The grounding dry-run
(infrastructure shipped in #218/#219/#220, see `docs/STATE.md`) should
**not** proceed until a strategic direction is chosen on the
Google-vs-alternative-vs-convergence question below.

## Context

The intended grounding sequence: ingest corpus → run the Google Places
resolver → attach a `google_place_id` to eligible `master_place` rows via
new `source_record`s → tiles render with `placeId` → the "yoTrippin
Verified" badge gates on `placeId` presence (#216, shipped).

The corpus is ready for grounding — the RIDB and OSM six-state campaigns
(`docs/STATE.md`, 2026-08-13) both completed this session. Nothing about
grounding itself has run yet.

**Estimated one-time grounding cost**, at current eligibility filters
(`campground`, `gas_station`, `lodging`, minus `gas_station` per an
operator call to drop it — not yet coded): **~$100 for six states, ~$500
for full US.**

**Estimated hydration cost for user-visible fields** (name, address, hours,
ratings, reviews, photos — the fields a rendered tile actually needs):
**~$510/month for 30k grounded places under proactive 30-day refresh**, or
variable-with-usage under lazy hydration (see Option A below).

## Constraints discovered

- **Google Maps Platform ToS**: `place_id` and coordinates are cacheable
  indefinitely; every other field (name, address, hours, ratings, reviews,
  photos) has a **30-day cache limit**.
- **"Ground once, cache forever" is not a legal option** under current
  Google terms — grounding produces a stable identity (`place_id`), not a
  stable value; the value side must be re-fetched on a cadence.
- **The $200/month promotional credit hides low-volume cost but does not
  exempt from usage limits.** Don't read "we're under the credit" as "this
  is free" — the 30-day cache constraint applies regardless of spend.

## Options considered — none decided

- **A) Ground via Google, hydrate lazily on user interaction.** Cost scales
  with usage, bounded by unique tile interactions per 30-day window.
- **B) Ground via Google, hydrate proactively on a 30-day refresh.**
  Predictable cost, scales with corpus size rather than usage (~$510/month
  at 30k grounded places, above).
- **C) Skip Google entirely. Use convergence (`source_count > 1`) as the
  verification signal.** Cheaper, weaker signal. The corpus currently has
  **16,512 of 16,521 rows single-sourced** — this is a **pre-RIDB/OSM
  measurement; the post-ingest number needs updating** (this session's
  work grew `master_place` total to 110,246, with 109,053 solo /
  1,193 multi-sourced — a very different ratio, though not filtered to
  the same eligibility/searchable scope the original 16,521 figure used,
  so the two aren't directly comparable without re-deriving under the
  same filter). Multi-source coverage improves as more sources land
  (PAD-US, USFS, BLM — see `docs/BACKLOG.md` §Pending ingest).
- **D) Alternative provider** (Overture Maps, Foursquare, Mapbox). Overture
  specifically permits permanent caching, which resolves the ToS
  constraint outright — but has different coverage tradeoffs, not
  evaluated here.
- **E) Google verify + OSM substitute for display.** Technically possible
  — verify identity/existence via Google, but render OSM's data instead of
  Google's — but **legally fuzzy** under Google's ToS: the "verify then
  display alternative data" pattern may violate the intent of their terms
  even if it satisfies the letter. Not recommended without a clearer ToS
  read.

## Related open decisions

- **Which places actually warrant grounding?** Category filter is
  currently eligible on `campground`, `gas_station`, `lodging`. The
  operator has called for dropping `gas_station` (Google already covers
  fuel lazily via the live search-area fanout; grounding it is redundant
  — see `docs/BACKLOG.md` §OSM fuel family retired for the parallel
  live-vs-corpus reasoning on the OSM side). **Not yet coded.**
- **Hydration architecture doesn't exist yet.** No code reads a
  `place_id`-bearing tile and pulls Google Place Details. Grounding
  produces the identity; hydration produces the value. They are separate
  infrastructure, and only the grounding-dry-run half has been built
  (#218–#220) — hydration is unbuilt regardless of which option above is
  chosen.

## Consequences

None yet — this is an open question, not a decision. The dry-run
infrastructure exists and can run at any time to produce a decision-quality
report (real candidate counts, `enriched_new`/`enriched_existing`/
`enriched_unknown` split), but running it without first choosing among
Options A–E risks generating a report nobody has agreed on how to act on.
