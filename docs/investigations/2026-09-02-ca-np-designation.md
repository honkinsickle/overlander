# CA state_parks "NP" designation — investigation

**Date:** 2026-09-02 · **Status:** investigation only, no fixes, no merges, no data changes.
**Scope:** the CA-specific SubUnit rows in the `state_parks` GIS source that surfaced
during the pre-existing cross-source-duplicate sort as "SP/SB/SRA/SHP vs NP" pairs.
**Follow-up to:** `docs/investigations/2026-09-02-cross-source-duplicates.md` and the
subsequent sorting pass over its 384 pre-existing pairs.

---

## 0. Answer, up front

**"NP" is a CA DPR sub-unit-classification suffix. Confidence: high.** Every row that
ends in " NP" in the `state_parks` source is a **SubUnit** record from CA DPR's
`ParkBoundaries` GIS layer — a protected sub-area *inside* a larger park unit. Given
CA DPR uses exactly three SubUnit classifications (Natural Preserve, Cultural
Preserve, State Wilderness) and the corpus contains exactly three SubUnit suffixes
(NP, CP, SW), the mapping is:

| suffix | CA DPR classification | corroboration |
|---|---|---|
| **NP** | **Natural Preserve** | inference (only remaining classification after CP and SW) |
| CP | Cultural Preserve | directly confirmed via CA State Parks Foundation write-up |
| SW | State Wilderness | well-known abbreviation, matches the pattern |

**Consequence for the duplicate sort:** every "X vs X NP" pair is a **parent unit
vs a Natural Preserve sub-unit inside it** — parent/child, not duplicate. All 9
NP-suffixed pairs in the pre-existing 384-pair set belong in the **DIFFERENT**
bucket. The 4 that the sort pass punted to "unclear" are reclassified below.

**Not a merge target.** These are the same shape as the `park ↔ campground` pairs
already dominating the DIFFERENT bucket — the schema already supports the correct
model via `place_relationships (contained_in)`, keeping both master_places distinct
and linking the SubUnit under its parent.

---

## 1. The measurement

### 1a. The full population

Both databases contain the same three-way SubUnit distribution (measured this
session against PROD and TEST):

| suffix | PROD SubUnit rows | TEST SubUnit rows |
|---|---:|---:|
| NP | 63 | 63 |
| CP | 24 | 24 |
| SW | 12 | 12 |
| **total SubUnit rows** | **99** | **99** |

Every one of these rows has:

- `source_id = state_parks`
- `normalized_payload.designation = "SubUnit"`
- `raw_payload.props.SUBTYPE = "SubUnit"`
- `normalized_payload.provenance.layer = "ParkBoundaries"`
- `normalized_payload.provenance.state = "CA"`
- `inferred_category = "recreation_area"`
- `raw_payload.props` fields limited to `{FID, GISID, GlobalID, SUBTYPE, Shape__Area, Shape__Length, UNITNAME, UNITNBR}` — no explicit "classification" column beyond `SUBTYPE`

The `UNITNAME` is the display name (e.g. `"Red Cliffs NP"`); the suffix is the only
signal of which SubUnit type the row is. No source-native field distinguishes NP
from CP from SW *except* the trailing token on the name.

### 1b. NP source_records → master_places

63 NP `source_record` rows resolve to **62** distinct `master_place` rows on PROD:

- **61** master_places have `source_count = 1` — the NP row is the only backing
  source; ER did not link it to anything else.
- **1** master_place has `source_count > 1` — one NP got linked into a larger row.

The 63-vs-62 gap is `Los Penasquitos Marsh NP`, which appears twice as a
`source_record` (two `agency_id`s: `640` and `fec71bff-…-964cea`) — one of the two
resolves to a shared master_place, the other did not link to a master_place in the
current query result. This is a minor data quirk, not the main finding.

### 1c. Reasoning for "NP = Natural Preserve"

CA DPR sub-unit classifications, per the search evidence gathered this session
(sources listed at end), are exactly three:

- **Natural Preserve** — distinct nonmarine areas of outstanding natural/scientific
  significance established within a parent state park unit (Cal. Code Regs. Tit. 14
  §4759)
- **Cultural Preserve** — analogous cultural/archaeological sub-units. The CP
  suffix mapping to Cultural Preserve is **directly confirmed** by a CA State
  Parks Foundation write-up seen this session.
- **State Wilderness** — wilderness sub-units within a parent park unit. The SW
  suffix mapping to State Wilderness is the conventional English abbreviation.

The corpus contains exactly three suffix codes (NP/CP/SW) on rows that CA DPR's
own metadata labels `SUBTYPE = SubUnit`. Two of the three (CP, SW) map cleanly.
The remaining code (NP) maps to the remaining classification (Natural Preserve) by
elimination. **What is NOT verified this session:** a CA DPR official data
dictionary explicitly stating "NP" as the Natural Preserve code. Two DPR PDFs
returned only binary content through the WebFetch tool. Confidence is high but not
authoritative-cite level. If a merge tool ever depends on this reading being
exact, verify against the CA DPR ParkBoundaries feature service schema before
acting.

---

## 2. The 9 NP pairs in the 384-pair pre-existing set

All 9 are CA. All have the visitor state-parks-content row on one side and a CA
DPR `SubUnit`-classified `NP` row on the other. The `dist_m` values are the
`findCandidates` centroid-to-centroid distances from the sort script — real,
measured this session.

| # | visitor row | NP row | prev bucket | dist | sim | recommended bucket |
|---:|---|---|---|---:|---:|---|
| 1 | Anderson Marsh State Historic Park | Anderson Marsh NP | unclear | 1619 m | 0.880 | **different** — Anderson Marsh Natural Preserve is a SubUnit of the SHP |
| 2 | Burton Creek SP | Burton Creek NP | unclear | 1014 m | 0.918 | **different** — Burton Creek NP is a Natural Preserve SubUnit of Burton Creek SP |
| 3 | Pescadero SB | Pescadero Marsh NP | different | 1412 m | 0.860 | **different** (confirmed) — Pescadero Marsh NP is a NP adjacent to the SB |
| 4 | Point Dume SB | Point Dume NP | unclear | 143 m | 0.869 | **different** — Point Dume NP is a Natural Preserve SubUnit associated with Point Dume SB |
| 5 | Salinas River SB | Salinas River Dunes NP | different | 839 m | 0.879 | **different** (confirmed) — distinct dunes Natural Preserve |
| 6 | Salinas River SB | Salinas River Mouth NP | different | 2534 m | 0.879 | **different** (confirmed) — distinct river-mouth Natural Preserve |
| 7 | Silver Strand State Beach | Silver Strand NP | different | 1469 m | 0.887 | **different** (confirmed) — Silver Strand NP is a Natural Preserve SubUnit |
| 8 | Wilder Ranch SP | Wilder Beach NP | different | 749 m | 0.860 | **different** (confirmed) — Wilder Beach NP is a Natural Preserve SubUnit at Wilder Ranch SP |
| 9 | Woodson Bridge SRA | Woodson Bridge NP | unclear | 776 m | 0.926 | **different** — Woodson Bridge NP is a Natural Preserve SubUnit of the SRA |

**Net effect on the sort pass**: the 4 previously-unclear NP pairs move to
**different**. This shrinks the sorting pass's UNCLEAR bucket from **6 → 2**
(remaining: `Munson Creek Falls SNS ↔ Munson Creek SNA`, and
`Berlin-Ichthyosaur State Park ↔ Berlin`), and grows DIFFERENT from **242 → 246**.
The SAME bucket is unchanged at 136.

**Same-bucket recommendation, all 9:** DIFFERENT. Not merge candidates. All 9 are
parent/child relationships — a Natural Preserve SubUnit is legally and
operationally a distinct protected area inside a larger park unit, not a naming
variant of it.

---

## 3. Beyond the 9 pairs — the wider NP population

The sort script's radius+similarity filter surfaced 9 NP pairs; the underlying NP
population on PROD is **62 distinct master_places** (from 63 source_records).
**53 of those 62 NP master_places do NOT appear in the 384-pair set** — either
because no non-NP master_place sits within 3 km at ≥0.85 name similarity (the
sort's filter), or because those NPs never got a same-locality twin surfaced via
`findCandidates`.

That is *not* a problem for the sort's correctness — the sort was scoped to
duplicate-detection, not sub-unit-relationship discovery. But it is a signal that
**modeling NP↔parent as `place_relationships` (contained_in)** — if pursued — is
a bigger job than "fix the 9 pairs the sort surfaced." A relationship pass would
need to walk all 62 NP master_places, match each to its parent CA DPR
top-level-unit master_place, and write the `contained_in` link.

**Explicitly out of scope for this investigation.** This document does not
propose the relationship-building work — only names it. Whether that work should
happen at all (versus letting NP records stand as independent searchable
master_places, as they do today) is a product decision, not a data-quality
one.

---

## 4. Recommendation for `docs/investigations/2026-09-02-cross-source-duplicates.md`

That doc's §2 lists 317 "similar" pairs and specifically flags a class of concern:
`Torrey Pines State Beach ↔ Torrey Pines State Natural Reserve` as "genuinely
distinct units". The NP class is the same shape and adds a specific piece of
information: **CA DPR ParkBoundaries emits both the parent-unit polygon AND its
NP/CP/SW SubUnit polygons as separate rows**, and the ER's radius+similarity
detector reads those as candidate duplicates. This is the mechanism behind the
`campground (180)` pair count and the `NP` pair count in the same breath — CA
DPR structurally emits parents-plus-sub-parts, and the corpus has done the
faithful thing by ingesting all of them.

**No change needed to that doc.** Its analysis already treats "different unit
type = do not merge" correctly; this investigation just names the mechanism.

---

## 5. Sub-units the sort didn't ask about (CP, SW)

For symmetry, the same logic applies to the other two SubUnit suffixes:

- **CP (24 rows on PROD, 24 on TEST) — Cultural Preserve SubUnit.** The sort's
  384-pair set contains **one** CP pair: `Topanga SP ↔ Topanga CP` — already in
  DIFFERENT with reasoning "state park vs county park". That reasoning was
  wrong-in-detail (CP ≠ county park; CP = Cultural Preserve SubUnit of the state
  park), but **correct in bucket assignment** — parent/child, DIFFERENT.
- **SW (12 rows on PROD, 12 on TEST) — State Wilderness SubUnit.** The sort's
  384-pair set contains **two** SW pairs: `Limekiln SP ↔ Limekiln SW` and
  `Cuyamaca Rancho SP ↔ Cuyamaca Mountain SW` — both already in DIFFERENT with
  reasoning "park vs state wilderness". Same reasoning; correct bucket.

So the NP → parent-unit-SubUnit relationship is one instance of a broader pattern
(NP, CP, SW), and the sort's DIFFERENT bucket already implicitly captures all
three — a merge tool built off the sort's output would not misfire on any of
them.

---

## 6. Scope limits

- The sort's 3 km, similarity-≥-0.85 filter is *not exhaustive* for finding
  parent↔NP pairs. A pair whose centroids sit >3 km apart, or whose parent-unit
  name normalizes far from the SubUnit name (e.g. `"California Citrus State
  Historic Park"` vs `"Some Local Feature NP"`), is not in the 9 or the 384.
- The 62 NP master_places may or may not each have an in-corpus parent
  master_place. Confirming that would need per-NP `agency_id`-to-parent-lookup
  or geospatial containment queries — **not run this session**.
- "NP = Natural Preserve" is a high-confidence inference from the presence of
  CP (confirmed) and SW (canonical) alongside it, not from a CA DPR data
  dictionary read verbatim. See §1c.
- Everything counted here is PROD (with TEST spot-checks that agreed). No writes,
  no schema changes, no code changes to the corpus. `git status` clean before
  the investigation commit.

---

## Sources consulted this session

- [Cal. Code Regs. Tit. 14 § 4759 — Natural Preserves](https://www.law.cornell.edu/regulations/california/14-CCR-4759)
- [Cultural Preserves in California State Parks (parks.ca.gov)](https://www.parks.ca.gov/?page_id=23750)
- [What's in a Name? Understanding California's State Park Classifications — CA State Parks Foundation](https://www.calparks.org/blog/whats-name-hidden-meaning-behind-californias-state-park-classifications)
- [DPR Operations Manual — Natural Resources (PDF, binary; content not extractable via WebFetch)](https://www.parks.ca.gov/pages/21299/files/DOM%200300%20Natural%20Resources.pdf)
- [CA DPR classification staff report (PDF, binary; not extractable)](https://www.parks.ca.gov/pages/29247/files/08c-CASPGP%20Resolution%20Class_Name%20NewStatePark_Final_051421_R.pdf)
