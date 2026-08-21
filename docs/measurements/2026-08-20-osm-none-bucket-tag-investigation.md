# OSM NONE-bucket tag investigation — 2026-08-20

Read-only investigation against TEST (`znldzjdatkogdktymtvi`). No writes, no
DB mutations, no code changes, no `eligibility.ts` changes applied. Mirrors
the USFS/BLM/RIDB missed-field pattern (see
`docs/measurements/2026-08-20-none-bucket-characterization.md` §5 and
`docs/measurements/2026-08-20-blm-ridb-eligibility-fixes.md`), scoped to OSM
specifically. Script: `data/scripts/measure-osm-none-bucket-tags-2026-08-20.ts`,
run `2026-08-20T23:18:25.697Z`.

## Denominator note — disclosing a discrepancy rather than silently using the new number

This run found **18,158** in-scope NONE-bucket master_places, against
**86,739** active source_record rows. Two other counts exist earlier in this
same session for the same measurement:

| When | Active source_record | In-scope NONE-bucket MPs |
|---|--:|--:|
| Characterization pass (`2026-08-20-none-bucket-characterization.md`) | — | 17,187 |
| BLM/RIDB fix verification, `2026-08-20T22:59:43Z` | 86,739 | 17,838 |
| This run, `2026-08-20T23:18:25.697Z` | 86,739 | 18,158 |

The active source_record count is **identical** between the last two runs
(86,739), so the NONE-count difference is not explained by new source data.
A direct follow-up check at `2026-08-20T23:22:07Z` found
`master_place_search_export` (the in-scope/"is-searchable" view) had grown to
**40,358** rows, up from the 39,980 the fix-verification pass used 22 minutes
earlier. That is real, independent growth in which master_places count as
in-scope, not a bug in this script — TEST is a live, shared environment this
session (per CLAUDE.md's ingestion/materialize conventions), and something
grew the searchable set between the two runs while the active-source-record
population held flat. The two eligibility computations (verification script
vs. this script) use the same imported `computeSignals`/`isStrong`/`isWeak`
functions and the same geo/in-scope query shape, so this is corpus drift, not
disagreement between two implementations. Noted explicitly rather than
picking one number silently, per the standing lesson from this session's
self-audit about undisclosed cross-report discrepancies.

## Structural framing — why OSM is a harder target than USFS/RIDB/BLM

`foldSignalsInto()` sets `has_meaningful` true on either a
`MEANINGFUL_OSM_KEYS` hit or `raw_tag_count >= 5`. That means every OSM
source_record attached to a NONE-bucket master_place must independently carry
**zero** of the 10 `MEANINGFUL_OSM_KEYS` and **fewer than 5** total raw tags —
otherwise it would already be STRONG. This was verified directly, not
assumed: across all 14,105 OSM active source_records attached to NONE-bucket
MPs, max raw tag count observed was **4**, rows with `raw_tag_count >= 5`:
**0**, occurrences of a `MEANINGFUL_OSM_KEYS` key: **0**. The pipeline's own
ceiling holds with zero exceptions. Unlike USFS/RIDB (where a single rich
`directions` field sat unread inside an otherwise-thin record), any OSM
record with room for a hidden prose field has already been swept into
STRONG or WEAK — so a hidden-field win here would have to live inside a
1-4-tag row.

**Coverage:** 13,908 of 18,158 NONE-bucket MPs (76.59%) carry ≥1 active OSM
source; 14,105 total OSM source_records across them.

## Task 1 — What OSM's category mapping actually produces in this bucket

Category breakdown (deduplicated per MP) of NONE-bucket MPs carrying OSM:

| Category | MPs |
|---|--:|
| picnic_area | 4,002 |
| campground | 2,787 |
| trailhead | 1,968 |
| dispersed_camping | 1,796 |
| park | 1,468 |
| ev_charging | 867 |
| grocery | 248 |
| water | 182 |
| toilet | 170 |
| beach | 166 |
| rest_area | 150 |
| hut | 34 |
| hardware | 25 |
| shower | 20 |
| facility | 11 |

OSM produces essentially **zero oddity rows** in this bucket — `oddity` does
not appear at all in the top-15. `facility` is 11 rows, dominated by
non-OSM sources elsewhere in the corpus (RIDB). This directly answers the
task: OSM's category mapping for this corpus does not produce meaningful
oddity/facility volume — those categories come from other sources.

## Task 2/3 — Full tag-key frequency, and genuine prose vs. categorical

195 distinct raw tag keys across the 14,105 rows. The top keys are all
category-defining or structural: `tourism` (8,817), `name` (6,344),
`highway` (2,131), `backcountry` (1,822), `leisure` (1,663), `amenity`
(1,265), `ele` (1,208 — elevation number), `gnis:feature_id` (1,118),
`access` (554), `fee` (411), `capacity` (338, numeric), `shop` (279),
`camp_site` (195, categorical), down through a long tail of 100+ keys at
frequency 1-3.

Every key **not** already read by an existing signal (`has_website`,
`has_phone`, `has_hours`, `has_wikipedia`, `has_wikidata`, or a
`MEANINGFUL_OSM_KEYS` member) and not itself a category-defining tag
(`tourism`/`leisure`/`amenity`/`natural`/`shop`/`highway`) was read down to
its sample values, including every key at frequency as low as 1:

- `review` (18) — all values `"no"` (boolean-shaped).
- `information` (12) — all `"board"` (categorical).
- `comment` (1) — `"Distributed Sites"` (short label, not prose).
- `wpt_description` (2) — `"This is waypoint no: 6"` / `"9"` — GPS-import
  boilerplate, not descriptive content.
- `loc_name` / `short_name` / `old_name` / `official_name` (2-3 each) — short
  alternate-name strings, same shape as `name`, not new information.
- `attribution` (3) — data-source citation strings.
- `image` (1) — a Street View thumbnail URL, not text.
- Remaining candidates: boolean flags (`covered`, `fireplace`, `openfire`,
  `wheelchair`, `drinking_water`, `group_only`), numeric (`ele`, `capacity`,
  `tents`), or IDs/refs (`ref`, `source_ref`, `brand:wikidata`,
  `gnis:feature_id`, `created_by`, `check_date`, `survey:date`).

**No key contained genuine free-text/prose content.** Every candidate was
either boolean, categorical, numeric, an ID/ref, or at best a short alternate
name — never a sentence or paragraph the way USFS/RIDB's `directions` field
was.

## Task 4 — Wikipedia/wikidata as a raw tag directly on NONE-bucket nodes

Checked directly, not assumed: `wikipedia` tag occurrences on NONE-bucket OSM
nodes: **0**. `wikidata`: **0**. This is the expected result given
`computeSignals()` already reads both into `has_wikipedia`/`has_wikidata` —
any row carrying either tag would already be STRONG, not NONE — and it's now
confirmed empirically rather than inferred from that logic alone.

**Extra check beyond the literal task list:** namespaced `contact:*` and bare
`email` tags, on the hypothesis that OSM might use `contact:website` instead
of the plain `website`/`url` keys `has_website` already reads (mirroring the
BLM `WEB_LINK`-vs-`contact.website` miss found earlier this session).
`contact:website`: 0. `contact:phone`: 0. `contact:email`: 0. `contact:url`:
0. Bare `email`: 1. All negative — no missed contact-info key.

## Task 5/6 — No promising candidate found

No corpus-wide flip count was run, because task 5 is conditional on finding
"a genuinely promising candidate field or pattern," and none was found. Per
task 6's explicit instruction, reporting that plainly rather than
manufacturing a marginal finding: the exhaustive frequency and sample-value
review (every non-category-defining key checked, including every key down to
frequency 1) turned up nothing resembling the USFS/RIDB `directions` gap —
no key anywhere in the 195-key vocabulary carries free-text/prose content
that isn't already read by an existing signal.

Stratified sample dumps across all seven target categories (trailhead, park,
facility, picnic_area, ev_charging, campground, dispersed_camping) confirm
the same pattern at the row level: 1-4 sparse categorical/numeric tags per
row, e.g. `{"tourism":"picnic_site"}`,
`{"amenity":"charging_station"}`,
`{"ele":"426","name":"Upper Rogue Regional County Park","leisure":"park","gnis:feature_id":"1987696"}`.
No exceptions found in the sampled rows.

## Verdict

**Genuine sparsity, not a cheap win.** Unlike BLM (a deliberately-suppressed
field) and RIDB (a schema gap — the field existed in `raw_payload` but was
never parsed into `normalized_payload`), OSM's NONE-bucket rows are thin
because the *source data itself* is thin: 1-4 tags, almost always limited to
what's needed to place and categorize the node, with no unread descriptive
field hiding in the payload. The eligibility pipeline's own structural
ceiling (verified with zero exceptions across 14,105 rows) guarantees this —
any OSM row with enough tag richness to plausibly hide a missed field has
already been classified STRONG or WEAK. Any further improvement to this
bucket would require better upstream OSM tagging on these specific nodes
(out of scope here), not a code fix to read a field that's already present.
