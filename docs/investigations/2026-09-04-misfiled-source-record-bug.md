# The misfiled-source_record bug — pattern, the six flagged groups, and a corpus-wide scan

**Date:** 2026-09-04 · **Status:** groups 41/68 blocked, group 78 fix built and
TEST-validated (**not applied to PROD**), corpus scan is audit-only.
**Follow-up to:** #379, #395, #397, #401.

---

## 1. The bug pattern

**A visitor-content `source_record` for park X is attached to the `master_place`
for park Y, where X already exists as its own `master_place`.**

The visible symptom is that Y's resolved description is about X — a
`master_place` named *"Bothe-Napa Valley SP"* whose description is Bale Grist
Mill's 1846 water-powered grist mill.

It is **not** a merge problem and `merge_master_place()` cannot fix it: the
offending record lives *inside* one master_place rather than being a separate
group member, so `excluded_ids` has no purchase on it. It is also invisible to
the Phase 3 containment audit, which compared member points to polygons and
never looked inside a member.

Two-part detector, and **both parts are load-bearing**:
1. the record's name disagrees with its host master_place's name, **and**
2. the true owner already exists as its own master_place.

Part 2 is what makes it precise. Without it, every legitimate sub-area —
Wanapum inside Ginkgo, Smith Creek Village inside Silver Falls, Albany SMR
inside McLaughlin Eastshore — reads as a defect.

## 2. Outcomes for the six originally-flagged groups

| group | outcome | evidence |
|---|---|---|
| **41** Bothe-Napa Valley SP | 🔴 **DEFECT** | canonical carries `california_state_parks:482` = Bale Grist Mill SHP (own mp `9754d424`), 3,164.3 m away. The **correct** Bothe-Napa record sits on the member that would be absorbed **into** it |
| **68** Harstine Island | 🔴 **DEFECT** | canonical carries `washington_state_parks:mcmicken-island-marine…` = McMicken Island Marine State Park (own mp `ab568cc1`) — *a different island*, by its own text |
| **48** McLaughlin Eastshore | 🟡 benign | Albany SMR *"is at the northern end of McLaughlin Eastshore State Park"* — nested, not foreign |
| **55** Ginkgo Petrified Forest | 🟢 clean | Ginkgo's own text: *"a 7,124-acre park **with year-round camping at Wanapum Recreational Area**"* |
| **74** Silver Falls | 🟢 clean | Smith Creek Village is *"a retreat center **nestled in** Silver Falls State Park"*; the correct park record is also on the canonical |
| **84** Cave Rock | 🟢 clean | no foreign record — the heuristic fired on a compound name |

**41 and 68 are now in `DEFAULT_BLOCKED_GROUPS`**, alongside 3/6/83/95/5001, with
the defect reason recorded in the constant's doc comment. They are **out of the
"already validated 106"** until the misfiled record is repointed.

## 3. Group 78 (Fort Rock) — fix built and validated, NOT applied

**Two questions, two answers.** The landmark-vs-park question is *benign*: the
SNA polygon measures **1.4150 km²** against **1.4527 km²** for a circle of the
tuff ring's stated 1,360 m diameter — the protected area *is* the landform, so
the atlas row and the SNA are one entity. The **cave** is the problem.

Confirmed on OPRD's own site: `parkId=170` is published as its **own** park
profile, *"Fort Rock Cave is near Fort Rock State Natural Area"* and *"The
location of Fort Rock Cave will not be shared."* That withheld location also
explains the geometry — the ingested point is a placeholder sitting inside the
SNA polygon, which is very likely what made ER fuse it.

**The fix:** `data/scripts/reattach-misfiled-source-record.ts` repoints the
record and recomputes both master_places. Same guard posture as the executor —
dry-run by default, `--confirm` for writes, PROD needs `--confirm-prod`, refuses
if the record is not on `--from` or if `--to` does not exist.

**PROD dry-run (read-only, no writes)** confirms the real state:
`oregon_state_parks:170` (name *"Fort Rock Cave"*) is on the SNA canonical
(3 sources, description = the cave text); destination
`c0d6a01b` *"Fort Rock Cave National Heritage Site"* has 1 source and **no
description at all**.

**TEST shape validation** (`verify-reattach-misfiled.ts`): 12 assertions, all
passing, including a **repro** step that proves the pre-state shows the cave text
so the rest cannot pass vacuously. After the reattach the SNA row **recovers its
own Fort Rock text**, the cave row gains the record and its description, and the
follow-on atlas+SNA merge then runs on the corrected record leaving the cave row
untouched with zero new edges.

### ⚠️ Sequencing for whoever runs the PROD pass

1. `reattach-misfiled-source-record.ts --external-id oregon_state_parks:170 --from 18fcb124… --to c0d6a01b… --target=prod --confirm --confirm-prod`
2. **Then** merge group 78 (atlas landform + corrected SNA).

Merging first is not catastrophic — the conflation is pre-existing and the merge
does not worsen it — but doing it in this order makes the merged record *correct*
rather than merely not-worse, and the fix is a single repointed record.

## 4. Corpus-wide scan — method, and its limits

Scope: **28,506** master_places, **30,282** active source_records. A per-record
LLM read is impractical at that size, so the detector is pure SQL + local set
logic, with the description-level read reserved for triage of the survivors.

**Naive trigram matching does not work, and I proved that on myself.** The first
build used `similarity(owner.name, record.name) >= 0.70` and **found none of the
four known cases** — defeated by exactly the abbreviation problem that defeated
the original classifier (*"Bale Grist Mill SHP"* vs *"Bale Grist Mill State
Historic Park"*). That is the Salton-Sea `SRA` lesson recurring.

The working detector normalises each name to a **core** by stripping designation
suffixes (`State Historic Park`, `SHP`, `Marine State Park`, `SNA`, …), verified
against 14 hand-checked examples. Two tiers:

| tier | rule | records | master_places | with visible symptom |
|---|---|--:|--:|--:|
| **1 — strict** | owner core **equals** record core | 124 | 122 | 26 |
| **2 — relaxed** | owner core **contained in** record core | 316 | 286 | 115 |

**Method control passes on all four known cases** — 41, 68 and 78's cave in
tier 1; 77 (Rowena Crest) only in tier 2, because the record name carries a route
prefix (*"Historic Columbia River Highway - Rowena Crest Overlook"*) the owner
name lacks.

Generic placeholder names (`unnamed dispersed camping`, `site 4`, `chevron`) were
excluded — they produced tens of thousands of spurious pairings — as were cores
shared by more than three master_places.

### Tier 1 splits into two different bugs

| | records | with symptom | what it is |
|---|--:|--:|---|
| **(a) missed duplicate** | 93 | 16 | host and owner are the **same place under two names** (`Columbia Hills` / `Columbia Hills Historical State Park`). Not misfiling — the merge classifier should have grouped them |
| **(b) true misfiling** | 31 | 10 | host and owner are **different places** |

The ten symptomatic (b) cases include all three tier-1 known defects plus
`Alameda-Tesla Expansion Area` ← *Carnegie SVRA*, `Colonel Bob Trailhead` ←
*Fletcher Canyon Trailhead*, `Warm Springs Picnic Area` ← *Warm Springs
Campground*, `Brian Booth State Park` ← *Beaver Creek*.

### Honest precision limits

- **Tier 2 is low precision.** Its symptomatic sample is dominated by RIDB naming
  variants (*"Magpie Campground"* vs *"Magpie Campground (Ut)"*) with owner cores
  like `Campground` or `Group Camp` — duplicates or the same record, not
  misfilings. **Do not treat 316/286 as a defect count.** It earns its place only
  because it is the tier that recovers group 77.
- **The (a)/(b) split has known gaps.** It relies on core containment between
  host and owner, so punctuation and unlisted abbreviations leak (a)-type cases
  into (b) — `Torrey Pines SNR` (SNR is not in the suffix list) and
  `Devil's Punch Bowl` / `Devils Punchbowl` are both really missed duplicates
  sitting in the (b) bucket. **31 is an upper bound.**
- Only the six flagged groups plus 77/78 were verified to **description depth**.
  Everything else is `[unverified]` pending the same per-case read.

## 5. What is NOT done

No record was edited and no group definition changed for anything in §4. The
corpus scan is audit-only. Groups 41 and 68 are blocked but **not fixed** — each
needs the same reattach the group-78 fix performs.
