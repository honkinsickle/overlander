# NONE-bucket reduction — implementation pass (Part 1 + Part 2)

TEST only (`znldzjdatkogdktymtvi`). No PROD. Builds on the corrected 14,043
baseline from `docs/measurements/2026-08-21-none-bucket-reduction-strategy.md`.
Investigate → count → apply → verify at each step.

## Part 1 — placeholder / junk-code deactivation, corpus-wide

### Re-confirmed counts (no drift since the strategy report)

| | strategy report | re-confirmed here |
|---|--:|--:|
| placeholder-named NONE-bucket (all categories) | 3,516 | **3,516** |
| junk-code-like NONE-bucket | 235 | **235** |
| real-named NONE-bucket | 10,292 | **10,292** |

Exact match, zero drift — no writes had occurred against this population
between the two measurements.

### Deactivation applied

New script `data/scripts/deactivate-placeholder-none-corpuswide.ts`
(generalizes today's picnic_area/ev_charging deactivations to all
categories, exact same three-step mechanism: `source_record.is_active =
false` → `recompute_master_place()` → dangling-`place_match` cleanup).
Dry-run matched the re-confirmed count exactly, then applied:

```
deactivated 3581 source_records
recompute done. ok=3516 failed=0
cleared 0 dangling pending place_match rows
```

3,581 source_records deactivated (a placeholder-named MP can carry more
than one active source), all 3,516 target master_places recomputed with 0
failures. **Junk-code slice (235 rows) deliberately NOT deactivated** —
per the task's explicit instruction, given the strategy report's confirmed
false positives (`"7-Eleven"`, `"Good2Go"` — real brand names that happen
to contain digits with no spaces).

### Junk-code review list

`docs/measurements/2026-08-21-junkcode-review-list.csv` — 235 rows
(id, name, category, state, lng, lat), re-derived post-Part-1-deactivation
to confirm none of them were accidentally touched. By category: campground
165, dispersed_camping 44, picnic_area 11, grocery 9, trailhead 2, toilet
2, ev_charging 2. **Not acted on** — delivered for manual review only, no
deactivation attempted on any of these 235 rows.

### Verification

| | value |
|---|--:|
| Deactivated rows still `source_count > 0` | 0 (all 3,516 at `source_count = 0`) |
| Deactivated rows still `is_searchable = false` (should be untouched, not deleted) | 0 flipped — `is_searchable` stayed as before |
| Deactivated rows still in `master_place_search_export` | 0 |
| Spot-check (5 rows, live `pois_along_corridor` RPC) | 0/5 surfaced |

**Before/after NONE-bucket count, corpus-wide, freshly recomputed:**

| | before Part 1 | after Part 1 |
|---|--:|--:|
| In-scope (`master_place_search_export`) | 36,250 | 32,734 |
| STRONG | 22,107 | 22,107 (unchanged) |
| WEAK | 100 | 100 (unchanged) |
| **NONE** | **14,043** | **10,527** |

36,250 − 3,516 = 32,734 and 14,043 − 3,516 = 10,527, both exact — the
deactivation removed exactly the target rows and nothing else, confirmed
by the unchanged STRONG/WEAK counts.

## Part 2 — minimal grounded template descriptions

### Re-measured target population (post-Part-1)

**10,292 real-named NONE-bucket rows** — unchanged from the strategy
report's figure and from Part 1's pre-write count, confirming Part 1 only
removed placeholder rows and left the real-named population untouched.
Full category breakdown (top ones): trailhead 2,330 · campground 2,095 ·
park 1,331 · oddity 1,128 · dispersed_camping 964 · picnic_area 642 ·
public_land 373 · recreation_area 373 · facility 290, plus a long tail of
46 distinct `primary_category` values total (including a number of
single-digit-count Google-sourced categories like `hamburger_restaurant`).

### Category display wording — checked, not invented

Searched `web/src` for an existing `primary_category` → natural-language
display convention before writing any new phrasing. **None exists.** The
only related mappings found are `AMENITY_LABELS` in
`web/src/lib/trip-browse/card-stats.ts` (a different thing — labels for the
boolean `amenities` map, e.g. `picnic: "Picnic Area"`) and a coarse
search-type grouping in `web/src/app/api/search-area/route.ts` (e.g.
`campground: "camping"`). Neither maps `primary_category` to display text.
`CATEGORY_LABELS` in the new script was built fresh, following the task's
one worked example (`dispersed_camping` → "dispersed camping site"), with
a generic snake_case-to-spaced-lowercase fallback for the long tail.

### Template logic + guard

New script `data/scripts/generate-none-bucket-templates-2026-08-21.ts`.
Two shapes:
- **Named-parent:** `"{name} is a/an {category} in {parent_name}, {state}."`
  — only when `place_relationships(relationship_type='contained_in')`
  resolves a parent with a real (non-placeholder) name, **and** the guard
  below doesn't reject it.
- **Bare fallback:** `"{name} is a/an {category} in {state}."` — for rows
  with no usable parent, with the state clause omitted when state itself
  is unresolvable (see below).

**Near-duplicate parent-name guard** — reuses
`data/entity-resolution/matcher.ts`'s `normalizeName` + Jaro-Winkler (the
`natural` package), the codebase's existing "are these the same place?"
mechanism, at the **same 0.85 threshold matcher.ts uses for auto-link**
(reused, not invented). Measured impact: **524 of the 7,163 rows with a
real-named parent (7.3%) were guard-rejected** and fell back to the bare
template — confirmed examples include the strategy report's own flagged
case (`"Fremont Indian State Park and Museum"` vs parent `"Fremont
Indian"`, similarity 0.878) plus several more of the same shape
(`"Capitol Reef National Park"` self-matching its own parent at 1.000,
`"Turlock Lake Campground"` vs `"Turlock Lake SRA"` at 0.950).

**Two additional defects caught by the mandated 30-row eyeball check, both
fixed before the full-scale run — exactly what that check is for:**

1. **Grammar: `"is a oddity"` / `"is a EV charging station"`.** Added an
   `article()` helper (vowel-letter check on the category label) —
   sufficient for this fixed label vocabulary, no exceptions like
   "university" appear in it.
2. **A real accuracy bug, not cosmetic: `"Fort Miller is a campground in
   Millerton Lake SRA, Nevada."`** — Millerton Lake is in California. The
   state-derivation helper reused the same lat/lng bounding boxes as
   `six_state_footprint()` (`supabase/migrations/20260810130000_six_state_footprint.sql`),
   whose own header explicitly documents that interior state-to-state edges
   (CA/NV, NV/UT, WA/OR) are **"deliberately loose... both sides are in
   scope, so overlap there costs nothing"** — true for six-state scope
   membership, false for asserting one specific state as fact. No true
   state-boundary dataset exists anywhere in this repo (same migration:
   "No TIGER or state-boundary dataset exists in this repo"), so there is
   no more-precise ground truth to fall back to. **Fix: check all six
   boxes; a point matching exactly one is confident and gets the state
   clause; a point matching zero or two-plus is ambiguous and the state
   clause is omitted rather than asserting a possibly-wrong one.** Measured
   impact: **1,212 of 10,292 rows (11.8%) fall in an ambiguous zone** and
   get a state-free template (e.g. `"Fort Miller is a campground in
   Millerton Lake SRA."` — no longer claims a state at all).

A third, minor formatting issue (a stray double space in one corpus
`canonical_name`, `"Salt Lake  Field Office"`) was also caught and fixed
with a whitespace-collapse on interpolated names — a presentation fix, not
a factual one.

### Schema applied

Migration `supabase/migrations/20260821000000_master_place_generated_content.sql`,
applied to TEST via `db:push-verify --test`. Reuses the table design
proposed in `docs/measurements/2026-08-20-llm-description-generation-pilot.md`
§6, with three deliberate, minimal changes made before first use (documented
in the migration header) rather than as a later alteration:

- **`generation_method text not null check (in ('template','llm'))`
  replaces the original `llm_generated boolean`** — a boolean that's always
  `true` by construction for the LLM case becomes actively wrong once
  template rows exist, and keeping both a boolean and a method string
  invites the two disagreeing.
- **`model_version` is now nullable** — meaningless for
  `generation_method = 'template'`.
- **`prompt_version`** is repurposed to mean "prompt version" for LLM rows
  or "template version" for template rows — one versioning column, not two
  near-duplicate ones.

Verified live on TEST: table exists, queryable, RLS enabled with zero
policies (service-role only, same posture as `source_record`/
`master_place`/`place_match`).

### 30-row sample — eyeball check (corrected version, after both fixes)

Ran preview mode (no writes) after both fixes landed. Sample output
(15 named-parent + 15 bare, full text shown, spot-checked line by line):

```
[named-parent] Wreckage of the S.S. Garden City is an oddity in Carquinez Strait Regional Shoreline, California.
[named-parent] Devils Kitchen Campsite 2 is a dispersed camping site in Canyonlands National Park, Utah.
[named-parent] DEVILS BRIDGE is a trailhead in Coconino National Forest, Arizona.
[named-parent] Fort Miller is a campground in Millerton Lake SRA.                    <- state correctly omitted now
[named-parent] MCLEOD FLATS is a trailhead in Sierra National Forest.                 <- state correctly omitted now
[bare-no-parent] Ochoco State Scenic Viewpoint is a public land area in Oregon.
[bare-guard-triggered] Fremont Indian State Park and Museum is a state park in Utah.  <- guard correctly fell back
[bare-no-parent] 'The Babies' is an oddity in California.
[bare-guard-triggered] Capitol Reef National Park is a national park in Utah.         <- guard correctly fell back
[bare-guard-triggered] Benbow Lake Campground is a campground in California.         <- guard correctly fell back
```

No wrong facts, no grammar issues, no formatting issues remained. Sample
judged correct — proceeded to full-scale generation.

### Full-scale generation — exact counts

| method | count | % of 10,292 |
|---|--:|--:|
| named-parent | 6,639 | 64.51% |
| bare (no usable parent at all) | 3,129 | 30.40% |
| bare (guard-triggered — parent too similar to child name) | 524 | 5.09% |
| **total** | **10,292** | 100% |

Rows with an ambiguous (ungroundable) state, state clause omitted: 1,212
of 10,292 (11.78%) — a subset spread across all three method categories
above, not a fourth bucket.

Write: `written: 10292 / 10292, errors: 0` — all rows landed, 0 batch
failures.

### Verification

| check | result |
|---|---|
| Duplicate `(master_place_id, field_name)` pairs | 0 |
| Rows with `generation_method != 'template'` | 0 |
| Rows with non-null `model_version` | 0 (correctly null for all template rows) |
| Distinct `master_place_id` referenced | 10,292 — every one resolves to a real `master_place` row |
| `grounded_on_source_record_ids` spot-check (5 rows) | all reference source_records that actually belong to that master_place |
| `master_place.description` writes | **0 — the script never writes to `master_place` at all**, only to the new table |

One thing that needed a second look, not a defect: 1,863 of the 10,292
referenced `master_place` rows have a **non-null but short**
`master_place.description` (max 39 characters, 0 rows at ≥40). This is
expected, not a bug — `master_place.description` can hold junk/name-echo
text (`"LAWSON SOUTH (Trailhead)"`, `"CABIN SADDLE CG (Campground)"`) that
never crosses the 40-char `has_real_description` threshold, exactly the
junk pattern already documented in `eligibility.ts`'s own
`DESCRIPTION_MIN_LENGTH` comment. My own verification script's initial
"expected 0" comment conflated "description is null" with
"has_real_description is false" — confirmed via a length check that all
1,863 are under the threshold, so this is correct NONE-bucket composition,
not a bucketing error.

## Corrected overall NONE-bucket size after both parts

| stage | NONE-bucket count |
|---|--:|
| Before this pass (corrected baseline) | 14,043 |
| After Part 1 (placeholder deactivation) | **10,527** |
| After Part 2 (template generation) | **10,527 — unchanged** |

**This is not an oversight — it's the explicit scope of this pass.**
Deactivation removes rows from scope entirely (they leave
`master_place_search_export`), so it directly reduces the NONE count.
Template generation writes to a separate table
(`master_place_generated_content`) and does **not** touch
`source_record`/`master_place` or `eligibility.ts` at all — so by
construction it cannot change what `computeSignals`/`bucketOf` report. A
templated row is still bucketed NONE today.

**Open follow-up decision, flagged and not assumed or acted on:** whether
`eligibility.ts` should ever be updated to treat a row with a
`master_place_generated_content` entry as sufficient (e.g., a new
`has_generated_content` signal folded into `isStrong()`) is a real product
question — does a deterministic, zero-fabrication template genuinely
satisfy whatever "has a description" is meant to guarantee, the same way
a real source description does? This pass does not answer that question
and `eligibility.ts` was not touched. If answered yes, the corrected NONE
count would drop by up to 10,292 (all of Part 2's population) minus
whatever fraction of the bare-fallback rows are judged too thin to count —
not computed here, since it depends on a decision not yet made.

## Confirmed scope

- **TEST only.** Both new scripts assert the project ref before any write.
  No `--confirm`/PROD path exists in either.
- **No code changes beyond what's scoped:** two new scripts
  (`deactivate-placeholder-none-corpuswide.ts`,
  `generate-none-bucket-templates-2026-08-21.ts`), one new migration
  (`20260821000000_master_place_generated_content.sql`), one CSV review
  artifact. `eligibility.ts` was **not** touched, per the task's explicit
  instruction.
- **Junk-code slice (235 rows) was not deactivated** — delivered as a
  review list only, exactly as scoped.
