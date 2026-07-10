# YoTrippin — Expedition Planner Spec

> **YoTrippin** — *tu compadre.* Your expedition trip planner.

**Branding:** the product is **YoTrippin** ("tu compadre"), positioned as *your
expedition trip planner*. `overlander` is the repo/engine/substrate name — a
codebase label, not product-facing. Lead all product copy with YoTrippin;
`overlander` refers to the corridor engine + POI corpus it's built on.

**Status:** Draft for review. Scope covers the product framing + all 4 stages;
Stages 1–2 are scoped to buildable detail. The four Stage-1/2 design decisions
(§9) are **SETTLED** (one-pass generation, fuel-POI layer as prerequisite, border
detection in Stage 1, seasonal advisory-first). Do not build from this yet.

**Companion docs:** the GPTv0.7 Overlanding Master Prompt (the reasoning
contract), `OVERLANDING REFERENCE ALASKA SOUTH.md` (the input template, §01–08),
and `ALASKA_SOUTH_ITINERARY.md` (the prototype — the **target output**, a manually
generated 19-day Chicken→Vancouver leg).

---

## 0. Framing — this is the product; the corridor work is the substrate

Everything shipped this session is the **ground-truth substrate**, not the
product:

- **Corridor derivation engine** — `routeBetween` → `segmentByPace` →
  `deriveCorridorCities` produces real routes, day segmentation, and the city
  spine.
- **POI corpus** — `master_place` + `pois_along_corridor` → real, sourced,
  place_id-backed POIs (fuel/camp/food/scenic), bucketed into the spine, ~46%
  Google-hydratable (live rating/hours/photos).
- **Day Detail column** — renders the spine + bucketed POI tiles + rich detail.
- **Trip creation** (fork / wizard) + the trip data model (`trips.payload`).

**THE PRODUCT is a navigation-grade expedition reasoning planner built on that
substrate.** The substrate supplies facts you can trust in the field; the planner
is the reasoning + audit layer that turns sparse anchors into a complete,
navigable, reasoned itinerary. The planner never builds a new render surface — it
**richly populates the Day Detail column this session built.**

---

## 1. Core value

> **Sparse anchors + parameters → a complete, reasoned, navigable itinerary.**

The user gives a few **anchor places**, some date-pinned, some flexible:

- `Chicken, AK — Jul 9 — start`
- `Dawson City, YT — Jul 10 — FIXED`
- `Hyder, AK — sometime — 2 days`
- `Vancouver, BC — Jul 27 — FIXED, arrival`

…plus start/end dates and parameters (rig profile + trip params, §01–02 of the
reference doc). The system generates **the entire day-by-day between the
anchors** — routing, daily segmentation (respecting max daily drive), overnights,
stops, pacing, side-trips, layovers, logistics — **reasoned against the
parameters.** Minimal input, complete reasoned output.

Prototyped manually yesterday: ~4 places + 2 dates + prompt params → the full
19-day itinerary in `ALASKA_SOUTH_ITINERARY.md`. **That file is the target
output.** This spec productizes it — fact-grounded and audited.

---

## 2. The target output (from the prototype)

The generated deliverable has these parts (master-prompt §A–F, seen in the
prototype):

- **A. Route summary** — the corridors, the food thread, which anchors are honored.
- **B. Phase breakdown** — named phases (Days 1–3 "Top of the World & the
  Klondike"), each with goals, highlights, and **per-day logistics** ("top off in
  Tok *before* Chicken", "border closes 6 p.m. Alaska time", "buy your Fish Creek
  ticket in Stewart — no cell in Hyder").
- **C. Full day-by-day table** — the load-bearing section (see §3).
- **Critical fuel gaps** — segment / gap / action (Tok→Chicken ~185 mi; Watson
  Lake→Dease Lake ~270 km).
- **D. Routing variants** — 1–2 alternates with pros/cons/shifts.
- **F. Permits & border crossings** — two checklists (permits w/ lead times;
  crossings w/ hours/docs/remoteness).

And — critically — the prototype opens with an **audit note**: it caught that the
reference doc's *Objective* ("USA Southwest… Moab") and *Duration* ("7 Days") were
stale template defaults, and reasoned past them using the date anchors. That
behavior — reconciling stated inputs against ground truth — is Stage 2, productized.

---

## 3. Section C IS the Day Detail column (the key composition)

The generated **Section C (Full Day-By-Day) IS the content that populates the
existing Day Detail column.** The planner doesn't invent a render surface — it
fills the one already shipped:

| Section-C column | Source | Status |
|---|---|---|
| Day / Date | `day.dayNumber` / `day.date` | ✅ engine |
| Start → End | `day.label` / corridor spine (start+end nodes) | ✅ **rendered** (this session) |
| Dist / Drive | `day.miles` / `day.driveHours` | ✅ engine computes |
| Key Stops / POIs | bucketed corpus tiles under spine nodes | ✅ **rendered** (this session) |
| **Weather (typical)** | reasoned / climate lookup | 🆕 planner |
| **Overnight** | reasoned rec — specific camp/hotel **+ why it fits the rig/style** ("level gravel, great for GX470+RTT") | 🆕 planner |
| **Per-day logistics** | from the phase breakdown ("cross by 6 p.m. AK", "top off in Tok") | 🆕 planner |
| **Obligations** | surfaced on the day + in a tickler | 🆕 planner (§6) |

So: **spine + tiles = the skeleton (DONE). The planner generates the reasoned
FILL** (overnight + rationale, weather, day logistics, obligations) that layers on
to make each day a complete Section-C row. The generation output schema is
designed to Section C's structure; Day Detail rendering extends to surface the new
reasoned elements alongside the existing spine + tiles.

---

## 4. Trust model — a FIELD NAVIGATION tool

Wrong facts strand the user in the Yukon. So:

> **The LLM REASONS but NEVER ORIGINATES facts.**

Every **navigable fact** traces to real data:

| Fact | Origin | Status |
|---|---|---|
| Route / distances / drive-times / day-segmentation | corridor engine | ✅ shipped |
| POIs (fuel / camp / food / scenic) | POI corpus (sourced, place_id-backed) | ✅ shipped |
| Fuel gaps | computed from route + real fuel POIs | ⚠️ needs a fuel-POI layer |
| Border crossings (where the route crosses) | route geometry vs border line | 🆕 small |
| Time-sensitive facts (border hours, seasonal windows, permits, event dates) | verified/live sources | ⏳ Stage 4 |

The LLM does **judgment over these facts**: pacing, sequencing, overnight choice,
why-this-routing, layover placement, side-trip calls, qualitative fit to the
parameters, flagging. **It does not invent routes, distances, or POIs.** The
session's whole corpus/engine work IS the trust foundation — without it you'd be
trusting an LLM's memory of Yukon gas stations, which you cannot do for navigation.

**Grounding mechanism:** the engine's facts are fed to the LLM as ground truth,
and the LLM is required to **reference POIs by their corpus id** (so every
recommendation links to a real, tappable tile) and to **not state a distance or
POI that wasn't provided.** Knowledge-based claims (seasonal, permits) are marked
advisory ("verify before you go") until a live source backs them (Stage 4).

---

## 5. The audit — what makes it trustworthy (Stage 2, buildable now)

After the LLM generates, **audit its output against ground truth BEFORE showing
it.** The LLM proposes; the fact-layer disposes.

- **Distance match** — every distance the LLM stated vs the engine's measurement
  of that leg. Discrepancy → correct to the engine value (or flag if structural).
- **POI existence** — every recommended POI must exist in the corpus
  (id/coords/place_id-backed). Not found → flag "unverified" or drop.
- **Fuel-gap match** — every fuel gap the LLM cited vs the computed gaps.
- **Anchor honored** — every FIXED anchor lands on its pinned date; every leg
  respects max-daily-drive.
- **Seasonal / timing check** — seasonal claims vs known windows (Stage 4 live
  data; Stage 2 marks them advisory or checks a small curated set).

**Discrepancy handling (three tiers):**
1. **Correctable** (LLM said 180 mi, engine says 185 mi) → silently snap to ground
   truth.
2. **Flaggable** (POI not in corpus; unverifiable seasonal claim) → mark
   "unverified — verify before you go", or drop the claim.
3. **Structural** (violated a FIXED anchor date; a leg exceeds max drive) →
   regenerate the affected span **within a bounded regen budget** (try N times,
   feeding the violation back to the LLM as a constraint). If still unsatisfiable
   after N, **stop and surface it honestly** — "couldn't fit your anchors within a
   350 mi/day cap; relax the cap, add a day, or drop a stop." Never silently ship a
   plan that violates a hard constraint, and never infinite-loop.

The prototype's opening note (catching the stale Objective/Duration) is a manual
instance of tier-2/3 reconciliation. Productize it: a **systematic audit of every
generated fact against ground truth**, run before display.

---

## 6. The item / obligation model

The plan is a set of **committed items** — `drive-leg | stop | activity | event |
overnight` — each carrying **zero or more obligations**.

```
Obligation {
  action:     book | permit | ticket | fuel | resupply | reserve | ...
  trigger:    { kind: "date-minus-leadtime", event_date, lead_time }
            | { kind: "geo-point", coords, radius }
  lead_time:  duration
  event_date: date | null
  severity:   info | recommended | critical
  reason:     string            // "no cell in Hyder — buy in Stewart"
  state:      pending | surfaced | escalating | done | expired
  provenance: llm-suggested | engine-derived | user-added   // METADATA ONLY
}
```

**Obligations straight from the prototype:**
- "Buy Fish Creek ticket in **Stewart** before crossing to Hyder (no cell)" →
  `action: ticket, trigger: geo-point(Stewart), reason: no signal in Hyder`.
- The Fuel Gaps table → `action: fuel` obligations, geo-triggered before each gap.
- The Permits table → `action: reserve/permit` obligations with lead times
  ("reserve southern parks weeks ahead").

**One pipeline for all items.** Provenance is metadata only — every item runs the
**same** `add-item → reason-its-obligations → surface` pipeline:
- **Initial generation** = the engine bulk-adding N items at once.
- **User adds an event later** ("an artist plays Tuesday — add it, surface
  buy-tickets now") = the *same* pipeline at N=1.
- **Editing** re-reasons the affected span (the baked-then-editable pattern —
  identical to how corridor edits re-run `recomputeDay`).

This uniformity is what lets Stages 3–4 (surfacing) treat generated, derived, and
user-added obligations identically.

---

## 7. Stages

1. **GROUNDED GENERATION** — anchors + params → engine facts → LLM reasoning →
   Section-C itinerary rendered into Day Detail. (Yesterday's magic, fact-grounded.)
2. **GENERATION-TIME AUDIT** — verify LLM output against engine/corpus before
   display. Makes the first output navigation-grade. **Buildable now.**
3. **CONTINUOUS RE-VERIFICATION + DELTAS** — the living plan. Re-check facts on a
   cadence/triggers; surface DELTAS for approval ("border hours changed / faster
   route available — accept new version?"). Trust from relentless verification,
   not perfect generation.
4. **LIVE TIME-SENSITIVE SOURCES + FIELD SURFACING** — border/events/seasonal live
   data; the **time tickler** (obligations surface on their act-by date, escalate
   until done|expired) and **geo-proximity** field surfacing ("arriving Tok: FILL
   UP, next fuel 265 mi").

**This spec scopes Stages 1–2** to buildable detail (below). Stages 3–4 are framed
but not yet scoped.

---

## 8. STAGE 1 + 2 SCOPE (the buildable foundation)

### 8.1 Input — the anchor + parameter form

**Anchors** (the core new input — an ordered list, 2–~8 rows):

| Field | Control | Notes |
|---|---|---|
| Place | geocoded place input (reuse the wizard's geocode) | start + end + intermediates |
| Date pin | segmented: **FIXED date** / **flexible** / **window** | FIXED = hard schedule anchor |
| Date | date picker (enabled when FIXED/window) | e.g. Dawson 7/10 FIXED |
| Dwell | number (days) | 0 = pass-through, 1+ = layover |
| Role | start / waypoint / end | first=start, last=end |
| Note | short text | "wildlife centerpiece" |

**Trip params (§01)** — per-trip controls:

| Field | Control | Default |
|---|---|---|
| Start / End date | date pickers | — |
| Budget level | select: budget / mid / premium | mid |
| Max daily drive | slider (mi) → `segmentByPace` pace | 350 |
| Buffer days | number | 0 |
| Avoid | multi-select chips (rock-crawl, tolls, ferries, rushed legs) | — |
| Return routing | select: shortest / scenic / same / loop | shortest |

**Rig profile (§02)** — a **saved profile on the user, set once, reused** across
trips (extends the existing `lib/vehicles/` + wizard "vehicle" slice):

| Field | Control |
|---|---|
| Vehicle | make/model/year |
| Build | multi-select (lift, tires, armor, winch, fridge, dual-battery, solar, RTT) |
| **Fuel range** | number (mi) — *drives fuel-gap detection* |
| Capability | select (mild / moderate / avoid-hardcore) |
| Group size / Skill | number / select |
| Preferences | multi-select (solitude, scenic, photography, local food, simple camp) |

Lives in the plan wizard (`web/src/app/plan`, `lib/plan`) — extend the existing
going/vehicle/stops steps. Note: `buildRouteAwareDays` currently **ignores the
wizard `stops` slice** — wiring intermediate anchors into the route is part of
Stage 1.

### 8.2 Generation call shape

**Pipeline** (LLM proposes structure + reasoning; engine grounds/audits the facts):

```
anchors + params + rig
      │
      ▼
[ENGINE — fact pre-compute]
  geocode anchors → routeBetween(anchor chain, return-routing)
  segmentByPace(maxDailyDrive) → BASELINE min-day count (a sanity seed, not final)
  deriveCorridorCities over the anchor route → available city spine
  pois_along_corridor + corpus fold → available POIs (id, name, category, coords,
      prominence, tags, rating?/hours? for place_id rows)
  (Stage 2 adds: fuel-gap candidates, border-crossing points)
      │
      ▼
[LLM — generation]   (Anthropic SDK, server-side, streamed, strong tier)
  system  = adapted Master Prompt (ROLE + §A–F contract + GROUNDING CONTRACT)
  input   = { params, rig, anchors,
              route: {legs, corridorCities},
              poolPOIs: [{id, name, category, coords, tags, rating?, hours?}],
              baselineDays, fuelGapCandidates, borderPoints }
  returns = STRUCTURED (tool-use / JSON schema, NOT prose):
    {
      routeSummary, foodThread, anchorsHonored[],
      phases: [{ name, dayRange, goals, logistics }],
      days: [{                      // ← Section C, one per day
        n, date, startPlace, endPlace, type: drive|layover|sidetrip,
        distanceMi, driveHours,     // LLM's STATED values (audited next)
        weather, keyStops:[poiId…], // POIs referenced BY CORPUS ID
        overnight: { poiId?|desc, type, rationale },
        logistics: string,
        obligations: [Obligation…]
      }],
      fuelGaps: [{ segment, gapMi, action }],
      variants: [{ label, pros, cons, shifts }],
      permits: [{ name, forWhat, howObtain, leadTime, notes }],
      borders: [{ crossing, countries, docs, hours, notes }]
    }
      │
      ▼
[ENGINE — audit / ground]   (§8.3)
  re-route each proposed day → snap distanceMi/driveHours to measured truth
  match every keyStops/overnight poiId → corpus (drop/flag if absent)
  match fuelGaps → computed gaps
  verify FIXED anchors land on date; legs ≤ maxDailyDrive
      │
      ▼
[PERSIST]  audited Section-C into trips.payload (per-day reasoned fields + trip
           sections + obligations) — baked, editable, regenerable on edit
      │
      ▼
[RENDER]   Day Detail: spine + tiles (existing) + weather/overnight/logistics/
           obligations (new fields); trip-level Overview panel: route summary,
           phases, fuel gaps, variants, permits, borders
```

**Notes:**
- **SETTLED — one LLM pass, audit-grounds.** A single generation pass proposes the
  day structure *and* references fed POIs by id; the engine then audits/re-grounds
  every fact. No separate structure-only pass. If the audit's structural tier
  can't reconcile the proposal (§8.3), it regenerates within a bounded budget
  rather than adding a pre-pass.
- Uses the app's existing Anthropic access + the server-route pattern already used
  by `/api/places/details`. Stream the reasoning — it *is* the product.
- Generation runs at finalize (deliberate, loader-covered — like the corpus fold),
  persisted so it survives reload; regenerated on significant edits (re-reason the
  affected span).

### 8.3 Audit checks (Stage 2) — verify before display

| Check | Ground truth | Discrepancy handling |
|---|---|---|
| **Distance / drive** | re-route each proposed day (`routeBetween` on its start→end) | snap to measured; if leg > maxDailyDrive → structural (re-split) |
| **POI exists** | every `keyStops`/`overnight` `poiId` ∈ corpus (fed pool) | not found → flag "unverified" or drop; never render a POI the corpus can't back |
| **Fuel gap** | computed longest-stretch-between-fuel-POIs vs fuel range | snap gap distance; add any computed gap the LLM missed |
| **Anchor honored** | FIXED anchor date == its day's date; dwell respected | structural → regenerate span or surface "couldn't satisfy" |
| **Seasonal / timing** | known-window set (Stage 2: small curated / advisory; Stage 4: live) | mark advisory "verify before you go" if unbacked |
| **Coordinate sanity** | every stated coord ∈ its POI's corpus coord | drop invented coords |

Output of the audit: an **audited itinerary + a provenance/confidence tag per
fact** (measured / corpus-backed / advisory-unverified), so the UI can render
trust visibly (e.g., a subtle "verify" marker on advisory claims).

### 8.4 Substrate-reuse map (reuse, don't rebuild)

| Planner need | Shipped piece that supplies it | Reuse / extend |
|---|---|---|
| Route + distance + drive-time | `routeBetween` / `segmentByPace` (`lib/routing`) | reuse as-is; call per proposed day for the audit |
| Corridor city spine | `deriveCorridorCities` (`lib/corridor/derive`) | reuse; supplies "available cities" |
| POIs along route | `pois_along_corridor` RPC + corpus fold (`bake-corridors`, `fetchCorpusForSegment`) | reuse; supplies the POI pool fed to the LLM + the audit corpus |
| POI live detail | `/api/places/details` + P3 hydrate | reuse; rating/hours enrich the LLM pool + the tiles |
| Day structure + trip payload | `buildRouteAwareDays`, `trips.payload`, fork/wizard | extend: day gets reasoned fields; the planner is a superset of wizard-finalize |
| Day Detail render (spine + tiles) | `day-detail-corridor.tsx` / `-column.tsx` | extend: surface weather/overnight/logistics/obligations alongside spine+tiles |
| POI detail overlay | `MapDetailOverlay` + `synthWaypoint` | reuse for recommended-POI detail |
| LLM access | Anthropic SDK + server-route pattern (`/api/places/*`) | new module `lib/itinerary/generate.ts` + `/api/itinerary/generate` |
| Edit → re-reason | `recomputeDay` (baked-then-editable) | mirror: edit re-reasons the affected span |

**Two new mechanical pieces:**
1. **Fuel-POI layer — PREREQUISITE, not optional.** Fuel gaps are the
   safety-critical flagship output; the corpus has no fuel category and far-north
   coverage is thin. **We do not ship guessed or sparse fuel gaps.** This is a
   fuel ingest that reuses the corridor-ingest pipeline (see §8.5) and **sequences
   before — or in parallel with — Stage 1 generation.**
2. **Border-crossing detection** (Stage 1, small) — route geometry vs the US/CA
   border line → crossing point + nearest towns. Crossing *hours* are Stage 4
   (live source).

Everything else is the reasoning + audit layer on top of shipped substrate.

### 8.5 Fuel-POI ingest (prerequisite for navigation-grade fuel gaps)

Reuse the ingest pipeline proven on the northern corpus run — do not build a new
one:

- **Sources:** OSM `amenity=fuel` (free, broad) + Google Places `type=gas_station`
  (authoritative, place_id-backed, costed). Same federated-source pattern as the
  existing corpus.
- **New `fuel` category** in `master_place`'s `primary_category` taxonomy — so
  fuel POIs live in the same corpus, surface through `pois_along_corridor`, and
  bucket/render like any tile.
- **Corridor-anchored ingest** — run along the reference corridors (and, later,
  generated routes) exactly like the corpus ingest, with the **`--skip-enrichment`**
  pattern from the northern run (enrichment starves the budget before discovery;
  fuel needs discovery-only). Watch the persistent Google cost ledger.
- **Curated anchors for remote stretches** — where OSM/Google are thin (Top of the
  World, Cassiar), hand-anchor the known pumps (Tok, Chicken, Dease Lake, Bell II,
  Meziadin) the way core-12 northern anchors were seeded. Sparse auto-discovery is
  not acceptable for a safety output.
- **Fuel-gap computation (mechanical):** project fuel POIs onto the route → sort by
  along-route mile → the gap between consecutive pumps is a candidate; any gap
  approaching/exceeding the rig's fuel range (§02) is flagged. This feeds both the
  LLM (as fact) and the audit (as ground truth) — see the prototype's Fuel Gaps
  table (Tok→Chicken ~185 mi; Watson Lake→Dease Lake ~270 km).

**Prod-write discipline applies** (pre-flight-confirm PROD ref, TEST-first where
testable, restore to test after) — same as every corpus/migration write this
session.

---

## 9. Decisions (SETTLED) + remaining risks

**Settled Stage-1/2 decisions:**
1. **One LLM pass, audit-grounds** — no structure-only pre-pass; the audit's
   structural tier regenerates within a bounded budget (§8.2, §8.3).
2. **Fuel-POI layer is a PREREQUISITE** — real fuel data ingested (§8.5) before
   navigation-grade fuel gaps ship; no guessed/sparse gaps.
3. **Border detection in Stage 1** (route-geometry vs US/CA line); crossing hours
   deferred to Stage 4.
4. **Seasonal advisory-first** — the LLM surfaces the insight *with* an explicit
   confidence tag ("typically opens mid-July — verify"); upgraded to verified at
   Stage 4.

**Remaining risks (watch during build):**
- **Fuel data quality in the far north** — even with ingest, OSM/Google are thin
  on the Cassiar/Top-of-the-World; the curated-anchor step (§8.5) is load-bearing,
  not a nice-to-have.
- **Structure quality from one pass** — the regen budget (§8.3) is the backstop; if
  regen rates are high in practice, revisit a structure pre-pass.
- **Cost/latency** — one long strong-tier call per generation; stream + persist +
  regenerate-on-demand (not per edit).
- **Grounding is load-bearing** — without "reference POIs by id, never state an
  unprovided fact" + the audit, the product reinherits ChatGPT's hallucination
  problem. Make-or-break — it's why Stage 2 ships with Stage 1.
```
