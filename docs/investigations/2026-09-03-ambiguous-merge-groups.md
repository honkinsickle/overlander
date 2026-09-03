# The 8 ambiguous merge groups — trade-offs and suggested tiebreakers

**Date:** 2026-09-03 · **Status:** report only. Read-only. Zero writes to
either database. No modifications to the merge preview tool.
**Follow-up to:** PR #374 (merge preview v2 with n-way cluster detection)
and PR #375 (UNITNBR root-cause fix that removed the Agua Caliente pair
from the classifier's output entirely).

**Scope:** the merge preview tool's score-based canonical picker leaves
**8 of 123 groups undecidable** — 7 pair-shaped, 1 three-way (Hat Rock).
This doc surfaces each for manual decision. It does not resolve them
algorithmically and it does not modify the tool.

**Header data measured this session (fresh PROD, post-#375 fix):** total
pairs 426; pre-existing 383; SAME 135 · DIFFERENT 246 · UNCLEAR 2; **123
merge groups, of which 8 have no auto-picked canonical.**

---

## 0. Read this section first — what "ambiguous" means here

Under the tool's score-based rule (`data/scripts/merge-preview-same-pairs.ts`,
`scoreMember`):

```
score = 100 · has(state_parks)  +  10 · (has(state_parks) ∧ ¬has(visitor_source))  +  source_ids.length
```

Every member in these 8 groups scores **exactly 1** (source_count = 1
from a single source, no `state_parks` GIS backing). The picker ties and
returns `canonical = null` rather than guessing.

**None of these groups have `state_parks` on either side.** That's the
whole reason they're ambiguous — the canonical rule keys on GIS backing
and can't fall through here. Documented in each group's "why ambiguous"
line below.

**One structural observation applies to every group:** if a merge is
executed, `recompute_master_place()` re-resolves every field from the
union of source_records via `field_precedence`. So the choice of
which mp_id survives affects **identity** (which UUID persists downstream,
which `place_match` rows survive the cascade) but does *not* directly
choose the merged row's `description` or `canonical_name` — those get
re-derived. Whichever mp_id wins, both sources' content gets combined.

**Suggestions below are labeled as such.** They apply structural
observations (description length, presence of a photo, prominence, source
authority) but are not automatic resolutions. Adam picks.

**Confidence: directly verified.** Each field value below was pulled from
PROD this session.

---

## 1. Group 3 — Old Town San Diego SHP (CA)

Two mps for the same physical park, one from CA's visitor content, one
from NPS.

| field | `9445b700-…` — CA visitor | `189782bc-…` — NPS |
|---|---|---|
| `canonical_name` | Old Town San Diego State Historic Park | Old Town San Diego State Historic Park |
| `primary_category` | `historic` | `park_feature` |
| Sources | `california_state_parks` | `nps` |
| Description length | **214 chars** | **3499 chars** |
| Photo | none | ✓ |
| Hours | ✓ | none |
| Contact | ✓ | ✓ |
| Prominence | 2 | **5** |
| Polygon | none | none |
| `updated_at` | 2026-09-02 | 2026-08-26 |

**Trade-off in plain terms:** NPS carries a substantially fuller
description and a photo; the visitor row carries hours the NPS row lacks.
Both categories are defensible for a historic park (`historic` vs
`park_feature`).

**Why ambiguous:** neither side has `state_parks` GIS backing. Both
score 1.

**Suggested tiebreaker (label: suggestion, not resolution): pick NPS.**
Reasoning — 16× longer description, has a photo, higher `prominence_score`
(5 vs 2). After merge, `field_precedence` should preserve the visitor
row's hours if that field's precedence ranks `california_state_parks`
above `nps` (this doc did **not** verify the precedence table — flag as
strong inference).

## 2. Group 6 — Salton Sea SRA vs "Salton Sea" (CA)

Same locality, different scope. The CA visitor row is about the
**recreation area** on the sea; the atlas_oddities row is about the
**geographic sea itself**.

| field | `02106f71-…` — CA visitor | `79c97694-…` — atlas |
|---|---|---|
| `canonical_name` | Salton Sea State Recreation Area | Salton Sea |
| `primary_category` | `recreation_area` | `oddity` |
| Sources | `california_state_parks` | `atlas_oddities` |
| Description length | 2404 chars | 2391 chars |
| Photo | none | ✓ |
| Hours | ✓ | none |
| Contact | ✓ | none |
| Polygon | none | none |

**Trade-off in plain terms:** name and scope suggest these describe
different-scale things (a park unit vs a lake basin). Descriptions are
similar length. The atlas row has the photo; the visitor row has the
hours/contact for the SRA.

**Why ambiguous:** neither has `state_parks` GIS backing, and neither
side is obviously "the same entity" — the SRA is a defined park unit; the
sea is a much larger geographic feature.

**Open decision, not a merge:** is this really SAME-bucket in the first
place? The classifier admitted them (name-similarity plus
common-locality) but they're arguably not duplicates — analogous to the
`Torrey Pines State Beach` ↔ `Torrey Pines State Natural Reserve`
DIFFERENT pattern from prior work. **Suggestion: move to DIFFERENT
bucket rather than picking a merge winner.** Confidence: strong
inference from the naming pattern; not verified against prior sort's
DIFFERENT rules.

## 3. Group 79 — Darlingtonia SNS (OR)

Two mps for the same rare-plant preserve.

| field | `acfeeefe-…` — OR visitor | `cb880d19-…` — atlas |
|---|---|---|
| `canonical_name` | Darlingtonia State Natural Site | Darlingtonia State Natural Site |
| `primary_category` | `public_land` | `oddity` |
| Sources | `oregon_state_parks` | `atlas_oddities` |
| Description length | **2329 chars** | 1533 chars |
| Photo | none | ✓ |
| Hours | none | none |
| Contact | none | none |
| Prominence | 2 | 2 |

**Trade-off in plain terms:** identical names. Visitor row has ~50%
more description content; atlas row has the photo. Category disagreement
(`public_land` vs `oddity`).

**Why ambiguous:** neither has state_parks GIS backing.

**Suggested tiebreaker (suggestion): pick the OR visitor row.**
Reasoning — longer description, and `public_land` is a better category
for a state-run preserve than `oddity`. After merge, the atlas row's
photo should carry forward via `field_precedence`.

## 4. Group 81 — Farewell Bend SRA (OR)

Same park unit represented on both sides.

| field | `6bad17a6-…` — OR visitor | `2ed2e12c-…` — NPS |
|---|---|---|
| `canonical_name` | Farewell Bend State Recreation Area | Farewell Bend State Recreation Area |
| `primary_category` | `recreation_area` | `park_feature` |
| Sources | `oregon_state_parks` | `nps` |
| Description length | **2663 chars** | 1281 chars |
| Photo | none | ✓ |
| Hours | none | none |
| Contact | none | ✓ |
| Prominence | 2 | **5** |

**Trade-off in plain terms:** identical names. Visitor description is
about 2× the NPS description; NPS has the photo and higher prominence.

**Why ambiguous:** neither has state_parks GIS backing.

**Suggested tiebreaker (suggestion): pick NPS.** Reasoning — NPS carries
the photo and has higher prominence, both of which drive user-facing
value. Visitor's longer description gets combined at recompute time via
`field_precedence` (assuming the visitor source outranks NPS for
description — unverified this session).

## 5. Group 83 — Hat Rock (OR) — 3-way

Three mps for the same park. **Notable: two of them are from NPS**
(one with "State Park" suffix, one bare) — likely a duplicate on the NPS
side that the corpus never deduplicated.

| field | `d7ebf7be-…` — OR visitor | `0f13a10f-…` — NPS "State Park" | `971799f0-…` — NPS "Hat Rock" |
|---|---|---|---|
| `canonical_name` | Hat Rock State Park | Hat Rock State Park | Hat Rock |
| `primary_category` | `park` | `park_feature` | `park_feature` |
| Sources | `oregon_state_parks` | `nps` | `nps` |
| Description length | **2161 chars** | 1125 chars | 1744 chars |
| Photo | none | ✓ | ✓ |
| Hours | none | none | none |
| Contact | none | ✓ | ✓ |
| Prominence | 2 | **5** | **5** |

**Trade-off in plain terms:** three-way merge. The two NPS entries are
almost certainly a duplicate on the NPS side of the corpus (both
`park_feature`, both `source_count = 1`, one uses the suffix, one
doesn't). The visitor row has the longest description; the NPS entries
carry photos.

**Why ambiguous:** none has state_parks GIS backing, and the two
NPS entries tie perfectly.

**Suggested tiebreaker (suggestion): merge as a 3-way to the OR visitor
row.** Reasoning — visitor has the fullest description, and the two NPS
duplicates should be collapsed regardless (they're both about Hat Rock).
The `nps` source's contribution (photos, contact) gets picked up at
recompute time via `field_precedence`.

**Alternative suggestion (only if a 3-way merge tool isn't ready): merge
the two NPS entries first, THEN pair-merge with the visitor row.** Two
2-way merges instead of one 3-way.

## 6. Group 95 — Tubac Presidio SHP (AZ)

Same park unit represented on both sides.

| field | `1960c448-…` — AZ visitor | `332c61c4-…` — NPS |
|---|---|---|
| `canonical_name` | Tubac Presidio State Historic Park | Tubac Presidio State Historic Park |
| `primary_category` | `historic` | `park_feature` |
| Sources | `arizona_state_parks` | `nps` |
| Description length | 1406 chars | **1628 chars** |
| Photo | none | ✓ |
| Hours | ✓ | none |
| Contact | ✓ | ✓ |
| Prominence | 2 | **5** |

**Trade-off in plain terms:** identical names. NPS has a slightly
longer description, the photo, and higher prominence; visitor has hours.

**Why ambiguous:** neither has state_parks GIS backing.

**Suggested tiebreaker (suggestion): pick NPS.** Reasoning — photo,
higher prominence, longer description. Same shape as Group 3 (Old Town
San Diego SHP) — those are structurally similar cases.

## 7. Group 120 — Sumpter Valley Dredge (OR)

Same physical dredge; the SHA is centred on it.

| field | `f85a6b84-…` — OR visitor | `22e2f773-…` — atlas |
|---|---|---|
| `canonical_name` | Sumpter Valley Dredge State Heritage Area | Sumpter Valley Gold Dredge |
| `primary_category` | `historic` | `oddity` |
| Sources | `oregon_state_parks` | `atlas_oddities` |
| Description length | **3418 chars** | 1314 chars |
| Photo | none | ✓ |
| Hours | none | none |
| Contact | none | none |
| Prominence | 2 | 2 |

**Trade-off in plain terms:** names differ slightly (`SHA` vs
`Gold Dredge`), but the SHA is *literally* built around this dredge.
PR #372 §2 already flagged this as a same-entity case in its verdict
table. Visitor description is 2.6× longer; atlas has the photo.

**Why ambiguous:** neither has state_parks GIS backing.

**Suggested tiebreaker (suggestion): pick the OR visitor row.**
Reasoning — substantially longer description, and the SHA name is the
official state designation. Atlas's photo carries forward at recompute.

## 8. Group 121 — Face Rock (OR)

Same physical rock; the viewpoint is a lookout onto it.

| field | `4119c926-…` — OR visitor | `3b75eb01-…` — atlas |
|---|---|---|
| `canonical_name` | Face Rock State Scenic Viewpoint | Face Rock |
| `primary_category` | `viewpoint` | `oddity` |
| Sources | `oregon_state_parks` | `atlas_oddities` |
| Description length | **3976 chars** | 833 chars |
| Photo | none | ✓ |
| Hours | none | none |
| Contact | none | none |
| Prominence | 2 | 2 |

**Trade-off in plain terms:** names differ (`State Scenic Viewpoint`
vs bare `Face Rock`), but PR #372 §2 flagged this as a same-entity case.
Visitor description is nearly 5× longer; atlas has the photo.

**Why ambiguous:** neither has state_parks GIS backing.

**Suggested tiebreaker (suggestion): pick the OR visitor row.**
Reasoning — much longer description, and `viewpoint` is the more
specific category. Atlas photo carries forward at recompute.

---

## 9. Cross-group patterns

- **6 of 8 groups pit an OR/AZ/CA visitor row against a single external
  catalog record (NPS or atlas_oddities).** The visitor rows consistently
  have longer descriptions; the external-catalog rows consistently have
  photos and (for NPS) higher `prominence_score`. If a general
  tiebreaker were adopted, "longer description" is one dimension;
  "presence of photo" is another. Neither strictly dominates.
- **Group 3 (Old Town) is the exception**: NPS has both a photo AND a
  much longer description than the visitor row. No trade-off — NPS wins
  on both.
- **Group 6 (Salton Sea) is arguably not SAME at all.** Suggested action
  is bucket-move to DIFFERENT rather than merge.
- **Group 83 (Hat Rock) is a 3-way with an intra-NPS duplicate.** Any
  fix needs to either handle 3-way merges directly or collapse the two
  NPS entries first.

**Confidence:** patterns above are strong inference from the group-level
counts, not from a corpus-wide sweep.

---

## 10. What this doc does NOT do

- Modify `data/scripts/merge-preview-same-pairs.ts`. The tool still
  reports these 8 as undecidable.
- Change the classifier's SAME assignments. Group 6 stays SAME per the
  classifier even though §2 suggests it belongs in DIFFERENT.
- Write anything to PROD or TEST.
- Verify the `field_precedence` behavior claimed in the "recompute
  re-derives" framing. That table wasn't inspected this session.

---

## 11. Confidence key

- **Directly verified (queried live PROD this session):** every count in
  §0's header, every field value in the group tables, the "8 of 123
  groups undecidable" figure, the merge preview tool's rule from its own
  source.
- **Strong inference:** every "suggested tiebreaker" line — grounded in
  the visible fields but assuming `field_precedence` behaves as
  described; the Group 6 "move to DIFFERENT" recommendation from prior
  bucket-shape analogues; the Group 83 "3-way with intra-NPS duplicate"
  characterization.
- **Unverified / estimated:** whether an executed merge with each
  suggested winner would actually produce the desired canonical output
  (would need to inspect `field_precedence` and run a recompute
  simulation); whether other CA/OR visitor-catalog pairs currently in
  SAME with confident canonicals were "close calls" the tool could
  have gotten wrong.

---

## 12. Open decisions for Adam (summary)

| group | state | shape | suggested tiebreaker (label: suggestion) | notes |
|---|---|---|---|---|
| 3 | CA | pair | NPS wins | NPS dominates on desc + photo + prominence |
| 6 | CA | pair | **Move to DIFFERENT** | Not the same entity — SRA on the sea vs the sea itself |
| 79 | OR | pair | OR visitor wins | Longer desc + better category (`public_land` > `oddity`) |
| 81 | OR | pair | NPS wins | Photo + prominence |
| 83 | OR | 3-way | OR visitor wins | Or: collapse the 2 NPS entries first, then pair-merge |
| 95 | AZ | pair | NPS wins | Photo + prominence + slightly longer desc |
| 120 | OR | pair | OR visitor wins | Much longer desc; SHA is the official designation |
| 121 | OR | pair | OR visitor wins | Much longer desc + specific `viewpoint` category |

**Directly-verified counts:** 8 groups total; 7 pairs; 1 three-way; 4
"visitor wins" suggestions; 3 "NPS wins" suggestions; 1 "move to
DIFFERENT" suggestion.
