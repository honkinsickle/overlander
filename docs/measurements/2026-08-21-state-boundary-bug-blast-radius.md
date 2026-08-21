# State-assignment bug — blast radius, quantified against a real boundary

Read-only investigation, 2026-08-21. TEST only (`znldzjdatkogdktymtvi`). No
writes, no fixes applied. Follows the manual spot-checks that found "The
Astoria Column" (real landmark in Astoria, OR) labeled WA, and "Fort Miller"
(near Millerton Lake, CA) labeled NV.

## 1. Mechanism — confirmed, not assumed

**No persisted state field exists anywhere in the schema.** Grepped every
migration for a `state` column on `master_place` or
`master_place_search_export` — none exists (the only `state text` column
anywhere in the schema is `trips.state` with `default 'draft'`, an unrelated
workflow-status field). State is inferred **transiently, ad-hoc, per-script**
by a `classifyState()` function copied into most of this session's
measurement/generation scripts. Its six boxes are copied from
`six_state_footprint()`'s per-state rectangles
(`supabase/migrations/20260810130000_six_state_footprint.sql`) — that
migration's own header explicitly documents interior state-to-state edges
(CA/NV, NV/UT, WA/OR, etc.) as **"deliberately loose... both sides are in
scope, so overlap there costs nothing"** — a fine tradeoff for its actual
purpose (is-this-point-in-the-six-state-region-at-all), not for asserting
one specific state as fact.

**Two variants existed in tonight's scripts, with different failure
behavior:**
- The **simple first-match version** (used throughout the earlier gap-scan,
  characterization, OSM-investigation scripts, and the ad-hoc "pull 4 rows"
  script that produced the Astoria Column error) checks boxes in a fixed
  order and returns the first match — silently wrong in overlap zones.
- The **ambiguity-aware version** built for tonight's Part 2 template
  generation (after catching the Fort Miller case) checks all six boxes and
  omits the state clause when more than one matches. That version's output,
  already written to `master_place_generated_content`, does **not** carry
  this bug for the rows it covers.

**The Astoria Column error itself was produced by the simple version**, in
an ad-hoc one-off script for a "pull 4 rows" request — not by anything
written to the database. No persisted corpus content is known to carry this
specific error; the risk is in any **future** ad-hoc use of the simple
classifier, and in every **historical** aggregate stat this session reported
using it (by-state percentages/counts in the gap-scan and characterization
docs are all subject to this same imprecision, not just the description
text).

## 2. Per-border-pair population — real boundary, not corpus proxy

No true boundary geometry exists in this repo, so a real reference was
pulled for this investigation only: a public US state-boundary GeoJSON
(github.com/PublicaMundi/MappingAPI — a common lightweight/simplified
public dataset, **not** full-precision TIGER/Line; adequate for scoping,
flagged as not production-grade) fetched to `.context/us-states-reference.geojson`
(gitignored, not committed). Used via `@turf/turf` (already a `data/`
dependency) for genuine point-in-polygon and point-to-boundary-line
distance — not another bounding-box approximation.

**Threshold: 10 miles (16.09 km)** — the upper end of the task's suggested
5-10mi range, chosen because legitimate near-border ambiguity (river
valleys, highway corridors where a POI's true assignment might reasonably
be argued either way) concentrates close to the line; going wider would
start counting places with no genuine ambiguity at all.

**32,734 in-scope corpus rows checked** (current post-deactivation count).
1,750 fell outside all 7 state polygons entirely (ocean edge, or land
outside the six-state-plus-Idaho set, e.g. Baja California) — not part of
this analysis. 0 rows matched more than one real polygon (confirms the
reference boundaries themselves don't overlap, unlike the corpus's boxes).

**Rows within 10mi of a real border, by pair:**

| pair | rows |
|---|--:|
| Oregon / Washington | 653 |
| California / Nevada | 347 |
| Arizona / Utah | 240 |
| California / Oregon | 217 |
| Idaho / Oregon | 211 |
| Arizona / California | 166 |
| Idaho / Washington | 131 |
| Arizona / Nevada | 114 |
| Nevada / Utah | 83 |
| Idaho / Utah | 30 |
| Nevada / Oregon | 13 |
| Idaho / Nevada | 9 |

**Total distinct rows within 10mi of any relevant border: 2,149 (6.57% of
the in-scope corpus).**

## 3. Measured error rate — bbox classifier vs. real boundary

Within that 2,149-row border zone: **1,651 (76.83%) agree** with the real
boundary; **498 (23.17%) are wrong.** Sample of the wrong ones, read
directly: mostly real, identifiable California places (Ubehebe Crater,
Bodie State Historic Park, Hope Valley) labeled Nevada, plus a smaller
Arizona/Nevada-border cluster.

## 4. The bigger finding — this is not confined to the border zone

**Corpus-wide (not restricted to the 10mi border zone): 2,779 of 32,734
rows (8.49%) disagree between the bbox classifier and the real boundary —
more rows than the entire 10mi-border-zone population itself (2,149).**
That gap is the real finding, and it changes the verdict.

**Broken down by (bbox-claimed, actually-is) pair, this is overwhelmingly
one specific defect, not general border noise:**

| bbox says | really is | count | % of all disagreements |
|---|---|--:|--:|
| Nevada | California | 2,191 | 78.84% |
| Oregon | Idaho | 165 | 5.94% |
| Oregon | Washington | 120 | 4.32% |
| Washington | Oregon | 109 | 3.92% |
| Arizona | Nevada | 102 | 3.67% |
| Arizona | California | 73 | 2.63% |
| Oregon | California | 13 | 0.47% |
| Utah | Arizona | 5 | 0.18% |
| Washington | Idaho | 1 | 0.04% |

**Measured how far these extend from a true border, not assumed:** for
every disagreement, distance from the point to its own real state's
boundary (i.e. how far "inland" it genuinely is). **Median: 79.48 km
(49.4 miles). 47.18% of all disagreements sit more than 50 miles from any
real state line.** The 10 farthest cases are all `Nevada`-labeled California
rows over 110 miles deep in the Central Valley/southern Sierra
(Porterville/Success Lake area, e.g. "North Park," "Success Lake
Recreation Area," "South Tule Campground" — all 112-113 miles from
California's own real boundary).

**Root cause of the scale, confirmed by the numbers, not guessed:** Nevada's
box (`lng -120.01 to -114.04`) reaches almost 6 degrees of longitude west of
Nevada's real western edge in its southern half, swallowing a large stripe
of California's Central Valley. This isn't a border-precision issue — it's
a badly-shaped box for one state, and it dominates (79%) the entire
disagreement population.

## 5. Verdict: not a small edge case

**Large enough to warrant a real fix, not a note-and-move-on.** 8.49% of
the in-scope corpus (2,779 rows) carries a wrong state assignment under the
method currently in use, concentrated overwhelmingly (79%) in one specific,
badly-shaped box (Nevada), extending up to ~113 miles past any genuine
border ambiguity. This is not "a few edge-case rows near a river" — it is a
systemic shape defect in one box that misclassifies real, well-known
California places as Nevada at a rate an order of magnitude larger than
genuine border-zone noise.

**Scope of what's affected today:** this session's aggregate by-state
statistics (gap-scan, characterization reports) used the simple classifier
and inherit this error at face value — their WA/OR/CA/NV/AZ/UT percentage
splits should be read with this in mind, though re-deriving each one is a
separate task, not done here. The persisted `master_place_generated_content`
template text (10,292 rows from tonight's Part 2) used the
**ambiguity-aware** version, which only omits state on disagreement rather
than asserting one — so those generated rows are not wrong, though an
unknown fraction of their state-omitted rows may in fact be resolvable now
with a real boundary (not measured here — out of this task's scope).

## 6. A real fix, scoped not implemented

**US Census Bureau TIGER/Line (or the lighter cartographic boundary
files, "cb_*_us_state_*") is the concrete, free, public source** —
public domain, no license restriction, the standard reference for exactly
this problem, and notably the same family of dataset `six_state_footprint()`'s
own header already names as absent ("No TIGER or state-boundary dataset
exists in this repo").

**What integrating it would take, at a scoping level:**
- Download the state boundary file (cartographic 1:500k resolution is
  more than sufficient for POI-level state attribution; full TIGER/Line
  is higher-precision than needed and much larger).
- Load it as a real PostGIS table (`us_states` or similar) — matches this
  repo's own stack invariant ("spatial queries always use PostGIS, never
  compute distance in app code if the values are in the DB"), unlike this
  investigation's own app-level turf approach, which was a deliberate
  read-only workaround for a one-off analysis, not the pattern to ship.
- Either (a) add a real `state` column to `master_place`, backfilled once
  via `ST_Within(mp.geometry, us_states.geom)`, and re-derived whenever
  `recompute_master_place()` runs (mirroring how `is_searchable` is
  derived today); or (b) a `resolve_state(geometry)` SQL function
  analogous to `six_state_footprint()`, callable at read time.
- A one-time backfill pass to correct the ~2,779 currently-wrong rows this
  investigation identified, plus (per §5) a decision on whether to
  re-derive the state clause for the 1,212 rows Part 2's generator left
  state-omitted, now that a real boundary could resolve some of them.

Not implemented in this pass, per the task's scope — investigation and
report only.
