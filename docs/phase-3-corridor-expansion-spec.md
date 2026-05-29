# Phase 3: Corridor Expansion — Build Spec

**Phase:** 3 (data scale — turn proof on JT into the actual LA→Deadhorse trip data)
**Duration:** 2–4 days actively, plus monitored runtime
**Status:** Ready to execute
**Owner:** Adam (ACW Creative)
**Pre-reqs satisfied:** Phase 2.5 closed — materialize pipeline self-running, sync prunes, test isolation in place, all 12 D4 tests green in CI on every PR.

---

## 0. Mission

Feed the actual LA→Deadhorse corridor through the validated pipeline. The architecture is proven on 153 JT places; this phase scales the *data* by 1–2 orders of magnitude without changing the architecture. The success state: search the deployed `/search` at any reasonable point along the route and get sensible federated results — campgrounds in Banff, gas stations in Whitehorse, the Top of the World Highway POIs.

Critical framing: **this is a data + cost exercise, not a code exercise.** The matcher, promote, recompute, sync, and Typesense layers all work as-is at scale (modulo possible perf tuning that surfaces). What's new is the volume of data, the dollar spend on Google Places, and the operational discipline of running ingestion at scale without burning hours or money.

Out of scope: Phase 3b (polygon containment, audit CLI, seed-geometry refactor), search ranking tuning, place cards, native app, scheduling/cron of the pipeline. This phase ends when the corridor data is in `master_place` and searchable in production.

---

## 1. Acceptance criteria

1. The LA→Deadhorse corridor is defined as one or more `ingestion_corridor` records covering the actual route with a reasonable buffer.
2. All four sources have been ingested for the defined corridor (OSM + RIDB + NPS + Google Places), via the existing materialize pipeline with the `--ingest` flag.
3. Entity resolution has run over the full corpus and `master_place` reflects the corridor-wide federated dataset.
4. Typesense is synced to current `master_place` with stale-doc pruning verified.
5. Production `/search` returns sensible ranked results for hand-picked queries along the route (a dozen spot-checks: known NPS campgrounds, gas stations in named towns, established overlander stops).
6. Total Google Places API spend for the initial ingest stays under the agreed budget cap (default $100; raise if needed before exceeding).
7. The corridor ingestion is documented in `docs/` so re-running or extending it is a repeatable operation.

---

## 2. Strategic decisions (defaults — override if you want)

### 2.1 Segmentation strategy: staged, not all-at-once

Default segmentation, west-coast first then north:
- **Segment A — LA → Pacific Northwest:** California, Oregon, Washington (~1,500 mi). High data density (federal + state lands, populated areas). Validates the pipeline at a meaningful but bounded scale.
- **Segment B — Canada west:** BC + Alberta (Banff/Jasper corridor). Crosses border, validates non-US data (NPS doesn't apply, RIDB doesn't apply — OSM + Google carry).
- **Segment C — Yukon + Alaska Highway:** YT + AK to Deadhorse. Sparse data, mostly OSM + Google.

Ship Segment A first as a single PR (`feat/corridor-segment-a`). Validate. Then B and C in subsequent PRs. This bounds the cost per attempt and surfaces issues on cheap slices first. Doing the whole corridor in one shot makes any bug 3× as expensive to discover.

Override only if you have a reason to do it all at once — there isn't a strong one.

### 2.2 Corridor geometry: buffered route, not bbox

A bbox enclosing the LA→Deadhorse route is wildly wasteful (it includes the entire Pacific and most of central Canada). Use a **buffered polygon around the actual route line** — e.g., 50km buffer for populated stretches, wider in remote sections where you might detour. Stored as one or more `ingestion_corridor` records.

If buffer-polygon geometry queries turn out to be fiddly with the source APIs (some only accept bbox), split the buffered polygon into a series of overlapping smaller bboxes that approximate it. Trade slight redundancy for query simplicity. Per-segment, this means roughly 5–15 bboxes covering the buffered route through that segment.

### 2.3 Google Places discovery: anchor-first, not brute-force

Brute-force "find every campground in 500km of corridor" via Google Places Nearby Search is the path to spending hundreds of dollars. Instead:

**Anchor on free sources first.** Ingest OSM + RIDB + NPS for the segment. These cover the long tail of federal land, OSM-mapped POIs, and bookable facilities. Volume is high, cost is zero (Overpass + free APIs).

**Use Google Places in two narrower modes:**
- **Enrichment** on the places the free sources already found — `Place Details` lookups using a tight field mask (only fields the master_place schema actually uses: name, coordinates, types, rating, opening_hours, website, formatted_address). Cheap per call.
- **Targeted discovery** only in populated areas (towns, named places, established overlander stops) — `Nearby Search` with a small radius and type filters (campground, lodging, gas_station, restaurant, grocery_or_supermarket). Not in empty wilderness where Google's coverage is weak anyway.

This trades comprehensiveness in remote stretches (where Google has little data anyway) for an order-of-magnitude cost reduction. The federated architecture means OSM + free federal sources cover what Google misses out there.

### 2.4 Budget cap

Default: **$100 hard cap on Google Places spend** for the initial corridor ingest across all three segments. Adjust before running if you have a different number in mind. Implementation: log every Google API call with estimated cost, halt ingestion if running total exceeds the cap. The pipeline must fail loud, not silently overspend.

Subsequent re-runs should be near-free since (a) most places are already in `source_record` and only deltas would be re-fetched, (b) details lookups can be cached with reasonable TTL.

---

## 3. Deliverable 1 — Corridor definition

### 3.1 Generate the corridor geometry

Use the route data you already have (the existing trip CSV / planning data) to compute a buffered route polygon for each segment. Approaches:

- If a routing service (OSRM, Mapbox, Google Directions) gives a polyline, use that as the centerline and buffer it (PostGIS: `ST_Buffer(line::geography, 50000)` for 50km).
- If only waypoints exist, snap to roads first via a routing service, then buffer.
- For initial pragmatism: a series of overlapping circles around the trip's day-stop waypoints (a 75km circle around each day's planned camp) approximates the corridor closely enough at this stage, is trivial to compute, and degrades to bbox queries cleanly.

Persist each segment as one row in `ingestion_corridor` with name (`segment_a_la_pnw`, etc.), the polygon geometry, and a status field (`pending`/`ingesting`/`complete`).

### 3.2 Per-source bbox extraction

Each ingester accepts a bbox. Derive a covering set of bboxes from the segment's polygon — either the polygon's bounding box (if small enough — typically <500km on a side) or a tiled set of smaller bboxes that approximate the polygon. The materialize pipeline's `--bbox` flag drives this per source.

Commit: `feat(corridor): define LA-Deadhorse corridor segments with buffered route geometry`.

---

## 4. Deliverable 2 — Cost-aware ingestion

### 4.1 Per-source ingest passes for Segment A

Run, in this order (cheapest first, so failures cost nothing):

1. **OSM** via Overpass (kumi.systems mirror). Likely needs to be chunked into smaller bboxes per query — Overpass has memory limits and timeouts. Expect thousands of rows for Segment A. Free.

2. **RIDB** — US federal bookable facilities for the segment's states (CA, OR, WA). The API is fast and bounded. Free.

3. **NPS** — parks + campgrounds for the segment's states. Includes the boundary polygon fetches. Free.

4. **Google Places**, the anchor-first hybrid:
   - **Enrichment pass:** for each existing `source_record` from OSM/RIDB/NPS in the segment, do a `Place Details` lookup keyed by (name + coords) → text search to find the matching Google place_id → details fetch with tight field mask. Cache the result keyed by master_place candidate, so re-runs don't re-fetch.
   - **Discovery pass:** for each populated-area anchor (towns, named overlander stops, fueling waypoints), run `Nearby Search` with a small radius (~5km) and the type filters. Cap calls per segment.

### 4.2 Cost guard

Wrap the Google Places client in a cost meter. Every call increments the running total (use Google's published per-SKU pricing as the cost model — Place Details with the chosen field mask, Nearby Search per call). Persist the running total in a small `ingestion_cost_ledger` table (or a JSON file in the segment's directory) so re-runs are aware. Hard-stop with a clear error message if the cap is hit.

If the actual cost diverges from estimate (Google's billing model has caveats), log enough detail (per-call SKU breakdown, response sizes) to reconcile against the real bill later.

Commit: `feat(corridor): cost-metered google places client with hard-stop guard`.

### 4.3 Run Segment A ingest

Trigger via the materialize orchestrator with the `--ingest --sources <list> --bbox <segment-bboxes>` flags. Sequential per source. Expect ingest runtime per source on the order of 5–30 minutes for Segment A; total wall time maybe 1–2 hours.

Stop and report after Segment A ingest, before ER. Include: per-source row counts added, Google Places spend total + budget remaining, any errors or rate-limit retries hit.

---

## 5. Deliverable 3 — Materialize at corridor scale

Run `npm run -w data materialize --rematerialize` over the now-populated source_records for Segment A's bbox set (constrain ER to the corridor; the orchestrator already accepts `--bbox`).

Things to watch that worked at JT scale (153 records) but may surface at corridor scale (thousands):

- **ER runtime.** At 219 records, ER ran in 56s post-perf-pass. At 5–10K records, expect minutes. If it exceeds ~10 min for a segment, surface it — there may be a remaining N+1 the JT corpus didn't hit.
- **Outcome distribution.** Watch for ratios shifting unexpectedly: the JT corpus was 152 new / 16 linked / 16 rolled-up / 35 pending. At corridor scale, dramatically different ratios (e.g., 90% pending) would indicate the matcher rules are misfiring on data shapes the JT fixtures didn't cover.
- **Orphan amenities.** The 28 orphan dump-stations at JT scale up linearly. Expect hundreds across the corridor. Logged metric, not blocker — 3b's polygon containment is the fix.
- **Memory / connection pool.** Supabase free-tier has connection limits; bulk operations may need batching adjustments.

Then sync to Typesense (the existing `search:sync`, called by the orchestrator), with prune verification — confirm no stale docs from the JT-only era remain.

Commit: `feat(corridor): segment A materialize + sync at scale`.

---

## 6. Deliverable 4 — Validation

### 6.1 Spot-check queries

Hand-pick a dozen queries that exercise the corridor breadth:

- "campground" near specific known points: a known California state park, a known Oregon coastal campground, a known Washington Cascades campground.
- "gas station" near sparse rural stretches (verify Google enrichment worked in populated areas).
- Named place lookups: "Crater Lake," "Olympic," "Mt Hood" — verify NPS authority on canonical_name wins.
- Federal-land facets: filter by `is_federal=true` near a known NPS area, confirm sensible results.

For each: hit `/search` (production) or call the search function directly, confirm top results are real places at sensible distances. Document any obvious quality issues (wrong source winning a field, orphans cluttering results, distance ordering off).

### 6.2 Document findings

Append a brief "Segment A validation" note to `data/entity-resolution/README.md` or a new `docs/corridor-validation.md` — what worked, what surprised, anything that needs fixing before Segments B and C.

---

## 7. Deliverables 5–6 — Segments B and C

Repeat steps 3–6 for Segment B (Canada west) and Segment C (Yukon + Alaska), each as its own PR. Adjustments per segment:

- **Segment B (Canada):** RIDB and NPS don't apply. Lean on OSM + Google. Canadian federal/provincial park data is patchy in OSM; Google enrichment becomes more important. Different field expectations (canonical_name precedence may want to defer to OSM for Canadian places where Google is the only other source).
- **Segment C (Yukon/Alaska):** Sparse everything. OSM is the workhorse. Google has minimal coverage in remote AK; the anchor-first strategy means we won't waste calls discovering nothing. Expect very long stretches with few POIs.

Cost expectations: Segment B and C combined should cost less than Segment A on Google Places — fewer populated areas to discover in, fewer anchors to enrich.

Commits: `feat(corridor): segment B|C materialize + sync`, one per PR.

---

## 8. Execution order

This is three PRs (one per segment), each through the PR + CI flow, each merged via `gh pr merge <N> --squash`.

For each segment:

1. Corridor definition (Deliverable 1) — generate the buffered geometry, persist `ingestion_corridor` rows.
2. Per-source ingestion with cost guard (Deliverable 2) — OSM → RIDB → NPS → Google in order; stop and report after Google spend.
3. Materialize at scale (Deliverable 3) — orchestrator with `--rematerialize` (first segment) or incremental (subsequent), then sync.
4. Validation (Deliverable 4) — spot-check queries, document.

Stop and report between Deliverables 2 and 3 of Segment A specifically — that's the highest-risk transition (first time ER runs at non-trivial scale) and worth a checkpoint before scaling further.

---

## 9. Constraints

- Existing PR + CI flow, branch protection, `typecheck` required.
- Secret discipline: any new API credentials direct to `.env` via terminal, never echoed.
- The cost guard is non-negotiable: ingestion must hard-stop on budget cap, not exceed silently. If you can't verify the cost meter is working, don't run the ingest.
- Re-runs must remain idempotent: running ingest twice for the same segment with the same data should produce the same end state and not double-spend on Google.
- The orchestrator (`materialize`) is the entry point. Don't reach around it to call ingesters or sync directly.
- Bear in mind this work is happening alongside Adam's actual departure (May 29, 2026, the trip itself) — graceful pause/resume is expected if scope contracts.

---

## 10. What this proves

When all three segments land, the product crosses from "proof on Joshua Tree" to "covers the trip you're actually taking." Search at any point along the LA→Deadhorse route returns federated results — the same architecture validated on 153 JT places, now operating across thousands of places spanning four sources and 3,000 miles. That's the moment the search experience is genuinely usable for the trip rather than a demo. Phase 3b (polygon containment for orphan amenities, audit CLI for pending matches) and search refinement (scope selector, ranking tuning, place cards) become the natural follow-ups, informed by real corridor data and any quality issues it surfaces.
