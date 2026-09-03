# Merge preview — the 136 SAME-bucket duplicate pairs

**Date:** 2026-09-03 · **Status:** dry-run preview only. Read-only. No writes to
either database. No merge executed.
**Tool:** `data/scripts/merge-preview-same-pairs.ts` (this PR).
**Input:** `.context/same-pairs-resolved.json` (gitignored) — 136 SAME-bucket
pairs from `.context/prod-pairs-bucketed-fresh.json` produced by the sort script
in PR #368/#369, with 8-character mp-id prefixes resolved to full UUIDs via a
one-shot query of all 28,506 PROD master_place ids (measured in this session,
zero prefix collisions).
**Output:** `.context/merge-preview-136.csv` + `.context/merge-preview-136.json`.

**Related work (both still open at time of writing):** PR #368 (the parent
cross-source-duplicate investigation) and PR #369 (its verification pass). This
PR is cut from `main` and does not depend on either; running the tool against
live PROD reproduced the same 136 SAME pairs and their canonical assignments
those PRs described.

---

## 0. What the tool does (and does not do)

For each pair the tool:

1. Hydrates both master_place rows (all columns), plus active `source_record`s
   pointing at each side, `place_match` row counts, generated-content and
   photo-candidate counts, and both directions of `place_relationships` edges.
2. Applies the canonical-side rule established by the parent investigation:
   the row backed by `state_parks` (the CA/OR/etc. DPR GIS source) wins; if
   both or neither is GIS-backed, applies the tiebreakers from the sort's
   §3 canonical table; anything the rule can't decide is flagged `either`.
3. Enumerates what a real merge would need to move — how many `source_record`s
   to repoint, how many `place_match` rows would cascade, how many
   `master_place_generated_content` and `master_place_photo_candidate` rows to
   move, and how many `place_relationships` edges to rewrite.
4. Diffs the two rows field-by-field, flagging where both non-null values
   disagree.
5. Emits per-pair risk flags for anything a human should look at before
   executing.

**It does NOT:**

- Execute any merge. Every query is a SELECT. The tool refuses any argument
  matching `--apply|--write|--execute|--commit|--run|--do`.
- Independently re-verify the SAME-bucket classification. It trusts the input
  file's bucket assignments. If a manual override in the classifier was wrong,
  this tool inherits that wrongness.
- Decide the 13 `either` cases. They are flagged and passed through with
  `canonical_mp_id = null`.

---

## 1. Canonical-side results across the 136 pairs

Counts, computed by the tool this session:

| canonical side | pairs |
|---|---:|
| `other` (state_parks GIS row wins) | **63** |
| `visitor` (state-parks-content row wins) | **60** |
| `either` (rule cannot decide; needs manual call) | **13** |

Reason breakdown (from the tool's `canonical_reason` field):

| reason | pairs |
|---|---:|
| other side has `state_parks` GIS record; visitor does not | 61 |
| visitor side has `state_parks` GIS record; other does not | 59 |
| neither has `state_parks` and equal sources; needs manual call | 13 |
| both GIS-backed; other is the untagged GIS home | 2 |
| neither has `state_parks`; visitor has more sources | 1 |

By state:

| state | visitor | other | either | total |
|---|---:|---:|---:|---:|
| CA | 12 | 45 | 5 | 62 |
| WA | 10 | 14 | 0 | 24 |
| OR | 9 | 3 | 7 | 19 |
| NV | 7 | 1 | 0 | 8 |
| AZ | 8 | 0 | 1 | 9 |
| UT | 14 | 0 | 0 | 14 |
| **total** | **60** | **63** | **13** | **136** |

**Confidence: directly verified.** Every count above is the tool's output on
fresh PROD data this session.

The state-level split matches the pattern the parent investigation described
(CA / WA have deep pre-existing `state_parks` GIS coverage so most pairs
collapse *onto* the GIS row; UT / AZ / NV visitor rows already carry
`state_parks` GIS backing themselves and pull in the external-catalog twin).
No new pattern surfaced.

---

## 2. What would move — per-pair inventory

Distribution of `source_record` count on the absorbed side (excluding the 13
`either` cases):

| absorbed active source_records | pairs |
|---:|---:|
| 1 | 121 |
| 2 | 2 |

So **>98% of merges (in the decidable set) move exactly one source_record**.
Corpus-wide that's a repoint operation for ~125 source_records total across
the 123 decidable pairs (and 0 changes for the 13 `either` cases in this
preview).

Distribution of `place_match` rows attached to the absorbed side (would drop
via CASCADE if the absorbed row were deleted; a merge that leaves the row
around at `source_count=0` doesn't hit this, but a real cleanup pass would):

| absorbed place_match rows | pairs |
|---:|---:|
| 1 | 120 |
| 2 | 3 |

Generated-content and photo-candidate moves — this preview measured **0
`master_place_generated_content` rows** and **0 `master_place_photo_candidate`
rows** attached to the 136 pairs on either side (verified via `count=exact`
head queries in the hydrator). Neither table is populated at scale on PROD
for these pairs, so a real merge would have no rows to move from them today.
That may change as those tables get populated in other work.

**Confidence: directly verified.**

---

## 3. `place_relationships` — 57 pairs involve existing edges, 38 are already linked to each other

The tool found:

- **19 pairs** where the absorbed row has `place_relationships` edges to
  *other* rows that would need rewriting to point at the canonical row.
- **38 pairs** where the absorbed row is *already linked to the canonical
  row itself* via `place_relationships`. Direction spot-checked on 6 pairs:
  every one had canonical row as the PARENT (the SHP / SP / SRA) and the
  absorbed row as the CHILD (the atlas_oddities landmark, the NPS
  park_feature, or the shorter-name variant).

Total pairs touching `place_relationships`: **57**.

The 38 already-linked cases are a **design tension**, not a bug. The schema
was set up to model *"same-locality distinct-row"* as a containment
relationship (SHP contains its eponymous landmark; SP contains its natural
feature) — see `docs/investigations/2026-09-02-cross-source-duplicates.md`
§4 and the parent PR's discussion of `place_relationships` as
*"a relationship, not a merge — both master_places remain distinct rows."*
A merge collapses that distinction: the "SHP contains its landmark" edge
becomes a self-reference (parent == child), which the schema does not
allow. A real merge would need to drop those edges.

Examples of the 38 (spot-check, direction verified per-pair):

- CA: `Malakoff Diggins SHP` PARENT of `Malakoff Diggins` (atlas_oddities)
- CA: `Fort Ross SHP` PARENT of `Fort Ross` (atlas_oddities)
- CA: `Chumash Painted Cave SHP` PARENT of `Chumash Painted Cave State Historic Park` (atlas_oddities-only variant)
- CA: `Colonel Allensworth SHP` PARENT of `Colonel Allensworth State Historic Park` (atlas_oddities-only variant)
- CA: `Antelope Valley Indian Museum (SHP)` PARENT of `Antelope Valley Indian Museum` (atlas_oddities)

**Confidence: directly verified for counts (57, 19, 38) and direction spot-check
(6 of 38). Not verified: whether the remaining 32 same-linked pairs all have
canonical-as-parent direction — likely yes given the pattern, but only 6 were
inspected directly this session.**

---

## 4. Field conflicts — high overall count, but most are artifactual

Any pair where both sides have a non-null value that disagrees was flagged.
Across 123 decidable pairs (the 13 `either` cases are counted as
"unresolved"):

| conflict field | pairs |
|---|---:|
| `canonical_name` | 110 |
| `secondary_categories` | 108 |
| `primary_category` | 106 |
| `description` | 65 |
| `photo_url` | 39 |
| `contact` | 24 |
| `amenities` | 4 |
| `hours` | 2 |
| `overlander_tags` | 1 |
| `geometry_polygon` | 1 |

Total pairs with at least one field conflict: **123**.

### The important qualification

These raw conflict counts overstate the human-decision surface, because a
merge in this codebase does not just "pick canonical's value and delete
absorbed's." The write path is:

1. Repoint absorbed's `source_record`(s) → canonical
2. `recompute_master_place(canonical)` re-resolves every field from the union
   of all `source_record`s now pointing at canonical, using `field_precedence`

So the *field* conflicts get re-resolved by the precedence table — the human
decision was already made when the source's precedence rank was set. What
this preview really flags is: **fields where the two source populations
disagree today**, so a human can predict what recompute will do without
running it. That's still useful — especially for descriptions and photos —
but not the same thing as "123 pairs each need a human decision."

**Confidence: directly verified for the counts. Strong inference for the
"artifactual" framing — it's derived from reading
`recompute_master_place()` behavior in the migrations, not from executing a
recompute this session.**

### Two data-flow observations worth naming

- **58 pairs**: the absorbed row has a description; the canonical row does
  not. If the visitor source_record's description survives the field_precedence
  resolution after repointing, the canonical row would gain a description. If
  it doesn't, that data effectively lands nowhere. This preview does not
  simulate the precedence resolution.
- **20 pairs**: the absorbed row has a `photo_url`; the canonical row does
  not. Same shape as above. Note the standing caveat from `CLAUDE.md` that
  the *rendered* photo comes from the export view's lateral join, not
  `master_place.photo_url`, so the field-level check here is not the whole
  story.

**Confidence: 58 and 20 are directly measured. The "may lose text/photo"
framing is a strong inference from the migration source, not from a live
recompute test.**

### 85 pairs where canonical's `canonical_name` is shorter than absorbed's

Almost all are the abbreviation cases — `Petaluma Adobe SHP` (canonical)
vs `Petaluma Adobe State Historic Park` (absorbed), and so on. A human
looking at the merged row might prefer the fuller form. `canonical_name`
does *not* participate in the field_precedence resolver — it is written
directly by `recompute_master_place()` from the highest-quality source's
name. A merge would keep whichever name that produces; a rename is a
separate operation.

**Confidence: 85 count is directly measured. Whether users would prefer
the fuller form is unverified.**

---

## 5. Risk-flag taxonomy

Every one of the 136 pairs carries at least one risk flag (which is
expected — a merge is a non-trivial write). Categories and counts:

| risk | pairs |
|---|---:|
| `place_match` CASCADE — 1–2 rows on absorbed would drop unless explicitly repointed | 136 |
| `primary_category` differs between canonical and absorbed | 106 |
| absorbed and canonical are already linked in `place_relationships` (self-reference hazard) | 38 |
| absorbed has `place_relationships` edges to other rows (rewrite needed) | 19 |
| `canonical_side = either` — needs manual decision | 13 |
| both sides have `geometry_polygon` (real merge needs a polygon-picking rule) | 1 |

The all-136 `place_match` CASCADE risk is not a per-pair alarm — it's a
class-level design decision the merge tool would need to make once. Two
options:

- **Repoint** the absorbed-side `place_match` rows to canonical (preserves
  ER decision history, adds ~123 UPDATEs to the operation).
- **Let CASCADE happen** (the absorbed row's ER history is lost, but so is
  the record it was scoring against, so semantically fine).

Neither is wrong. Not deciding here.

**Confidence: risk counts directly measured. The "not a per-pair alarm"
framing is a design observation, not verified against a specific merge
implementation.**

---

## 6. The 13 `either` cases

Every `either` case has the same shape: **the visitor-side master_place is
backed by a visitor source ONLY (`california_state_parks`,
`oregon_state_parks`, or `arizona_state_parks`), and the other side is
backed by ONE external catalog source ONLY (`atlas_oddities` or `nps`)**.
Neither carries the `state_parks` GIS backing that the canonical rule
usually keys on, so the rule falls through to the "equal sources; needs
manual call" branch.

Full list (all measured this session):

| # | state | visitor (source) | other (source) |
|---:|---|---|---|
| 1 | CA | Old Town San Diego State Historic Park (`california_state_parks`) | Old Town San Diego State Historic Park (`nps`) |
| 2 | CA | Salton Sea State Recreation Area (`california_state_parks`) | Salton Sea (`atlas_oddities`) |
| 3 | CA | Empire Mine State Historic Park (`california_state_parks`) | Empire Mine State Park (`atlas_oddities`) |
| 4 | CA | California Citrus State Historic Park (`california_state_parks`) | California Citrus State Historic Park (`atlas_oddities`) |
| 5 | CA | Pigeon Point Light Station State Historic Park (`california_state_parks`) | Pigeon Point Lighthouse (`atlas_oddities`) |
| 6 | OR | Fort Rock State Natural Area (`oregon_state_parks`) | Fort Rock (`atlas_oddities`) |
| 7 | OR | Darlingtonia State Natural Site (`oregon_state_parks`) | Darlingtonia State Natural Site (`atlas_oddities`) |
| 8 | OR | Farewell Bend State Recreation Area (`oregon_state_parks`) | Farewell Bend State Recreation Area (`nps`) |
| 9 | OR | Hat Rock State Park (`oregon_state_parks`) | Hat Rock State Park (`nps`) |
| 10 | OR | Hat Rock State Park (`oregon_state_parks`) | Hat Rock (`nps`) |
| 11 | OR | Sumpter Valley Dredge State Heritage Area (`oregon_state_parks`) | Sumpter Valley Gold Dredge (`atlas_oddities`) |
| 12 | OR | Face Rock State Scenic Viewpoint (`oregon_state_parks`) | Face Rock (`atlas_oddities`) |
| 13 | AZ | Tubac Presidio State Historic Park (`arizona_state_parks`) | Tubac Presidio State Historic Park (`nps`) |

**Recommendation (not applied):** the natural canonical here is the
visitor-content row, because it carries the state-parks description/hours
that the atlas_oddities/nps rows do not. That is a slightly different
canonical rule than "prefer the state_parks GIS record" — it is "prefer
the row that will produce the richest post-recompute output." I did not
apply this rule automatically because the parent investigation named the
GIS-wins rule specifically and the user's ask was "apply per-case logic
if a clear rule exists in the data, otherwise flag as needs manual
canonical-side call — do not guess." Flagging.

**Confidence: 13 count and case list directly verified. The recommendation
above is a strong inference from the parent investigation's canonical
precedent and the tool's per-row data, not an application of an existing
rule.**

---

## 7. Two edge cases where the canonical rule picks the leaner row

The tool found **2 pairs where the absorbed side has strictly more active
sources than the canonical side** — meaning the canonical rule is
collapsing the richer record onto the leaner one:

| state | canonical (source_count) | absorbed (source_count) | tool's reason |
|---|---|---|---|
| WA | Grayland Beach OBA (1, `state_parks`+`wikipedia`) | Grayland Beach (2, `state_parks`+`washington_state_parks`) | both GIS-backed; other is the untagged GIS home |
| NV | Fort Churchill State Park (1, `state_parks`+`wikipedia`) | Fort Churchill Historic State Monument (2, `nevada_state_parks`+`state_parks`) | both GIS-backed; other is the untagged GIS home |

Both are cases where the rule's "prefer the untagged GIS home" tiebreaker
fires — the untagged variant is the "cleaner" GIS-side record — but that
variant currently has fewer contributing sources than the visitor-tagged
variant.

Whether this is desirable depends on intent. If the goal is "GIS row is
canonical because it's the durable long-term identity, and the visitor
content moves onto it," these two would be exactly right (recompute would
pull in the second source's fields via precedence). If the goal is
"whichever row has more sources today," they'd be wrong.

Not decided here.

**Confidence: 2 cases directly verified with names, source lists, and
counts. The "depends on intent" framing is analysis, not measurement.**

---

## 8. Confidence key for the whole report

Per the ask, using explicit labels rather than a blanket "confirmed":

- **Directly verified (queried live PROD this session):** all counts in
  §1–§7, the `place_relationships` direction spot-check on 6 pairs, the FK
  topology used by the tool (from `supabase/migrations/*.sql`), the
  canonical-side outputs, all field-conflict tallies, the `either`-case
  list, the two canonical-picks-leaner edge cases.
- **Strong inference (derived from reading source, not from live
  execution):** the "conflicts are largely artifactual because recompute
  re-resolves via field_precedence" framing; the recommendation to pick
  the visitor row as canonical for the 13 `either` cases; the "no per-pair
  alarm" framing for the place_match CASCADE risk; the direction of the
  32 unspot-checked already-linked-in-relationships pairs.
- **Unverified / estimated:** whether the field_precedence table actually
  yields the "right" resolution for each disputed field (would need a
  recompute simulation, not run); whether users would prefer the longer
  `canonical_name` in the 85 abbreviation cases; whether the 2 canonical-
  picks-leaner cases are actually miscategorizations vs desired outcomes;
  whether the `master_place_generated_content` and
  `master_place_photo_candidate` tables staying empty for these pairs
  reflects a permanent fact or the current state of those pipelines.

---

## 9. What this preview does NOT verify

- The classifier's SAME-bucket assignments themselves. This tool trusts
  the input. If a pair is mis-classified as SAME (i.e., it's really
  DIFFERENT), the tool will happily preview a merge that shouldn't
  happen. The parent investigation's manual overrides in particular are
  taken on faith.
- Whether `recompute_master_place()` on the canonical row after a real
  repoint would produce the fields we'd want. That requires either running
  the recompute (a write) or building a pure-function simulator (not
  scope).
- Whether the `place_match` CASCADE / repoint decision would introduce
  duplicate `place_match` rows (`(source_record_id, master_place_id)`
  uniqueness on the canonical side after repointing) — a real merge would
  need a UNIQUE-conflict check.
- Interaction with Typesense — the export view (`is_searchable AND
  source_count > 0`) means the absorbed row drops out of the index only
  after `source_count` goes to 0 via recompute. Not simulated here.

---

## 10. Questions for Adam before a real merge tool is built

Passing these up rather than filing speculative backlog items, per the
brief:

1. **The 13 `either` cases** — should the canonical rule fall through to
   "prefer the visitor row" here (my recommendation, §6), or should they
   be triaged one-by-one?
2. **The 38 already-linked-via-relationships pairs (§3)** — is merging the
   right move, or does the existing `contained_in` model correctly
   represent them as distinct (SHP-contains-landmark)? This changes the
   scope of the merge from "collapse dupes" to "collapse dupes AND
   drop containment edges we deliberately built."
3. **The 2 canonical-picks-leaner pairs (§7)** — does the "untagged GIS
   home" tiebreaker want tightening (e.g., prefer the higher-source-count
   side when both are GIS-backed)?
4. **`place_match` handling** (§5) — repoint or let cascade?
5. **Do we want a recompute simulator** before executing merges, so we can
   preview the actual resulting `master_place` field values, not just the
   conflict list?
