# Stale template description regeneration (post state-boundary fix)

TEST only (`znldzjdatkogdktymtvi`). No PROD. Investigate → count →
regenerate → verify.

## Context

`master_place_generated_content` holds 10,292 template-generated
`description` rows, produced before the
[all-six-states state-boundary fix](2026-08-21-state-boundary-fix-all-six-states.md)
landed. Any template whose text names the state that fix subsequently
corrected is stale.

## 1. Prior schema pass

No separate `description_source`/`needs_review` column pass has been
applied to `master_place_generated_content`. Confirmed by direct column
inspection: the table's columns are exactly `id, master_place_id,
field_name, generated_text, generation_method, model_version,
generated_at, grounded_on_source_record_ids, prompt_version` — nothing
resembling a review-state or source-provenance flag beyond
`generation_method` itself.

## 2. Identifying affected rows

**Did not assume the naive transition-matrix count (2,964) applied
directly.** That figure is the state-boundary fix's own corpus-wide
`master_place` change count; the population that matters here is
template rows whose **stored text literally names** a state.

Measured directly:

| step | count |
|---|--:|
| Total template rows in `master_place_generated_content` | 10,292 |
| Resolved current state+geometry for | 10,292 (100%) |
| Candidates (old bbox-derived state ≠ new real-boundary state) | 1,369 |
| Not candidates (old == new) | 8,923 |
| **Confirmed stale via literal text inspection** (text names the OLD, now-wrong state) | **158** |
| Old state was omitted (ambiguous/outside under the old classifier), now resolvable to a real state — **explicitly NOT touched in this pass** | 1,211 |
| Old state named in text, but doesn't match the expected old-classifier value (unexpected path) | 0 |

The gap between 1,369 candidates and 158 confirmed-stale is real: most
candidate rows either never named a state in their generated text at all
(the bare-fallback template, used when no `contained_in` parent existed)
or already had the old state omitted because the old classifier called
them ambiguous/outside. Only rows whose stored text *actually contains*
the old, now-wrong state name were regenerated.

**The 1,211-row population is flagged, not addressed here** — these rows
can now gain a real, correct state clause they never had, which is a
distinct addition, not a stale-fact correction. Out of this pass's literal
scope ("text names the OLD wrong state").

## 3. Regeneration

Reused the exact template logic from
`generate-none-bucket-templates-2026-08-21.ts` (same `CATEGORY_LABELS`,
`article()`, `clean()`, named-parent/bare-fallback structure) — the only
change is the state source: reads the now-corrected, persisted
`master_place.state` column directly instead of re-deriving via any bbox
classifier.

**UPDATEs the existing row in place** (same `id`, bumps `generated_at`
and `prompt_version` to `template-v1-2026-08-21-state-fix`, keeps
`generation_method='template'`) — does not insert a new row. This is the
right approach: `master_place_generated_content` has no versioning/audit
table, so in-place correction of a wrong fact is the same operation this
session has used throughout (e.g. the BLM/RIDB field fixes), and avoids
creating duplicate `(master_place_id, field_name)` rows.

Dry-run first (confirmed the diff was sane before writing), then applied:

```
Written: 158 / 158, 0 errors
```

## 4. Before / after sample (15 of 158)

| master_place | before | after |
|---|---|---|
| Osprey | "Osprey is a dispersed camping site in Oregon." | "Osprey is a dispersed camping site." |
| Three Creek Campsite | "...dispersed camping site in Nezperce National Forest, Oregon." | "...dispersed camping site in Nezperce National Forest." |
| Upper Dry Gulch Campsite | "...in Nezperce National Forest, Oregon." | "...in Nezperce National Forest." |
| Alder | "Alder is a picnic area in Loth197, Oregon." | "Alder is a picnic area in Loth197, Washington." |
| Lornas Lulu Beach Campsite | "...dispersed camping site in Oregon." | "...dispersed camping site." |
| China Garden Campsite | "China Garden Campsite is a campground in Oregon." | "China Garden Campsite is a campground." |
| Blue Canyon Campsite | "...in Cottonwood Field Office, Oregon." | "...in Cottonwood Field Office." |
| China Campsite | "...in Cottonwood Field Office, Oregon." | "...in Cottonwood Field Office." |
| Battle Ground Lake Campground | "...in Ice Age Floods National Geologic Trail, Oregon." | "...in Ice Age Floods National Geologic Trail, Washington." |
| Upper China Garden Campsite | "...is a campground in Oregon." | "...is a campground." |
| Across Round Springs Campsite | "...dispersed camping site in Oregon." | "...dispersed camping site." |
| Red Tail Campsite | "...dispersed camping site in Oregon." | "...dispersed camping site." |
| Square Beach Campsite | "...in Nezperce National Forest, Oregon." | "...in Nezperce National Forest." |
| TRUPER Distribuidora | "TRUPER Distribuidora is a hardware store in California." | "TRUPER Distribuidora is a hardware store." |
| Tom's Hole Campsite | "...dispersed camping site in Oregon." | "...dispersed camping site." |

Two real, confirmable corrections stand out: **Battle Ground Lake
Campground** is genuinely in Battle Ground, Washington (not Oregon), and
the **Ice Age Floods National Geologic Trail** / **Loth197** rows sit on
the Columbia River border, matching the state-boundary fix's documented
OR↔WA reclassification pattern. **TRUPER Distribuidora** (a
California-labeled hardware store) now resolves to no state — consistent
with sitting near the CA/Mexico border, correctly not forcing a wrong
claim. The Nezperce National Forest / Cottonwood Field Office rows (both
Idaho BLM/USFS units near the OR/ID border) correctly drop the state
clause entirely while keeping the real named-parent intact, rather than
naming a wrong state.

## 5. Verification

Re-selected all 158 rows directly from the DB post-write (not from
console output):

- `generation_method`: `template` for all 158 (unchanged, as intended).
- `prompt_version`: `template-v1-2026-08-21-state-fix` for all 158
  (confirms the write landed).
- **Wrong-state-name check**: for every regenerated row, scanned the text
  for any of the six state names *other than* the one matching the row's
  current `master_place.state` — **0 mismatches**. No row was corrected
  into a new wrong state.
- **Orphan/duplicate check**: grouped `master_place_generated_content`
  rows by `(master_place_id, field_name='description')` for the 158
  affected places — **0 places have more than one description row**.
  Confirms the UPDATE-in-place approach did not create duplicates.
- **`master_place.description` untouched**: the regeneration script's
  write path is a single `UPDATE master_place_generated_content ...`;
  it contains no statement touching `master_place`. Structurally
  incapable of writing to `description`.

**One side observation, flagged rather than chased**: of the 158 affected
`master_place` rows, **17 now have a non-null `description`**. This is
pre-existing state, not something this pass introduced (again: this
script never writes to `master_place`) — most plausibly these rows since
picked up a real value from an unrelated pipeline (e.g. this session's
earlier LLM-description pilot's stratified sample, or a source-record
update). Worth a look in a future pass since a NONE-bucket row gaining a
real description may make its template row redundant, but out of this
task's scope.

## 6. Totals

| | count |
|---|--:|
| Total template rows checked | 10,292 |
| Candidates (old ≠ new state) | 1,369 |
| Confirmed stale (text names old wrong state) | **158** |
| Regenerated | **158** (0 errors) |
| Explicitly NOT touched — now-resolvable, previously-omitted population | 1,211 |

No orphaned or duplicate `master_place_generated_content` rows were
created. `master_place.description` remains untouched for all 158 rows
(structurally, by the write path used).

## Known leftover, unrelated to this task

`data/scripts/_pull-replacement-row.ts` is still present and untracked in
git status — a one-off from an earlier ad-hoc row-pull task in this
session, not cleaned up at the time. Flagged here rather than silently
deleted, since removing it wasn't part of what was asked in this pass.
