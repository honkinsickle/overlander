# NONE-bucket reduction — corrected baseline + three strategic variants

Research and strategy pass, 2026-08-21. Read-only except Part 1's scoping-bug
fix, which was done in a new script copy — no edits to any original script,
no DB writes anywhere in this pass. No PROD.

## Part 1 — the scoping bug, fixed and re-verified

`measure-corpus-gap-scan-2026-08-20.ts`'s "BY SOURCE_ID" section built each
source's MP set from *all* active `source_record` rows corpus-wide, never
restricted to `master_place_search_export` membership the way the
corpus-wide STRONG/WEAK/NONE totals correctly are (diagnosed in
`docs/measurements/2026-08-20-padus-scope-reconciliation.md`). New script,
not editing the original: `data/scripts/measure-corpus-gap-scan-2026-08-21-scoped-fix.ts`.
Intersects every per-source and per-category MP set against the real
in-scope id set. Run `2026-08-21T01:25:57Z`.

**Corrected corpus-wide totals:**

| bucket | n | % |
|---|--:|--:|
| STRONG | 22,107 | 60.98% |
| WEAK | 100 | 0.28% |
| **NONE** | **14,043** | **38.74%** |

In-scope population: 36,250 (`master_place_search_export`).

**Corrected by-source-id NONE counts** (properly restricted; sources are not
mutually exclusive, so this does not sum to 14,043):

| source | n_mps (in-scope) | none% | none(n) |
|---|--:|--:|--:|
| padus | 0 | — | **0** (confirmed correct — was 35,967/99.92% in the buggy run) |
| osm | 19,259 | 50.54% | 9,733 |
| state_parks | 1,432 | 88.90% | 1,273 |
| google_resolved | 81 | 93.83% | 76 |
| usfs | 5,183 | 28.71% | 1,488 |
| atlas_oddities | 2,829 | 40.54% | 1,147 |
| blm | 672 | 22.77% | 153 |
| ridb | 5,492 | 7.56% | 415 |
| nps | 4,251 | 0.00% | 0 |
| google | 5 | 0.00% | 0 |

**By `primary_category`, corpus-wide, in-scope only** — a clean partition
this time (verified: sums to exactly 14,043). Top NONE contributors:
campground 3,336 · trailhead 2,824 · dispersed_camping 2,223 · park 1,469 ·
oddity 1,128 · state_parks-heavy `public_land` 373 + `recreation_area` 373 ·
picnic_area 653 · facility 290 · grocery 248 · water 182 · toilet 170 ·
beach 166 · rest_area 150 · ev_charging 119 (all these are post-today's-
deactivation figures — picnic_area/ev_charging are the real-named remainder,
not the pre-deactivation totals).

**Every number in Parts 2-4 below uses this corrected 14,043 baseline**, not
any earlier same-session figure.

## Part 2 — what's already been tried (summary; full detail in the cited docs)

- **Google content warehousing: ruled out on compliance grounds**, live-fetch-
  at-render parked (`docs/decisions/2026-08-20-corpus-enrichment-and-cleanup-decisions.md`
  §1). Not re-litigated here.
- **LLM description enrichment: scoped to STRONG/WEAK-no-description
  (7,154 rows, atlas_oddities excluded), not the NONE bucket at all** — by
  construction, NONE-bucket rows have nothing to ground a real LLM
  description on. Prompt fix cut fabrication 41%→4% on a 27-row sample,
  flagged as small-sample, not certified at scale (§3 below).
- **BLM WEB_LINK + RIDB FacilityDirections: fixed and merged** — 273 rows
  recovered from NONE (already reflected in the 14,043 baseline above).
- **OSM: investigated and found genuinely sparse** — structural ceiling
  (max 4 raw tags, zero `MEANINGFUL_OSM_KEYS` hits on any NONE-bucket OSM
  row) re-verified in this pass against the corrected population and still
  holds exactly (§3c below). No further OSM sourcing fix exists in currently-
  ingested data.
- **Placeholder deactivation: applied to picnic_area + ev_charging** —
  4,175 rows removed from scope entirely (not just NONE — removed from
  search). Their real-named remainders (1,187 / 2,703 total; 653 / 119 of
  which are still NONE-bucket, per the corrected category table above) were
  deliberately left active.
- **Still unexplored coming into this pass** (per the task's framing,
  confirmed against `docs/BACKLOG.md`): the campground/dispersed_camping
  mixed-name pattern, the RecAreaDirections gap, precise sizing of the
  picnic_area real-named remainder. All three are addressed below.

## Part 3 — investigated angles

### 3a. Aggressive placeholder / junk-code deactivation

Extended today's `isPlaceholderName` classifier with a second pattern —
**junk-code-like names**: no spaces, contains a digit, alphanumeric/dot/dash
only, ≤15 chars (matches the flagged examples: `"42"`, `"1103-001"`,
`"D10.62L"`, `"EC1"`, `"SR517FRD-002"`). Applied to the full corrected
14,043-row NONE bucket, not just the two target categories, to check the
task's "any other category with a similar signature" instruction.

**Target categories:**

| category | total | placeholder | junk-code | real | placeholder+junk |
|---|--:|--:|--:|--:|--:|
| campground | 3,336 | 1,076 (32.25%) | 165 (4.95%) | 2,095 | **1,241 (37.20%)** |
| dispersed_camping | 2,223 | 1,215 (54.66%) | 44 (1.98%) | 964 | **1,259 (56.64%)** |

**Unrequested but surfaced by the corpus-wide sweep — several categories
are near-total placeholder, more extreme than either target category:**

| category | total | placeholder | placeholder% |
|---|--:|--:|--:|
| water | 182 | 182 | **100.00%** |
| shower | 20 | 20 | **100.00%** |
| toilet | 170 | 164 | 96.47% |
| rest_area | 150 | 133 | 88.67% |

**Corpus-wide total, all categories: 3,751 placeholder+junk-code (26.71% of
14,043); 3,516 placeholder-only (25.04%)** — matching today's exact
picnic_area/ev_charging criterion, extended corpus-wide.

**Heuristic validated by eyeball, with one real limitation flagged, not
hidden:** the junk-code sample (`"EC1"`, `"53"`, `"302-005"`,
`"SR517FRD-002"`) is genuinely code-shaped. But two false positives
appeared in the same sample — `"Good2Go"` and `"7-Eleven"` (real grocery
brand names containing digits, no spaces). **The junk-code heuristic is not
safe to apply blind at scale** — any real deactivation pass would need
either a tighter pattern or a manual review pass over the junk-code slice
specifically (small: 165 + 44 = 209 rows in the two target categories, or
~235 corpus-wide), not the placeholder slice (which reuses today's
already-proven `isPlaceholderName` exactly).

**Note the overlap with 3d:** water/shower/toilet/rest_area's placeholder
rows are *also* counted in the category-conditional variant below (3d) —
these are not additive populations if both variants were applied together.

### 3b. Minimal grounded template descriptions

Distinct from the already-scoped LLM enrichment (which requires STRONG/WEAK
signals to ground on and explicitly excludes NONE-bucket rows by
construction). This variant targets the NONE bucket's **real-named** rows
directly with a much more constrained generation: template text built only
from fields that unconditionally exist (name, category, state) plus,
optionally, a resolved containing land unit via `place_relationships`.

**Population: 10,292** real-named (non-placeholder, non-junk-code)
NONE-bucket rows — the exact complement of 3a's 3,751 (10,292 + 3,751 =
14,043, confirmed a clean partition of the whole bucket).

**Two distinct ceilings, not one number:**

- **Bare template** ("X is a [category] in [state]") — name, category, and
  state are unconditionally available for every in-scope row. **Ceiling:
  10,292 (100% of the real-named population).** Flagging honestly, per the
  task's instruction not to inflate: a one-clause generic sentence like this
  is of real but limited value — it's barely more informative than the
  category badge already shown, and it's fair to ask whether it satisfies
  any actual "has a description" product requirement or just checks a box.
- **Named-parent template** ("X is a [category] in [named parent unit],
  [state]") — resolved via `place_relationships(relationship_type=
  'contained_in')`. **7,168 of 10,292 (69.65%) have a contained_in parent at
  all; 7,163 (69.60%) have a parent that itself carries a real (non-
  placeholder) name.** Ceiling: **7,163.** This is meaningfully more
  useful content (real examples: *"Devils Kitchen Campsite 2" (dispersed_
  camping) contained_in "Canyonlands National Park"*; *"DEVILS BRIDGE"
  (trailhead) contained_in "Coconino National Forest"*) — genuinely
  identifies where the place actually is, not just its category.

**Real limitation surfaced, not smoothed over:** not every `contained_in`
relationship is a meaningfully distinct "broader area." Sample case: *"Fremont
Indian State Park and Museum" contained_in "Fremont Indian"* — the parent's
name is essentially the same place under an abbreviated label, not a
genuinely broader containing unit. This wasn't quantified (would need a
name-similarity check between child and parent to filter out), so 7,163 is
an upper bound on the *mechanism's* reach, not a certified count of
*meaningfully improved* rows — the true useful-template count is somewhat
below 7,163, by an unmeasured amount.

**Cost:** this is materially cheaper than LLM generation — no model call
needed for the bare version at all (pure string templating from existing
columns); the named-parent version needs one join, already computed by
`recompute_master_place`. Zero fabrication risk for either version, since
every word comes from a field that's either always true (category, state)
or a real corpus relationship (parent name) — this is the one variant here
with essentially zero content-accuracy risk.

### 3c. Remaining sourcing fixes, corrected scoping

Repeated the USFS-directions/BLM-WEB_LINK/RIDB-directions missed-field
pattern across every source now that the scoping bug is fixed.

- **padus: 0 NONE-bucket rows** — nothing to check (confirmed correct in
  Part 1).
- **A new, real finding: `state_parks` has the exact same shape as the BLM
  bug.** `normalized_payload.web_link` carries a real URL (e.g.
  `https://parks.wa.gov/find-parks/state-parks/deception-pass-state-park`)
  on 177 of 1,448 in-scope state_parks source_records, but **0** of them are
  mapped into `contact.website` — so `has_website` never sees them, the
  same missed-signal shape as BLM's original bug. **Measured flip impact:
  71 of the 177 (the rest are already STRONG via another signal) would move
  from NONE to STRONG if fixed** — smaller than BLM's 265 but a real,
  cheap, same-shape fix, not yet applied anywhere.
- **`state_parks.description` is NOT a missed field — checked and it's
  already correctly read.** 92 of 1,448 in-scope state_parks rows carry a
  non-empty description; every one is well above the 40-char threshold
  (min 99 chars, genuinely good prose — e.g. *"Alta Lake State Park is a
  174-acre camping park where the mountainous pine forests meet the
  desert."*) and all already flip their row to STRONG via
  `has_real_description`. The earlier raw scan's "description key present
  on 747 of 1,287 NONE rows" was a false lead — that count included rows
  where the key exists but holds `null`/empty, not real content.
- **`google_resolved`: nothing to fix.** `normalized_payload` is
  structurally minimal by design (coords, provenance, canonical_name,
  primary_category only) — no hidden field.
- **RecAreaDirections (RIDB `recarea`), re-verified fresh against the
  corrected population:** 1,163 in-scope RIDB recarea rows, 1,055 carry
  real `RecAreaDirections` text, but only **1** is currently NONE-bucket
  (recareas are almost always already STRONG via another signal) —
  confirms the earlier self-audit figure exactly, no drift.
- **OSM structural ceiling, re-verified against the corrected 14,043
  population:** 9,930 OSM active source_records now attached to a
  NONE-bucket MP (down from the pre-correction 14,105, reflecting both the
  scoping fix and today's deactivations). Max raw tag count still 4, rows
  with ≥5 tags still 0, `MEANINGFUL_OSM_KEYS` leaks still 0 — **the
  "genuinely sparse, not a cheap win" verdict is unchanged** under the
  corrected count. No new OSM-side opportunity.

**Total corrected remaining-sourcing-fix opportunity: 71 (state_parks) + 1
(RecAreaDirections) = 72 rows.** Real and cheap (same mechanism as today's
already-shipped BLM/RIDB fix), but small relative to the 14,043 bucket —
reported honestly as a minor, not a major, lever.

### 3d. Category-conditional requirement (product-level, Adam's call)

Quantifying, not recommending. Categories that read as utility infrastructure
rather than destinations, where a description may not be a meaningful
product requirement at all:

| category grouping | categories | NONE(n) | % of 14,043 |
|---|---|--:|--:|
| **Core** (least ambiguous "utility, not destination") | rest_area, water, toilet, shower | **522** | **3.72%** |
| **Extended** (+ arguably-utility) | + activity_pass, hardware, dump_station, hut | **659** | **4.69%** |

This is explicitly Adam's call, not a recommendation — whether an anonymous
roadside water tap or vault toilet needs a description at all is a product
definition question, not something this investigation is resolving.
**As noted in 3a, this population heavily overlaps with the placeholder
slice** — 88–100% of the core-utility rows are also placeholder-named, so
this variant and 3a's placeholder deactivation are two different *framings*
of much of the same rows (one removes them from the corpus, this one just
stops counting them as "needing a description"), not two independent chunks
of the 14,043.

## Part 4 — three variants, compared

| | **Variant 1: Placeholder/junk-code deactivation** | **Variant 2: Minimal grounded templates** | **Variant 3: Category-conditional redefinition** |
|---|---|---|---|
| **What it does** | Remove placeholder- and junk-code-named NONE-bucket rows from scope (same mechanism as today's picnic_area/ev_charging), any category | Generate a short, zero-fabrication-risk template description for real-named NONE rows, from fields that already exist | Redefine which categories require a description at all — treat utility-POI NONE rows as not-a-problem rather than fixing them |
| **Targeted slice (measured, not guessed)** | 3,751 (placeholder+junk-code, all categories) / 3,516 (placeholder-only, matches today's exact criterion) | 10,292 real-named rows total; 7,163 with a real named containing unit (richer, more defensible version) | 522 (core: rest_area/water/toilet/shower) to 659 (extended) |
| **% of corrected 14,043** | 25–27% | 51–73% | 3.7–4.7% |
| **Google dependency** | None | None | None |
| **Engineering cost** | Low — reuses today's exact mechanism; the junk-code sub-pattern needs a manual-review step first (~235 rows, false-positive risk shown) | Low-medium — no model call for the bare version; a join for the named-parent version; needs a decision on template wording and a read-path fallback shape (same open question as the LLM-generated-content proposal) | Near-zero engineering — a product decision plus possibly a display-layer change (stop treating these categories as needing the field) |
| **Risk** | Low — same reversible mechanism already proven twice today | Very low fabrication risk (every word traceable to a real field or relationship) but real risk the *bare* version is too thin to be worth shipping; the named-parent version has an unmeasured "same-place parent" false-positive rate | None to data integrity; the only risk is a product-scope disagreement, not a technical one |
| **Ceiling, honestly stated** | Real, moderate. Doesn't reduce "how much content exists" — it reduces "how big the reported problem is" by removing rows that were never fixable | Largest measured slice, but the bare-template ceiling (10,292) is inflated relative to genuine content value; the defensible ceiling is closer to 7,163, and even that has an unmeasured discount for near-duplicate parent names | Smallest slice by a wide margin; overlaps heavily with Variant 1's target population rather than being additive |

No recommendation between them — the numbers above are what they are.

## Plain read

**14,043 → some meaningfully smaller number is realistic, but not by
"solving" the bucket — by redrawing its boundary and doing one more cheap
sourcing fix.** The corrected data supports three genuinely different, all
non-Google paths, and they're not mutually exclusive:

- Variant 1 (placeholder/junk-code deactivation) and Variant 2's bare
  template are **exact complements** of the same 14,043 — together they
  cover literally all of it, because "real-named" and
  "placeholder-or-junk" is a clean partition by construction. That doesn't
  mean applying both eliminates the bucket cleanly — it means the bucket
  splits cleanly into "rows with nothing to say" (candidates for removal)
  and "rows with a name but no content" (candidates for a thin template),
  and every row in the bucket falls into exactly one side.
- The honest ceiling on *meaningfully* fixing content (not just relabeling
  or removing) is closer to **7,163** (Variant 2's named-parent template) +
  **72** (Variant 3c's remaining sourcing fixes) ≈ **7,235** — about half
  the corrected bucket — and even that carries an unmeasured discount for
  low-quality parent-name matches.
- A real chunk is **structurally unfixable without new data or a product
  redefinition**: the OSM sparse verdict held again under the corrected
  count (9,930 rows, hard ceiling of 4 tags each, zero exceptions), and the
  utility-POI categories (522–659 rows) aren't a sourcing gap at all — they're
  a question of whether the product should want a description for a vault
  toilet in the first place.

**14,043 is not a fixed target.** The single biggest lever isn't a bigger
sourcing fix — the remaining sourcing opportunity is only 72 rows, an order
of magnitude smaller than today's BLM/RIDB fix (273). The real leverage is
in Variants 1 and 2, both of which change what counts as "the bucket," not
what's true about the corpus.
