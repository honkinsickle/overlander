# Notes-to-Spine Gap — investigation & recommended approach

**Status:** investigation only — nothing implemented. 2026-08-24.
**Author:** Claude Code (branch `dubai`).
**Scope:** generated expedition trips (`/plan/expedition` → the itinerary
pipeline). Reference/fork trips do not run this path and are out of scope.

Evidence tags follow the repo convention: `` `[read source]` ``,
`` `[queried TEST]` ``, `` `[measured 2026-08-24]` ``, `` `[UNVERIFIED]` ``.

---

## The ask

Each day's Overnight / Logistics / Fuel / Reserve notes name real places
(e.g. "Overnight — Tuttle Creek Campground", "charge at Victorville or
Ridgecrest", "Lone Pine Supercharger"). Those places currently live only as
prose. The request: if a place is named in the notes, it should also appear as
a node/tile on the day's spine.

## TL;DR — the gap is not one problem, it is two, split by structure

1. **Overnight is a different, much smaller problem than Logistics / Fuel /
   Reserve.** The overnight is *already* a structured, grounded field, and in
   the sampled corpus it is **already on the spine as a tile or node on 96 of
   104 overnight-bearing days** `[measured 2026-08-24, TEST]`. What is missing
   for the overnight is **labeling/linking**, not resolution.

2. **Logistics / Fuel / Reserve are genuinely prose-only.** They are
   free-text fields with **no place slot at all** — nothing is resolved,
   nothing carries coordinates. But a large share of the places they name are
   *also already on the spine* (towns that are corridor nodes, POIs that are
   already tiles). So a naive "extract every place from the notes and add it to
   the spine" would mostly **duplicate** what is already there; the true
   increment is a narrow subset of specifically-named service POIs (a named
   Supercharger, a named grocery) that are not otherwise grounded.

3. Because most note-named places are already grounded elsewhere, the honest
   framing is **"the spine is missing a small set of specifically-named
   service/overnight POIs, and is failing to *label* the ones it already has,"**
   not "the notes are full of places the spine never sees."

---

## Q1 — Where do the note strings originate?

Traced end to end `[read source]`:

- **Origin: the LLM's structured output.** `ITINERARY_OUTPUT_SCHEMA`
  (`web/src/lib/itinerary/schema.ts`) defines, per day: `overnight
  {name|null, desc|null, type, rationale}`, `logistics: string`,
  `obligations: {action, severity, reason, eventDate, leadTimeDays}[]`, plus a
  trip-level `fuelGaps: {segment, gapMi, action}[]`. `generate.ts` hands this
  schema to the model as a structured-output constraint. So the note strings
  are **model-authored free text**, not a separate pass and not derived from
  the corpus.

- **The four note "kinds" map onto these fields:**
  | Note callout | Source field | Grounded today? |
  |---|---|---|
  | **Overnight** | `day.overnight.name` (+ `.type`, `.rationale`) | **Yes** — audited |
  | **Logistics** | `day.logistics` (string) | No |
  | **Fuel** | `day.obligations[action="fuel"].reason` and `fuelGaps[].action` | No |
  | **Reserve** | `day.obligations[action="reserve"].reason` | No |

- **The audit grounds the overnight, and only the overnight.** In `audit.ts`,
  `overnight.name` runs through `groundReference` (pool-first → live Google
  resolve → on-corridor guard → else drop, which nulls the name and swaps in
  `UNVERIFIED_OVERNIGHT_DESC`) `[read audit.ts:534-553]`. `logistics`,
  `obligations`, and `fuelGaps` are **passed through untouched** — they are
  never parsed for place names and never resolved.

- **The notes string list is assembled in `to-trip.ts`.** `dayNotes(dp)`
  `[read to-trip.ts:92-110]` composes `day.notes: string[]` from an
  `Overnight — …` line, a `Logistics — …` line, one line per obligation, and
  (after) any reader-relevant audit flag. Separately, `day.overnight` is
  persisted as a structured `OvernightSelection` **only when `overnight.name`
  is non-null** `[read to-trip.ts:163-175]`.

- **How grounded places reach the spine.** `bake.ts` turns every audited
  `resolvedPlaces` entry — including the *live-resolved* overnight
  (`where:"overnight"`) — into a `segmentSuggestions` tile via `resolvedToTile`
  `[read bake.ts:48-63, 122-128]`, which is then bucketed onto the corridor
  spine. A **pool-hit** overnight is not re-emitted as a tile; its corpus tile
  "arrives via the federated fold" if the day's corpus query includes it
  `[read audit.ts:543-545]`.

## Q2 — Do the named places already exist as identifiable entities / on the spine?

Sampled all **24 generated trips / 108 days** currently in TEST `public.trips`
`[queried TEST 2026-08-24]`.

### Overnight — computed, defensible

Comparing each day's structured `overnight.selected.name` against that day's
spine node names (`corridorCities[].name`) and tile titles
(`segmentSuggestions[].title`) `[measured 2026-08-24, TEST]`:

- 108 days total; **104** carry a structured overnight name, **4** are
  desc-only (no groundable place, e.g. the trip's terminal day).
- Overnight name matches a **spine node**: 27 (the overnight is a town that is
  the day's end node — Las Vegas, Moab, Torrey…).
- Overnight name matches a **spine tile**: 72 (the overnight is a named
  campground/lodge already rendered as a card — Watchman Campground, Saddlehorn
  Campground, Amphitheater Campground, South Mineral Campground…).
- On the spine **as node or tile: 96 of 104**. **Not anywhere on the spine: 8.**

⚠ **Method caveat:** the match is a lenient two-directional substring compare
after name-normalization, so it can over-count (a "Torrey, UT" overnight
matches a "Torrey" tile). Treat 96/104 as an upper-ish bound on "already
present," not a precise figure. The direction is unambiguous even if the exact
number is soft: **the overnight place is usually already on the spine** — it is
simply not *labeled* as the overnight there, and it is *also* duplicated into
the "Camping" briefing block and the "Overnight —" note line.

### Logistics / Fuel / Reserve — qualitative (prose has no place slot, so no clean structured comparison exists)

Read across the sample `[queried TEST 2026-08-24]`, note-named places fall into
four buckets:

1. **Already a corridor node** — "resupply in Vegas", "top off in Torrey",
   "fuel in Silverton". These towns are already spine nodes.
2. **Already a spine tile** — "Charge fully in St. George" (St. George is a
   day-3 tile), "Ruby's Inn L2 charging" (Best Western Plus Ruby's Inn is a
   day-6 tile), "Green River" (a day-9 tile). These POIs already render.
3. **The overnight campground restated** — RESERVE/FUEL obligations naming the
   same campground already covered by the overnight (Watchman, Amphitheater).
4. **Genuinely absent, specifically named** — the true increment: a named
   Supercharger not chosen as a key stop, a specific grocery. This bucket
   exists but is the *minority* of note-named places in the sample.
5. **Ungroundable by construction** — "mid-budget hotel", "informal boondock",
   "buy water/snacks", "resupply". These name a *category*, not a place; there
   is nothing to put on a spine.

**Consequence:** the naive reading ("notes are full of places the spine
lacks") is not what the data shows. Most note-named places are already
grounded; extraction would mostly re-surface duplicates.

## Q3 — Could these be resolved and grounded like key stops?

**The machinery exists.** `resolve.ts` (`PlaceResolver`, Google
`places:searchText`) plus the audit's on-corridor guard already resolve a bare
NAME to a real place_id + verified-on-route coords, and `bake.ts` already turns
a resolved place into a spine tile. Any place we can express *as a name with a
day/corridor anchor* can ride the same rails.

**The obstacle is that Logistics / Fuel / Reserve have no name slot — they are
prose.** To spine them you must first turn prose into a specific place name.
Two structurally different ways to do that:

- **Option B — emit structured place refs at generation time** (schema +
  prompt change). Add an optional grounded-place array to the relevant fields
  (mirroring `keyStops: {name, note}[]`), e.g. obligations gain an optional
  `placeName`, or the day gains a `serviceStops: {name, note, kind}[]`. These
  flow through `groundReference` exactly like key stops. **Pros:** the model
  names the specific place directly (it already "knows" it — the prose is a
  lossy flattening of that knowledge); grounding stays at the source; no NER.
  **Cons:** touches the generation contract; only benefits *newly generated*
  trips; needs a render treatment distinct from key stops (a Supercharger is
  not a "worth-the-stop" attraction).

- **Option C — post-hoc extraction from the existing prose** (parse
  `day.notes`/`logistics`/`obligations` → candidate names → resolve → guard →
  tile). **Pros:** works on already-stored trips, no regeneration. **Cons,
  which are the specific technical obstacles you asked for:**
  - **Multiple candidates per line** — "charge at Victorville **or**
    Ridgecrest" names two options; which (if either) becomes a node?
  - **Ambiguous / generic names** — "Lone Pine Supercharger" resolves cleanly;
    "buy groceries in Ridgecrest" names a *town*, not a store; "informal
    boondock" names nothing.
  - **Heavy dedup burden** — per Q2 most named places are already spine
    nodes/tiles, so extraction must reliably suppress duplicates or the spine
    fills with repeats (Las Vegas, Moab, Arches all appear in prose *and* on
    the spine already).
  - **Re-derives what the model already flattened**, lossily — the opposite of
    the grounding discipline, which keeps every navigable fact traceable to a
    single origin.

**The overnight needs neither B nor C** — it is already grounded (Q1/Q2). Its
fix is Option A below.

## Q4 — Interaction with the #275/#276 backfill

The #275/#276 backfill (`anchor-backfill.ts`) is a **different source** from a
notes-to-spine feature, and conflating them would be a mistake:

- Backfill picks are **machine-chosen from the corpus pool to fill a
  geometric gap** near a bare anchor, hard-gated to `OPENER_CATEGORIES`
  (`scenic/food/oddity/attraction/camping` — deliberately **excludes** `fuel`
  and `overnight`), within `ANCHOR_NEAR_MI`, and **capped at
  `MAX_BACKFILLS_PER_DAY = 2`** with a null-over-pad contract
  `[read anchor-backfill.ts]`.
- A notes-derived stop is the **opposite provenance**: the *planner explicitly
  named it*. It is closer to the `groundReference` key-stop/overnight path than
  to gap-filling. And its categories are exactly the ones backfill *excludes*
  (fuel, reserve/lodging) — so it cannot reuse `OPENER_CATEGORIES` gating.

**Recommendation for the cap/gating interaction — but flagged as a product
call, not decided here:**

- A notes/overnight stop should very likely **not** consume a
  `MAX_BACKFILLS_PER_DAY` slot, because the cap exists to stop *machine* picks
  from outnumbering the model's real key stops; a planner-named place is a real
  key stop by another name. Making it compete with backfill for 2 slots would
  either starve gap-fill or starve the named stop.
- But whether notes-stops should have **their own** cap (to avoid a day where
  every fuel/reserve line becomes a node) is a genuine UX question — see Open
  Questions.

---

## Recommended approach

**Do Option A now; treat B/C as a separate, later, product-gated decision.**

### Option A — surface the overnight (small, low-risk, no new resolution)

The overnight is already grounded and usually already a spine tile (Q2). The
fix is representational:

1. **Link `day.overnight` to its spine tile** so the overnight card and the
   spine node are the same object, visibly marked as the overnight (an
   "overnight" affordance on the tile), rather than an unlabeled card plus a
   separate "Camping" prose block plus a prose note line — three copies today.
2. **For the ~8 grounded-but-off-spine overnights and the 4 desc-only days**,
   decide whether to promote the grounded overnight tile onto the spine (it is
   grounded, so this is safe) or leave desc-only overnights as prose (nothing
   to ground).

This directly addresses the "Overnight — Tuttle Creek Campground" case with no
new resolution path, no cap interaction, and no generation change. It is the
highest-value, lowest-risk slice.

### Option B (preferred over C) — for Logistics / Fuel / Reserve, if pursued

If service stops are wanted on the spine, prefer **structured emission at
generation time** over post-hoc prose parsing: it keeps grounding at the
source, avoids the multi-candidate/ambiguity/dedup obstacles of Option C, and
reuses the existing `groundReference` rails. The costs are a generation-contract
change and no retroactive benefit to stored trips — both acceptable given
generation is flag-gated (`ENABLE_PLANNER_WIZARD`) and not live on prod.

**Do not lead with Option C.** Post-hoc extraction is the tempting "works on
existing trips" path but carries the worst false-positive and duplication risk
and cuts against the grounding discipline.

---

## Open questions (product/UX — flagged, not decided)

These change what the user sees; per the standing rule they are surfaced, not
resolved unilaterally:

1. **Cap accounting.** Should notes/overnight-derived stops count against
   `MAX_BACKFILLS_PER_DAY`, get their own cap, or be uncapped (they are
   planner-named, not machine-padded)?
2. **Visual distinction.** A fuel/reserve/lodging stop is not a "worth-the-stop"
   key stop. Should it render as a distinct kind of node (an errand marker) vs.
   a curated key stop?
3. **Duplication policy.** When a note names a place already a spine node/tile
   (the common case — Ridgecrest, Arches, Silverton), do nothing / link the
   note text to the existing node / annotate it? This is the dominant case, so
   its answer drives most of the value.
4. **Overnight labeling.** Should the overnight be explicitly marked *as the
   overnight* on the spine, and should the "Camping" briefing block then be
   de-duplicated against it?
5. **Ungroundable references.** "mid-budget hotel", "resupply", "informal
   boondock" name categories, not places — confirm these stay prose-only.

## What was NOT done / scope of the numbers

- **No implementation.** Investigation only.
- **The only computed figures are the overnight-overlap counts** (24 trips /
  108 days / 104 named / 96 on-spine / 8 off / 4 desc-only), measured this
  session against **TEST** with the lenient substring caveat above. Every
  Logistics/Fuel/Reserve characterization is **qualitative** from reading the
  sample — no precise percentage is claimed, because reliably extracting place
  names from prose is itself the hard part of the problem.
- **TEST only.** No PROD reads. The 24 trips are whatever currently sits in
  TEST `public.trips`; they skew to the CA/NV/UT/CO sample routes, so the
  bucket *mix* in Q2 may not match a different corpus.
- **Render facts** (notes → prose, overnight → "Camping" block, spine fed only
  by `corridorCities` + pool) were traced against current source in
  `web/src/components/trip/` `[read source 2026-08-24]`.
