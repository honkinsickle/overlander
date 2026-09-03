# Merge preview v2 — n-way cluster handling + Agua Caliente exclusion

**Date:** 2026-09-03 · **Status:** dry-run preview only. Read-only. No writes
to either database. No merge executed.
**Tool (this PR):** `data/scripts/merge-preview-same-pairs.ts` — supersedes
the v1 tool in PR #370.
**Companion:** the Agua Caliente federation-bug plan, §5 of this doc.

**Related PRs (all still open at time of writing):** #368 · #369 · #370 ·
#372. This PR is cut from `main` and does not depend on any of them; it
reads PR #370's on-disk `.context/same-pairs-resolved.json` artifact and PR
#372's Agua Caliente exclusion mp-id pair as constants in the tool.

---

## 0. What changed vs v1 (PR #370)

- **Excludes the Agua Caliente / NPS Anza-Borrego pair by default.** PR #372's
  verdict placed that pair in DIFFERENT because the canonical master_place is
  a corrupted state_parks federation. Overridable with
  `--include-agua-caliente`.
- **N-way cluster detection via union-find.** Any master_place that appears
  in more than one pair collapses into a single merge group with all
  members. The tool emits per-group output alongside the per-pair output.
- **Score-based group canonical picker.** For each group, every member is
  scored by `state_parks`-GIS presence + untagged-GIS-home bonus + source
  count; the top scorer wins. Ties are flagged as unresolvable (rather than
  guessed). This replaces v1's implicit "run the pair rule pairwise" logic,
  which had a bug: for a group `{A, B, C}` where `A` and `B` compared as
  "either" but `C` was clearly canonical, v1 would return "unresolvable"
  because the first pairwise comparison short-circuited. **Group 78 (`Fort
  Rock State Natural Area`) exposed this; v1 returned undecidable, v2
  correctly picks the state_parks-GIS-backed third member.**
- **Set size shift:** v1 processed 136 pairs. v2 processes **135** pairs
  after the Agua Caliente exclusion. See §1 for the accounting.

## 1. Set size accounting

Input file `.context/same-pairs-resolved.json` was written before PR #372's
verdict, so it still holds **136 SAME-bucket pairs** as classified by the
original sort.

Under PR #372:

- **1 pair excluded** — Agua Caliente County Park (ABDSP) ↔ NPS Anza-Borrego
  Desert State Park. Not mergeable until the upstream federation bug is
  fixed (see §5).

**Actively-processed set: 135 pairs.**

The user's prompt mentioned "134 or 135 depending on whether Part 1's fix
resolves Agua Caliente back into a normal mergeable pair — state clearly
which." **This session did not execute the Agua Caliente fix (see §5 for
why), so the tool processes 135 pairs** and Agua Caliente is a persistent
exclusion. If a future session executes the fix and re-runs PR #368's
classifier, the pair would either disappear entirely (Agua Caliente CP mp
no longer has a visitor SR pointing at it) or re-form as a clean
`{new ABDSP mp} ↔ {NPS ABDSP mp}` pair depending on how the split is done.

**Confidence: directly verified.** The 135 count is the tool's post-filter
`processing N pair(s)` log line this session.

## 2. Per-pair results (backward-compatible v1 output)

| canonical side | pairs |
|---|---:|
| `other` | 63 |
| `visitor` | 59 |
| `either` | 13 |

Compared to v1's 63 / 60 / 13: exactly the drop of 1 `visitor` pair
attributable to the Agua Caliente exclusion (v1's Agua Caliente pair had
`canonical_side = visitor` because the visitor's master_place carries
`state_parks`, ignoring the fact that it's a corrupt federation).

- Pairs with any field conflict: 122
- Pairs with any risk flag: 135

**Confidence: directly verified** — every count above is the tool's output
against fresh PROD data this session.

## 3. N-way merge groups

Union-find over all mp-ids surfaced in the 135 pairs consolidates into
**123 groups**:

| group size | count |
|---:|---:|
| 2 | 113 |
| 3 | 9 |
| 4 | 1 |

**12 pairs consolidated into 10 n-way clusters (size > 2).** Two were named
in the ask; **eight more were surfaced** by this scan. Full list, computed
this session:

| group | size | state | canonical (winner) | reason |
|---:|---:|---|---|---|
| 12 | 3 | CA | `Pigeon Point Light Station SHP` (state_parks) | state_parks GIS wins |
| 39 | 3 | CA | `Empire Mine SHP` (state_parks+wikipedia) | state_parks GIS wins |
| 51 | 3 | CA | `California Citrus SHP` (state_parks) | state_parks GIS wins |
| 55 | 3 | WA | `Ginkgo Petrified Forest` (state_parks+washington_state_parks) | state_parks GIS wins (also visitor-tagged) — was named in the ask |
| 57 | 3 | WA | `Palouse Falls` (state_parks+washington_state_parks+wikipedia) | state_parks GIS wins (also visitor-tagged) |
| 78 | 3 | OR | `Fort Rock State Natural Area` (oregon_state_parks+state_parks+wikipedia) | state_parks GIS wins (v1 got this wrong; see §0) |
| 83 | 3 | OR | **undecidable** — `Hat Rock State Park` × 2 + `Hat Rock` | 3 members tie at score 1 — no member has state_parks |
| 89 | 4 | NV | `Fort Churchill State Park` (state_parks+wikipedia) | state_parks GIS wins (untagged home) — 4-way cluster |
| 98 | 3 | UT | `This Is The Place` (state_parks+utah_state_parks+wikipedia) | state_parks GIS wins (also visitor-tagged) — was named in the ask |
| 107 | 3 | UT | `Coral Pink Sand Dunes` (state_parks+utah_state_parks+wikipedia) | state_parks GIS wins (also visitor-tagged) |

**Consequence for a real merge tool:** these 10 groups must be processed as
n-way merges (all N-1 absorbed members repointed onto the canonical in one
transaction, then recompute the canonical once), or as chained 2-way merges
with in-flight state updates so the second pair's absorbed mp gets replaced
onto the already-collapsed canonical. Processing them as independent 2-way
merges would either double-repoint records or produce dangling references.

**Confidence:**
- **Directly verified**: the 123 total groups, the 10 n-way clusters, each
  cluster's members and source lists, the winner per group (except group
  83), the size distribution, the pair-to-group consolidation count (12
  pairs).
- **Strong inference**: the group-83 tie truly needs manual review — the
  score-based ranking is deterministic, but I did not read the descriptions
  of each `Hat Rock` variant to confirm the ranking's outcome matches
  intent.

## 4. Undecidable groups (need manual canonical decision)

**8 groups**, decomposed by size:

- **7 size-2 groups** — these are the classic `either` pair cases from
  prior investigations. Examples: `Old Town San Diego State Historic Park`
  (visitor vs NPS), `Salton Sea State Recreation Area` (visitor vs
  atlas_oddities), `Face Rock State Scenic Viewpoint` (visitor vs
  atlas_oddities). None has a `state_parks`-backed side; the rule falls
  through.
- **1 size-3 group** — group 83 (`Hat Rock` × 3, OR): all three members
  lack `state_parks` and each has source_count=1, so all three tie at
  score 1.

**Confidence: directly verified** — the 8 count and per-group membership
came from the tool's output this session. The reason "no member has
state_parks" is inspected from the same JSON.

## 5. Agua Caliente federation bug — investigation and scoped plan (Part 1)

Investigated fully but NOT executed. See §5.4 for the go/no-go reasoning.

### 5.1 Confirmed root cause: `dissolveBoundaries` grouping by shared `UNITNBR`

The canonical master_place at issue is `9cf912c6-10c8-4af2-bada-499abcdeb2d7`
(`Agua Caliente County Park (ABDSP)`, category `recreation_area`,
`source_count = 2`). It carries two `source_record`s (verified via PROD
query this session):

1. **`state_parks:CA:park:622`** — `Agua Caliente County Park (ABDSP)`,
   linked deterministically at CA state_parks ingest (2026-08-21).
2. **`california_state_parks:638`** — `Anza-Borrego Desert State Park ®`,
   linked via `spatial_containment` (method) by
   `auto:california_state_parks_er` at 2026-09-02T16:49:15Z. Confidence
   1.0, name_similarity 0, distance 0 (i.e. inside the polygon).

Under `data/ingestion/sources/state-parks.ts` line 208 the CA slice groups
features by `UNITNBR`. This state_parks GIS record has `UNITNBR = "622"`
AND `provenance.dissolved_from = ["009fc1a3-…", "2c30a104-…"]` — meaning
CA DPR's own source data had **two features sharing UNITNBR = 622** and
the ingest's `dissolveBoundaries` combined their polygons under whichever
`props` came first (Agua Caliente County Park's).

Verified this session by fetching the record's `normalized_payload.geometry_polygon`
and running point-in-polygon in Python:

- Polygon type: MultiPolygon with **250 parts**
- Bounding box: **63 km × 102 km** (all of the Anza-Borrego region)
- All three test points inside the polygon:
  - Visitor SR Point (~ABDSP center): inside ✓
  - NPS Anza-Borrego Point centroid: inside ✓
  - Agua Caliente canonical mp centroid: inside ✓

So the polygon labeled "Agua Caliente County Park (ABDSP)" is a superset
that spans all of Anza-Borrego, which is why `spatial_containment` fired
for the CA visitor SR whose Point sits at ABDSP center. `chooseContaining`
(the fix in `data/scripts/lib/spatial-prelink.ts` for the overlapping-polygons
case) name-scored `california_state_parks:638`'s
`"Anza-Borrego Desert State Park"` against every containing candidate; the
combined `Agua Caliente County Park (ABDSP)` polygon was one of them and
the `"ABDSP"` substring in its name likely boosted its Jaro-Winkler score
enough to win the tiebreaker.

Neither of those pieces is broken in isolation. **The upstream data quality
issue is that CA DPR's ParkBoundaries source has two distinct features
sharing a UNITNBR value, and the ingest's group-by-UNITNBR dissolve
doesn't detect the divergence.** Named for future work.

### 5.2 Correct target mp for the visitor SR

There is already a master_place representing NPS's Anza-Borrego, verified
this session: `2e118c6f-aad5-43ad-926b-5bb0f04626dc`, `canonical_name`
`Anza-Borrego Desert State Park`, category `park_feature`, `source_count = 1`,
`is_searchable = true`, no polygon. The visitor SR's ABDSP content belongs
here.

### 5.3 The scoped plan (not executed)

A minimal-blast-radius fix:

1. `UPDATE source_record SET master_place_id = '2e118c6f-…' WHERE id = 'e20b90aa-…'`
2. `UPDATE place_match SET master_place_id = '2e118c6f-…', match_method = 'manual_correction', notes = 'reversed spatial_containment miss on shared UNITNBR=622 polygon' WHERE source_record_id = 'e20b90aa-…'` — or delete-and-reinsert with the same semantics.
3. `SELECT recompute_master_place('9cf912c6-…')` — restores the Agua Caliente CP mp to state_parks-only fields (description/hours/contact/amenities revert; canonical_name/geometry_polygon retained since they were already `state_parks`).
4. `SELECT recompute_master_place('2e118c6f-…')` — adds the visitor content to the NPS Anza-Borrego mp; `source_count` → 2; description/hours/amenities/etc. get resolved via `field_precedence`.
5. Verify: query both mps' `canonical_name`, `source_count`, `is_searchable`.

The pair-generation would then produce a different SAME pair on the next
classifier run: `{NPS Anza-Borrego mp with CA visitor content, source_count = 2}` no longer needs a peer to duplicate against. It becomes just a fully-merged mp.

**This does NOT fix the underlying state_parks federation bug.** The
"Agua Caliente County Park (ABDSP)" master_place would still hold the
oversized polygon covering all of Anza-Borrego. Any FUTURE ingest that
runs spatial_containment against CA state_parks polygons on a point inside
Anza-Borrego would hit the same trap.

### 5.4 Why I did not execute

Applying the brief's "small, clearly-scoped, low-risk change" test:

- **Small: yes.** 2 UPDATEs + 2 RPCs.
- **Clearly-scoped: mostly yes**, but with an ambiguity on step 2 — whether
  to update the `place_match` row in place or delete-and-reinsert to
  preserve a clean audit trail is a policy call I haven't seen precedent
  for.
- **Low-risk: NO, on reflection.** Three reasons:
  1. **First PROD write of this thread.** The user's standing pattern has
     been read-only across the entire series (PRs #368–#372). A PROD
     write on a data-quality issue this deep deserves explicit sign-off
     rather than my judgment.
  2. **Fixes a symptom, not the root cause.** The upstream `UNITNBR`
     dissolve bug remains. A merge tool that then processes the corrected
     Anza-Borrego mp doesn't help until the state_parks record itself is
     split or excluded.
  3. **The `field_precedence` outcome for the merged NPS Anza-Borrego mp
     is unverified.** If NPS holds any field where visitor takes
     precedence in the table, the merged mp's canonical_name might flip
     from `"Anza-Borrego Desert State Park"` to `"Anza-Borrego Desert
     State Park ®"` (with the ® symbol) — I did not verify this session.

So per the brief: "if it's ambiguous or risky, stop and report the scoped
plan instead of guessing at execution." Stopped.

**Confidence:**
- **Directly verified**: the two SRs on the canonical mp, the
  spatial_containment `place_match` row, the polygon's 250-part MultiPolygon
  and its bounding box, the three point-in-polygon tests, the ingest logic
  in `data/ingestion/sources/state-parks.ts:208`, the existence of the NPS
  Anza-Borrego mp with source_count 1.
- **Strong inference**: the "shared UNITNBR = 622" origin (`dissolved_from`
  lists two GlobalIDs, and CA DPR's data-shape suggests two features
  sharing UNITNBR is possible; not directly verified from the CA DPR source
  itself this session).
- **Unverified / estimated**: what `field_precedence` would do to the
  merged NPS mp's canonical_name; whether other CA state_parks records
  have similarly bogus multi-feature dissolves; whether the
  `chooseContaining` name-score reasoning above is exactly what fired
  (plausible from reading the code, not traced).

## 6. What this preview does NOT do

- Execute or simulate any merge. Every query is a SELECT.
- Re-run PR #368's classifier. This tool trusts the artifact from that PR
  plus PR #372's exclusion.
- Verify that `recompute_master_place()` would produce the field values
  the merge intends. Would require a recompute simulator (out of scope).
- Modify the schema. `place_relationships.no_self_ref_chk` still requires
  the merge write path to delete any parent/child edges between merging
  rows before completing the merge; that responsibility falls to whichever
  script eventually executes.
- Attempt the Agua Caliente fix. Investigation + plan only. See §5.4.

## 7. Confidence key for the whole report

Following the same convention as PR #370, PR #372, PR #369:

- **Directly verified (queried live PROD or ran the tool this session):**
  §1 set-size accounting; §2 canonical-side distribution; §3 group count
  and cluster list; §4 undecidable count and membership; §5.1 root-cause
  details (SRs, place_match, polygon shape, PIP tests); §5.2 NPS
  Anza-Borrego mp existence.
- **Strong inference:** §5.1 shared-UNITNBR mechanism (from `dissolved_from`
  plus ingest code); §5.3 the plan's step-by-step effects (from reading
  `recompute_master_place` behavior in migrations, not from a live
  execution).
- **Unverified / estimated:** all future-tense claims about what a real
  merge would produce; whether `Hat Rock` group 83's tie is truly
  irresolvable at the pair level or whether extra manual context would
  break it; whether other same-UNITNBR dissolves exist in CA state_parks;
  the `chooseContaining` traceback reasoning for the Agua Caliente pair.

## 8. Question for Adam

Passing up, not filed as backlog — same convention as PRs #369 and #372.

**§5.3's plan for the visitor SR repoint is a self-contained, reversible
2-UPDATE + 2-RPC operation. Do you want me to execute it in a follow-up
PR, or does the underlying state_parks federation bug need to be resolved
first?** Executing it now clears the pair from any future merge queue but
leaves the CA state_parks GIS record with the oversized polygon — a
persistent trap for future ingests.
