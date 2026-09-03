# Re-verify the `resolvePlaces()` Paper diagram against `main` @ `75207ba`

**Date:** 2026-09-03
**Diagram:** Paper file *Card data model and ofrmation* (`01KYG6G37E7TN00XA1PXEAZX2D`),
artboard **`3R4-0`** — *"resolvePlaces() — verified current state"*.
**Previous verification:** #371, against `origin/main` @ `0dae80c`.
**This pass:** `origin/main` @ **`75207ba`** — not `4e55039`. Main moved again
between the request and this pass: **#368** merged on top of #376.
**Outcome:** **one claim was stale and was fixed; every other claim held.**
Nothing about #373's constant split required a diagram change.

Confidence labels: `[literal]` = directly executed or read from source in this
pass · `[strong inference]` = read but not executed · `[unverified]` = neither.

---

## 1. The direct question: does #373's constant split affect the diagram?

**No.** `[literal]`

#373 split one constant in
`web/src/app/api/trip-browse/[tripId]/[dayId]/route.ts` into
`ALL_VIEW_CATEGORIES` (the `all` expansion) and `REQUESTABLE_CATEGORIES`
(derived from `BROWSE_CARD_CATEGORIES` via `browseCategoryToSlide`), and
extracted the validation into a pure exported `resolveRequestedCategories()`.

Two independent reasons it touches nothing on the diagram:

1. **The diagram never mentions the category vocabulary.** All 40 text nodes on
   `3R4-0` were enumerated and read. None references `SLIDE_CATEGORIES`,
   category validation, the chip row, `urban`/`interest`, or the request
   allowlist. The day-scoped-browse box carries exactly three facts — the
   surface name, `WIRED · FLAG OFF`, and
   `TRIP_BROWSE_USE_RESOLVER, default off locally — #269 merged 2026-08-23`.
2. **The change is entirely upstream of the resolver hand-off.** Reading the
   diff hunk: the edit replaces an inline validation block with a call to
   `resolveRequestedCategories(...)` and assigns the same
   `requested: SlideCategoryKey[]`. The `useResolver: TRIP_BROWSE_USE_RESOLVER`
   hand-off into `produceBrowsePlaces` is outside every hunk, and
   `handler.ts` was not touched by #373 at all.

**A distinction worth keeping:** the fix is *not* "purely internal, same
behaviour." It **materially changes behaviour** — `REQUESTABLE_CATEGORIES` is
deliberately **wider** than `ALL_VIEW_CATEGORIES`, so the `urban` and `interest`
chips now return 200 instead of 400. What is unchanged is **this surface's
relationship to `resolvePlaces()`**, which is all the diagram describes. Real
behaviour change; zero diagram impact.

## 2. The general sweep — everything that changed since `0dae80c`

Rather than reasoning only about the category angle, the full non-docs diff was
enumerated `[literal]`:

```
git diff --stat 0dae80c..HEAD -- . ':!docs'   →  11 files
```

- **Product code: exactly one file** —
  `web/src/app/api/trip-browse/[tripId]/[dayId]/route.ts` (#373), plus its two
  test files.
- **Everything else is config or tooling:** `.github/workflows/ci.yml`,
  `CLAUDE.md`, `web/package.json` (all #376), one `data/scripts/` file (#368),
  and four `web/scripts/` measurement scripts (#364/#366).

**#376 changed no product code at all** `[literal]` — its only `web/src` edits
are comment-header corrections in two test files. So its candidate diagram
impact was limited to the **test counts** the diagram quotes, which were
re-executed below and are unchanged.

## 3. Claim-by-claim results

| # | Diagram claim | Result |
|---|---|---|
| 1 | `resolvePlaces()` importers: `trip-browse/…/handler.ts:30`, `search-area/handler.ts:32`, `places/details/handler.ts:23` | **HOLDS** `[literal]` |
| 2 | "Still 0 in `src/components`" | **HOLDS** `[literal]` — no hit for `resolve-places` or `resolvePlaces` anywhere under `web/src/components` |
| 3 | "id normalization across known formats (27 tests)" | **HOLDS** `[literal]` — `place-id.test.ts` runs **27/27** |
| 4 | "resolver suite 43/43" | **HOLDS** `[literal]` — `resolve-places.test.ts` runs **43/43** |
| 5 | LIVE sources: "Mapbox (fuel) · Google · Foursquare (+ RIDB/USFS/BLM)" | **HOLDS** `[literal]` — both default lists in `resolve-places.ts` are `mapboxSearchBoxSource, googlePlacesSource, foursquareSource/recGovSource, usfsSource, blmSource` |
| 6 | Three flags real, each default OFF | **HOLDS** `[literal]` — all three read `process.env.X === "true"` |
| 7 | Flag provenance: #260 / #266 / #269 merged 2026-08-23 | **HOLDS** `[literal]` — `d62f660` 14:30:48, `a086cb8` 16:15:51, `b227e65` 17:07:07, all 2026-08-23 |
| 8 | Shared client cache NOT BUILT; resolver holds no cache | **HOLDS** `[literal]` — `resolve-places.ts:20-22` and `:538-540` say so; no cache implementation in the module |
| 9 | Day-corridor scope is 2-point start/end (`resolve-places.ts:114-120`) | **HOLDS** `[literal]` — the `kind: "day-corridor"` union member carries `start`/`end` only; the file is untouched since `0dae80c` |
| 10 | `federated.ts:305-307` — real per-day polyline deferred | **HOLDS** `[literal]` |
| 11 | `fetchCorpusForPolyline` at `bake-corridors.ts:122` | **HOLDS** `[literal]` — line 122 is its `export async function` line, in `web/src/lib/trips/bake-corridors.ts` |
| 12 | **`BACKLOG.md:760`, still open** | **STALE — FIXED** `[literal]`, see below |
| 13 | `rating / reviewCount / priceTier / photoUrl (nullable)`, `description_source` → tier | **HOLDS** `[literal]` |
| 14 | GAP box: `161,431` master_place rows, `10,311` with `photo_url` | **NOT RE-MEASURED** `[unverified]`, see §5 |

### A near-miss worth recording

The first importer sweep appeared to show `search-area/handler.ts` at line
**37**, not the diagram's **32** — a plausible-looking drift. It was not one.
`grep` matched the **closing** `} from "@/lib/places/resolve-places";` line of a
multi-line import; `resolvePlaces` itself is on line **32**. Confirmed twice
over: the file is byte-identical at those lines between `0dae80c` and `75207ba`,
and **no commit has touched it since** `0dae80c` `[literal]`. A drift report
here would have been an artifact of the query, not a fact about the code.

## 4. The one real fix

**`BACKLOG.md:760` no longer resolves.** `[literal]`

- At `0dae80c`, line 760 **was** `## `preComputeFacts` → `resolvePlaces()`
  migration — deferred (2026-08-25)` — the correct target, and the section that
  names both `fetchCorpusForPolyline` and `fetchFederatedPois`.
- At `75207ba`, that heading is at line **1076**. Line 760 now falls inside an
  unrelated `operational_status` SQL block.
- Cause: `docs/BACKLOG.md` went from **4287** to **4665** lines across **7**
  merges since `0dae80c` (#361, #364, #367, #366, #373, #376, #368). **#373 and
  #376 are two contributors, not the cause** — the section moved 316 lines and
  those two account for well under half of that.

**Edit applied** to node `4AH-0`: the bare line citation became a **section
citation with the line as a secondary, ref-stamped hint** —
`BACKLOG.md § "preComputeFacts → resolvePlaces() migration" (line 1076
@75207ba), still open.` A bare line number into an append-heavy doc is
guaranteed to rot; the section heading is stable.

**Edit applied** to node `3R6-0` (the header stamp): now records this pass's ref
alongside the original, and states its scope —
`… verified against origin/main @0dae80c, 2026-09-03 · code re-verified
@75207ba 2026-09-03 (DB counts not re-measured) — not local branch`.

**A first attempt at that header overflowed the artboard and was caught and
corrected before finishing.** The node is a fixed 1649px single-line text box
inside a 1700px artboard; the longer wording clipped at `— NOT LOCAL BRANC`.
Verified by screenshot **after** the correction, not assumed from the write
succeeding — the same discipline as reading a value back rather than trusting a
successful call.

## 5. What this pass did NOT verify

**The GAP box's two row counts — `161,431` master_place rows with NULL
`rating`/`review_count`/`price_tier`, and `10,311` rows carrying a real
`photo_url` on TEST — were not re-measured** `[unverified]`. They need live DB
queries, which is outside a source-diff verification pass.

`[strong inference]` They are unlikely to have moved *because of #373/#376*:
neither PR contains a migration, a data script, or any corpus write — #373 is
one route file, #376 is CI config. But the corpus grows independently of this
repo's merges, so **treat both numbers as dated to #371's measurement, not to
`75207ba`.** The header stamp now says exactly that.

## 6. Outcome

**One text fix, one header stamp, no structural change.** The diagram's model of
`resolvePlaces()` — what is built, what is wired, which flags gate which
surface, where the gaps are — is accurate against `main` @ `75207ba`. #373's
constant split is real behaviour change that the diagram simply does not
describe, and #376 touched no product code.
