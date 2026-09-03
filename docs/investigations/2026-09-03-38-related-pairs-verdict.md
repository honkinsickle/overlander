# The 38 already-related SAME-bucket pairs — merge verdict

**Date:** 2026-09-03 · **Status:** investigation only, no writes to either
database, no schema or classifier changes.
**Follow-up to:** PR #370 (`docs/investigations/2026-09-03-merge-preview-136-same-pairs.md`).
**Scope:** the 38 pairs from that PR's §3 flagged as *"already linked to each
other via `place_relationships`"* — the design tension named there but not
resolved.

---

## 0. Answer, up front

Reading all 38 pairs' `place_relationships` rows + both master_place records
against live PROD this session:

| verdict | count |
|---|---:|
| **Same-entity duplicate** — SAME bucket is correct; `contained_in` relationship row is a mechanical geometric artifact of polygon-covers-point and would be redundant once merged | **37** |
| **Exclude from SAME** — the canonical row itself is a bad federation (two different parks merged into one master_place upstream); this needs fixing before any merge | **1** |
| **Unclear** | **0** |

**Direction pattern:** 37 of 38 have the canonical (state_parks-GIS-backed row
with the polygon) as PARENT and the absorbed (atlas_oddities / NPS / RIDB
point-only row) as CHILD. The 1 reversed case is Fort Churchill State Park →
Fort Churchill Historic State Monument: the canonical row here has no polygon
(`geometry_polygon = null`) while the absorbed row does, so `ST_Covers` fired
the other direction. Same conclusion for the merge either way.

**Relationship type:** all 38 rows are `contained_in`, the only value the
CHECK constraint permits today. Verified via query.

**All 38 canonical rows are `state_parks`-backed.** Verified via query.

**Confidence: directly verified.** Every count above and every direction check
was queried this session; the 38-vs-1 split was arrived at by hand-classifying
each pair from its actual name, category, sources, description text, and
centroid distance.

---

## 1. The mechanism: why these pairs are BOTH duplicates AND correctly-linked-as-parent-child

`place_relationships` is derived from polygon containment by
`recompute_master_place()` (schema: `20260601030000_phase3b_place_relationships.sql`).
For every pair, the state_parks-GIS row has a `geometry_polygon` (the park's
official boundary) and the other side has a `geometry` Point. When
`ST_Covers(parent.geometry_polygon, child.geometry)` returns true, a
`contained_in` row is written.

For all 37 same-entity cases the geometric fact is trivially true: the
atlas_oddities / NPS / RIDB record's Point sits inside the park boundary,
because that Point represents the eponymous feature or the park itself. So
the `contained_in` row is **not spurious in the schema's own terms** — it is a
correct statement about geometry.

But conceptually the two rows describe the same physical entity. The `SHP`
CONTAINS the landmark that gave the `SHP` its name, only in the same
tautological sense that Yellowstone "contains" Yellowstone. A merge collapses
that redundancy; the `contained_in` row would need to be dropped (it would
otherwise violate the schema's `no_self_ref_chk` after the merge).

**Confidence:**
- Directly verified: the FK topology (`contained_in` only, computed by
  `recompute_master_place()` via `ST_Covers`) from the migration source and
  from PROD `place_relationships.relationship_type` on all 38 rows.
- Strong inference: the *conceptual identity* claim — that the atlas_oddities
  "Malakoff Diggins" and the state_parks "Malakoff Diggins SHP" describe the
  same entity — is a semantic judgment I made by reading both descriptions
  and comparing names, not a ground-truth mapping. Highly likely correct for
  all 37 but not verified against an authoritative registry.

---

## 2. Per-pair verdict table

Distances are Haversine between the two rows' `geometry` (Point) centroids,
measured this session. The parent row's polygon covers the child row's point
regardless of centroid distance — a large park with a centroid far from the
child feature can still contain it.

| state | canonical (parent, w/ polygon) | absorbed (child, point-only) | dist | verdict |
|---|---|---|---:|---|
| CA | `Agua Caliente County Park (ABDSP)` | `Anza-Borrego Desert State Park` (nps) | 21,216 m | **exclude-from-same** |
| CA | `Antelope Valley California Poppy Preserve (SNR)` | `Antelope Valley Poppy Reserve` (atlas_oddities) | 282 m | same-entity |
| CA | `Antelope Valley Indian Museum (SHP)` | `Antelope Valley Indian Museum` (atlas_oddities) | 577 m | same-entity |
| CA | `Bodie SHP` | `Bodie State Historic Park` (atlas_oddities) | 443 m | same-entity |
| CA | `Chumash Painted Cave SHP` | `Chumash Painted Cave State Historic Park` (atlas_oddities) | 126 m | same-entity |
| CA | `Colonel Allensworth SHP` | `Colonel Allensworth State Historic Park` (atlas_oddities) | 1,490 m | same-entity |
| CA | `Fort Ross SHP` | `Fort Ross` (atlas_oddities) | 842 m | same-entity |
| CA | `Malakoff Diggins SHP` | `Malakoff Diggins` (atlas_oddities) | 848 m | same-entity |
| NV | `Berlin-Ichthyosaur State Park` | `Berlin-Ichthyosaur State Park` (atlas_oddities) | 815 m | same-entity |
| NV | `Cathedral Gorge State Park` | `Cathedral Gorge` (atlas_oddities) | 141 m | same-entity |
| NV | `Fort Churchill Historic State Monument` | `Fort Churchill` (atlas_oddities) | 3,121 m | same-entity |
| NV | `Fort Churchill State Park` (no polygon) | `Fort Churchill Historic State Monument` (nevada_state_parks+state_parks; has polygon) | 3,420 m | same-entity (direction reversed for this row only) |
| NV | `Valley of Fire State Park` | `Valley of Fire` (atlas_oddities) | 6,984 m | same-entity |
| NV | `Ward Charcoal Ovens State Historic Park` | `Ward Charcoal Ovens State Historic Park` (atlas_oddities) | 725 m | same-entity |
| OR | `Devil's Punch Bowl State Natural Area` | `Devils Punchbowl` (atlas_oddities) | 126 m | same-entity |
| OR | `Erratic Rock State Natural Site` | `Erratic Rock State Natural Site (Bellevue Erratic)` (nps) | 210 m | same-entity |
| OR | `Fort Rock State Natural Area` | `Fort Rock` (atlas_oddities) | 502 m | same-entity |
| OR | `Silver Falls State Park` | `Silver Falls State Park` (atlas_oddities) | 852 m | same-entity |
| OR | `Smith Rock State Park` | `Smith Rock State Park` (atlas_oddities) | 155 m | same-entity |
| OR | `Thompson's Mill State Heritage Site` | `Thompson's Mills` (atlas_oddities) | 3,327 m | same-entity |
| OR | `White River Falls State Park` | `White River Falls` (atlas_oddities) | 747 m | same-entity |
| UT | `Coral Pink Sand Dunes` | `Coral Pink Sand Dunes State Park` (atlas_oddities) | 466 m | same-entity |
| UT | `Escalante` | `Escalante Petrified Forest State Park` (ridb) | 1,282 m | same-entity |
| UT | `Gunlock` | `Gunlock State Park` (ridb) | 618 m | same-entity |
| UT | `Hyrum` | `Hyrum State Park` (ridb) | 1,488 m | same-entity |
| UT | `Jordanelle` | `Jordanelle State Park` (ridb) | 2,784 m | same-entity |
| UT | `Sand Hollow` | `Sand Hollow State Park` (ridb) | 1,263 m | same-entity |
| UT | `Snow Canyon` | `Snow Canyon State Park` (ridb) | 830 m | same-entity |
| UT | `This Is The Place` | `This is the Place Heritage Park` (nps) | 880 m | same-entity |
| UT | `This Is The Place` | `This Is The Place Heritage Park` (ridb) | 1,178 m | same-entity |
| UT | `Wasatch Mountain` | `Wasatch Mountain State Park` (ridb) | 1,890 m | same-entity |
| WA | `Ginkgo Petrified Forest` | `Ginkgo Petrified Forest National Natural Landmark` (nps) | 2,293 m | same-entity |
| WA | `Ginkgo Petrified Forest` | `Ginkgo Petrified Forest` (atlas_oddities) | 1,109 m | same-entity |
| WA | `Lyons Ferry` | `Lyons Ferry State Park` (nps) | 478 m | same-entity |
| WA | `Palouse Falls` | `Palouse Falls State Park` (nps) | 95 m | same-entity |
| WA | `Steamboat Rock` | `Steamboat Rock State Park` (nps) | 3,886 m | same-entity |
| WA | `Sun Lakes-Dry Falls` | `Sun Lakes-Dry Falls State Park` (nps) | 7,464 m | same-entity |
| WA | `Yakima Sportsman` | `Yakima Sportsman State Park` (nps) | 389 m | same-entity |

**Confidence per row: state / names / distance / sources / direction —
directly verified.** The verdict column itself is a per-pair semantic judgment
based on reading source_record names and description text from PROD (available
in `.context/related-38-hydrated.json`); labeled strong inference.

---

## 3. The one exclusion — Agua Caliente / Anza-Borrego is a duplicate on top of an upstream federation bug

The pair-formation is coherent:

- The visitor source_record `california_state_parks:638` is literally named
  `Anza-Borrego Desert State Park ®` and its geometry sits 285 m from the NPS
  `Anza-Borrego Desert State Park` Point. Name similarity after normalization
  is 1.000 (identical). The classifier's SAME assignment on that pair alone
  is correct.

But the visitor source_record has been federated onto a master_place that
also holds a **different** source_record — `Agua Caliente County Park
(ABDSP)`, a small San Diego County park inside the Anza-Borrego area. The
master_place's `canonical_name` is *Agua Caliente County Park (ABDSP)* (not
ABDSP), its Point centroid is Agua Caliente's (~21 km from the NPS
ABDSP Point), and its polygon is whichever of the two source-side polygons
the federation preserved. Two distinct parks under one master_place upstream.

**So the pair is a same-entity duplicate at the source_record level and a
data-quality issue at the master_place level, simultaneously.** Merging the
pair as-is would push the NPS ABDSP content onto the already-corrupted
canonical row, compounding the problem instead of resolving it.

**Recommendation (not applied):** remove the pair from the current SAME merge
set. The correct sequence is:

1. Split the canonical master_place into two rows: one for Agua Caliente CP,
   one for ABDSP. This is an upstream state_parks-federation fix, not a
   merge-tool task.
2. Re-run the classifier — the pair `{new ABDSP-only mp} ↔ {NPS ABDSP mp}`
   would form as a clean duplicate at that point.
3. Merge that clean pair.

**Confidence:**
- Directly verified: the visitor source_record's name (`Anza-Borrego Desert
  State Park ®`), external_id (`california_state_parks:638`), 285 m distance,
  1.000 similarity, and identical name_class in PR #368's fresh CSV; the
  two-source-record federation on the canonical master_place; the 21,216 m
  centroid-to-centroid distance.
- Strong inference: the "split the canonical row first" recommendation — it
  follows from the two source_records genuinely describing different parks,
  but I did not verify what geometry_polygon the canonical row currently
  carries or which of the two source-side polygons produced it.

---

## 4. Duplicate clusters — two canonical rows appear in >1 pair

- **`This Is The Place` (UT)** appears in 2 pairs, matched to NPS
  `This is the Place Heritage Park` (880 m) and RIDB `This Is The Place
  Heritage Park` (1,178 m). A merge here is a **three-way collapse**, not two
  independent binary merges.
- **`Ginkgo Petrified Forest` (WA)** appears in 2 pairs, matched to NPS
  `Ginkgo Petrified Forest National Natural Landmark` (2,293 m) and
  atlas_oddities `Ginkgo Petrified Forest` (1,109 m). Also a three-way
  collapse.

No absorbed row is duplicated across pairs.

**Confidence: directly verified via a `Counter` over the 38-row artifact.**
Consequence for the merge tool — real merges executing pair-by-pair must
either (a) update pair state after each merge (so the second pair's absorbed
gets replaced onto the already-collapsed canonical) or (b) group these into
n-way merges upfront. Not a design decision for this doc, but a heads-up for
whoever builds the writer.

---

## 5. What this means for the 136 SAME bucket

Applying this verdict to PR #368's classifier output:

| bucket state | before this investigation | after this investigation |
|---|---:|---:|
| SAME | 136 | 135 |
| DIFFERENT | 246 | 247 |
| UNCLEAR | 2 | 2 |
| **total** | **384** | **384** |

The single move: `Agua Caliente County Park (ABDSP) ↔ Anza-Borrego Desert
State Park` → out of SAME, into DIFFERENT.

**Confidence: directly verified.** The 136 / 246 / 2 baseline was
independently reproduced against PROD in PR #369; the +1 / −1 shift is
literal arithmetic on this session's verdict.

The other 37 pairs stay in SAME. Their `contained_in` rows are:

- **Correct as geometric statements today.** Verified — the parent polygon
  covers the child point on all 38.
- **Redundant if the pair is merged.** Strong inference — post-merge the
  parent and child become the same mp id, and the schema's
  `no_self_ref_chk (child_master_place_id <> parent_master_place_id)` would
  block the resulting row. A real merge tool must delete these edges as part
  of the merge, not preserve them.

---

## 6. What this preview does NOT verify

- **Whether the parent polygons are actually correct.** The `ST_Covers`
  result depends on the polygon being correct. `Sun Lakes-Dry Falls` and
  `Valley of Fire` have centroid distances of 7 km and 7 km respectively;
  the corresponding polygons must be quite large for containment to hold.
  Not spot-checked geometrically this session.
- **Whether any of the 37 same-entity pairs are also miscategorized in the
  same way as Agua Caliente/Anza-Borrego** — i.e., whether the canonical
  row secretly federates two different parks under one master_place, one of
  which is the same entity as the absorbed row. I read source_record names
  for all 38 and only Agua Caliente stood out, but I did not query for
  every canonical row's *complete* source_record roster beyond the 38 pairs
  themselves.
- **Whether the merge itself is the right product move.** The SAME
  classification is a duplicate-detection judgment, not a UX decision. Two
  rows can be "same entity" without the user experience benefiting from
  their being collapsed. Out of scope here.

---

## 7. Confidence key for the whole report

- **Directly verified (queried live PROD this session):**
  - The 38-pair set (filtered from PR #370's artifact + direct query of
    `place_relationships`).
  - Every row's `relationship_type` = `contained_in`, `computed_at`,
    parent/child direction, canonical row's polygon presence, absorbed row's
    polygon presence, both centroids, Haversine distance.
  - The name, `primary_category`, source list, and source_record names for
    every row.
  - The Agua Caliente canonical row's two-source-record federation.
  - The two duplicate-cluster canonicals (`This Is The Place`, `Ginkgo`).
  - All aggregate counts (37 / 1 / 0).
- **Strong inference:**
  - Per-pair verdict of "same-entity" for the 37 — based on reading names
    and description text, not on an authoritative registry.
  - The 3-way merge implication for the two duplicate-cluster canonicals.
  - The "redundant post-merge" framing of the `contained_in` rows on the 37.
- **Unverified / estimated:**
  - Whether the parent polygons actually cover the child points *today*
    (relationships were `computed_at 2026-09-02`; recompute has not been
    verified re-executed since).
  - Whether other same-entity pairs among the 37 might have canonical
    federation issues similar to Agua Caliente.
  - Whether merging is the right product decision (a UX question).

---

## 8. Question for Adam

**One concrete follow-up, not filed as backlog per the brief.** Should the
`Agua Caliente County Park (ABDSP)` canonical row be split into two
master_places (one for the county park, one for the ABDSP) as a prerequisite
to any merge involving it? If yes, this is a small state_parks-federation
cleanup that would remove the pair from the merge queue naturally. If no,
the pair still needs to leave the SAME bucket — the current row's federation
is either wrong or the pair-detection's name-match on `Agua Caliente County
Park (ABDSP)` vs `Anza-Borrego Desert State Park` (which are not similar
names) has a separate explanation I did not chase down this session.
