# NONE-bucket deep characterization — 2026-08-20

Read-only investigation against TEST (`znldzjdatkogdktymtvi`). No writes, no
code changes, no ingest, no bulk API calls (one small, non-bulk, 20-request
live calibration against the free public Wikipedia API is the one exception,
per §6 — explicitly not "bulk"). Not an enrichment pass — characterizing
what's actually in the NONE bucket before anyone decides what to do with it.

Script: `data/scripts/measure-none-bucket-characterization-2026-08-20.ts`
(kept), plus two small follow-up scripts written, run, and deleted after
capturing their output (`_check-nested-fields-2026-08-20.ts`,
`_wikipedia-affinity-calibration-2026-08-20.ts`, `_pull-ev-charging-none-2026-08-20.ts`
— one-off, not durable artifacts). Run 2026-08-20T19:33:07.984Z: 158,742
`master_place` rows queried unfiltered, 86,735 active `source_record` rows
queried.

## 1. Precise count + partition check

**In-scope MPs (searchable + geometry + ≥1 active source_record): 38,950.**

| bucket | n | % |
|---|--:|--:|
| STRONG | 21,659 | 55.61% |
| WEAK | 104 | 0.27% |
| **NONE** | **17,187** | **44.13%** |

Sum check: 21,659 + 104 + 17,187 = 38,950 — matches in-scope N exactly, no
gap or double-count.

**STRONG breaks down cleanly into the pieces from prior sessions:**
already-described 12,981 + no-description 8,678, and the no-description
group splits into atlas_oddities 1,628 + non-atlas 7,050. **7,050
non-atlas STRONG-no-description + 104 WEAK (all non-atlas) = 7,154** — the
exact same target-population figure from the enrichment pilot, re-verified
against the current corpus rather than assumed. It has not drifted, even
though total active `source_record` crept up slightly this session
(86,393 → 86,735) — the growth landed outside this particular slice.

**1,144 NONE-bucket rows also carry an atlas_oddities source** — reported
for completeness; they're in NONE (not excluded from it) because
atlas_oddities rows without a `contact.website` have no signal at all, so
they land here on their own merits, same as any other source.

**Scoping note, worth stating plainly:** "in-scope" here means present in
`master_place_search_export` (searchable + geometry), the same convention
used throughout this session. **PAD-US has zero rows in this NONE bucket**
— not because PAD-US content is rich, but because PAD-US's `land_status`
rows are `is_searchable = false` and never enter the view at all (a
separate, much larger, already-known-and-decided population — see
`docs/STATE.md`). Do not read "NONE bucket" as "all sparse content in the
corpus" — it is specifically the sparse subset of what's already
search-visible.

## 2. NONE bucket by category — does NOT lean campground

Top categories by count, `primary_category` (resolved), out of 17,187:

| category | n | % |
|---|--:|--:|
| picnic_area | 4,080 | 23.74% |
| campground | 2,910 | 16.93% |
| trailhead | 2,818 | 16.40% |
| dispersed_camping | 2,488 | 14.48% |
| park | 1,469 | 8.55% |
| oddity | 1,125 | 6.55% |
| ev_charging | 867 | 5.04% |
| facility | 298 | 1.73% |
| grocery | 248 | 1.44% |
| beach | 166 | 0.97% |
| rest_area | 150 | 0.87% |
| water | 145 | 0.84% |
| toilet | 132 | 0.77% |

(51 distinct `primary_category` values total; long tail below 0.5% each.)

**`picnic_area` is the single largest NONE category, not campground** —
confirms the task's instruction not to assume. Together, picnic_area +
campground + trailhead + dispersed_camping = 71.55% of the bucket — four
categories account for nearly three-quarters of it.

## 3. Source, state, and category × source breakdown

**By source_id** (an MP counted once per source it carries):

| source | n |
|---|--:|
| osm | 13,839 |
| usfs | 1,488 |
| atlas_oddities | 1,144 |
| ridb | 424 |
| blm | 418 |
| google_resolved | 76 |

padus and nps: **0** (padus excluded by scope per §1; nps is essentially
always STRONG via `has_website` per the 2026-08-20 gap scan, so it barely
touches NONE at all).

**By state:**

| state | n | % |
|---|--:|--:|
| CA | 6,293 | 36.61% |
| UT | 2,889 | 16.81% |
| OR | 2,545 | 14.81% |
| AZ | 2,202 | 12.81% |
| WA | 1,859 | 10.82% |
| NV | 1,399 | 8.14% |

CA's share roughly tracks its overall corpus share — not a
disproportionate concentration, just the biggest state.

**Category × source cross-tab (top categories):**

| category | osm | usfs | atlas_oddities | ridb | blm |
|---|--:|--:|--:|--:|--:|
| picnic_area | 4,002 | 78 | 0 | 0 | 0 |
| campground | 2,784 | 120 | 0 | 17 | 0 |
| trailhead | 1,968 | 975 | 0 | 0 | 0 |
| dispersed_camping | 1,807 | 307 | 0 | 0 | 418 |
| park | 1,468 | 0 | 2 | 0 | 0 |
| oddity | 0 | 0 | 1,125 | 0 | 0 |
| ev_charging | 867 | 0 | 0 | 0 | 0 |
| facility | 11 | 8 | 0 | 298 | 0 |

`oddity` is 100% atlas_oddities and `ev_charging` is 100% osm, by
construction (no other source produces those categories at all).
`facility` is almost entirely ridb. `trailhead` is the most-usfs-heavy of
the OSM-dominant categories (975 of 2,818, 34.6%).

## 4. Qualitative spot-check — the real question

Reviewed real rows with full raw content across the top 5 categories by
count (picnic_area, campground, trailhead, dispersed_camping, park), plus a
separate pull for `ev_charging` (highest stub rate, wasn't in the top-5
dump). This is a corrected, corpus-scale answer to the 5-row manual check
in the task's context — **the pattern the 5-row check found does NOT hold
uniformly; it holds strongly for some categories and is close to inverted
for others.**

Automated split first — `isPlaceholderName` (the exact function from
`eval-llm-descriptions.ts`, reused verbatim: `null`/empty/`"unnamed …"`/a
small generic-name allowlist counts as placeholder):

| category | total | placeholder | named |
|---|--:|--:|--:|
| picnic_area | 4,080 | 3,427 (84.00%) | 653 (16.00%) |
| campground | 2,910 | 1,076 (36.98%) | 1,834 (63.02%) |
| trailhead | 2,818 | 492 (17.46%) | 2,326 (82.54%) |
| dispersed_camping | 2,488 | 1,215 (48.83%) | 1,273 (51.17%) |
| park | 1,469 | 138 (9.39%) | 1,331 (90.61%) |
| oddity | 1,125 | 0 (0.00%) | 1,125 (100.00%) |
| ev_charging | 867 | 748 (86.27%) | 119 (13.73%) |
| facility | 298 | 0 (0.00%) | 298 (100.00%) |
| **whole bucket** | **17,187** | **7,614 (44.30%)** | **9,573 (55.70%)** |

**Corpus-wide, a slim majority (55.70%) are named** — directionally
consistent with the 5-row check's "mostly real places" read, but the 5-row
sample overstated it: whole-bucket named-rate is 56%, not 80%.

**Reading the actual raw content confirms the automated split is roughly
right, with real texture underneath:**

- **`picnic_area` (84% placeholder) is genuinely, almost uniformly blank.**
  The typical row is `{"tourism":"picnic_site"}` — one tag, no name, no
  address, nothing else. Even the "named" 16% are often thin —
  `"Big Trees Day Use Area"`, `"Site 9"`, `"Danny's Place"` — a real label
  plus the same single `tourism` tag, no additional content. This is the
  single largest category in the bucket and it is the closest to a true
  "nothing to say" population.

- **`ev_charging` (86% placeholder) is the other genuinely-blank
  category.** Confirmed on a fresh pull: the typical row is
  `{"amenity":"charging_station"}`, sometimes with `capacity`/`socket:*`/
  `level` tags (functional, not descriptive) but no brand or name. The
  small "named" fraction is mostly a host institution's own name (e.g.
  `"Santa Monica College"`) rather than anything identifying the charger
  itself, or a real charging-network brand (`"ChargeNet"`) with no further
  detail beyond that.

- **`trailhead` (83% named) is the strongest "real place, thin data"
  category, and the richest structurally.** OSM rows are typically a real
  trail name + `highway=trailhead` (2 tags). The 975 usfs-sourced
  trailheads carry a much larger structured payload per row — `site_name`,
  `site_id`, `total_capacity`, `development_scale`, `managing_org`,
  `fee_charged`, `pack_in_out`, dozens of fields — genuinely rich
  *structured* data, just no prose `directions` field populated (that's
  exactly why the USFS fix didn't move these — no `directions` text, only
  numeric/categorical fields the current signal set doesn't check). These
  are real, specific, identifiable trailheads with real metadata; the gap
  is prose, not identity.

- **`park` (91% named) is similar** — the OSM rows for named parks
  routinely carry `ele` (elevation) and `gnis:feature_id` (a real USGS
  Geographic Names Information System reference id) alongside the name —
  genuinely identifiable real places (county parks, wildlife refuges,
  historical monuments) with a couple of structured facts, just no prose.

- **`campground` and `dispersed_camping` are genuinely mixed** (63%/51%
  named respectively) — real named sites (`"Coyote Primitive Campground"`,
  `"Lakes Basin Campground"`, `"Devils Kitchen Campsite 2"`) sit alongside
  true blank stubs and also alongside a third pattern worth flagging
  separately: **names that are technically non-placeholder but not
  meaningfully identifying** — `"42"`, `"46"`, `"1103-001"`, `"D10.62L"`,
  `"green crabs fishing"`. These pass `isPlaceholderName` (they're not
  literally "Unnamed X") but a human wouldn't call them real place names
  either — they're OSM mapper shorthand, USFS internal site codes, or
  odd/joke labels. **Not separately counted** (no precise number computed
  for this finer distinction — flagging qualitatively, not estimating a
  count for it).

- **`oddity` (100% named) and `facility` (100% named) are both
  structurally guaranteed to be named** — atlas_oddities rows always carry
  a scraped name (confirmed earlier this session: 0/2,866 have description
  text, but 100% have a name + address + category tags), and RIDB facility
  rows always carry a real `FacilityName`.

**Plain read on the qualitative question:** the 5-row check's finding is
real but category-dependent, not corpus-wide. `trailhead`, `park`,
`oddity`, and `facility` (33.22% of the bucket combined, 5,710 of 17,187)
are dominantly real named places with thin *prose* but often real
structured data. `picnic_area` and `ev_charging` (28.78% of the bucket
combined, 4,947 of 17,187) are dominantly genuine blank stubs.
`campground` and `dispersed_camping` (31.41% combined, 5,398 of 17,187)
are a real mix of both, plus a third pattern (junk/code "names") not
cleanly captured by either label.

## 5. Missed-field check — one real finding, one false lead

Checked actual raw payload shapes (not schema docs) for padus/ridb/nps/blm
NONE-bucket rows.

- **padus, nps: 0 NONE-bucket rows each** — nothing to check (padus
  excluded by view scope per §1; nps essentially never lands in NONE).

- **ridb: found a real candidate, structurally identical to the USFS
  case.** `raw_payload.facility.FacilityDirections` is a genuine
  driving-directions prose field, separate from `FacilityDescription`
  (which normalizes into the already-checked `normalized_payload.description`
  and is uniformly ≤39 characters here — always a name-echo, correctly
  filtered as junk, not a missed field). Of 425 RIDB NONE-bucket rows,
  **`FacilityDirections` is non-empty in 16 (3.76%)**, and **8 of those 16
  clear the 40-character real-content threshold** and are not a name-echo
  — real driving directions:
  - *"From Union Creek Resort, OR, travel north on Highway 62 (Crater Lake
    Highway) to the junction with Highway 230..."* (Lake West Nordic
    Shelter)
  - *"Riley Springs Trailhead is located approximately 15 miles northeast
    of Loa, Utah. Head north on N Main St..."* (Riley Springs Trailhead)
  - Three more of the same shape (Pole Canyon Trailhead, Rust Spring
    Trailhead, Whisky Ridge Viewpoint).

  Small in absolute count (8 rows would flip out of 425 RIDB NONE rows,
  same order of magnitude as USFS's 162-of-5,183), but the same *shape* of
  gap — a real prose field the current signal set doesn't check.
  `FacilityAccessibilityText` and `FacilityUseFeeDescription` were also
  checked and are uniformly empty (0/425 each) — not a missed field.

- **blm: `props.DESCRIPTION` is a false lead — checked and it's not
  populated.** Non-null in only 1 of 437 rows, and that one is 33
  characters (below threshold anyway). **Not a missed field.**

- **blm: a different, real finding — `props.WEB_LINK` is a real,
  frequently-populated URL the current signals don't credit.** Non-null in
  279 of 437 BLM NONE rows (63.8%), and 277 of those are real URLs ≥40
  characters (e.g. `https://www.blm.gov/visit/lower-deschutes-wild-and-scenic-river`).
  This isn't prose — it doesn't fit the "directions" pattern — but if these
  rows are in NONE despite having a real external URL, it means BLM's
  normalizer isn't mapping `WEB_LINK` into `normalized_payload.contact.website`,
  so the existing `has_website` signal (which *would* make these STRONG) is
  silently missing real data that's sitting right there in `raw_payload`.
  Flagging this as the second candidate alongside RIDB's `FacilityDirections`
  — same "cheap reclassification" shape as the USFS fix, different
  mechanism (a missed existing signal, not a new one).

  `FET_SUBTYPE` (always populated, e.g. `"Campsite - Primitive - Non
  Reservable - No Fee"`) is **not** a missed find — it's a short, heavily
  repeated categorical label, not free text, and checking confirmed the
  same handful of subtype strings recur across nearly all 437 rows.

**Not fixed in this pass, per the task's scope** — both are reported as
candidates only.

## 6. Wikipedia-proximity-fallback overlap

Located the exact mechanism: `web/src/lib/discovery/wikipedia.ts`,
functions `significantTokens`/`sharesSignificantToken` (the "2c guard"),
called from `geosearchTitle`. Live, wired into `discover()` and several
real request paths — not dormant. It requires a live MediaWiki geosearch
call per place (500m radius, up to 5 candidates), then accepts a match on
exact title, substring, or (last resort) a candidate within 100m sharing a
non-stopword token with the place name.

**Two numbers, deliberately kept separate because the first one is close
to meaningless on its own:**

- **Naive precondition (name has ≥1 non-stopword token): 17,177 of 17,187
  (99.94%).** Reported because the task asked for it, but this number is
  a poor proxy — `significantTokens("Unnamed picnic area")` = `{unnamed,
  picnic, area}`, all non-stopwords, so even a true blank stub trivially
  "passes" this precondition. It does not mean 99.94% of the bucket has a
  real path to Wikipedia content.
- **Better precondition (named, i.e. not `isPlaceholderName`): 9,573**
  (same figure as §4's "named" count) — the population where a real,
  specific name exists for the affinity check to actually mean something.

**Live calibration (small, not bulk — 20 real requests against the free,
keyless public Wikipedia API, 200ms spacing):** ran the exact
`geosearchTitle` logic (copied verbatim) against 20 named NONE-bucket rows,
deterministically spread across the 10,420-row named-NONE pool (categories:
oddity, campground, trailhead, recreation_area, facility, dispersed_camping,
unknown, grocery — a genuine cross-section, not cherry-picked).

**Result: 0 of 20 matched (0.0%).** Every single sampled row — including
real, specific names like "Wreckage of the S.S. Garden City," "Steele
Canyon County Park," "Año Nuevo SP," "Huntington City Beach" — found no
exact, substring, or affinity-gated Wikipedia article within 500m. Flagged
honestly: **0/20 is a real, computed result, not a claim of 0% at full
scale** — a 20-row sample can't rule out a true rate somewhere under
roughly 15% (rule-of-thumb upper bound for zero successes in 20 trials),
and a larger, more notable subset (e.g. named state/county parks, wildlife
refuges) would plausibly do better than obscure numbered campsites and
generic trailheads. But on this real, cross-category draw, the
mechanism found nothing — the honest read is that Wikipedia-proximity
overlap with this bucket is **low, not the free win the task's framing
raised as a possibility**, at least at this sample size.

## Plain-language read

**Not a single answer — it splits cleanly along the category lines
measured in §4, and the split is close to even by row count.**

- **33.22% of the bucket (trailhead + park + oddity + facility: 5,710 of
  17,187) is dominantly real, specific, named places** — the model has actual
  entities to work with, often with real structured metadata (USFS site
  codes/capacity, GNIS feature ids, RIDB facility records, Atlas Obscura
  addresses/categories) alongside the name. This slice reads as a
  **sourcing problem**: the identity and much of the substance is already
  there, just not as prose, and per §5, at least one concrete, cheap,
  RIDB-specific fix (`FacilityDirections`) and one signal-mapping gap
  (BLM `WEB_LINK`) exist to recover some of it the same way the USFS fix
  did — on a smaller scale (single digits to low hundreds of rows, not
  thousands).
- **28.78% of the bucket (picnic_area + ev_charging: 4,947 of 17,187) is
  dominantly genuine blank stubs** — one or two structural tags, no name, nothing to
  ground a description on and nothing a sourcing fix would recover,
  because the source itself never captured more than "there is a picnic
  table/charger here." This slice reads as the **product/category
  question** the task asked about: whether a description is a meaningful
  card requirement for an anonymous roadside picnic table or an unbranded
  charging station at all.
- **31.41% of the bucket (campground + dispersed_camping: 5,398 of
  17,187) is a genuine mix** of both patterns, plus a distinct third pattern — technically
  "named" rows whose name is a mapper code or site number, not really an
  identifying place name — that doesn't cleanly sort into either bucket
  and wasn't given a precise count here.

Wikipedia-proximity fallback, per §6, does not currently look like a
meaningful additional path into this bucket — the mechanism exists and is
live, but a real (if small) calibration sample found no matches at all,
even on rows with genuine, specific names.

No fix proposed, per the task's scope — this is what's actually in the
bucket, category by category, not a recommendation for what to do about
it.
