# Top pick per category, per stop — bake-time selection + compliant storage — plan (investigation only)

**Status: PLAN ONLY. Nothing implemented.** Same posture as the four surface
cutover plans (#258 / #261 / #262 / #267 / #268): investigate first, write the
plan, implement in a separate change behind a flag.

**Decisions taken 2026-08-24 (Adam):** O1 ranking rule (**Google always wins**),
O2 title gap (**explicit loading state, no stored name**), O3 categories
(**7, not 9 — `interest`/`urban` out of scope**), O4 flags (**two, as
proposed**), O6 partial-failure (**fail soft per pick**). **O5 (staleness
policy) is still OPEN**, plus two named residuals — **O1a** the minimum
review-count floor and **O6a** the wall-clock budget. Full register in §8;
§2/§3/§5/§6 carry the decisions inline.

**The feature.** At trip creation/bake time, select and store ONE "top pick"
place per category for each major stop, combining corpus and live Google data.
Day Column renders that single pick per category by default, with a "more"
link to the full list.

**The constraint that shapes everything.**
`docs/measurements/2026-08-20-google-places-details-compliance-check.md` found
that Google Places content may not be persisted beyond two exceptions —
`place_id` (indefinitely) and coordinates (30 days). Everything else
(`displayName`, `rating`, `userRatingCount`, `photos`, `formattedAddress`,
`regularOpeningHours`, `websiteUri`, `internationalPhoneNumber`) has **no
caching exception**, and the restriction is **field-based, not display-based**.
So a Google-sourced top pick can bake **an id, a category, and a rank —
nothing else**. A corpus-sourced top pick has no such restriction.

⚠ **Read §9 before treating that constraint as fully settled.** The prior check
answered *persistent DB storage*; it did **not** analyse cross-user or
persistent server-side caching as a distinct question. This plan is written to
be safe under the strictest reading, but the boundary itself is not established.

---

## 1. What the bake does today `[read source: bake-corridors.ts, 163 lines]`

`bakeCorridors(trip, supabase)` (`web/src/lib/trips/bake-corridors.ts:157`) is
two steps, in order:

1. **`foldFederatedCorridorSupply(trip, supabase)`** (:68) — behind
   `USE_FEDERATED_CORRIDOR`. Per day, calls `fetchCorpusForSegment(start, end)`
   → `fetchCorpusForPolyline` → the `pois_along_corridor` RPC with a 16 km
   buffer and `p_categories: null` (i.e. **all categories, unranked**). Rows are
   filtered through `isSuppressedCategory`, mapped by `mapMasterPlaceRow`, and
   **appended wholesale** to `day.segmentSuggestions`, deduped only by id
   against what's already there (:85-93).
2. **`resolveCorridorCities(folded)`** — derives the spine and buckets place ids
   under each `CorridorCity.placeIds`.

**Three properties of today's bake that matter here:**

- **It is corpus-only.** The fold reads `pois_along_corridor` and nothing else.
  **There is no live Google call anywhere in the bake path** `[read source]`.
  This is exactly why Day Column lacks gas/food — confirmed live earlier today:
  a Kernville day yields **1** `master_place` row against **52** live results
  for `fuel,food` `[measured 2026-08-24]`.
- **It selects nothing.** It appends every corridor row that isn't suppressed.
  `la-to-portland` carries **2,543** `segmentSuggestions` across **11** days
  `[queried TEST 2026-08-24]`. "Top pick" is a genuinely new concept — there is
  no existing ranking step to extend.
- **It is idempotent-by-marker, not by content.** `hasBakedCorpusTiles` (:28)
  skips the fold when any `mp:` tile exists; `stripBakedCorridors` (:40) clears
  the markers for a re-bake. **Any new top-pick artifact must be added to
  `stripBakedCorridors` or a re-bake will not refresh it.**

### Does `resolvePlaces()` day-corridor provide the ranking signal? — Mostly yes

`resolvePlaces()`'s day-corridor scope (`resolve-places.ts:436-455`) was
designed from `/api/trip-browse/:tripId/:dayId` and runs LIVE + FEDERATED
concurrently, merging on canonical id. It gives the bake three things it does
not have today:

1. **Live Google results**, which the bake has never had.
2. **`sortByVerificationTier`** (:364) — the #255/#256 Verified/Unverified tier,
   already computed and applied *before* any limit. Measured on
   `la-to-portland`/`day-3` with both flags on: **52 verified / 1 unverified**
   of 53 `[measured 2026-08-24]`.
3. **`source` stamping** — `'live'` vs `'master_place'`, set unconditionally
   (design §D7), which is precisely the corpus-vs-Google discriminator the
   compliance rule keys on.

**What it does NOT give, and this is the important gap:** the tier is a
**two-bucket sort, not a quality ranking**. On that measured day it puts 52 of
53 places in one bucket — it cannot pick a best-of-52. Verification tier answers
"is this description real or generated," not "is this the best campground."
**Tier is a useful pre-filter and a poor final ranker.** Something else is
needed for the actual pick — see §2.

Two more mismatches to design around:

- **`resolvePlaces()` is day-scoped, the feature is stop-scoped.** Its
  day-corridor scope takes `{start, end}` and builds bboxes around **both
  endpoints** (:439-444). A day on `la-to-portland` has **2–5** corridor cities
  `[queried TEST 2026-08-24]`, so the intermediate ones are not endpoints of
  anything. Either call it per-stop with a synthesized `{start: stop, end:
  stop}` scope, or add a `stop`/point scope. **This is a real API gap, not a
  configuration detail.**
- **`enrich` is opt-in and off by default** (`:370`, `if (input.enrich)`), which
  turns out to be exactly right here — see §2.

---

## 2. Ranking rule + what data actually exists at bake time

### The finding that changes the cost picture

**Live discovery already returns `rating` and `reviewCount` inline. No
`enrichByGoogleId()` call is needed to rank.** Measured on
`la-to-portland`/`day-3`, `categories=all`: **169** places returned, of which
**146 carry a rating** `[measured 2026-08-24]`. Sample:
`gpl/ChIJCdMFwr_NwYARoxShhPmLYtw` "Frandy Park Campground" rating 4.4 / 781
reviews, straight out of the `searchNearby` fanout.

This matters twice over:

- **Cost:** ranking needs zero extra Google calls beyond the discovery fanout
  the bake would already run. The "call `enrichByGoogleId()` per category per
  stop at bake time" scenario the brief flagged as a rate-limit risk **is
  avoidable**. (Enrichment at bake would still be needed if the pick must
  display immediately without a client fetch — which §3 rejects on compliance
  grounds anyway.)
- **Compliance:** a rating used to *rank* and then *discarded* is never
  persisted. **Ranking is a transient computation; only the ordinal survives.**
  This is the crux of the whole design and it is clean.

### The rule — DECIDED 2026-08-24 (O1), flat, not cascading

**Google always wins.** Per (stop, category):

1. **Filter to candidates**, live + federated, for that category within the
   stop's radius.
2. **If ANY live Google result exists for that category, a Google result is the
   pick** — regardless of its rating, and regardless of whether a corpus
   candidate exists or what tier that corpus candidate carries. Verified corpus
   does **not** outrank Google.
3. **Corpus is the fallback only when no live Google result is available** for
   that (stop, category).
4. **Else: no pick for that category at this stop.** Must be representable.
   Measured: `oddity` returned **0** results on the sample day, and `interest` /
   `urban` cannot be discovered live at all (§5).

> **Supersedes the originally-proposed cascading rule** (Verified corpus → Google
> by rating → Unverified corpus → unrated → none). That version made a
> 4.9-rated restaurant lose to a verified corpus row with no rating; the flat
> rule removes that inversion. The cascade is preserved here only as the
> superseded text it is.

**What this rule does NOT settle — the intra-Google tie-break.** "Google's live
pick" presupposes choosing *among* Google results when several exist for a
category, which is the common case (the sample day returned **37** food and
**15** fuel results for one day `[measured 2026-08-24]`). Ranking those by
`rating` still needs a **minimum review-count floor**, or a single 5.0 review
beats a 4.4 backed by 781. **No floor value has been set** — see O1's residual
in §8. Nothing in the corpus or the code implies one.

**Consequence that survives the simplification:** ratings are volatile. The rank
is frozen at bake; the rating that justified it is re-fetched live and may have
moved, so a pick can read as stale or wrong ("why is this the top pick, it's
3.1?"). Re-bake is the only correction. Same staleness class as the `#254`
category drift that forced the `la-to-portland` re-bake on 2026-08-23. **This is
exactly what O5 asks about, and O5 is still open** (§8).

**Second-order effect of Google-always-wins, worth stating plainly:** it makes
the feature *more* dependent on the live path than the cascade did, so most
picks will be id-only and need hydration to display (§3), and a rate-limited or
down Google makes a category fall back to corpus rather than simply reorder.
That raises the stakes on the loading state (O2) and on fail-soft (O6) — both
now decided.

---

## 3. Compliant storage + rendering

### The existing storage shape cannot hold a compliant Google pick

`Day.segmentSuggestions` is `BrowsePlace[]` (`types.ts:268`), and `BrowsePlace`
requires `title`, `photoAlt`, `pills`, `stats`, `mention`, `description`,
`pullquote`, `placeInfo`, `cta` `[read source: places.ts:30-70]`. **Persisting a
Google pick as a `BrowsePlace` would require persisting `displayName` as
`title` — the exact thing the compliance check prohibits.** So this feature
cannot reuse `segmentSuggestions`. It needs its own, deliberately thin field.

### Proposed shape — a new `Day.topPicks`

```ts
/** Bake-time top pick per category per corridor stop. Deliberately THIN:
 *  for a Google-sourced pick the ONLY persistable fields are the id and
 *  coordinates (compliance-check 2026-08-20), so display fields are absent
 *  BY DESIGN and must be live-fetched at render. */
type TopPick = {
  cityId: string;            // CorridorCity.id
  category: SlideCategoryKey;
  rank: number;              // 0 = the pick; >0 reserved for runners-up
  placeId: string;           // canonical id, e.g. "gpl/ChIJ…" or "mp:<uuid>"
  source: "live" | "master_place";
};
```

`placeId` uses the canonical id form the resolver already produces. Measured on
the sample day: ids arrive as **`gpl/<google_place_id>`** (147 of 169) and
`usfs/…` (22) `[measured 2026-08-24]`. For a `gpl/` pick the stored value is a
Google place_id plus a source prefix — **the one field that is explicitly
cache-exempt indefinitely.**

**For `source === 'master_place'`, no restriction applies** — that pick could
alternatively be stored as a full `BrowsePlace`, or simply resolved out of the
`segmentSuggestions` the bake already writes. Storing only the id for both keeps
one code path, at the cost of a corpus lookup at render. **Open decision O2.**

### Can Day Column render an id-only pick? — Almost. One concrete gap.

**The good news: the hydrate pattern already exists on this exact surface**, and
it is the same shape Date Detail uses.

- `placePool(day)` (`day-detail-corridor-column.tsx:1194`) builds
  `CorridorPlace[]`, and `CorridorPlace.placeId` (`day-detail-corridor.tsx:62`)
  is documented as *"The key for live hydrate-by-place_id of ratings/photos on
  day-select."*
- A day-select effect (`day-detail-corridor-column.tsx:307-349`) batches
  `POST /api/places/details` for every tile matching
  `t.placeId && !t.photoUrl && !hydrated[t.placeId]` — **an id-only pick passes
  that filter**, since it has no `photoUrl`.
- `hydratePlaces(d)` (:818-841) grafts `rating`, `reviewCount`, `photoUrl`,
  `category`, `priceTier` onto the tile.
- That route is already cut over to `enrichByGoogleId()` behind
  `DATE_DETAIL_USE_RESOLVER` (#263/#266), so the resolver capability is reused
  as-is with no new plumbing.

**The gap: the title cannot be recovered.** `CorridorPlace.title` is a required
`string` sourced from the baked place, and `hydratePlaces()` grafts everything
**except** the title. `PlaceRich` (`google-places.ts:250-261`) has **no name
field at all** — even though `DETAILS_FIELD_MASK` (:267) *does* request
`displayName`, and `placeDetails()` (:330+) simply drops it on the floor.

**So the fix is small and costs nothing extra at Google:** add `name` to
`PlaceRich`, return `p.displayName` from `placeDetails()`, and let
`hydratePlaces()` graft it into `title`. The field is already in the mask, so
**no additional billing and no mask change** — it is currently fetched and
discarded.

### How the title gap is resolved — DECIDED 2026-08-24 (O2)

**By design, with an explicit loading state — NOT by storing or recovering the
name, and NOT with placeholder data.**

On view, if a pick needs live data to display, the user is shown an honest
loading/refresh state (e.g. *"Refreshing your trip…"*) while the live fetch
runs. This is the existing `enrichByGoogleId()` hydration pattern (already wired
behind `DATE_DETAIL_USE_RESOLVER`) plus a real UI state — not a workaround that
fabricates or caches a title.

Three things follow, and they are the actual implementation work:

- **The loading state is a first-class state, not a skeleton afterthought.**
  Today every tile has a real title at first paint. An id-only pick has none
  until the fetch lands, so the card needs a genuine "refreshing" treatment.
  Under the Google-always-wins rule (§2) **most picks will be id-only**, so this
  state is the common path on every day-select, not an edge case.
- **A hydration-failure state is still required.** `placeDetails()` returns
  `null` on missing key, network error, or non-OK, and the route negatively
  caches `null` for 15 minutes (`route.ts:38`). An id-only pick that fails to
  hydrate has **nothing to render at all** — unlike today's tiles, which degrade
  to essentials. The card must be able to disappear or show a genuine error,
  and per the RUNBOOK gotcha, one transient blip is replayed as failure for the
  rest of that window.
- **`PlaceRich.name` is still needed.** The loading state resolves *what the
  user sees while waiting*; it does not conjure a title when the fetch lands.
  The step-1 change stands — add `name` to `PlaceRich`, return `p.displayName`
  from `placeDetails()`, graft it into `title`.

⚠ **Reading applied to O2, flag it if wrong.** O2 as written asks a narrower
question: *do corpus picks get the same storage treatment as Google picks?* The
decision above is phrased around *picks that need live data*, which implies:
**one storage shape (id-only) for both**, with the render differentiated — a
corpus pick resolves locally against the already-baked pool and shows **no**
loading state, a Google pick fetches and does. That is the reading recorded
here. If the intent was instead to store corpus picks in full as `BrowsePlace`,
say so and this section changes.

---

## 4. Dependency: the dead "Explore more {city}" link

The feature's "more" link is, by definition, the city-scoped full list — which
is exactly the affordance that exists in the UI and **does nothing today**.
Found and confirmed in tonight's session:

- `web/src/components/trip/day-detail-corridor.tsx:864` — `onClick={noop}`
  (read spine; rendered only when `!curatedMode`)
- `web/src/components/trip/day-detail-node-blocks.tsx:643` — `onClick={noop}`
  (edit spine, `editMode` only)
- `const noop = () => {}` at `day-detail-corridor.tsx:44`, under a live TODO at
  :43 naming this exact link.

The **day-level** "Explore more of Day NN" *is* wired (`:697` →
`day-detail-corridor-column.tsx:923` `openBrowseFor(d)` → `CategoryBrowsePanel`),
so the machinery exists; what's missing is a **city/stop-scoped** `BrowseTarget`
rather than a `dayId`-scoped one. `CorridorCity.id`'s own docstring
(`types.ts:283-285`) already names *"city-scoped 'Explore more' discovery"* as
its purpose — the schema anticipated this.

**Noted as a dependency, deliberately NOT fixed here**, per the brief. It should
land as its own change, before or alongside the top-pick UI, because a top pick
with no route to the full list is a worse surface than today's full list.

---

## 5. Real scope and bake-time cost

**All figures below were computed this session; none are carried from memory.**

| | `la-to-portland` | `la-to-deadhorse` |
|---|--:|--:|
| days | 11 | 66 |
| corridor cities (total) | 32 | 115 |
| corridor cities per day (min–max) | 2–5 | 0–9 |
| `segmentSuggestions` baked | 2,543 | 0 |

`[queried TEST 2026-08-24]` — `la-to-deadhorse` shows 0 because it is a
pre-fold reference, not because the fold failed.

**Categories.** The `SlideCategoryKey` union has **9** members
(`places.ts:7-16`), but the browse/discovery set is **7** — `SLIDE_CATEGORIES`
(`trip-browse route.ts:16-24`) and `ALL_SLIDE_CATEGORIES`
(`google-places.ts:26-34`) both omit **`interest`** and **`urban`**. ⚠ **So two
of the "existing 9 UI category buckets" named in the brief cannot be filled from
live discovery at all.**

**DECIDED 2026-08-24 (O3) — correction accepted.** The feature is scoped to the
**7 live-discoverable categories** (`SLIDE_CATEGORIES` / `ALL_SLIDE_CATEGORIES`:
`scenic`, `food`, `oddity`, `attraction`, `camping`, `overnight`, `fuel`), not
all 9 UI buckets. **`interest` and `urban` are explicitly OUT OF SCOPE** for
this feature — they get no top pick — **until/unless they become
live-discoverable.** This composes with the Google-always-wins rule (§2): a
category with no live path has no primary source under that rule, so scoping it
out is the consistent choice rather than a special corpus-only branch.

(Minor doc bug noticed in passing, not fixed: the route's docstring at :99 says
`categories=all` is "all 6"; the array holds 7.)

**Derived work units** (arithmetic on the measured numbers above): 32 stops × 7
discoverable categories = **224** (stop, category) pairs for the 11-day trip;
115 × 7 = **805** for the 66-day trip.

### Cost

**Discovery fanout.** `resolvePlaces()` day-corridor issues one `discover()` per
slide key over `bboxes = endpoints.map(...)` (`resolve-places.ts:439-447`), and
`discover()` fans out across `DEFAULT_CORRIDOR_LIVE_SOURCES` — Google,
rec-gov, Foursquare, USFS, BLM (:193-199). A stop-scoped variant with a single
bbox per stop is therefore **on the order of one Google `searchNearby` per
(stop, category)** — the 224 / 805 figures above — plus the same again per
additional live source. **That is a real per-creation cost**, paid synchronously
while a user waits for their trip.

**Enrichment.** Not required for ranking (§2). If a future variant *did* enrich
at bake, the sample day returned 169 places for one day's all-category query —
so enrichment would be ~1 Details call per unique id, per day, which is the
expensive shape. **Recommend explicitly not doing this.**

**This is a genuine rate-limit concern, and today's preflight is the evidence.**
The session-start health check reported **FOURSQUARE 429**, **RIDB 401**,
**OVERPASS 000**, **MAPILLARY 500** `[preflight 2026-08-24 09:31]`. Three of
five corridor live sources were unhealthy at the moment this plan was written.
A bake that fans out per stop per category across those sources will hit
partial failure routinely, so:

- **The bake must fail soft per (stop, category) — DECIDED 2026-08-24 (O6,
  partial-failure half).** Exactly as `fetchCorpusForPolyline` already fails
  soft to `[]` (:136-138). **A category whose source is down or rate-limited
  simply has no top pick shown for that category on that stop. It never fails
  the whole bake, and never fails the trip creation.** A missing pick is a
  normal outcome, and §2 rule 4 already requires "no pick" to be representable
  — this decision makes that the failure path too, not just the empty-result
  path. Note the interaction with §2: because Google always wins, a
  rate-limited Google does not merely reorder a category — it demotes that
  category to its corpus fallback, or to no pick at all if the corpus has
  none.
- **Latency is the bigger risk than dollars.** These calls sit on the trip-
  creation path. Serializing 805 fanouts would be untenable; even well-batched,
  this needs a concurrency cap and a wall-clock budget with a partial-result
  bail-out. **The wall-clock budget itself is NOT decided — see O6's residual
  in §8.**
- **`p-limit(1)`-style throttling** is already the standing rule for ingestion
  (root `CLAUDE.md` §Forbidden patterns). The same discipline should apply here.

---

## 6. Flag + rollback strategy

**This should not ship in one piece.** It touches the write path, and the
write-path rollback problem is the reason the Day Column consolidation was
deferred in the first place (#267, BACKLOG): **a flag flip does not un-bake a
payload.** Once `topPicks` is persisted into `trips.payload`, turning the flag
off stops *new* writes but leaves every already-baked trip carrying the field.

Proposed sequencing, each independently revertable:

| Step | Change | Flag | Rollback |
|---|---|---|---|
| 1 | `PlaceRich.name` + `placeDetails()` returns `displayName` + `hydratePlaces()` grafts title | none (additive, no behaviour change until read) | plain revert |
| 2 | "Explore more {city}" wired to a stop-scoped `BrowseTarget` (§4 dependency) | own flag | plain revert |
| 3 | Bake writes `Day.topPicks`; nothing reads it | `BAKE_TOP_PICKS` (default OFF) | flag off + `stripBakedCorridors` clears the field |
| 4 | Day Column renders picks + placeholder/failure states | `TOP_PICKS_UI` (default OFF) | flag off → falls back to today's full pool |

**Two flags, not one — DECIDED 2026-08-24 (O4), accepted as proposed.** The
write and the read roll back independently: a bad ranking rule can be fixed
without hiding the UI, and a bad UI can be hidden without re-baking. Same
posture as `TRIP_BROWSE_USE_RESOLVER` and `USE_FEDERATED_POIS` being
deliberately orthogonal (#269). `BAKE_TOP_PICKS` and `TOP_PICKS_UI`, both
default OFF.

**`stripBakedCorridors` must learn about `topPicks`** (§1) or a re-bake will
silently preserve stale picks — the same failure mode as the pre-#254 category
freeze that required the 2026-08-23 `la-to-portland` re-bake.

**Verification posture**, matching the four cutovers: unit tests for every flag
state behind a dependency seam, plus a live TEST end-to-end run with a
non-vacuous contrast (flag on vs off on the same day). Note that **web tests do
not run in CI** — a pre-existing gap recorded in STATE.md — so live checks plus
review are the real gate.

---

## 7. Recommended shape

1. Land step 1 (title through hydrate) first. It is small, additive, costs
   nothing at Google, and is independently useful — it is currently a fetched-
   and-discarded field.
2. Fix the "Explore more {city}" link as its own change.
3. Only then bake `topPicks`, behind `BAKE_TOP_PICKS`, over the **7**
   live-discoverable categories (O3), applying the **Google-always-wins** rule
   (O1) against already-returned discovery ratings, failing soft per pick (O6),
   storing id + category + rank + source.
4. Render behind `TOP_PICKS_UI`, reusing the existing day-select hydrate, with
   the explicit loading/refresh state (O2) as a first-class state rather than a
   skeleton.

**Two things to settle before step 3 can be written, and one before step 4
ships:** O1a (review-count floor) and O6a (wall-clock budget) both bind step 3;
**O5 (staleness) bites hardest once trips are baked and ageing**, so it can
trail step 3 but should not trail a production rollout.

---

## 8. Decisions register — five DECIDED 2026-08-24, one still OPEN

Original O1–O6 text is preserved verbatim under each heading (struck where
superseded), per this repo's append-and-annotate convention. **O5 is the only
item with no decision. Two decided items carry a named residual.**

### O1 — the ranking rule itself · **DECIDED (with a residual)**

> ~~Does a Verified corpus place outrank a better-rated Google place (§2 rule
> 2)? This is the product call at the centre of the feature. Sub-question: what
> minimum review count qualifies a rating? Nothing in the corpus or the code
> implies a value.~~

**Decision (Adam, 2026-08-24): No — Google always wins.** A live Google result
takes the pick for its category regardless of its rating and regardless of the
corpus candidate's Verified/Unverified tier. Corpus is used **only** when no
live Google result exists for that (stop, category). The cascading rule is
superseded by the flat rule now in §2.

⚠ **RESIDUAL — O1a, still unset: the minimum review-count floor.** The
sub-question above was **not** answered and is not mooted by the flat rule:
choosing *among* several Google results for one category still needs a rating
tie-break, and without a floor a single 5.0 review beats a 4.4 with 781
reviews. The sample day returned 37 food and 15 fuel results for a single day,
so multi-candidate categories are the norm. **No value is recorded here because
none was given.**

### O2 — corpus picks vs Google picks · **DECIDED (reading applied — verify)**

> ~~Do corpus picks get the same treatment as Google picks? Storing id-only for
> both is one code path but forces a lookup for data already baked. Storing
> corpus picks in full is faster to render and legal, but forks the shape. The
> brief explicitly raises this; it is not resolved here.~~

**Decision (Adam, 2026-08-24):** the title gap is resolved **by design, not by
storing the title.** On view, a pick that needs live data shows an explicit
loading/refresh state (*"Refreshing your trip…"*) while the fetch runs — the
existing `enrichByGoogleId()` hydration pattern plus a real UI state, not
placeholder data and not a cached name. Recorded in §3.

⚠ **Reading applied:** the decision is phrased around *picks that need live
data*, which this doc reads as **one storage shape (id-only) for both**, with
the render differentiated — corpus resolves locally with no loading state,
Google fetches. **If the intent was to store corpus picks in full, §3 and this
entry both change.**

### O3 — `interest` and `urban` · **DECIDED**

> ~~Two of the nine UI buckets are not live-discoverable (§5). Corpus-only
> picks, or excluded from the feature?~~

**Decision (Adam, 2026-08-24): correction accepted — excluded.** Scope the
feature to the **7 live-discoverable categories**; `interest` and `urban` are
explicitly out of scope until/unless they become live-discoverable. Recorded
in §5.

### O4 — flag granularity · **DECIDED**

> ~~Two flags as proposed, or one? Two costs more wiring and buys independent
> rollback on a write path that cannot be un-baked.~~

**Decision (Adam, 2026-08-24): two flags, accepted as proposed** —
`BAKE_TOP_PICKS` and `TOP_PICKS_UI`, both default OFF. Recorded in §6.

### O5 — staleness policy · **STILL OPEN — no decision recorded**

> **A frozen rank over volatile ratings will drift. Accept and re-bake on
> demand, or add a TTL / re-rank-on-serve path? Note that re-ranking at serve
> reintroduces the per-serve cost the bake exists to avoid.**

**Not addressed.** Left open deliberately rather than inferred from the other
five. **The Google-always-wins decision (O1) makes this sharper, not softer:**
with corpus demoted to a fallback, nearly every pick is now a Google pick whose
justifying rating is fetched fresh at render while the *rank* stays frozen at
bake — so the displayed rating and the reason-for-ranking can visibly disagree.
There is already precedent for the failure mode: the pre-#254 category freeze
required an in-place re-bake of `la-to-portland` on 2026-08-23.

### O6 — bake latency budget · **DECIDED in part (partial-failure half)**

> ~~What wall-clock is acceptable on the trip-creation path, and~~ what is the
> partial-result behaviour when the budget is exceeded? Given three of five live
> sources were failing at the time of writing (§5), partial results are the
> expected case, not the edge case.

**Decision (Adam, 2026-08-24) — partial-failure half:** the bake **fails soft
per pick**. A category whose source is down or rate-limited simply shows no top
pick for that category on that stop; it never fails the whole bake. Recorded
in §5.

⚠ **RESIDUAL — O6a, still unset: the wall-clock budget.** "What wall-clock is
acceptable on the trip-creation path" was not answered. Fail-soft defines what
happens on error; it does not define when a slow-but-not-failing fanout should
be abandoned.

---

## 9. Compliance caveat — the prior check does not cover everything here

The 2026-08-20 check answered **"may we persist Google fields into our own
DB?"** — no, beyond `place_id` and coordinates. This plan is designed to that
answer and stores only exempt data.

**But that check did not analyse two things this feature touches**, and its
basis has one gap worth stating:

1. **It never analysed caching duration or cross-user reuse.** A repo-wide read
   of the document finds no discussion of TTLs, in-process caches, ephemeral vs
   persistent storage, or per-user vs cross-user reuse — the only duration it
   addresses is the 30-day coordinates exception. It does not mention the
   existing 15-minute route cache at all.
2. **The primary contractual document was not read in full.** The check states
   plainly that the Service Specific Terms were "too long for automated fetch to
   return un-truncated"; its strongest first-party source is Google's policy
   page, corroborated by an archived snapshot and two third-party summaries.
3. **A pre-existing gap is still untriaged.** The same check noticed that the
   `google_resolved` and `google` source_records already persist `displayName`
   and `formattedAddress` indefinitely. `docs/BACKLOG.md` still carries this as
   *"a live compliance gap in current data... not yet triaged."*

**Consequence for this plan:** nothing here depends on the unanswered question —
id + coordinates + a locally-computed rank is safe under the strictest reading.
But if step 3 is ever revised toward caching richer Google data server-side (for
example, to avoid the placeholder flash in §3), **that needs a fresh reading of
Google's current terms, not an extrapolation from this one.**
