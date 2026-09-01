# generated_content → `master_place.description` copy-in — TEST backfill

**Date:** 2026-08-31 · **Environment:** TEST (`znldzjdatkogdktymtvi`)
**Branch:** `little-rock` · **Script:**
`data/scripts/backfill-description-from-generated-content.ts`

Executes "Fix 1 (copy-in)" for the wiring gap scoped in
`docs/measurements/2026-08-31-generated-content-bake-gap.md` (Population A).
Every number below was computed in this session against TEST. Nothing is
carried over from the scoping doc; where a figure happens to match, that is
stated as a match, not reused.

## What was measured before writing anything

`master_place_generated_content` rows with `field_name = 'description'`:
**17,725**. Joined to their `master_place` rows (17,725 matched, 0 missing):

| Bucket | Count |
|---|---:|
| Population A — `is_searchable`, `description` NULL/empty | **13,942** |
| … `generation_method = 'llm'` | **6,548** |
| … `generation_method = 'template'` | **7,394** |
| … `needs_review = true` | **0** |
| "Dual" — searchable, description already present | 3,783 |
| Not `is_searchable` | 0 |

**A = 13,942 exactly matches the scoping doc's figure** — the corpus has not
shifted for this population since 2026-08-31 morning.

## The finding that changed the scope: template rows are excluded on purpose

`pois_along_corridor` carries this predicate:

```sql
and not (mp.description is null and coalesce(desc_gc.has_template, false))
```

Template-only rows are **deliberately excluded from trip-stop candidacy** per
`docs/decisions/2026-08-21-template-eligibility-provenance-review-decisions.md`
§2 ("Counting toward eligibility is a statement about 'does this
description-generation pipeline need to keep working on this row'; it is
explicitly not a statement about 'is this good enough to hand a
trip-planner'"). Copying template text into `mp.description` makes
`mp.description is null` false, so the exclusion stops firing.

**Measured live, not inferred** — one template row and one llm row, each
queried through `pois_along_corridor` before and after a copy-in, then
restored:

| Row | method | before | after |
|---|---|---|---|
| `0007a5cb…` Ochoco State Scenic Viewpoint | template | **not returned**, `description_source: template` | **returned**, `description_source: source` |
| `000b3d43…` Swelter Shelter Trailhead | llm | returned, `description: null`, `description_source: llm` | returned, `description` populated, `description_source: source` |

So the two halves of Population A behave differently:

- **llm (6,548)** — already corridor-eligible, already `verified` tier
  (`mapMasterPlaceRow` maps both `'llm'` and `'source'` to `"verified"`). The
  copy-in changes only whether a description actually renders. Pure fix.
- **template (7,394)** — the copy-in additionally reverses a merged ADR by
  admitting ~7.4k thin one-liners ("`{name} is a {category} in {parent},
  {state}.`") into trip-stop candidacy.

**Only the llm half was run.** The template half is held for explicit
sign-off — see §Held below.

The tiles named in the handoff for re-verification are mostly llm rows, so the
llm-only run covers most of them: Fawnskin Market (llm), Pineknot Campground
(llm).

**Correction — an earlier version of this doc said "24 of the 25 Yellow Post
rows are llm". That was a capped sample reported as a population count**: the
query carried `.limit(25)`, so 25 was the cap, not the count. Re-measured
uncapped, `master_place` where `canonical_name ilike '%Yellow Post%'`:

| | Count |
|---|---:|
| total rows | **80** |
| `generation_method = 'llm'` (fixed by this run) | **46** |
| `generation_method = 'template'` (held) | **11** |
| no generated-content row at all (Population B) | **23** |

So this run fixes 46 of the 80 Yellow Post rows, not "essentially all" of
them. 11 more are one flag away; the remaining 23 have no description anywhere
and are out of scope for either half.

## `attribution.description` — the existing convention

Asked for before deciding anything. Measured across all 19,803 searchable
`master_place` rows whose `description` was not NULL pre-backfill. (Of those,
19,688 held actual text and 115 were empty strings — **both derived from this
session's own measurements**, not read off the earlier scoping doc: post-run
non-empty 26,236 − rows written 6,548 = 19,688, and 19,803 − 19,688 = 115.)

| Count | `attribution.description` |
|---:|---|
| 5,344 | `ridb` |
| 4,979 | `nps` |
| 4,204 | `usfs` |
| 2,767 | `atlas_oddities` |
| 1,963 | `osm` |
| 533 | `editorial_food` |
| 13 | `family_destinations` |
| **0** | *(no `description` key)* |

**The convention is: the value is always a `source_id`, and it is always
present when a description is.** It is written by `recompute_master_place()`
(`v_attribution := v_attribution || jsonb_build_object(v_field, v_source)`)
from the winning `source_record` per `field_precedence`, and the whole
`attribution` map is **replaced wholesale** on every recompute.

Two consequences, so **this backfill writes no attribution at all**:

1. There is no existing value meaning "generated, not sourced". Inventing one
   (`'generated'`, `'llm'`, …) would be a new convention, which the task
   explicitly forbade.
2. Anything written would be transient — the next `recompute_master_place()`
   for that row rebuilds `attribution` from `source_record` only and would
   drop the key. Verified directly: after a recompute on `000b3d43…`,
   `attribution` came back `{"access":"osm","geometry":"osm","canonical_name":"osm"}`
   with no `description` key.

Provenance stays fully recoverable from the `master_place_generated_content`
row, which is untouched.

Side note, measured: 113 of the 13,942 A rows carry a **stale**
`attribution.description` (111 `ridb`, 2 `nps`) while holding an empty
description — leftovers from the clear-bug era described below. Of the 6,548
rows this run actually wrote, **7** carry such a stale key (5 `ridb`, 2 `nps`);
the other 6,541 have no `description` key at all. So the post-backfill corpus
now contains 6,541 rows holding a description with **no** attribution entry —
a state that did not previously exist (pre-backfill: 0 of 19,803) — plus 7
whose attribution entry names a source that is *not* where the text came from.

## Durability: does a direct write survive `recompute_master_place()`?

This matters because `master_place.description` is a precedence-resolved
column and the schema invariant is "never write to `master_place` directly
except via `recompute_master_place()`". Measured with a sentinel:

```
before.description: null
after direct write: "__copyin_durability_probe__"
recompute_master_place(...) -> 204
after recompute:    "__copyin_durability_probe__"   <-- SURVIVES
```

**The first run of this experiment had no positive control** — nothing in it
proved the function body executed rather than silently no-opping, which is
exactly the apparatus failure `CLAUDE.md` warns about. Re-run with
`last_resolved_at` (written unconditionally in the function's Step 6) as the
control:

```
0007a5cb… before: description=null  last_resolved_at=2026-08-20T23:12:55.242Z
           rpc: 204
           after: description="__audit_positive_control__"
                  last_resolved_at=2026-09-01T03:52:37.393Z
  last_resolved_at CHANGED (the body ran):        true
  description survived (no clear branch fired):   true
```

**The body ran and the description still survived.** So on TEST the clear
branch is genuinely absent, measured, not inferred.

**Why:** `20260819180000_recompute_master_place_clear_bug_fix.sql` added an
explicit `set description = null` for the case where `resolve_field()` returns
no candidate. The later `20260831100000_operational_status.sql` is a
`create or replace` written from the **pre-fix** function body plus
`operational_status`, and it has no `elsif v_field = any(v_clearable_fields)`
branch and no `v_clearable_fields` declaration at all.

**Scope of the PROD claim — read this before repeating it.** The behavioural
proof above is **TEST only**. That the same regression is live on PROD is an
**inference**, from two things: the migration file's content, and
`docs/STATE.md` §2026-08-31 recording that PR #321's three migrations were
applied to both environments. **No PROD measurement was taken this session**,
and this repo has a documented file-vs-DB drift history that makes reading a
migration file a weaker signal than `pg_get_functiondef` against the live
database. Confirming it on PROD needs either a live function-definition read
or the same sentinel probe, both of which require Adam's sign-off. Until then
the PROD half is **`[UNVERIFIED]`**.

So: **if the clear-bug fix is ever restored, this entire backfill is silently
wiped** on the next recompute of each row. Filed in `docs/BACKLOG.md`. This is
a pre-existing regression, not caused by this work, but it is exactly the
load-bearing assumption underneath the copy-in approach and it should not stay
implicit.

## Text formatting parity

`stripDescriptionHtml()` (`web/src/lib/trip-browse/description-text.ts`) run
over **all 6,548** written strings, not a spot-check:

```
stripDescriptionHtml() changes the string for 0 of 6548 rows.

post-strip artifact scan:
  empty result:          0
  contains "<":          0
  contains "&…;":        0
  double space:          0
  leading/trailing ws:   0
  contains newline:      182
  length min/median/max: 33 / 147 / 825
```

The sanitizer is a complete no-op on this content — generated text contains no
HTML tags and no entities. The 182 rows with a newline are paragraph breaks,
which the sanitizer preserves for `white-space: pre-line` callers and which
`line-clamp-2` surfaces ignore.

## The run

`npx tsx --env-file=.env scripts/backfill-description-from-generated-content.ts --confirm`
(TEST, default `--method llm`).

```
generated_content candidates (field_name='description', needs_review=false): 7433
matching master_place rows: 7433

PLAN (gap-fill only; a row with a description is never overwritten)
  skipped — description already present: 885
  skipped — not is_searchable:           0
  skipped — no master_place row:         0
  skipped — generated_text blank:        0
  TO WRITE:                              6548

  wrote 6548, failed 0

VERIFY: 6548/6548 rows now hold exactly the generated text; 0 still empty.
```

**Rows updated: 6,548.** Top categories written: `ev_charging` 1,764,
`dispersed_camping` 1,270, `campground` 1,105, `park` 1,031, `trailhead` 660,
`grocery` 342, `picnic_area` 213, `beach` 82.

Post-backfill, searchable `master_place` rows with a **non-empty** description
measure **26,236** (queried after the run).

Snapshot (prior values, for `--undo`):
`~/.config/overlander/generated-content-copyin-snapshots/copyin-znldzjdatkogdktymtvi-2026-09-01T03-41-03-057Z.json`
(6,548 rows).

## Re-verification through the real bake path

Not read off the base table — queried through `pois_along_corridor`, the RPC
`fetchCorpusForPolyline()` → `mapMasterPlaceRow()` calls. All five return a
real description and `description_source: source`:

| Tile | Description now served |
|---|---|
| Fawnskin Market | "A small grocery store in Fawnskin, California, serving the local community and visitors in the area." |
| Pineknot Campground | "Pineknot Campground is a Forest Service campground in California with drinking water and toilet facilities. More information is available at the USDA Forest Service website." |
| Yellow Post #27 | "Yellow Post #27 is a campground in California managed by the San Bernardino National Forest, located in a forested setting typical of the national forest system." |
| Keller Peak Yellow Post #1 | "Keller Peak Yellow Post #1 is a campground in California administered by the San Bernardino National Forest, located in a mountain area where dispersed or yellow-post camping is permitted." |
| Bates Canyon Campground | "Bates Canyon Campground is a Forest Service campground in California's Los Padres National Forest, based on the USDA Forest Service website domain, likely offering basic facilities in a canyon setting for tent and vehicle camping." |

Before the backfill each of these had `master_place.description` empty, so
`mapMasterPlaceRow` emitted `"{Title} — {Category}."`.

## No bake-path code changes required — confirmed

The chain is `bake-corridors.ts:fetchCorpusForPolyline()` →
`supabase.rpc("pois_along_corridor")` → `mapMasterPlaceRow(r, …)` →
`description: row.description ?? "{name} — {Category}."`
(`web/src/lib/trip-browse/federated.ts:253`). The RPC already selects
`mp.description`, so a populated column flows straight through. Confirmed
twice: by reading the chain, and by the live RPC probe above returning the
text. **Zero web-side changes are in this PR.**

One knock-on worth naming: `description_source` flips `'llm'` → `'source'`
for these 6,548 rows, in both `pois_along_corridor` and
`master_place_search_export`. `mapMasterPlaceRow` maps both to
`verified: "verified"`, so **the verification tier does not change**. But the
DB-level provenance signal now reports `'source'` for content that is
LLM-generated. Given the decision that generated descriptions are treated
identically to sourced ones in the UI, that is consistent — but a future
consumer of `description_source` should know it no longer distinguishes these
rows. `master_place_generated_content` remains the accurate record.

## Held, not done

1. **The 7,394 `template` rows of Population A.** One flag away:
   `--method all --confirm` (or `--method template --confirm`). Held because
   it reverses ADR 2026-08-21 §2 and would admit thin one-liners into
   trip-stop candidacy — measured above, not speculated. Needs an explicit
   call. The "newly admitted" figure is **exactly 7,394**, not an upper
   bound: re-checked against the RPC's *other* gates (`source_count > 0`,
   `primary_category <> 'land_status'`) and all 7,394 pass them, so removing
   the template exclusion admits every one.
2. **PROD.** Not run. Requires separate sign-off. The script accepts `--prod`,
   which asserts the PROD ref before doing anything.
3. **Population B** (no fallback row anywhere) — out of scope per the task.
   The Yellow Post breakdown above shows 23 such rows in that one name family
   alone.
4. **Entity-resolution duplicates** (Serrano, Boulder Basin) — out of scope
   per the task, and **not independently confirmed here**. What was actually
   measured is only a name-substring count: `canonical_name ilike '%Serrano%'`
   returns 12 `master_place` rows and `'%Fawnskin%'` returns 3. Most of those
   are plainly *different* places (Serrano Spring, Serrano Ridge Viewpoint,
   Los Serranos Park), so that count is **not** evidence of duplication. The
   duplicate claim for Serrano Campground / Boulder Basin comes from the
   prior investigation, not from this session.

## Scope note — what was built beyond the literal ask

- `--method` — load-bearing; the llm/template split is the finding, and there
  was no way to express "ran one half, held the other" without it.
- `--undo` + timestamped snapshot — not requested, but `CLAUDE.md`
  §"Source integration workflow" requires a measured snapshot before any
  corpus-mutating run, so this is the repo's own discipline, not invention.
- **`--prod` — unrequested configurability, and the weakest of the three.**
  The task said TEST only and that PROD needs separate sign-off. The named
  precedent (`backfill-osm-templated-descriptions.ts`) uses a hard TEST-only
  guard and would require a code edit to ever target PROD. Adding the flag
  makes the PROD path explicit and reviewable, but it also makes PROD one
  argument away instead of one diff away. If the stricter posture is
  preferred, deleting the flag and the `PROD_REF` constant is a four-line
  change.
- `p-limit(8)` concurrency — the cited precedent writes sequentially. Uses an
  existing dependency; cuts the run from ~9 min to ~90 s. Minor added moving
  part.

## Reversal

`npx tsx --env-file=.env scripts/backfill-description-from-generated-content.ts --undo`
restores every row in the newest snapshot to its prior value. The snapshot
records the pre-write `description` per row and the script refuses a snapshot
whose `project_ref` doesn't match the connected project.
