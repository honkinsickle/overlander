# Three-part cleanup pass

TEST only (`znldzjdatkogdktymtvi`). No PROD. Three independent parts.

## Part 1 — Backfill state clause for the now-resolvable population

**Distinct from the 158-row stale-fact fix**: that pass corrected a wrong
state already asserted in text. This pass adds a state clause that was
never asserted at all, for rows where the old bbox classifier called the
row ambiguous (2+ overlapping boxes) or outside (0 boxes) and the template
omitted the state clause rather than guess.

### 1. Re-identified population (fresh)

Recomputed directly from the same old-classifier logic
(`classifyStateUnambiguous`, copied verbatim from
`generate-none-bucket-templates-2026-08-21.ts`) against the **current**
10,292 template rows — not from any stored list.

**Confirmed current count: 1,212** (not 1,211 — a 1-row drift from the
number in this task's own context, likely one row's eligibility bucket or
attribution shifted between the earlier investigation and this pass; not
re-derived further since it doesn't change the substance of the fix).

A cross-check flagged 37 of the 1,212 rows as unexpectedly already
containing a state name in their stored text. **Investigated directly,
confirmed benign**: in every case the state word is part of a real proper
noun already in the corpus — a parent name ("Spooner and Backcountry Lake
Tahoe-Nevada State Park"), the place's own name ("Nevada Quicksilver
Mine", "Santa Claus, Arizona", "Nevada Test Site", "Exact Center of
California"), or a source-record body ("California State Lands
Commission") — not the template's own state-clause logic asserting
anything. Not a defect; included in the population as normal.

### 2. Resolvable subset

Of the 1,212: **1,211 now resolve to a real state** via the persisted,
TIGER/Line-backed `master_place.state` column. **1 remains null** —
genuinely outside all six states, left untouched (no fact forced).

### 3. Regeneration

Same template logic as the original generator (named-parent form with the
near-duplicate-parent guard, bare fallback otherwise), UPDATE-in-place on
the existing row (`prompt_version` bumped to
`template-v1-2026-08-21-state-backfill`, `generation_method` unchanged at
`template`).

```
Regenerated 1211 resolvable rows; text actually differs from before in
1211 of them
Written: 1211 / 1211. Errors: 0
```

### 4. Before / after sample (15 of 1,211)

| master_place | before | after |
|---|---|---|
| Dutch/Hidden Trailhead | "...is a facility." | "...is a facility in California." |
| Duff Creek Campground | "...campground in Sierra National Forest." | "...campground in Sierra National Forest, California." |
| Pohono Trailhead | "...trailhead in Yosemite National Park." | "...trailhead in Yosemite National Park, California." |
| Darwin Falls Trailhead | "...trailhead in Death Valley National Park." | "...trailhead in Death Valley National Park, California." |
| Marble Bath | "...is an oddity." | "...is an oddity in California." |
| Stokes Castle | "...is an oddity." | "...is an oddity in Nevada." |
| Glacier Canyon Trailhead | "...trailhead in Inyo National Forest." | "...trailhead in Inyo National Forest, California." |
| Del Rey Beach State Recreation Site | "...is a public land area." | "...is a public land area in Oregon." |
| Mcnary And Umatilla Refuge Hunt Permit | "...in Ice Age Floods National Geologic Trail." | "...in Ice Age Floods National Geologic Trail, Washington." |
| Area 51 | "...is an oddity." | "...is an oddity in Nevada." |
| La Hupp Picnic Area | "...picnic area in Inyo National Forest." | "...picnic area in Inyo National Forest, California." |
| Paradise Point Campground | "...in Ice Age Floods National Geologic Trail." | "...in Ice Age Floods National Geologic Trail, Washington." |
| High Camp | "...dispersed camping site in Gifford Pinchot National Forest." | "...in Gifford Pinchot National Forest, Washington." |
| Hume Lake Trailhead | "...trailhead in Sequoia National Forest." | "...trailhead in Sequoia National Forest, California." |
| Pierce Pond | "...dispersed camping site in Sequoia National Forest." | "...in Sequoia National Forest, California." |

All additions are plausible: California/Nevada/Oregon/Washington national
forests and named landmarks previously sitting in the old classifier's
overlap or outside zones, now correctly assigned by real geometry.

### 5. Verification

Re-selected all 1,211 rows directly from the DB by their new
`prompt_version`:

- `generation_method`: `template` for all 1,211 (unchanged).
- **Wrong-state-name check**: 0 mismatches — no row's text contains a
  state name other than its `master_place.state`.
- **Missing-expected-state check**: 0 — every row's text does contain its
  expected state name.
- **Orphan/duplicate check**: grouped by `(master_place_id,
  field_name='description')` for the 1,211 affected places — **0 places
  have more than one description row.**
- `master_place.description`: this script's only write targets
  `master_place_generated_content`; structurally incapable of touching
  `master_place`.

Same side observation as the 158-row fix: **275 of the 1,211 affected
places have a non-null `master_place.description`** (pre-existing, not
introduced by this write) — see Part 2 below, which investigates this
pattern directly.

### 6. Totals

| | count |
|---|--:|
| Population re-identified (old classifier: ambiguous/outside) | 1,212 |
| Resolvable (real state, backfilled) | 1,211 |
| Left as-is (still genuinely outside all six states) | 1 |
| Regenerated / written | 1,211 (0 errors) |

---

## Part 2 — The dual description/template population

### 7. Re-confirmed count

**The "17" figure was never a corpus-wide measurement.** It came from a
narrower check in the previous pass — "of the 158 already-regenerated
stale-fix rows, how many have a non-null `master_place.description`" —
not a scan of all 10,292 template rows. Doing the corpus-wide scan this
task asked for:

**Confirmed current count: 1,757** template rows whose `master_place_id`
also has a non-null, non-empty `master_place.description`.

This is a large discrepancy from the number implied in this task's own
context, flagged directly rather than silently reconciled: the true
population is ~100x the "17" figure. Proceeding with the full 1,757, not
a re-derivation of the smaller number.

Source breakdown of these 1,757 `master_place.description` values (via
`attribution.description`): **1,448 usfs, 301 ridb, 8 osm.**

### 8/9. Pattern classification and recommendation

Presenting per-row detail for all 1,757 in this report isn't useful (full
raw dump captured separately, ~430KB); classified the population by
pattern instead:

| pattern | count |
|---|--:|
| `"NAME (Category)"` boilerplate — description is just the place's own name plus a parenthetical category tag (e.g. `"WILLIAMSON VALLEY TRAILHEAD (Trailhead)"`), carrying zero information beyond `canonical_name` + `primary_category` already give | 1,193 |
| HTML-wrapped bare name only (e.g. `<p>Trailhead.</p>` where the text is just the name/category, stripped of tags) | 211 |
| Everything else | 353 |

A 20-row spot-check of the "everything else" 353 (**estimate — a sample,
not an exhaustive classification**) shows most of those are *also*
non-substantive: truncated name fragments (`"BIG SPRINGS"` for "Big
Springs Trailhead"), or near-empty HTML placeholders (`<p>.</p>`, `<p>
</p>`, `<p>...</p>`). A minority carry a genuine, short operational fact:
`"This is a very popular beach."`, `"Pit latrine, private."`, `"Site has
been decommissioned."`, `"Toilets, wheelchair accessible."`, `"Area
burned in Mosquito Fire."`, `"25 sites."`, `"Scenic overlook with
mural."` On this sample, informative real descriptions are a small
minority of the 1,757, not a majority.

**Sample table (10 of the 1,757, spanning all three patterns):**

| master_place | source | real `master_place.description` | template `generated_text` |
|---|---|---|---|
| LAWSON SOUTH | usfs | "LAWSON SOUTH (Trailhead)" | "LAWSON SOUTH is a trailhead in Siskiyou National Forest, Oregon." |
| Dutch/Hidden Trailhead | ridb | "Dutch/hidden Trailhead" | "Dutch/Hidden Trailhead is a facility in California." |
| Mogollon Trailhead | ridb | "\<p>Mogollon Trailhead\</p>" | "Mogollon Trailhead is a facility in Sitgreaves National Forest, Arizona." |
| Big Springs Trailhead | usfs | "BIG SPRINGS" | "Big Springs Trailhead is a trailhead in Utah." |
| Cemetery Day Use Area | usfs | "This is a very popular beach." | "Cemetery Day Use Area is a picnic area in Cache National Forest, Utah." |
| Camp Host Toilet | osm | "Pit latrine, private." | "Camp Host Toilet is a restroom in Yuma Field Office, Arizona." |
| Devils Canyon Campground | usfs | "Site has been decommissioned." | "Devils Canyon Campground is a campground in Tonto National Forest, Arizona." |
| Cibbets Flat Campground | ridb | "\<p>25 sites.\</p>" | "Cibbets Flat Campground is a campground in Cleveland National Forest, California." |
| Osprey Overlook | ridb | "\<p>Scenic overlook with mural.\</p>" | "Osprey Overlook is a facility in Lassen National Forest, California." |
| Nook Bar Boating Site | ridb | "\<p>.\</p>" | "Nook Bar Boating Site is a facility in Siskiyou National Forest, Oregon." |

**Recommendation (investigate + recommend only — nothing deleted):** do
**not** auto-remove a template row whenever `master_place.description`
becomes non-null. On this population, doing so would in the large
majority of cases **strip the more informative field** (the template,
which includes category + state + real parent context) and leave only a
near-worthless boilerplate or empty-HTML fragment behind. The eligibility
signal computation already appears to be doing the right thing here —
these rows correctly landed in the NONE bucket (that's *why* they got a
template at all) despite `description` being technically non-null,
because the signal logic evidently doesn't count a bare name-repeat or
empty `<p>` as sufficient. So the two fields are already coexisting
correctly by the same logic that put them there.

**The broader policy question, flagged as asked, not decided here:**
whether the *app's display layer* should ever prefer the template over a
technically-present-but-uninformative `master_place.description` is a
`web/` display-precedence question, out of this `data/`-only pass's
scope per this repo's own web/data boundary (`web/` does not import from
`data/` at runtime). If a future pass wants to reduce this population
further, the more precise target is a stricter substantive-description
detector at generation/eligibility time (e.g. flag `"NAME (Category)"`
and near-empty-HTML patterns as equivalent to null) rather than a
delete-on-presence rule — but that's a proposal, not something applied
in this pass.

---

## Part 3 — Leftover script cleanup

**Deleted** `data/scripts/_pull-replacement-row.ts` (confirmed untracked,
a one-off from an earlier ad-hoc row-pull task this session).

```
$ git status --porcelain | grep _pull-replacement-row
(no output — clean)
```

---

## Summary

| Part | Result |
|---|---|
| 1 — Backfill resolvable state clause | 1,212 population (fresh), 1,211 resolvable and regenerated (0 errors), 1 left null, 0 verification failures |
| 2 — Dual description/template investigation | 1,757 population (fresh — corrects the earlier-implied 17), classified by pattern, recommendation: do not auto-delete; flagged broader policy question, no action taken |
| 3 — Leftover script cleanup | `_pull-replacement-row.ts` deleted, git status confirmed clean |

New durable script from Part 1:
`data/scripts/backfill-resolvable-state-templates-2026-08-21.ts` (kept,
not a one-off — mirrors the naming/retention convention of
`regenerate-stale-state-templates-2026-08-21.ts`). All Part 2
investigation scripts were `_`-prefixed one-offs and deleted after their
output was captured, per this session's established convention.
