# Re-verification — the 2026-08-25 `resolvePlaces()` findings, checked against current main

**Date:** 2026-09-03
**Branch:** `reverify-aug25-findings`, cut from `origin/main` at **`0dae80c`**
(`fix(er): matcher category-compatibility gaps + wide-radius rescue routing (#365)`)
**Mode:** READ-ONLY. No code changes, no writes to TEST or PROD. One TEST read
(column population counts).

**Context.** The 2026-08-25 investigation found `resolvePlaces()` built but
unwired, and its findings were rendered as a Paper diagram. This thread's
chain — **#361** (three-surface trace), **#364** (category × source audit),
**#366** (live-coverage sampling), plus the diagram PRs **#362/#363** — has run
since. Each claim below was checked **against current main directly**, not
inherited from the Aug 25 report or from my own earlier PRs in this thread.

---

## ⚠️ Headline: four of six findings were already false when they were written

This is the single most important result, and it is **not** "a week of work
changed things."

> **TIMEZONE — every clock time in this report is PDT (UTC−7), the repo's local
> frame and the one its committer dates carry.** Stated once, here, and used
> consistently below. An earlier draft mixed PDT committer dates with UTC
> `mergedAt` values in the same paragraph, which made #269 look like an Aug 23
> merge in one frame and an Aug 24 merge in the other. In UTC that PR merged
> `2026-08-24T00:07:08Z`; in PDT it is `2026-08-23 17:07:07`. Same instant,
> different date label — hence the single declared frame.

**The three flag-gated resolver cutovers all merged on 2026-08-23 PDT — two days
before the Aug 25 investigation.** Merge times, all PDT:

| PR | merged (PDT) | cutover |
|---|---|---|
| #260 | 2026-08-23 14:30:48 | Search + `SEARCH_AREA_USE_RESOLVER` |
| #266 | 2026-08-23 16:15:51 | Date Detail + `DATE_DETAIL_USE_RESOLVER` |
| #269 | 2026-08-23 17:07:07 | Day-scoped browse + `TRIP_BROWSE_USE_RESOLVER` |

Verified three ways: each commit is an ancestor of `origin/main`, each carries an
Aug 23 PDT committer date, and main contains **33** further commits dated
Aug 24–27 on top of them (exact count,
`git log origin/main --since=2026-08-24 --until=2026-08-28 | wc -l`,
re-verified 2026-09-03; the earlier "~20" was read off a `head -20`-truncated
listing, not counted).

| Cutover | Commit | Date | PR |
|---|---|---|---|
| Search → `resolvePlaces()` + `SEARCH_AREA_USE_RESOLVER` | `d62f660` | 2026-08-23 | #260 |
| Date Detail → `enrichByGoogleId` + `DATE_DETAIL_USE_RESOLVER` | `a086cb8` | 2026-08-23 | #266 |
| Day-scoped browse → `resolvePlaces()` + `TRIP_BROWSE_USE_RESOLVER` | `b227e65` | 2026-08-23 | #269 |

And the tiering chain, same PDT frame: **#255** 13:05:50, **#256** 13:14:11,
**#259** 14:14:24, **#260** 14:30:48 — all four on Aug 23, spanning **~85
minutes** first-to-last. (A span is frame-independent, so that figure is
unchanged by the timezone correction above; re-verified from `mergedAt` in this
pass.)

So findings 1, 2 and 6 described a state that had already passed. **The Paper
diagram rendered from them depicts a codebase that had not existed for two
days.**

**Likely mechanism — flagged as UNVERIFIED.** The most plausible explanation is
that the Aug 25 session ran in a Conductor worktree cut from a `main` older than
Aug 23, which is a routine hazard in this setup. I cannot verify which checkout
that session used, so this is a hypothesis about *why*, not a finding. What **is**
established is the timeline above.

---

## Item-by-item

### 1. "resolvePlaces() imported by nothing (additive only)" — **CHANGED** (and was already false on Aug 25)

**`src/app`: three importers.** Real `import` statements, not comment mentions:

| File | Imports |
|---|---|
| `app/api/trip-browse/[tripId]/[dayId]/handler.ts:30` | `resolvePlaces` |
| `app/api/search-area/handler.ts:31-37` | `resolvePlaces`, `LIVE_SLIDE_FOR_PRIMARY` (multi-line) |
| `app/api/places/details/handler.ts:23` | `enrichByGoogleId` |

Note the third imports a *different export* from the same module, not
`resolvePlaces` itself — worth keeping distinct when re-checking.

**`src/components`: still zero.** Grep over `web/src/components` for
`resolve-places` returns **0** lines. So the narrow half of the Aug 25 claim
holds; the broad half does not, and the module is reached from components
transitively via the API routes.

### 2. "`SEARCH_AREA_USE_RESOLVER` is only a doc recommendation, no actual flag" — **CHANGED** (already false on Aug 25)

All three flags are real `process.env` reads in route files:

- `app/api/search-area/route.ts:35` — `SEARCH_AREA_USE_RESOLVER`
- `app/api/trip-browse/[tripId]/[dayId]/route.ts:40` — `TRIP_BROWSE_USE_RESOLVER`
- `app/api/places/details/route.ts:36` — `DATE_DETAIL_USE_RESOLVER`

Each first appeared in its cutover commit above (`git log -S`, first match).
Per **#364**, none is set in `web/.env.local` or `.env.development.local`, so
all three default OFF locally; **Vercel's environment is not readable from the
repo and this makes no claim about it.**

### 3. "Shared client cache — decided, zero implementation" — **UNCHANGED**

Still unbuilt. Evidence:

- `lib/places/resolve-places.ts:20-22` still documents the absence as
  deliberate: *"no cache. ADR step 4 puts one shared cache on the client, keyed
  by canonical id."* Line 539 repeats it.
- **No client-cache library is installed** — `web/package.json` has no
  `swr` / `react-query` / `@tanstack` / `apollo` / `urql` dependency.
- **No cache keyed by canonical id anywhere** — grep for `canonicalizePlaceId`
  intersected with `cache` returns nothing.
- The only caches that exist are **three per-route, server-side, in-process**
  ones (`app/api/places/details/route.ts`, `.../trip-browse/.../route.ts`,
  `app/api/search-area/route.ts`). Those are the opposite of what the ADR
  specifies: per-lambda and per-endpoint, not shared and client-side.

### 4. "rating / review_count / price_tier / photo_url unselected despite being real columns" — **UNCHANGED as stated, but the significance differs sharply per column**

Migration `20260821060000_master_place_enrichment_columns.sql` does add all four
to `master_place`. None is read by the resolver's corpus readers:

- `hydrate.ts:72-73` (base table) selects `id, canonical_name, primary_category,
  prominence_score, mvum_corridor, overlander_tags, contact, description,
  attribution, hours, capacity, amenities` — **none of the four**.
- `hydrate.ts:87` (export view) selects `id, lng, lat, photo_url,
  description_source`.

⚠️ **That `photo_url` is NOT the migration's column.** The view's `photo_url`
comes from a `LEFT JOIN LATERAL` over `source_record.normalized_payload->'photo'
->>'url'` (`20260902050100`/`20260902050200`). Same name, different value.
`master_place.photo_url` is still unread. A check that stopped at "photo_url is
selected" would conclude wrongly.

`resolve-places.ts:27-29` still carries the matching note: *"no read of step 1's
new master_place columns … Neither underlying reader selects them yet."*

**Measured on TEST just now** (the Aug 25 framing implies wiring these up would
gain something; for three of four it would gain nothing):

| column | non-null rows |
|---|--:|
| `master_place` total | 161,431 |
| `rating` | **0** |
| `review_count` | **0** |
| `price_tier` | **0** |
| `photo_url` | **10,311** |

`data/scripts/backfill-master-place-enrichment.ts:186-189` asserts the first
three *must* be NULL corpus-wide ("no source carries one"), and the measurement
agrees. **So `rating`/`review_count`/`price_tier` are empty by design — selecting
them today would return nothing.** Only `master_place.photo_url` has substance:
**10,311** populated values currently unread by any web read path.

*(Scope: TEST only. PROD was not measured.)*

### 5. "No polyline support — 2-point start/end only; parallel corridor wrappers" — **UNCHANGED, and now sharper**

- `resolve-places.ts:114-124` — `day-corridor` scope is still
  `{ start: Coord; end: Coord; … }`. Two points.
- `federated.ts:305-307` — `fetchFederatedPois`'s own docstring says it builds
  *"the SAME straight day-segment LineString … start→end — exact parity with the
  current corridor, **not the real per-day polyline (deferred)**."*
- The parallel path is intact: **two wrappers on one RPC**, both in `web/src` —
  `federated.ts:327` (`fetchFederatedPois`, resolver + browse routes) and
  `bake-corridors.ts:127` (`fetchCorpusForPolyline`, generation via
  `preComputeFacts` → `facts.ts:24`).
- **The generation wrapper has the capability the resolver lacks.**
  `fetchCorpusForPolyline` takes `coordinates: [number, number][]` and its
  docstring states the reason: *"A straight 2-point chord's 16 km buffer misses
  POIs where the road curves away from it by >16 km (the Cassiar fuel pumps are
  the canonical case)."*

**BACKLOG item status: still open, unmodified.** `docs/BACKLOG.md:760`,
"`preComputeFacts` → `resolvePlaces()` migration — deferred (2026-08-25)", with
both blockers as written.

#### ✅ Blocker 2 of that item is now ANSWERED — and the answer is the feared one

The item says suppression parity is *"unverified this session and needs
confirming."* Confirmed here:

- **`isSuppressedCategory` has exactly two call sites in `web/src`**:
  `hydrate.ts:140` (bbox/ids path) and `bake-corridors.ts:134` (generation path).
- **`fetchFederatedPois` applies only `isClosedPlace`** (`federated.ts:336-338`)
  — no suppression filter.
- **The RPC does not filter them either.** `pois_along_corridor`'s `WHERE`
  (migration `20260902050100`, lines 139-148) excludes `land_status`, closed and
  decommissioned rows, and template-only descriptions — but **not**
  `dump_station` / `water` / `toilet` / `fire_pit` / `shower` / `picnic_area` /
  `picnic_ground`.

So `preComputeFacts`-via-resolver **would** let suppressed rows through, exactly
as the backlog feared.

⚠️ **But do not over-read it into a live bug.** `fetchFederatedPois` always
passes `p_categories = SLIDE_TO_PRIMARY_CATEGORY[slideKey]`, never `null`
(`federated.ts:320-321`), and per **#364** none of the nine slide buckets claims
a suppressed value. **So nothing leaks today — safety comes from the category
allowlist, not from a suppression filter.** That is a fragile guarantee: passing
`null` categories, or adding an amenity to a slide bucket, would start leaking
suppressed rows with no filter to catch it.

### 6. "Search tiering blocker fixed only in shared hydrate code; route swap unmerged" — **CHANGED** (already false on Aug 25)

`fix/hydrate-description-source` is **merged**, not open and not abandoned —
and so is the route swap:

| PR | Branch | State | Merged (PDT) |
|---|---|---|---|
| #255 | — | **MERGED** | 2026-08-23 13:05:50 |
| #256 | — | **MERGED** | 2026-08-23 13:14:11 |
| #259 | `fix/hydrate-description-source` | **MERGED** | 2026-08-23 14:14:24 |
| #260 | (Search cutover / route swap) | **MERGED** | 2026-08-23 14:30:48 |

The fix is present in main today: `hydrate.ts:87` selects `description_source`,
and lines 108/117 carry its type through. The branch still exists locally and on
origin, which is probably what made it look unmerged — **branch existence is not
merge status.**

---

## Summary

| # | Aug 25 finding | Verdict | Note |
|---|---|---|---|
| 1 | `resolvePlaces()` imported by nothing | **CHANGED** | 3 importers in `src/app`; still 0 in `src/components`. Landed Aug 23 |
| 2 | `SEARCH_AREA_USE_RESOLVER` is doc-only | **CHANGED** | All 3 flags real since Aug 23; all default OFF locally |
| 3 | Shared client cache unbuilt | **UNCHANGED** | No lib, no impl; only 3 per-route server caches |
| 4 | 4 enrichment columns unselected | **UNCHANGED** | True — but 3 of 4 are empty corpus-wide; only `photo_url` (10,311 rows) has substance |
| 5 | No polyline support; parallel wrappers | **UNCHANGED** | Backlog item open; **blocker 2 now answered** |
| 6 | Tiering fixed in hydrate only, swap unmerged | **CHANGED** | #255/#256/#259/#260 all merged Aug 23 |

**Two unchanged findings are genuinely still open and worth acting on** — the
shared client cache (#3) and the polyline gap (#5). **One is technically
unchanged but largely moot** (#4: three of the four columns are empty by
design). **Three were stale on arrival** (#1, #2, #6).

### What this says about the Aug 25 artefacts

> **⚠️ CORRECTED 2026-09-03. The first version of this section made two claims
> about the Paper diagram without opening it. Both were wrong.** The diagram has
> since been read directly (node `3R4-0`, *"resolvePlaces() — verified current
> state"*, in the Paper file "Card data model and ofrmation"). Findings below.

**The diagram DOES pin a reference point — my original claim that it did not was
false.** Its header line reads, verbatim:

> `OVERLANDER · QUICK REFERENCE · VERIFIED AGAINST ORIGIN/MAIN 2026-08-23, NOT LOCAL BRANCH`

So it names both a date and an explicit ref, and goes out of its way to say it
was checked against `origin/main` rather than a local branch — the exact
discipline I claimed was missing. It pins no SHA, which is the only part of the
original criticism that survives, and a much smaller point.

**Note the date: the diagram says 2026-08-23, not Aug 25.** The three cutovers
merged that same day, at 14:30, 16:15 and 17:07 PDT. **So if the diagram was
verified earlier on Aug 23, it was accurate when it was made.** I cannot
determine the hour, so my original "false at render time" was an assertion I had
no evidence for and have withdrawn.

**The diagram is also not uniformly stale.** Read against this report:

| Diagram element | Status now |
|---|---|
| `master_place` SCHEMA BUILT | still accurate |
| **LIVE sources box — "Google, Foursquare (+ RIDB/USFS/BLM per scope)"** | **stale — Mapbox is missing.** `mapboxSearchBoxSource` landed in `864b752` (#289, 2026-08-25, *"Mapbox Search Box as the fuel source"*) and today sits in **both** of `resolve-places.ts`'s default source lists, at **lines 193 and 207** (verified this pass; the import is line 45, lines 184/205 are comments). The same change emptied Google's fuel types, so the box is wrong about both providers |
| GAP note — rating/reviewCount/priceTier/photoUrl columns real but unread | **still accurate** (see item 4; three of four are also empty corpus-wide) |
| Shared client cache — NOT BUILT, "ADR step 4 — decided, zero implementation" | **still accurate** (item 3) |
| "id normalization across known formats (27 tests)" | **still accurate** — `place-id.test.ts` runs **27 tests, 27 pass** (executed this pass) |
| "resolver suite 36/36" | **stale** — `resolve-places.test.ts` now runs **43 tests, 43 pass** (executed this pass) |
| **Day Column box** | **mis-framed rather than stale** — see below |
| "additive only — imported by nothing in src/app or src/components" | **stale** — three importers in `src/app` |
| CORRECTION note — "No `SEARCH_AREA_USE_RESOLVER` flag exists in code… not flag-gated, just not wired" | **stale** — all three flags exist and all three surfaces are flag-gated |
| Date Detail — NOT WIRED | **stale** — wired behind `DATE_DETAIL_USE_RESOLVER` |
| Search — NOT WIRED, "route swap not merged" | **stale** — #260 merged 2026-08-23 PDT |
| Day-scoped browse — NOT WIRED | **stale** — wired behind `TRIP_BROWSE_USE_RESOLVER` |

**Day Column was never a pending wiring task, and earlier versions of this
report were wrong to describe it as "not wired."** Read directly from
`docs/architecture/resolve-places-day-column-cutover-plan.md` §7: *"Do not build
a Day Column cutover PR. There is no endpoint, no client contract, and no
read-path flag… The four-surface framing over-counted Day Column: it is not an
independent read surface but the rendered form of the write path's output."*

Day Column is a **passive renderer of the baked `Trip.days` JSONB** — it calls no
live endpoint, so there was nothing to cut over and no wiring that failed to
happen. That question was closed by **PR #267** (`4757067`, merged
**2026-08-23 16:28:07 PDT**, *"docs: Day Column cutover plan — no endpoint to
wrap, it's a write-path question"*), which means **four** PRs in the resolver arc
landed that day, not the three this report originally counted.

The residual work is a **write-path** question, tracked separately at
`docs/BACKLOG.md` § *"Day Column write-path / baking consolidation — DEFERRED
(from #267, 2026-08-23)"*, which records that the bake already reads the same
`pois_along_corridor` RPC and mapper the resolver's day-corridor half uses, so
routing it through `resolvePlaces()` is largely redundant today.

**Recommendation: REGENERATE, not retire.** Grounded in the table above rather
than in the diagram's reputation: its architectural shape (`master_place` +
LIVE sources → `resolvePlaces()` → shared cache → surfaces) is still the correct
shape, and three of its elements are still accurate — the shared-cache
NOT BUILT box and the columns GAP note, which are the two items this report found
genuinely open, plus the "27 tests" figure. Retiring it would destroy correct
information. Leaving it as-is is also wrong on six counts: the LIVE sources box
omits Mapbox, the resolver-suite figure is stale, three surface boxes carry false
NOT WIRED badges, and the CORRECTION note asserts a flag does not exist when
three do. The Day Column box needs re-framing rather than a status flip — it was
never a pending wiring task.

The durable lesson survives, but narrower than I first wrote it, and it now
applies to me rather than to that session: **do not characterise an artefact you
have not opened.** Every claim in this report is anchored to `0dae80c` with
cutover commits cited by SHA; the diagram claims above are anchored to a direct
read of node `3R4-0`.

**Scope of the negatives here:** "zero importers in `src/components`", "no
client-cache library", "two `isSuppressedCategory` call sites" are all scoped to
`web/src` and `web/package.json` on `0dae80c`, via repo-root grep. Column counts
are TEST-only.
