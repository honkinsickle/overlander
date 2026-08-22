# master_place enrichment columns — per-source investigation and backfill

**Date:** 2026-08-21
**Branch:** `master-place-enrichment-columns` — **not created by this work.**
Conductor had already created the branch (from `c370115`) and renamed the
workspace's original `andorra` branch onto that name before the task started;
the reflog records `branch: Created from c3701154…` followed by
`Branch: renamed refs/heads/andorra to refs/heads/master-place-enrichment-columns`.
What this work did do was **verify** `HEAD` sat exactly at `origin/main`'s tip
(`c370115`) before committing onto it. Do not read "forked from origin/main"
anywhere below as a claim that this work performed the fork.
**Target:** TEST (`znldzjdatkogdktymtvi`) only. **No PROD *database* reads or
writes.** One PROD-touching call did occur and is disclosed for accuracy:
`supabase projects list`, a Supabase **management-API** read that returned
project metadata for the prod project (`nqzeywzcowujzyegxbsr`). It reads no
table and writes nothing.
**Implements:** step 1 of `docs/decisions/2026-08-21-place-data-resolver-consolidation.md`

Every number below was computed in this investigation against TEST on
2026-08-21. Counts marked *population* come from a full scan or an exact
`count` query; anything sampled says so and gives its frame.

> **Corrections applied 2026-08-21 after a self-audit pass.** Four claims in
> the first version of this document were wrong or under-scoped and are
> corrected in place: the "strict superset by design" framing in §4 (it is
> measured, not structural — see §4a), the attribution of the 907 column-only
> rows in §4 (693/214, not all filter-excluded), the state scope of the
> state_parks findings in §2/§2d/§4 (Washington only), and the absence proof
> for rating/reviewCount/priceTier in §3 (a regex census was not sufficient;
> §3a records the exhaustive re-check). The corrections are marked ⟲ where
> they appear.

---

## 0. Summary

| ADR field | Column | Populated rows | How |
|---|---|--:|---|
| `photoUrl` | `master_place.photo_url` **(new)** | **7,360** | backfilled from nps / ridb / blm / state_parks |
| `description` | `master_place.description` *(already existed)* | 16,490 | untouched — recompute-owned, see §5 |
| `rating` | `master_place.rating` **(new)** | **0** | no ingested source carries one (§3) |
| `reviewCount` | `master_place.review_count` **(new)** | **0** | no ingested source carries one (§3) |
| `priceTier` | `master_place.price_tier` **(new)** | **0** | no ingested source carries one (§3) |

`master_place` holds **160,703** rows on TEST, **70,888** of them with
`source_count > 0` `[queried TEST 2026-08-21]`.

**`description` is not a new column.** It has existed since
`20260527120100_phase1_master_place.sql:29` and is resolved by
`recompute_master_place()` via `field_precedence`. The migration deliberately
does not re-add or alter it. The ADR names five fields; four columns were
added.

---

## 1. Method

Two scripts, both read-only, both committed:

- `data/scripts/investigate-enrichment-fields-2026-08-21.ts` — **full scan**
  (not a sample) of every `source_record` row for all ten `source_id` values
  in the corpus, walking both `raw_payload` and `normalized_payload` to depth
  4 and counting, per key path, present / non-empty rows plus example values.
  Key paths whose leaf name matches a rating / review-count / price / description
  / photo pattern are reported for human judgement. Rows scanned: osm 109,492 ·
  padus 37,701 · usfs 6,330 · ridb 6,013 · nps 5,283 · atlas_oddities 2,870 ·
  state_parks 1,736 · blm 876 · google_resolved 122 · google 5.
- `data/scripts/measure-enrichment-backfill-scope-2026-08-21.ts` — population
  counts of the affected `master_place` rows, so the backfill's numbers were
  measured *before* it ran rather than reported after.

Reading the normalizers alone would not have been enough: two of the findings
below (§2) are fields sitting unmapped in `raw_payload`, exactly the shape of
the BLM `WEB_LINK` and RIDB `FacilityDirections` misses found on 2026-08-20.

---

## 2. Per-source findings

Reported per source rather than assumed. ✓ = present and usable, ✗ = measured
absent, ⚠ = present in `raw_payload` but **not mapped** into
`normalized_payload` by the ingester.

| Source | rating | reviewCount | priceTier | description | photoUrl |
|---|---|---|---|---|---|
| **OSM** | ✗ | ✗ | ✗ | ✓ 2,749 rows | ✗ |
| **NPS** | ✗ | ✗ | ✗ | ✓ 5,281 rows | ✓ 4,876 rows |
| **RIDB** | ✗ | ✗ | ✗ | ✓ 5,795 rows | ✓ 2,667 rows |
| **state parks** | ✗ | ✗ | ✗ | ✓ 97 rows — **⟲ all 97 are WA** | ⚠ 138 rows — **⟲ all 138 are WA** |
| **Atlas Obscura** | ✗ | ✗ | ✗ | ✗ 0 rows | ✗ |
| **BLM** | ✗ | ✗ | ✗ | ✓ 169 rows | ⚠ 102 rows |
| **USFS** | ✗ | ✗ | ✗ | ✓ 6,323 rows | ✗ |
| *padus* | ✗ | ✗ | ✗ | ✗ 0 rows | ✗ |
| *google / google_resolved* | ✗ | ✗ | ✗ | ✗ 0 rows | ✗ |

Row counts are non-empty `source_record` rows out of the full-scan totals in
§1. `padus`, `google` and `google_resolved` are not among the six the task
named; they are in the same table and are reported so the picture is complete.

**⟲ SCOPE CORRECTION — the state_parks row of this table is Washington-only.**
`state_parks` is a **six-state** source (CA/AZ/NV/UT/WA/OR, 1,736 rows). Both
fields credited to it above exist **only on its Washington layer**, measured
across all 1,736 active rows: `props.Imagelink` **138/138 WA**,
`props.Description` **97/97 WA**. The first version of this document reported
both as "state parks" with no state scope, which reads as a six-state
capability and is not what was measured. **No equivalent state breakdown was
determined for BLM** — the probe used to establish the state_parks scoping
does not resolve a state for BLM external_ids, so this document makes **no
claim in either direction** about how BLM's 102 `PHOTO_LINK` / 169
`description` rows distribute across states.

### 2a. OSM — genuinely nothing

- `raw_payload.element.tags.stars` exists on **8** rows out of 109,492. It is
  OSM's hotel star *classification*, not a user rating, and 8 rows is not a
  field. Rejected.
- `tags.review` exists on **24** rows, every sampled value literally `"no"` —
  an OSM boolean ("has this been reviewed"), not a count. Rejected.
- `tags.fee` on **4,332** rows is `yes`/`no`. A boolean, not a 1–4 tier.
  `tags.price` (**1** row, `"$25"`) and `tags.cost` (**2** rows, `"15 USD"`)
  are free text at negligible scale. Rejected — mapping any of these to a tier
  would be inventing a value.
- `tags.image` on **34** rows is mostly not a direct image url (Flickr album
  pages, a `.pdf`, `wikimedia_commons` `File:` references on 21 more rows).
  Not usable as a `photo_url` without a resolver. Rejected.
- `norm.description` **2,749** non-empty — this includes the templated OSM
  descriptions from `osm-description-templates.ts`, not only real
  `description`/`note` tags (`tags.description` 1,013, `tags.note` 1,139).

### 2b. NPS — description and photo, no rating

`normalized_payload.description` **5,281/5,283** and
`normalized_payload.photo.url` **4,876**. The photo is already the Route A
mechanism read by the export view's lateral.

`raw_payload.campground.fees[].cost` (**199** rows) and
`park.entranceFees[].cost` (**41**) are dollar amounts like `"36.00"`. A price
*amount* is not a price *tier*, and NPS entrance fees are not comparable to a
restaurant `$$` scale. Rejected.

### 2c. RIDB — description and photo, no rating

`normalized_payload.description` **5,795** (from `FacilityDescription` /
`RecAreaDescription`), `normalized_payload.photo.url` **2,667**.

`FacilityUseFeeDescription` (**799**) and `RecAreaFeeDescription` (**325**) are
prose fee explanations, often HTML. Not a tier. Rejected.

**False positive worth recording:** the census flagged
`raw.media[].IsPreview` (**2,669** rows) as a reviewCount candidate because
`"IsPreview"` contains the substring `review`. It is a boolean on a media
object. This is why the census reports candidates for judgement rather than
auto-mapping them.

### 2d. State parks (⟲ **Washington only**) — ⚠ an unmapped photo field

**⟲ Read this section as "the Washington state-parks layer", not "state
parks".** Both fields below are WA-only, measured across all 1,736 active
`state_parks` rows: `props.Imagelink` **138/138 WA**, `props.Description`
**97/97 WA**. The other five states in this source (CA/AZ/NV/UT/OR) publish
neither field.

`raw_payload.props.Imagelink` carries a real, direct image url on **138** of
1,736 rows — **all 138 Washington** (e.g.
`https://parks.wa.gov/sites/default/files/2023-02/Manchester%20Torpedo%20Warehouse%202022.jpg`).
**`state-parks.ts` does not map it into `normalized_payload`.** Same class as
the BLM `WEB_LINK` miss fixed on 2026-08-20.

`raw_payload.props.Description` is present on only **207** rows and non-empty
on **97** — again **all 97 Washington** — and `state-parks.ts` *does* map it
to `normalized_payload.description`. It never reaches `master_place` anyway;
see §5.

The practical consequence of the WA scoping: the 133 state_parks photos this
backfill writes (§4) are a Washington slice, not six-state coverage, and
fixing the normalizer (§7 item 2) would not widen that — the data does not
exist in the other five states' layers.

### 2e. Atlas Obscura — nothing, by design

`normalized_payload.description` is present on all 2,870 rows and non-empty on
**0**. That is deliberate: `normalizeOddities()` writes `description: null`
because the AO CSV has no description column and the AO page would need a
separate scrape plus a ToS check. No photo, rating, review or price field
exists in the CSV at all. This source contributes nothing to any of the five.

### 2f. BLM — ⚠ an unmapped photo field

`raw_payload.props.PHOTO_LINK` carries a direct image url on **102** of 876
rows (Flickr static CDN), with `PHOTO_THUMB` and `PHOTO_TEXT` alongside on the
same 102. **`blm-rec.ts` does not map any of them into `normalized_payload`.**

`normalized_payload.description` is non-empty on **169** rows. It never reaches
`master_place` either; see §5.

### 2g. USFS — description, no photo

`normalized_payload.description` **6,323/6,330** (from `recarea_description`).

`fee_charged` is `Y`/`N` on **6,324** rows and `fee_description` is prose on
**4,101**. Neither is a tier. `norm.recopp.url` (**3,216**) is an
`fs.usda.gov` *web page*, not an image. Rejected.

---

## 3. rating / review_count / price_tier — measured zero

**No ingested source carries any of the three.** Not "we didn't find a good
one" — the full-scan census across all 170,428 source_record rows surfaced no
candidate key for any of them beyond the four rejected near-misses documented
in §2a/2b/2c/2g. **⟲ The evidence originally offered for this was not
sufficient; see §3a for the exhaustive re-check that now backs it.**

### 3a. ⟲ How this absence claim is actually supported

The first version of this section rested on the §1 census, which reports only
key paths whose **leaf name matches a regex** for each concept. That is a
discovery instrument, not an absence proof, and it demonstrably leaked: the
`priceTier` pattern includes `price`, and **`price` is not a substring of
`pricing`** — so OSM's `pricing`, `pricing:display`, `pricing:check_method`
and `pricing:check_required` tags were never reported by it. (They sit on
**1** OSM row of 109,492, and `pricing=by_request` is checkout metadata, not a
tier — but the census not surfacing them at all is the problem, not their
content.)

So the claim was re-established by **enumerating the complete key space** —
every distinct leaf name across `raw_payload` and `normalized_payload`, no
pattern filter, full scan of every row of each source:

| source | rows scanned | distinct key paths | distinct leaf names |
|---|--:|--:|--:|
| nps | 5,283 | 301 | 156 |
| ridb | 6,013 | 111 | 84 |
| state_parks | 1,736 | 127 | 119 |
| blm | 876 | 37 | 36 |
| usfs | 6,330 | 132 | 112 |
| atlas_oddities | 2,870 | 23 | 19 |
| osm | 109,492 | 967 | 950 |

**Result: the conclusion holds.** No leaf name in any of those seven sources
denotes a user rating, a review count, or a price tier. Two further candidates
that the regex census missed and this pass caught, both examined and rejected:

- **NPS `relevanceScore`** — the NPS API's own search-relevance score for a
  query, not a user rating of the place.
- **USFS `development_scale` / `usage_level`** — USFS site-development and
  usage classifications. Numeric-looking, but neither a rating nor a price.

`padus`, `google` and `google_resolved` were covered by the §1 census and
carry none of the three either.

The columns were still added, because that is the ADR's point: the card layer
stops needing to know whether a field *could* exist given this row's
provenance. A column that is NULL corpus-wide reads the same as one that is
NULL for this particular place.

**⚠ Compliance constraint on ever populating them.** The only source known to
this codebase that carries all three is Google Place Details (`rating`,
`userRatingCount`, `priceLevel`). Storing those is prohibited — Google's
caching policy grants exceptions only to `place_id` (indefinite) and
coordinates (30 days), and names `rating` / `userRatingCount` explicitly as
non-cacheable. See
`docs/measurements/2026-08-20-google-places-details-compliance-check.md`. So
these three columns are **not** a destination for Google data; a future
populate path needs a source whose terms permit storage. This is recorded in
the migration header so it cannot be lost.

---

## 4. photo_url backfill — what was written

**7,360 distinct `master_place` rows**, resolved nps > ridb > blm >
state_parks:

| winning source | rows |
|---|--:|
| nps | 4,690 |
| ridb | 2,449 |
| blm | 88 |
| state_parks | 133 — **⟲ all Washington** (§2d) |
| **total** | **7,360** |

Source-side coverage before precedence (active rows carrying a photo url /
of those, linked to a master_place):

| source | rows with photo | linked | distinct master_place |
|---|--:|--:|--:|
| nps | 4,876 | 4,697 | 4,690 |
| ridb | 2,667 | 2,510 | 2,464 |
| blm | 102 | 88 | 88 |
| state_parks (**⟲ WA only**) | 138 | 135 | 135 |

Mechanism: `backfill_master_place_photo_url(uuid[])`
(`20260821070000`), a set-based SQL helper in the same posture as
`backfill_state_for_ids()`. `data/scripts/backfill-master-place-enrichment.ts`
chunks ids into it. The nps/ridb precedence deliberately mirrors the photo
`LEFT JOIN LATERAL` already in `master_place_search_export` and
`pois_along_corridor`, including its NPS-preferred rule.

**blm and state_parks photos are read from `raw_payload.props`** because
neither normalizer maps them (§2d, §2f). Reading raw_payload keeps the
backfill honest about where the data lives rather than silently dropping 221
real photos; the durable fix is a normalizer change plus re-normalization,
flagged in §7.

**Verification** (`data/scripts/backfill-master-place-enrichment.ts --report`
and `verify-mp-photo-url-vs-export-view-2026-08-21.ts`):

- Re-running the backfill reports **0 rows changed** — idempotent.
- `photo_url` empty-string count: **0**. NULL is the only "no data" value.
- `rating` / `review_count` / `price_tier` non-null: **0 / 0 / 0**, asserted by
  the script (it throws otherwise).
- Against `master_place_search_export.photo_url` (6,453 rows with a photo):
  **6,430 identical**, **0 view-only** — ⟲ **measured, not guaranteed. See
  §4a; do not read this as a structural property.**
- **23 rows differ**, and the cause was checked rather than assumed:
  **23/23** of them link **more than one** photo-carrying nps/ridb
  source_record. The view's lateral orders only by `case source_id`, so with
  two same-source candidates its pick is Postgres-arbitrary; the column adds
  `source_quality_score DESC, external_id ASC` and is a total order. **0/23**
  fall outside that explanation.
- **907 column-only rows** — ⟲ **the split is 693 / 214, not "all excluded by
  the view's filters"; see §4b.**
- Of the 7,360, **7,140** already have a `description` and **220** do not.

### 4a. ⟲ "0 view-only" is a measurement, NOT a design guarantee

The first version of this document said the column is "a strict superset of
the view's lateral, which is what the design predicts." **That is wrong.**

The export view's photo lateral
(`20260821040000_search_export_description_source.sql:63-67`) filters on
`master_place_id`, `source_id in ('nps','ridb')`, and a non-null photo url —
**and nothing else. It does not filter `is_active`.** The RPC
(`20260821070000`) *does* filter `is_active = true`. So the two resolve over
different row sets, and the view can surface a photo from a **deactivated**
source_record that the column deliberately excludes. Nothing structural makes
the column a superset.

**Why "0 view-only" held anyway, measured:** `[queried TEST 2026-08-21]` there
are currently **0 inactive nps** and **0 inactive ridb** source_records
carrying a `normalized_payload.photo.url`. The divergence is real but
**latent** — today's data simply contains no row that exercises it.

**⚠ It will break on the first deactivation of a photo-carrying NPS or RIDB
source_record.** At that moment the view keeps serving that place's photo
while `master_place.photo_url` (once the backfill is re-run, which clears it)
does not — a view-only row, and the superset relationship inverts. This is not
hypothetical maintenance advice: `is_active = false` deactivation passes are
routine in this corpus (three ran on 2026-08-20 alone). Whoever repoints the
export view at the column (§7 item 3) should treat the `is_active` difference
as the substantive decision, not a detail — the view arguably has the bug, but
that is a separate call and is not made here.

### 4b. ⟲ The 907 column-only rows — corrected attribution

The first version said "the rest are rows the view's own filters exclude."
Measured `[queried TEST 2026-08-21]`, the 907 split two ways:

| | rows | why |
|---|--:|---|
| **absent from the export view entirely** | **693** | excluded by the view's own filters (`is_searchable`, `source_count > 0`, `st_intersects(geometry, six_state_footprint())`) |
| **present in the export view, `photo_url` NULL** | **214** | in the view, but its lateral covers only nps/ridb — these places' photos come from blm / state_parks, which the lateral does not read |
| **total** | **907** | |

So 214 of the 907 are *not* filter-excluded at all; they are rows where the
view is present-but-blank because the column reaches a source the lateral
doesn't. That distinction is the whole point of §7 item 3 — repointing the
view at the column would fill in those 214, not merely deduplicate logic.

For reference, the active source_ids across all 907 (population, not a
sample): nps 685 · state_parks 133 · blm 88 · osm 4 · padus 4 · ridb 1. Note
these overlap — a master_place can carry several sources — so the list is not
a partition of the 907.

---

## 5. description — the gap is field_precedence, not a missing column

`master_place.description` is non-null on **16,490** of 160,703 rows.

`resolve_field()` INNER JOINs `field_precedence`, so **a source with no
`description` precedence row can never contribute a description to
`master_place`, no matter what its payload holds.** Measured coverage
`[queried TEST 2026-08-21]`:

| source | field_precedence rows |
|---|---|
| nps | 12 fields incl. description |
| osm | 11 fields incl. description |
| ridb | 11 fields incl. description |
| usfs | 3 fields incl. description |
| padus | 3 fields incl. description |
| state_parks | 8 fields — **description absent** |
| **blm** | **NO ROWS AT ALL** |
| **atlas_oddities** | **NO ROWS AT ALL** |

Consequence, measured:

- **138** master_place rows link an active BLM source_record carrying a real
  description, and **138 of those 138** have `master_place.description IS
  NULL`.
- **95** for state_parks, **95 of 95** NULL.

**Nothing was changed about this.** Seeding those precedence rows is a product
decision, not a mechanical fix — the state-parks architecture spec §10a
excluded `description` *on purpose* ("sourced from visitor websites, not
GIS"), so reversing it silently would be wrong. And writing description
directly onto `master_place` from a backfill would violate the schema
invariant (`master_place` is written only by `recompute_master_place()`) and
be erased by the next recompute anyway.

**Second, larger finding, flagged not fixed:** `blm` and `atlas_oddities` have
**no `field_precedence` rows for any field**. Their source_records link to
master_places and count toward eligibility bucketing (which reads
source_record directly), but they contribute **zero resolved fields** to
`master_place`. That is broader than description and was not previously
recorded anywhere I could find.

---

## 6. Overlap with the LLM description enrichment pilot

Asked for as a report, not as work. Nothing here was run or changed.

**The pilot's bulk run has already happened on TEST — this contradicts
STATE.md.** `[queried TEST 2026-08-21]` `master_place_generated_content` holds
**17,725** rows: **10,292** `generation_method='template'` and **7,433**
`generation_method='llm'`. STATE.md's 2026-08-21 section states "10,292
generated_content rows, all `generation_method='template'`, **0 `llm`**". The
LLM rows are stamped `claude-sonnet-4-5`, `prompt_version`
`2026-08-20b-antifab` (the corrected anti-fabrication prompt), `generated_at`
2026-08-21 19:23–19:37 UTC — i.e. after STATE.md was written, most likely from
a parallel Conductor workspace. Model/prompt uniformity is from a **sample of
1,000** rows (PostgREST's default max page), not the full 7,433. **Not touched
by this branch.**

**Should the `description` column backfill draw from that output? No — and it
does not need to.**

1. It already has a designated home. `20260821000000_master_place_generated_content.sql`'s
   own header records that a column on `master_place` was **considered and
   rejected** for generated content, precisely so generated text can never be
   confused with source-of-truth data. Writing LLM output into
   `master_place.description` would undo that decision.
2. It would mislabel provenance. `master_place_search_export.description_source`
   derives `'source'` from `master_place.description IS NOT NULL`. LLM text in
   that column would be reported as `'source'` on both the export view and the
   Typesense index.
3. The read path already exists: description from `master_place` when present,
   `master_place_generated_content` as fallback, with `description_source`
   (`'source'`/`'template'`/`'llm'`/`null`) live in Postgres and Typesense
   since 2026-08-21.

**One correction to the task's framing.** The pilot's target population is
**not** the NONE bucket. It is defined in
`docs/measurements/2026-08-20-llm-description-generation-pilot.md` as
STRONG/WEAK-bucket rows with **no existing real description** — 8,782 rows,
corrected to **7,154** after excluding `atlas_oddities`. The NONE bucket is
what the *template* pass addressed (10,292 rows, which took NONE from 10,527
to 235). The measured 7,433 llm rows sit close to that 7,154 target, which is
consistent with a bulk run over it rather than over the NONE bucket.

**Residual to be aware of:** on a **sample of the first 1,000** llm rows,
**116** sit on a master_place that already has a real
`master_place.description`. Not necessarily wrong — the read path prefers the
real description — but it means some LLM spend went to rows that will never
show it. Worth a population-level check before a PROD run. Not measured at
population scale here.

**Verdict: separate follow-up, and largely already-built infrastructure rather
than new work.** It is not part of this migration.

---

## 7. Flagged, deliberately not done

1. **`photo_url` is a snapshot, not resolver-owned.** It is not wired into
   `recompute_master_place()`, so a later deactivation or materialize will not
   refresh it until the backfill is re-run. Same staleness class as
   `master_place.state` (already an open item in STATE.md). Wiring it in
   properly needs a `photo`/`photo_url` row in `field_precedence` for each
   contributing source, and `resolve_field()` reads
   `normalized_payload->><field>` — the photo lives at
   `normalized_payload.photo.url`, so it would need a dedicated step like the
   existing `geometry_polygon` one (Step 5), not a plain precedence entry.
   Seeding `field_precedence` is reserved for Adam per CLAUDE.md. **The
   backfill script is re-runnable and self-clearing, so re-running it after a
   materialize is the interim mitigation.**
2. **blm `PHOTO_LINK` and state_parks `Imagelink` are unmapped in their
   normalizers.** Fixing that (plus a re-normalization backfill, exactly like
   `backfill-blm-website.ts`) would also feed the export view's lateral, so
   search results would gain those 221 photos too. Not done here. **⟲ Note the
   ceiling: the state_parks half is Washington-only (§2d), so this widens
   coverage within WA, not across the six states.**
3. **`master_place_search_export.photo_url` still comes from the lateral, not
   the new column.** They now differ on 221 blm/state_parks rows and on the 23
   arbitrary-pick rows. Repointing the view at the column is step-2 work under
   the ADR (resolver consolidation), not step 1. **⟲ Whoever does it must
   decide the `is_active` question first — the lateral does not filter it and
   the column does (§4a).**
4. **`blm` and `atlas_oddities` have no `field_precedence` rows at all** (§5).
5. **state_parks / blm `description` precedence rows** (§5) — a product
   decision.
6. **No PROD apply.** Both migrations are applied to TEST only. **The CHECK
   constraints in `20260821060000` take an ACCESS EXCLUSIVE lock and full-scan
   to validate — cheap at TEST's current size; PROD's `master_place` row count
   has not been measured, so no claim is made about it either way. A PROD
   adaptation should use `NOT VALID` + a later `VALIDATE CONSTRAINT`. Recorded
   in that migration's header.**
7. **The `rating` (0–5) and `price_tier` (1–4) CHECK ranges encode Google's
   scales.** Foursquare — named as a live source by the ADR — rates 0–10 on
   its public API. Nothing in the codebase produces a Foursquare rating today
   (`web/src/lib/discovery/foursquare.ts` carries no rating or price field),
   so there is no live conflict, but the choice is a decision point deferred
   to whoever first populates these columns from Foursquare. Recorded in the
   migration header.

---

## 8. Artifacts

| Path | What |
|---|---|
| `supabase/migrations/20260821060000_master_place_enrichment_columns.sql` | the four columns + range checks + column comments |
| `supabase/migrations/20260821070000_backfill_master_place_photo_url.sql` | `backfill_master_place_photo_url(uuid[])` |
| `data/scripts/investigate-enrichment-fields-2026-08-21.ts` | full-scan key census (read-only) |
| `data/scripts/measure-enrichment-backfill-scope-2026-08-21.ts` | population counts (read-only) |
| `data/scripts/backfill-master-place-enrichment.ts` | the backfill + `--dry-run` + `--report` |
| `data/scripts/backfill-master-place-enrichment.test.ts` | unit test for `photoUrlOf()` — 11 cases pinning its coalesce order, trim/empty handling and non-string rejection to the RPC's SQL |
| `data/scripts/verify-mp-photo-url-vs-export-view-2026-08-21.ts` | column-vs-view cross-check (read-only) |
| `data/scripts/verify-enrichment-audit-2026-08-21.ts` | **the measurement basis for every ⟲ correction in this document** (read-only, six sections) |

**Provenance of the corrections.** The four ⟲ corrections were re-measured by
`verify-enrichment-audit-2026-08-21.ts`, and each of its sections maps to one
of them, so the corrected numbers can be re-derived rather than taken on
trust:

| section | backs |
|---|---|
| §A | §5 — `blm` and `atlas_oddities` have **0** `field_precedence` rows, by direct per-source filter |
| §B | §4b — the **693 / 214** split of the 907 column-only rows |
| §C | §4a — **0** inactive nps and **0** inactive ridb rows carry a photo url, which is the whole reason "0 view-only" held |
| §D | §2d — `Imagelink` **138/138 WA**, `Description` **97/97 WA**, plus the explicit caveat that BLM's state distribution was **not** determined |
| §E | §3a — the full key-space table (every distinct leaf name per source, no pattern filter) |
| §F | §3a — the OSM `pricing` leak that showed the regex census was not an absence proof |

`§E` rescans ~132k source_record rows and is the slow one; the rest run in
well under a minute via `--sections A,B,C,D`. `--leaves` prints §E's complete
leaf-name lists so a reader can re-judge the absence claim independently
rather than accepting this document's summary of it.

Gates, all exit 0: `npm run -w data typecheck`, `npm run -w web typecheck`,
`npm run -w data test` (570 passed, 3 skipped), `cd web && npx next build`.
