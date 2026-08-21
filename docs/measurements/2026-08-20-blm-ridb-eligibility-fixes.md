# BLM website + RIDB directions eligibility fixes — 2026-08-20

Code fix pass on TEST (`znldzjdatkogdktymtvi`) only. **No PROD
(`nqzeywzcowujzyegxbsr`) changes of any kind** — no migration, no ingest, no
backfill run against PROD, no `--confirm` flag ever passed. Stopping here
per the task's instruction; explicit go needed before any PROD step.

Both fixes follow from the 2026-08-20 NONE-bucket characterization
(`docs/measurements/2026-08-20-none-bucket-characterization.md` §5).

## Fix 1 — BLM `WEB_LINK` → `has_website`

### Root cause — not what was assumed, and worth reading before trusting the fix

The task's framing called this a "normalizer bug." **It isn't a bug — it's
a deliberate, commented design decision that this fix reverses.**
`data/ingestion/sources/blm-rec.ts`'s `normalize()` already read
`WEB_LINK` and wrote it to `normalized_payload.web_link` — a real value,
correctly extracted, just not under the key `has_website` reads
(`contact.website`). The original code comment, preserved in place:

> `// Office-level URL, not per-POI — stored, not promoted.`

BLM's `WEB_LINK` is a link to a whole recreation area or river corridor's
BLM page (e.g. `https://www.blm.gov/visit/lower-deschutes-wild-and-scenic-river`
for one individual dispersed campsite among many along that river) — not a
URL specific to the one point it's attached to. Whoever wrote the ingester
deliberately kept it out of `contact.website` so it wouldn't be
represented as "this place's own website."

**Implemented the fix exactly as scoped anyway, per the task's explicit
instruction to do so and flag the concern rather than substitute
judgment.** The concern is flagged here, in the code (both on the field
docstring and inline on the new `website` local in `normalize()`), and in
the commit: **`has_website=true` on a BLM row now means "a real URL
exists for the general area," not "this specific place has a website" the
way it does for a source with genuinely per-POI URLs.** Whether that's an
acceptable trade for the eligibility signal is a product read, not
something this fix pass decided.

### Fix applied

`data/ingestion/sources/blm-rec.ts`: `normalize()` now also sets
`contact: { website } ` (the same field/shape `computeSignals()` in
`data/scripts/lib/eligibility.ts` already reads for every other source),
alongside the pre-existing `web_link` field, which is kept unchanged for
continuity. **Confirmed via `field_precedence`, not assumed:** `contact`
is an existing whole-object precedence-resolved field
(`google` > `nps`/`parks_canada` > `ridb` > `osm` > `ioverlander` >
`bc_parks` > `alberta_parks`) — the right target field, not a new one.

**Separate, related gap surfaced and deliberately NOT fixed here:** BLM
has **zero** `field_precedence` rows for any field — confirmed by grepping
every migration. This fix makes `has_website` (an eligibility-bucketing
signal computed directly from `source_record`, independent of
`field_precedence`) correctly see BLM's website. It does **not** make that
website appear on `master_place.contact` for end users — `resolve_field()`
would need a `('contact', 'blm', <priority>)` row to ever select BLM's
contact for display, and none exists. Not added in this pass — assigning
BLM a corpus-wide priority ranking is a real decision (CLAUDE.md: ask
before changing source priorities), not a two-line follow-on to a signal
fix, and this task was scoped to the eligibility signal specifically.

### Backfill

New script `data/scripts/backfill-blm-website.ts` (added to
`data/package.json` as `backfill:blm-website`), same
Phase-1-read-then-Phase-2-write shape as the existing
`backfill-ridb-photo.ts` (re-derive from each row's own stored
`raw_payload`, no network calls, PROD gated behind `--confirm`, idempotent).
Applied to TEST:

```
scanned: 876, withWebLink: 625, withRealWebsite: 625, changed: 625, skipped: 251, errors: 0
```

625 of 876 BLM `source_record` rows (all statuses, not just NONE-bucket —
a backfill corrects data regardless of current activation) had a real
`WEB_LINK` and got `contact.website` populated; 251 had no `WEB_LINK` and
were correctly left with `contact: null`. 0 errors.

## Fix 2 — RIDB `facility.FacilityDirections` not checked

### Root cause

Confirmed by grepping `eligibility.ts`'s own git history: **there was no
prior committed USFS-directions fix to pattern-match.** This session's
earlier "USFS directions fix" was only ever a reimplementation inside
one-off measurement scripts (`measure-usfs-directions-fix-2026-08-20.ts`
and its successors) — `lib/eligibility.ts` was deliberately left untouched
at the time (that task's own scope said not to touch it without
authorization). `usfs.ts`'s ingester already wrote real directions text
into `normalized_payload.directions`; only the eligibility signal never
read it. RIDB's gap was one layer earlier: `ridb.ts`'s `FacilitySchema`
didn't even parse `FacilityDirections`, so it never reached
`normalized_payload` at all — visible only inside the passthrough
`raw_payload`.

### Fix applied — generalized, not duplicated per-source

Given real authorization to touch the shared module this time, implemented
this as **one generic fix that covers both sources**, not two separate
special-cases:

- `data/scripts/lib/eligibility.ts`: new `has_real_directions` signal,
  checking `normalized_payload.directions` with the same
  `DESCRIPTION_MIN_LENGTH` (40-char) threshold as `has_real_description`.
  Deliberately a **separate** signal, not folded into
  `has_real_description` — real turn-by-turn directions and real
  descriptive prose are different content, not different phrasings of the
  same fact. Folded into `isStrong()` alongside the existing signals. This
  is source-agnostic: it works for USFS automatically (already populated
  `normalized_payload.directions`) and now RIDB, and will work for any
  future source that populates the same field, with no further
  eligibility.ts change needed.
- `data/ingestion/sources/ridb.ts`: `FacilitySchema` now parses
  `FacilityDirections`; `normalizeFacility()` writes it to
  `normalized_payload.directions` (HTML-stripped via a new local
  `cleanText()`, mirroring the existing pattern in `bc-parks.ts`). Scoped
  to **facility rows only** — `RecAreaSchema` has no directions-equivalent
  field, matching what the characterization pass actually found.
- Added 12 new unit tests (7 in `eligibility.test.ts`, 3 in `ridb.test.ts`,
  covered the boundary/independence/HTML-stripping cases) plus 2 in
  `blm-rec.test.ts` for Fix 1. Full workspace suite: **28 files, 531
  passed, 3 skipped, 0 failed** (pre-existing skips, unrelated).

### Verify RIDB-only — same standard as the USFS-fix framing

Reused the exact same shared module every other eligibility script in this
session depends on, so "is this RIDB-only" reduces to "does any non-RIDB,
non-BLM master_place's bucket change" — checked directly, not assumed:
**33,817 non-BLM/non-RIDB-linked in-scope master_places checked, 0 bucket
changes.** A separate check specifically isolated USFS (the other source
that already populates `directions`): **4,212 USFS-only master_places
(no BLM/RIDB co-source) checked, 0 bucket changes** — confirms today's
fixes didn't silently re-touch USFS's already-correct behavior.

### Backfill

New script `data/scripts/backfill-ridb-directions.ts` (added as
`backfill:ridb-directions`), same shape as Fix 1's backfill — facility
rows only (external_id starting `ridb:facility:`), existing `photo` field
carried through unchanged (not clobbered), PROD-gated. Applied to TEST:

```
scanned: 6013, facilityRows: 4793, withDirections: 3114,
withRealDirections: 3047, changed: 3106, skipped: 2907, errors: 0
```

**This number is much larger than the "8 rows" the characterization pass
found** — because that 8-row figure was scoped to the NONE bucket only
(425 rows sampled), while the backfill scope is every RIDB facility row
regardless of current bucket (4,793). 3,047 of all 4,793 RIDB facilities
(63.6%) carry real directions text — most of those rows were already
STRONG via other signals (RIDB is >90% STRONG corpus-wide, per the
2026-08-20 gap scan), so the signal is newly true for many rows but only
**flips the bucket** for the narrow slice that had nothing else. See
below — that slice is exactly 8, confirming the characterization pass's
finding held at full scale, not just in its sample.

## Before/after bucketing — both fixes, one verification pass

Computed OLD (pre-fix, reconstructed from current data — BLM's `contact`
was unconditionally `null` pre-fix, RIDB's `directions` key didn't exist
pre-fix, both verified directly against the original code) vs NEW (current,
post-fix-and-backfill) in a single pass, so no separate "before" DB
snapshot was needed. Run 2026-08-20T22:59:43Z, 39,980 in-scope
master_places, 86,739 active source_records (corpus grew slightly since
the characterization pass's 38,950/17,187 baseline — a live TEST
environment, not a discrepancy).

| | OLD | NEW |
|---|--:|--:|
| STRONG | 21,763 (54.43%) | 22,042 (55.13%) |
| WEAK | 106 (0.27%) | 100 (0.25%) |
| **NONE** | **18,111 (45.30%)** | **17,838 (44.62%)** |

**273 rows flipped out of NONE, corpus-wide.**

**BLM-linked in-scope master_places (672 total):**

| | OLD | NEW |
|---|--:|--:|
| `has_website` (aggregated across all of that MP's active sources) | 1 (0.15%) | 463 (68.90%) |
| NONE bucket | 418 (62.20%) | 153 (22.77%) |

**265 BLM-linked master_places flipped out of NONE** — the BLM slice of
the bucket dropped by nearly two-thirds.

**RIDB-linked in-scope master_places (5,492 total):**

| | OLD | NEW |
|---|--:|--:|
| `has_real_directions` (aggregated) | 805 (14.66%) | 2,933 (53.40%) |
| NONE bucket | 423 (7.70%) | 415 (7.56%) |

**8 RIDB-linked master_places flipped out of NONE** — matches the
characterization pass's "8 of 425" finding exactly, now confirmed at full
population scale rather than sample scale.

**Cross-check, not asserted — computed:** 265 (BLM) + 8 (RIDB) = **273**,
exactly the corpus-wide total above. No double-counting, no unattributed
movement, no third source silently affected.

## Confirmed scope

- **TEST only.** Every script defaults to TEST via `data/.env`; PROD is
  gated behind an explicit `--confirm` flag that was never passed. No
  `db:push-verify`, no migration, no PROD `.env` swap occurred.
- **No code changes beyond what's scoped:** `blm-rec.ts` (+test),
  `ridb.ts` (+test), `eligibility.ts` (+test), `data/package.json` (two
  new script entries), plus the two new backfill scripts. Nothing else
  touched.
- **Full test suite green:** `npm run -w data typecheck` clean; 28 test
  files, 531 passed, 3 pre-existing skips, 0 failed.
