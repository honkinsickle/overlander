# Link the overnight to its existing spine tile

2026-08-24. Implements the overnight slice recommended in
`docs/decisions/notes-to-spine-gap.md` (PR #278). Branch `overnight-spine-tile`.

## Context

The notes-to-spine investigation found the overnight is already a structured,
grounded field — `audit.ts` grounds `overnight.name` pool-first → live-resolve
→ on-corridor guard — and, when it grounds, its place is already present on the
spine (a live-resolved overnight becomes a `segmentSuggestions` tile via
`bake.ts:resolvedToTile`; a pool-hit overnight arrives via the corpus fold). The
gap was **labeling and duplication**, not resolution: the tile was never marked
as the overnight, and the same place was emitted three independent times — an
unlabeled spine tile, the "Camping" briefing block (from `day.overnight`), and
an "Overnight —" prose line in `day.notes`.

Note: production had **no** overnight→tile matching at all. The "lenient
substring match" #278 mentions was only in that investigation's throwaway
measurement script; this change adds a real match to production for the first
time, by **identity**, not substring.

## Decision

- **Match by canonical id, not name.** `audit.ts` records
  `DayAudit.overnightRef` — the id of the tile that IS the overnight: a corpus
  id on a pool-hit, `google:<placeId>` on a live-resolve (derived by
  `overnightTileRef`, which reads the same `groundReference` outcome that grounds
  the overnight). `null` on a desc-only / dropped overnight.
- **Mark the one tile.** `bake.ts:markOvernightTile` flags the tile whose id
  equals `overnightRef` as `isOvernight`, and sets `curated` so it is featured
  on the spine (the spine demotes non-curated tiles in `curatedMode`) rather
  than lost in the pool. Its status line carries the overnight's rationale. Pure
  and unit-tested; a no-op when `overnightRef` is null or matches no tile.
- **Single source of truth, no triplication.**
  - The spine tile badges as "Overnight" (`pickStatus` in
    `day-detail-corridor.tsx`, threaded via `placePool`).
  - The "Camping" briefing block **derives from that tile** when present
    (`day-briefing-card.tsx`), falling back to `day.overnight` only when there
    is no tile.
  - `to-trip.ts:dayNotes` **drops the redundant "Overnight —" prose line** when
    the overnight is on the spine.
- **Fallback, never a forced match.** When the overnight is desc-only or off
  this day's corridor (no tile), nothing is marked, the Camping block reads
  `day.overnight`, and the prose line stays — the same empty/fallback-over-a-
  bad-pick posture as #275. The `MAX_BACKFILLS_PER_DAY` cap and the #276
  backfill are untouched: this links an already-resolved place, it does not
  resolve or pick anything.

## Consequences

- **Existing trips are unaffected.** The bake/notes changes only run at
  generation time, so stored payloads keep their old notes. On render, an
  existing trip has no `isOvernight` tile, so `pickStatus` returns the note
  unchanged and the Camping block falls back to `day.overnight` — byte-identical
  behavior. Only newly generated trips gain the link.
- **The overnight rides the curated-pick path** (featured + badged) rather than
  a bespoke overnight node style. This is the surgical reuse of existing
  machinery; a fully distinct overnight node treatment is a follow-up.
- **Verification:** unit-tested (`overnight-tile.test.ts`, the two new
  `to-trip.test.ts` cases) plus the full `typecheck` + `next build` gate, both
  exit 0. **Not verified via a live end-to-end generation** — that needs the
  authed wizard + LLM, out of reach here; the audit→bake wiring is covered by
  the pure-helper tests and the type gate, not an integration run.

### Open UX questions — flagged, not decided

Per the standing rule (product/UX calls surfaced, not made unilaterally):

1. **Should the "Camping" briefing block remain at all** once the overnight is a
   labeled spine node, or is the block now redundant with the tile? Kept for now
   (deriving from the tile) rather than removed.
2. **Exact overnight affordance** — this uses an "Overnight ·" status prefix on
   the featured card; a distinct badge/icon or a dedicated overnight node style
   may read better.
3. **Overnight == the end-town node.** When the overnight IS the day's end city
   (a town, e.g. "Moab, UT"), its tile is stripped as node-identical, so no
   separate tile is marked and the prose line stays. Whether the end **node**
   itself should be labeled "overnight" is unaddressed.

---

## Follow-up (2026-08-24) — reported "overnight tile missing on some days"

Post-merge live testing reported the link working on some days, silently absent
on others within one trip, and **no visible "Overnight" badge anywhere**.

**Investigated — root cause is NOT a code defect in #279.** Measured every
generated trip in TEST `public.trips` `[queried TEST 2026-08-24]`: **`isOvernight`
is absent on every tile of every day of every trip** — a *universal* absence, not
the day-to-day inconsistency it looked like. The days that appeared to work had
the overnight tile featured only because the LLM *also* listed it as a key stop
(`curated=true`, `isOvernight` unset); the "broken" days had the tile present but
uncurated, so it demotes in `curatedMode` and reads as missing. No badge showed
because `isOvernight` was never set.

**Why universal-absent:** #279 landed on `main` at **2026-08-25T01:23:46 UTC**;
the newest trip in TEST was created **01:26 UTC** (~3 min later, before any deploy
could build) and the rest predate the merge entirely. So none of these trips were
generated by code containing #279 `[git log + created_at, 2026-08-24]`.

**The #279 wiring is verified correct**, not assumed: a new integration test
(`bake-overnight-integration.test.ts`) drives the real `bakeGeneratedDays` with a
fake corridor-RPC client (no network) and confirms it reads `day.audit.overnightRef`,
finds the matching tile, and sets `isOvernight` + `curated`; the desc-only case
marks nothing. The generate→audit→bake→persist wiring was also read end to end
(`expedition-actions.ts:85-88` passes the audited days, carrying `overnightRef`,
straight into `bake`).

**Resolution:** regenerate a trip with #279-deployed code and re-check. This is a
merge-vs-deploy lag, not a bug to fix in code.

### Residual risk — UNCONFIRMED, flagged not fixed

A **pool-hit** overnight is linked by its `master_place` id (`overnightRef =
poi.id`). TEST has **duplicate rows for the same place** — e.g. **7** `master_place`
rows match "Silver Strand" (campground, state beach, county park, …)
`[queried TEST 2026-08-24]`. If the name-match in the audit's pool resolves to a
*different* row than the day's corridor fold surfaces, `overnightRef` won't match
any baked tile and the overnight stays unmarked **even post-#279**. This is
distinct from the reported symptom and **cannot be confirmed without a post-#279
generation** (the ref is transient — not in stored payloads). A live-resolve
overnight (e.g. Granite Flat → `google:<placeId>`) is immune: its tile id equals
the ref by construction.

### Badge prominence (Q3) — UX call, flagged

Where `isOvernight` is set, the affordance is the `pickStatus` "Overnight ·"
status-line prefix from #279 — subtle, and possibly not distinct enough from an
ordinary key stop. Whether it needs a stronger badge/icon is the same open UX
question already logged above; not decided here.

---

## Follow-up 2 (2026-08-24) — live-generation confirmation

Ran a real generation on the dev server's #279 code (LLM spend approved) to
confirm the fix end-to-end and probe the residual. Method: drove the real
`preComputeFacts → generateAndAudit → bakeGeneratedDays` pipeline via a script
against **TEST** (service-role, API keys injected from `.env.local`, hard
TEST-only assertion), inspecting the transient `day.audit.overnightRef` directly;
persisted one throwaway reference slug for a browser render, then deleted it.
Route: San Diego → Los Angeles, 3 days, beach-camping objective.

**#279 works end-to-end — CONFIRMED.** Both overnights (San Elijo State Beach
day 1, San Onofre State Beach day 2) got `overnightRef` set (live-resolve,
`google:<placeId>`), the ref **matched the baked tile by id**, and that tile
carried `isOvernight=true` + `curated=true`. In the rendered day view: the
overnight is featured as a Key Stop with an "Overnight · …" status, the **Camping
briefing block derives from the tile**, the redundant **"Overnight —" notes line
is gone**, and there is **one** card per place. So the earlier "missing" report
was pre-#279-deploy trips (per #280), not a defect.

**Silver Strand residual — does NOT manifest** (but stays theoretically open).
Direct probe: despite **7** `master_place` rows named "Silver Strand", the
generation pool surfaced exactly **one** eligible entry (`mp:54182e9b`, the
campground) and the Coronado corridor fold surfaced the **same** id — they agree,
so a pool-hit Silver Strand overnight would match `[queried TEST 2026-08-24]`.
Eligibility filtering (the pool query + `pois_along_corridor` exclusions of
land_status/boundary rows) collapses the collision. **Caveat:** the live LLM
chose *live-resolve* overnights (immune by construction), so a pool-hit overnight
being marked was not directly observed live — the id agreement plus
`bake-overnight-integration.test.ts` cover that path. **If it ever bites**, the
divergence would be the trip-wide pool (`preComputeFacts`) vs the per-day fold
(`pois_along_corridor`) selecting *different* rows for one name; a fix would make
both key on the same canonical id, or ground the overnight with geographic
disambiguation rather than name alone. Flagged, not fixed.

**Badge prominence (Q3) — renders, but subtle (screenshot-confirmed).** The
overnight card is visually identical to any Key Stop card (photo, amber title,
"yoTrippin Verified ★ rating", green-dot status line, Details →); the ONLY
differentiator is the leading text "Overnight ·" in the same gray status-line
styling as an ordinary key-stop note. No distinct color, icon, badge, or border.
This matches the original "reads as a normal verified card" report. Whether to
strengthen it (a colored badge / icon / dedicated node style) is a **UX call —
flagged, not decided.**

**Minor data-cleanliness (new):** the overnight is usually the same place as the
day's *endpoint* (and sometimes also a key stop), so `resolvedPlaces` carries
2–3 same-id entries (`where:"endpoint"` + `"overnight"` [+ `"keyStop"`]) → 2–3
same-id tiles in the persisted `segmentSuggestions`, all flagged `isOvernight`.
**The render dedupes by id** (`byId` / `curatedPicks` Maps in
`day-detail-corridor.tsx`), so exactly one card shows — harmless visually, but
messy stored data. A tidy-up would dedupe `resolvedPlaces`/tiles by id in
`bake.ts`. Flagged, not fixed.

---

## Follow-up 3 (2026-08-24) — "New Shady Rest missing" report: timing, plus a REAL pool-hit gap found

A Day-2 screenshot (Red Mountain, CA → Mammoth Lakes, CA, overnight "New Shady
Rest Campground") showed the overnight absent from the spine. Investigated via
persisted TEST payloads + `preComputeFacts` probes (no LLM spend).

### The reported trip — TIMING, not a regression

Trip `2d014a87` "San Diego → Reno", created **2026-08-25T02:29:44 UTC**. It has
**zero `isOvernight` tiles on any day** `[queried TEST]`, so it was generated by
code **without** #279. Its New Shady Rest tile (`mp:ec830a17`) *is* present in
Day 2's fold, and `New Shady Rest Campground` is in that route's generation pool
as the same id `[preComputeFacts, TEST]` — so it **would** mark under #279
(a pool-hit whose fold tile shares the ref id; the same shape as Big Reservoir
below, which *did* mark). So this specific case is the #280 pre-deploy class.

⚠ **The deploy was NOT a clean cutover — flagged, not resolved.** Two #279-marked
trips exist at **02:16 / 02:17 UTC**, *older* than this 02:29 trip, and unmarked
trips also appear *after* them (02:21, 02:29). So `2d014a87` was generated by a
non-#279 code path even though later than some #279 trips — most likely the
wizard is being exercised across more than one environment/deploy. Pinning the
exact deploy topology is an infra question (needs deploy logs), not determinable
from the DB.

### A genuine #279 gap, found in a #279-generated trip

Trip `c64ebc1c` "San Jose → Reno" (02:16 UTC, #279 code) is **partially marked**:
- Day 1 overnight **Big Reservoir Campground** (`mp:7dc38e4d`) — pool-hit, tile
  in the day's fold → **MARKED** ✓ (live proof a pool-hit overnight marks).
- Day 2 **William Kent Campground** (`mp:643ec87f`) and Day 3 **Kaspian
  Campground** (`mp:ee49789a`) — **NO tile at all → UNMARKED.**

Root cause `[preComputeFacts + payload, TEST]`: William Kent and Kaspian **are**
in the trip-wide generation pool (so the overnight grounds as a pool-hit,
`overnightRef = mp:…`), but the **per-day corpus fold** (`fetchCorpusForSegment`,
a tight 2-point segment query) did **not** surface them, so no baked tile carries
that id and `markOvernightTile` is a no-op. This is the asymmetry the design
already half-anticipated but under-scoped: **live-resolve overnights get a
synthesized tile (`resolvedToTile`) and always mark; pool-hit overnights rely on
the day's fold and silently miss when the fold doesn't include them** (dwell days
and days whose tight chord misses an off-highway campground are the usual
triggers). This is the ACTUAL residual — not the name-collision the earlier
Follow-up hypothesised (Silver Strand agreed; this is a coverage gap, not an id
collision).

### Fix scope (NOT fixed — needs more than a trivial change)

To mark a pool-hit overnight the day's fold misses, the bake would **synthesize a
tile from the pool POI** (it has coords/name/category) when no fold tile carries
`overnightRef`, then bucket it onto the spine — mirroring the `resolvedToTile`
path live-resolves already get. That needs the audit to surface the overnight's
pool POI (coords + name), not just its id, to `bake` (today only
`DayAudit.overnightRef` — the bare id — crosses that seam), plus tile synthesis +
`bucketPlacesIntoCorridor` for the new tile. Touches the audit→bake contract and
spine bucketing, so: **flagged with scope, not implemented.** Whether an
off-corridor overnight *should* be forced onto the spine at all (vs. left as the
Camping/notes prose) is also a product call — flagged.

---

## Follow-up 4 (2026-08-24) — live reproduction of the pool-hit gap (dwell + backcountry)

Ran a live generation on #279 code (LLM spend approved) deliberately targeting
Follow-up 3's risk cases: Bishop → Mammoth (dwell 1 night = a layover day) →
South Lake Tahoe, objective forcing dispersed/off-highway USFS campgrounds.
**All five overnights grounded as pool-hits (`mp:` refs).** Per-day result
(computed this run):

| Day | Type | Overnight | ref | tile | isOvernight |
|---|---|---|---|---|---|
| 1 | drive | Convict Lake Campground | `mp:e97401d5…` | none in fold | ✗ |
| 2 | **layover** | Convict Lake Campground | `mp:e97401d5…` | none in fold | ✗ |
| 3 | drive | Twin Lakes Campground | `mp:96a77e1f…` | matched | ✓ |
| 4 | drive | Hope Valley Campground | `mp:780e086d…` | present at a **different id** `google:ChIJ…` | ✗ |
| 5 | drive | Fallen Leaf Campground | `mp:cf68537e…` | matched | ✓ |

**Two marked, three unmarked — a clean live reproduction of the Follow-up 3 gap**,
including the predicted **layover** trigger (Day 2: a dwell day's degenerate route
yields no fold, so the overnight has no tile). Days 1–2 (Convict Lake) are the
plain fold-miss: the pool has it, the day's fold does not, no tile carries the ref.

**Refinement — the root cause is broader than "fold miss."** Day 4 (Hope Valley)
is a NEW sub-case: the overnight place **is** on the spine, but as a live-resolve
**`google:` tile** (from the day's *endpoint* resolution — `endPlace` was the
campground), while the **overnight grounded pool-first to the `mp:` id**. Same
place, two id schemes, so `markOvernightTile` (id-exact) doesn't connect them. So
the real statement of the gap is: **the id the overnight ref carries (pool-first
`mp:` from the audit) and the id of the tile that actually represents the place on
the spine can differ or be absent, because overnight grounding (pool-first) and
tile production (per-day fold `mp:` + endpoint/keyStop live-resolve `google:`) are
independent paths with different id schemes.** #279 marks only when they coincide
(Days 3, 5). This subsumes both the plain fold-miss (Follow-up 3) and the
`mp:`-vs-`google:` mismatch seen here.

**Not fixed — this only sharpens the fix scope.** A robust fix links the overnight
to whatever tile represents its place regardless of id scheme (match by canonical
place / coords / `google_place_id`, not just the raw ref id), and/or synthesizes a
tile from the overnight's own grounded coords when none is present — both cross the
audit→bake seam. Flagged, not implemented. Whether an off-corridor / layover
overnight should be forced onto the spine at all stays a product question.
