# PROPOSAL — Atlas Obscura oddities: TEST → PROD promotion scoping

**Status: SCOPING ONLY — not applied.** No PROD writes, no PROD schema
changes. This is a read-only investigation and a plan. Nothing here goes
live until Adam signs off on a specific option and timing.

**Source of truth for TEST state:** PR #309 (this session,
`ingest/ao-oregon-manual`), which landed AO editorial descriptions +
hero photos on 1,789 atlas_oddities source_records (of 2,870 on TEST),
plus two SQL migrations (`20260827180000`, `20260827180100`) extending
the description/photo pipeline to atlas_oddities. TEST-only; PROD has
zero atlas_oddities rows and zero of the two migrations applied.

---

## 1. What "promotion" actually means here

**There is no general TEST → PROD row-copy mechanism.** Repo search
confirms: `data/entity-resolution/promote.ts` is a match-outcome
application layer (ER pipeline), not a project-sync tool.
`data/pipeline/materialize.ts` is TEST-side ER application. Neither
copies rows from one Supabase project to another.

**Every prior PROD ingest of a new source has followed the same
pattern** (documented in STATE.md §2026-08-10, §2026-08-11, and the
`state-park-systems-enumeration` branch history):

1. `supabase link --project-ref nqzeywzcowujzyegxbsr` (relink CLI to PROD)
2. Swap `data/.env` `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to PROD
   values (backups live at `~/.config/overlander/env-backups/`)
3. `npm run -w data db:push-verify` (apply the source's migrations —
   this hits the CURRENTLY-linked project, which is why step 1 matters)
4. `npm run -w data ingest:manual -- --source <name> ...` (run the
   source's own ingester against PROD)
5. `npm run -w data materialize` at `ER_APPLY_BATCH_SIZE=25` (PROD's
   60-second `statement_timeout` kills batches of 100 or 500)
6. Search sync via `data/search/sync-typesense.ts`
7. Restore `data/.env` and CLI link to TEST

**Atlas Obscura's specificity:** the source ingester (PR #241,
`data/ingestion/sources/atlas-oddities.ts`) reads six per-state anchor
CSVs from `.context/ao-*-anchors.csv` and writes rows with `description
= null`, `photo = null`. The ENRICHED description + photo content from
PR #309 is NOT in those anchor CSVs — it lives in a separate manual
dataset at `/Users/adamwagner/atlas-obscura-{or,ca}/data/*.csv` and was
applied via `data/scripts/atlas-oddities-manual-content-ingest.ts`.

So a PROD promotion is not one step; it is two composed steps whose
order matters:

- **Step A: rows.** Run PR #241's anchor-CSV ingester against PROD.
  Produces ~2,870 atlas_oddities source_records + master_places, all
  with null descriptions and null photos.
- **Step B: enrichment.** Run PR #309's manual-content-ingest script
  against PROD. Populates description + photo on the OR/CA/LA subset
  (~1,789 rows). AZ/WA/NV/UT stay unenriched (see §5).

Between A and B, PR #309's two migrations (`20260827180000`,
`20260827180100`) must land on PROD too — they extend field_precedence
and the corridor RPC to include atlas_oddities as a source. Without
them, Step B updates source_record but nothing flows to master_place
or to the browse-facing RPC.

**Compatibility of PR #309's shape:** the AO rows on TEST after PR #309
use the same schema shape (source_record.normalized_payload,
master_place.description via field_precedence,
master_place.photo_url via backfill_master_place_photo_url) as every
other source on PROD today. No new tables, no new columns. The
scripts themselves are project-agnostic — the same code that ran
against TEST will run against PROD once the CLI is linked and
`data/.env` is swapped.

---

## 2. Density-cascade risk

### 2.1 What we know from PR #296 and PR #300–#305

**PR #296 (2026-08-26)** replaced corridor-city selection with a
strict 3-mile-to-day-polyline rule — no prominence, no spacing
suppression. Suburban corridors surface many more corridor cities per
day than before (measured at 21–29 on dense routes per the ADR).
`maxNodes` was raised from 4 to 40 as a pathology backstop.

**PR #300 (2026-08-27)** added `filterVisibleSpineItems()` — drops a
corridor city from the RENDERED spine (not the data) when its POI
pool has no real content. Later PRs (#301, #303) extended this rule
to fuel-only and undescribed-only pools.

**PR #305 (2026-08-27)** wired `prominence_score` all the way through
to `BrowsePlace` and made every rendered city surface a
prominence-ranked featured pick.

**The cascade concern:** the strict-proximity gate is geometric
(distance from route polyline). Adding POIs does NOT add corridor
cities — cities come from a gazetteer, not from POI density. But
adding POIs to a city CAN keep it in the rendered spine when
`filterVisibleSpineItems()` would have dropped it (empty pool), and
can shift which POI wins the featured pick within a city.

### 2.2 Geographic distribution of the ~1,787 enriched AO POIs

Measured this session against TEST via
`data/scripts/atlas-oddities-prod-scoping-density.ts`:

| state | enriched (PR #309) | all AO on TEST | enrichment coverage |
|---|--:|--:|--:|
| CA | 1,537 | 1,548 | 99.3% |
| OR | 227 | 227 | 100% |
| WA | 0 | 293 | 0% |
| NV | 0 | 294 | 0% |
| AZ | 0 | 309 | 0% |
| UT | 0 | 158 | 0% |
| (state NULL) | 23 | 39 | 59% |
| **total** | **1,787** | **2,868** | **62.3%** |

The state-NULL rows sit outside their state's TIGER polygon (out-of-
scope or borderline coordinates). They exist but wouldn't render on
any six-state corridor.

**CA dominates the enriched set at 86%.** OR is the other 13%. AZ/WA/
NV/UT contribute nothing to the enriched set today (§5).

### 2.3 What actually cascades — and what doesn't — when AO promotes

**Does NOT change on PROD from an AO promotion:**
- Number of corridor cities selected per day (gazetteer-derived,
  geometry-only per PR #296).
- Corridor city selection order (prominence, straight-line offset).
- Backfill anchor set (derived from `dayCorridorAnchors`, shared with
  bake per PR #295).

**DOES change on PROD from an AO promotion:**
- Pool composition inside each corridor city crossed by an
  OR/CA/LA-region route. New AO POIs become eligible pool members and
  can win featured picks / guarantee slots.
- Whether `filterVisibleSpineItems()` drops a city or not. A rural
  corridor city with no OSM/NPS/RIDB content today may render with an
  AO oddity as its only content after promotion. That is either a
  desirable rescue (real oddity worth a stop) or noise (obscure
  oddity in an unremarkable town).
- Featured-pick winner in cities where AO's `prominence_score` beats
  the incumbent. Not measured — `prominence_score` for atlas_oddities
  is defaulted (0.5 quality × prominence formula), so unlikely to
  dominate nps/ridb/state_parks in high-density places, but likely to
  surface in low-density-corpus places.

### 2.4 Whether this can be measured without touching PROD

**Partially — with caveats.** Two viable read-only paths:

**Path A: TEST-corpus corridor-RPC comparison.** Call
`pois_along_corridor` on TEST against an OR/CA route TWICE — once
with the current AO-enriched TEST state, once with atlas_oddities
temporarily excluded from the lateral join (achievable via a small
test-only clone of `pois_along_corridor` with the extended chain
reduced back to `nps/ridb/wikipedia`). The DIFF is the AO-driven
delta. Limitation: TEST corpus is ~8× larger than PROD (~160k
master_place vs 20.9k), so AO's proportional impact on TEST
UNDER-represents what it would be on PROD.

**Path B: PROD read-only shape query.** Read PROD's corridor-city
gazetteer + master_place distribution in OR/CA regions to characterize
current PROD-side density, then project TEST-observed AO POIs onto
those cities using AO's TEST coordinates. This is a paper simulation,
no writes. Requires briefly using PROD's service-role key for a
read-only query (per CLAUDE.md's env-swap runbook, no CLI relink
needed for a one-shot read). **Not done in this scoping pass** — the
task guardrail says "safe read-only queries" are allowed, but I want
Adam's explicit go-ahead before touching PROD credentials at all this
session, given how much this session already touched.

**Path C (rejected): dry-run against live PROD.** Would require
either writing rows to PROD and reverting (violates the "no PROD
writes" gate) or copying the PR #241/PR #309 pipeline to a
shadow-PROD staging project that doesn't exist. Neither is available.

**Recommendation:** Path A is worth doing as a follow-up MEASUREMENT
before Adam signs off on Option A/B/C in §5. Path B is worth doing
too. Path C is out. Neither Path A nor B is a substitute for a
post-promotion live check on real PROD trips — Adam should plan for
that regardless, i.e. treat the first hour after PROD ingest as a
sit-and-watch window.

**2026-08-27 UPDATE — Path A AND Path B both executed.** See
`docs/measurements/2026-08-27-ao-density-cascade.md`. Verdict: **safe
to promote, with product-shape caveats.** Corridor-city selection is
gazetteer-based (verified from source, not assumed) — no city adds or
drops. `filterVisibleSpineItems` is the only gate AO can affect. Across
8 sample corridors: 1,079 AO-only rows would be added to PROD (of
2,858 total enriched on TEST), 97 of them are 5+ miles from any
current PROD content (the upper bound on potential city-visibility
flips). AO becomes the majority of the real-content pool on 6 of 8
measured routes (rural corridors); a supplement on the dense CA + UT
routes. No data-integrity risk, no code-path issue — remaining
questions are product-shape (isolated-AO rate acceptable? rural-route
majority acceptable? markdown-in-descriptions needs a converter?),
not technical-safety.

---

## 3. Baked-trip impact

Per the session's frozen-snapshot lesson (§PR #302, `refreshCorpusTiles`
in `web/src/lib/trip-refresh/`): existing trips carry a snapshot of
`segmentSuggestions` at bake time. New corpus content does NOT
retroactively appear on old trips.

**Trips likely to be affected (i.e. whose route crosses OR/CA/LA
regions):**

- `la-to-portland` on PROD — in-scope by construction. Baked snapshot
  will be missing AO content until refreshed.
- User-generated PROD trips (count not queried this pass) that route
  through OR/CA/LA.
- The standing PROD instrument `4534add5-3787-4b5f-ade6-584ce0fc27e7`
  (San Diego → Portland) — definitely in scope; will not surface new
  AO content until refreshed.

**Trips NOT affected:**
- `la-to-deadhorse` (out of six-state scope; the corridor doesn't
  pass through OR/CA anyway per the 2026-07-31 de-link note in
  RUNBOOK).
- `dawson-vancouver-cassiar` (FROZEN, out of scope).

**Two paths after PROD ingest:**

- **Path A (default):** do nothing to existing trips. New AO content
  appears only on trips generated AFTER the ingest lands. Existing
  trips stay on their frozen snapshot. `refreshCorpusTiles` action
  from PR #302 is available if a user (or Adam) wants to refresh a
  specific trip; nothing runs automatically.

- **Path B (opt-in):** bulk-refresh PROD trips in OR/CA/LA scope. PR
  #302 exposes `refreshCorpusTiles(tripId)`; wrapping it in a batch
  script over `trips` rows whose route bbox intersects OR/CA is
  straightforward but a NEW piece of tooling that doesn't exist
  today. Cost is zero LLM (per PR #302) but non-zero DB write per
  trip.

**Decision point flagged for Adam:** which of A vs B. I'd default to
A on the "don't touch what isn't broken" reasoning; existing trips
are working today without AO content, and forcing a bulk refresh has
its own regression risk (PR #302's `refreshCorpusTiles` was verified
per-trip, not at bulk-scale). Adam's call.

---

## 4. Rollback plan

**Rollback IS clean.** atlas_oddities lives under a distinct
`source_record.source_id = 'atlas_oddities'`. Nothing cross-references
it under another source_id, and the ER matcher's outcomes are
recorded in `place_match` with `source_record_id` referencing the AO
row directly (not silent cross-source merges). Steps:

1. **Deactivate all AO rows on PROD.** One statement:
   `UPDATE source_record SET is_active = false WHERE source_id =
   'atlas_oddities'` — same posture as the six-state trim (STATE.md
   §2026-08-10). Rows stay in the DB, but recompute drops them from
   the resolution set.

2. **Recompute affected master_places.** Enumerate the mp_ids linked
   to the now-inactive AO rows, then loop `SELECT
   recompute_master_place(id)` — the same call the ingest script
   used. Each mp reverts to its non-AO description/photo (or NULL if
   AO was the only source contributing).

3. **Re-run `backfill_master_place_photo_url()`** on those mp_ids to
   clear AO-only photo_urls (the RPC is idempotent + self-correcting;
   it sets photo_url back to NULL when no non-inactive AO source
   remains).

4. **Search sync.** `master_place_search_export` re-projects on
   query; Typesense sync needs a run to push the delta to
   `places_prod`.

5. **Migrations (`20260827180000`, `20260827180100`) can stay applied
   on PROD** — they are additive (a new field_precedence row +
   extended precedence chain on two RPCs). With AO rows deactivated,
   the extended chain evaluates to zero AO contributions and behaves
   as if the migrations weren't there. If a full revert of the
   migrations is desired, both are `CREATE OR REPLACE` and can be
   reverted with the pre-2026-08-27 versions of each function; the
   field_precedence row is a single-row DELETE.

**Cost of rollback:** minutes of DB work + one Typesense sync. No
data loss, no user-facing surface reset beyond the immediate
disappearance of AO content on newly-generated trips. Existing
already-baked trips would be unaffected either way (they were
frozen snapshots).

**What rollback does NOT undo:** trips generated between PROD ingest
and rollback that BAKED AO content into their `segmentSuggestions`
snapshot. Those trips retain AO tiles in their snapshot until the
user regenerates or refreshes. That's a feature of the baked-trip
model, not a bug of this rollback plan.

---

## 5. Remaining gap — AZ/WA/NV/UT

The manual dataset supplied this session covers OR (230 rows), CA
statewide (1,564), and LA (245 near-subset). The other four
six-state entries — AZ 309, WA 293, NV 294, UT 158 (§2.2) — have no
manual enrichment. If OR/CA/LA promotes to PROD:

- OR + CA POIs render on PROD trips with editorial descriptions + AO
  hero photos.
- AZ/WA/NV/UT POIs render on PROD trips (after Step A of the promote)
  with null description and no AO photo. Google hydration would fill
  photo on some via `photo_source_url`, but description stays null;
  the tile shows the AO POI as an unenriched card.

**Three options for how to sequence this:**

- **Option A: promote OR/CA/LA now; AZ/WA/NV/UT later, same path.**
  Delivers real value on the highest-traffic corridors (I-5, CA
  coastal, Bay Area, LA basin) immediately. Two-part promotion.
  Content asymmetry across states until the other four ship.

- **Option B: wait for six-state manual dataset before promoting
  anything.** Uniform coverage on first PROD render. No content
  asymmetry. Delays known-good OR/CA content by however long
  AZ/WA/NV/UT manual data takes.

- **Option C: promote OR/CA/LA now, but ONLY THE ENRICHED subset.**
  Skip Step A's full row insertion for AZ/WA/NV/UT — only insert +
  enrich rows that have both an anchor CSV entry AND a manual
  content entry. PROD would carry 1,787 enriched AO POIs and zero
  unenriched ones. When the four other states supply content, add
  another 1,081 in one pass. **Requires custom tooling** — PR #241's
  ingester doesn't have a "filter to enriched only" mode; Adam or I
  would need to build a subset ingester or add a filter flag.

**Recommendation:** **Option A**, with Option C as a fallback if
Adam wants the AZ/WA/NV/UT tile-with-no-description look to be
avoided at PROD launch. Reasoning:

- OR/CA are exactly the corridors where AO content adds the most value
  (dense urban + coastal routes with many oddity-heavy cities).
- Rendering an unenriched AO tile on an AZ/WA/NV/UT-crossing trip is
  not worse than today (today those trips have no AO tile at all;
  after Option A they have an AO tile with a null description). The
  degradation is bounded.
- Option B punts an unknown-duration delay. AO enrichment for the
  other four states depends on Adam supplying the manual dataset;
  there is no pipeline to produce it.
- Option C's tooling cost is modest but not zero, and it splits the
  promote into two dissimilar steps (custom subset ingester + normal
  enrichment script) rather than the clean composed A + B in §1.

**This is Adam's call, not mine.** Flagging both the recommendation
and the reasoning.

---

## 6. Go / no-go recommendation

**No-go this session, at any timing.** Reasons:

1. §2.4 identifies two viable read-only measurement paths (Path A:
   TEST-corpus RPC diff; Path B: PROD read-only shape query). Neither
   has been executed. Density-cascade risk is characterized here in
   shape but not measured. A promotion decision without those two
   measurements is a decision without the numbers you'd want.
2. §3 flags a bulk-refresh-existing-trips option that hasn't been
   built or scoped. Adam's call whether to skip it (Path A) or scope
   it as pre-work (Path B).
3. §5 needs an Option A/B/C decision. All three are viable; the
   recommendation is A, but the input isn't mine.

**Suggested next steps (in order):**

1. **Adam decides on §5 A/B/C.** Everything downstream branches on
   this.
2. **Run the Path A measurement from §2.4** (TEST-corpus RPC diff on
   a representative OR/CA route). Read-only, small script, ~15 min
   of work.
3. **Decide on Path B from §2.4** (PROD read-only shape query). If
   yes, do it as a one-shot with explicit env swap + immediate
   restore.
4. **Decide on §3 baked-trip strategy** (Path A do-nothing vs Path B
   bulk-refresh). If Path B, build the batch wrapper first, verify
   on TEST.
5. **THEN** — and only then — plan the actual PROD promotion window
   with the full apply-path from §1.

Explicit list of things I could NOT safely investigate without
touching PROD, from this scoping pass:

- Exact PROD master_place density in OR/CA regions today (Path B
  above).
- PROD user-trip count/pattern in OR/CA-crossing scope (would need a
  read against `public.trips` on PROD).
- Whether PROD's `master_place_search_export` view + Typesense sync
  would be materially reshaped by the added AO rows (a read against
  the view's row count is safe; not done).
- Whether any PROD-side migrations are pending that would collide
  with `20260827180000` / `20260827180100`'s timestamps (`ledger`
  drift; not read).

None of these are blockers for the plan; they are inputs for a
higher-confidence go/no-go, and are all reachable via safe read-only
queries whenever Adam authorizes them.

---

## Appendix — measurements taken this session

- Density-by-state distribution of the enriched AO set on TEST:
  `data/scripts/atlas-oddities-prod-scoping-density.ts` output,
  §2.2 above.
- Prior TEST corpus counts: `docs/DATA_INVENTORY.md` §TEST as of
  2026-08-21 (160,703 master_place; 78,983 active source_record).
- Prior PROD corpus counts: `docs/DATA_INVENTORY.md` §PROD as of
  2026-08-11 (20,904 master_place; 20,527 active source_record).
- PR #309 ingest results: `docs/LOG.md` §2026-08-27 (Atlas Obscura
  manual content ingest).

No PROD reads or writes were performed for this scoping pass.
