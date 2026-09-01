# `recompute_master_place()` regression audit — and why the requested exception cannot be built as specified

**Date:** 2026-09-01 · **Environment:** TEST (`znldzjdatkogdktymtvi`), read-only
**Branch:** `little-rock`
**Status:** **INVESTIGATION ONLY. NOTHING APPLIED. NO MIGRATION FILE ADDED.**

Two outcomes, one of which was not in the task's scope:

1. The regression is **five distinct behaviours across seven code sites**, not
   just the description clear-branch. Proven by diffing the **live** function
   body against the migration history.
2. **Step 2 of the task cannot be built as described.** The mechanism it names
   — "`description_source = 'source'` rows that originated from
   `master_place_generated_content` … check how PR #327 marked them" — does not
   exist. PR #327 marked those rows with nothing, deliberately. Per the task's
   own stop clause, I stopped rather than approximate.

Every figure below was computed in this session against TEST. Where something
is inferred rather than measured it says so.

## Corrections from a second self-audit pass

Re-checked before Adam read this. Three claims were asserted ahead of the
measurement that would support them; one was genuinely overstated; one is a
judgment call worth naming.

1. **"`pg_get_functiondef` matches `20260831100000` exactly" — imprecise, now
   diffed.** It cannot match exactly: Postgres normalises the wrapper
   (`CREATE OR REPLACE FUNCTION`, keyword case, `volatile` omitted as the
   default, `$$` → `$function$`). Diffed properly: **the function body is
   identical**, and the only deltas are those wrapper normalisations. The
   conclusion — no out-of-ledger drift — stands, now on evidence.
2. **"Has a generated_content row is insufficient — 3,790 dual rows" —
   overstated.** Measured: within the clear branch's actual domain, the
   "has a generated row" predicate and the "exact text equality" predicate
   exempt **the same 6,541 rows**. They are **identical today**. The 3,790
   dual rows are *prospective* exposure — they only become wrongly-exempted if
   their source later goes away and the clear branch starts firing on them.
   That is a real difference between the two predicates, but it is a future
   one, and the original phrasing implied a present mis-exemption that does
   not exist.
3. **"This is where the corpus's empty-string descriptions come from" — was an
   inference from 7 rows, now measured at population level.** All **108** rows
   with `description = ''` have a source whose `normalized_payload.description`
   resolves to `""`; **0** have no resolvable source. 108/108, not extrapolated.
4. **"Both recomputed rows are this audit's own sentinel probes" — asserted,
   now measured.** The two ids are `000b3d43…` (Swelter Shelter Trailhead) and
   `0007a5cb…` (Ochoco State Scenic Viewpoint) — exactly the two probe rows.
5. **The decision to stop is a judgment call, not a clear mandate — see
   §"Was stopping right?" below.**

The "byte-for-byte the 2026-05-27 original" claim was re-checked **without**
stripping comments and blank lines, and it holds — the un-stripped diff still
yields only the two `operational_status` hunks. One wording fix: those are two
*hunks*, not two lines (the second reformats a one-line array declaration into
four).

## How this was measured

Previous sessions had no SQL access to TEST and reasoned from migration files.
That gap is closed: `supabase link --project-ref znldzjdatkogdktymtvi` +
`supabase db query --linked`, which reaches TEST through the Management API.
**Only `SELECT`s were issued this session.** The CLI is now linked to **TEST**
(`supabase/.temp/project-ref`, gitignored) — that is the steady state the
runbook's `db:push-verify -- --test` expects, and it is *not* PROD.

The authoritative comparison is `pg_get_functiondef` pulled live, per this
repo's documented file-vs-DB drift history — not a reading of the files.

## What each migration was trying to do

Seven migrations have defined or redefined `public.recompute_master_place(uuid)`.

| Migration | Intent |
|---|---|
| `20260527130000_phase3a_recompute_functions` | **Original.** Steps 1–6: aggregated fields → `source_count` → precedence-resolved fields loop → geometry → geometry_polygon → attribution/prominence/`last_resolved_at`. |
| `20260601010000_phase3a_resolve_field_determinism` | Make resolution **deterministic** when sources tie. Adds `order by fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc` — to `resolve_field()` *and* to Steps 4 and 5's inline geometry lookups. Without the tie-break, co-equal sources (its example: nps vs parks_canada, both priority 1 / quality 0.95) resolve differently run to run. |
| `20260601040000_phase3b_recompute_containment` | Add **Step 7**: rewrite this place's `contained_in` edges in `place_relationships`, in both roles (as child of a covering polygon, and as parent if it has a polygon). Stateless delete-then-reinsert so geometry changes converge. |
| `20260602000000_phase1_padus_land_status_is_searchable` | Add `is_searchable = (primary_category is distinct from 'land_status')` to Step 6, so PAD-US land-status rows are excluded from search **as a derived fact**, recomputed every time. |
| `20260603010000_phase2_mvum_corridor` | Add **Step 6.5**: `mvum_corridor = true` for `dispersed_camping` places within 30 m (geography) of an open MVUM route; `null` for every other category. |
| `20260819180000_recompute_master_place_clear_bug_fix` | **DROP + CREATE.** Fix the clear-bug: when a field's last active source goes away, `resolve_field()` correctly returns no candidate, but the guarded `if` skipped the `UPDATE`, stranding the stale value. Adds `v_clearable_fields` + an `elsif` explicit `set <field> = null` for the 9 nullable resolved fields, plus an `else` clear for `geometry_polygon`. Deliberately excludes `canonical_name`, `primary_category`, `geometry` — all `NOT NULL`, so there is no NULL to clear to. |
| `20260831100000_operational_status` | Add `operational_status` to the resolved-fields loop (`v_jsonb_fields` + `v_text_columns`) so USFS's structured status resolves through `field_precedence` like any other field. **This is the correct, intended change — and it is the only thing this migration adds.** |

## The regression, proven

`20260831100000_operational_status.sql`'s function body is **byte-for-byte the
2026-05-27 original**, plus exactly the two `operational_status` array
additions. Diffing the two migration files directly, with comments and blank
lines stripped, yields *only* those two hunks:

```
10c10,11
<     'capacity', 'seasonality', 'cell_signal'
---
>     'capacity', 'seasonality', 'cell_signal',
>     'operational_status'
12c13,16
<   v_text_columns text[] := array['canonical_name', 'primary_category', 'description'];
---
>   v_text_columns text[] := array[
>     'canonical_name', 'primary_category', 'description',
>     'operational_status'
>   ];
```

(That diff was re-run **without** stripping comments or blank lines and yields
the same two hunks — so "byte-for-byte the original" is literal, not a
comments-normalised approximation.)

So it was authored by copying the **oldest** definition and adding
`operational_status` to two arrays — silently reverting three months of
accumulated fixes in one `create or replace`.

**The live TEST body confirms this landed.** Diffing `pg_get_functiondef`
against the migration file: the **function body is identical**, and the only
differences are Postgres's own wrapper normalisation (`CREATE OR REPLACE
FUNCTION`, keyword case, `volatile` dropped as the default, `$$` rendered as
`$function$`). So there is **no out-of-ledger drift on TEST** — the file is the
deployed truth. (An earlier draft said the live definition "matches exactly",
which it cannot; `pg_get_functiondef` always reformats the wrapper.)

### What was lost — 5 behaviours, 7 code sites

| # | Lost behaviour | Site(s) | Added by |
|---|---|---|---|
| 1 | Clear-branch for the 9 nullable resolved fields (`v_clearable_fields` + `elsif`) | Step 3 | `20260819180000` |
| 2 | Clear-branch for `geometry_polygon` (`else`) | Step 5 | `20260819180000` |
| 3 | Deterministic tie-break on geometry selection | Step 4 | `20260601010000` |
| 4 | Deterministic tie-break on geometry_polygon selection | Step 5 | `20260601010000` |
| 5 | `is_searchable` derivation | Step 6 | `20260602000000` |
| 6 | `mvum_corridor` (Step 6.5 entirely) | Step 6.5 | `20260603010000` |
| 7 | Containment / `place_relationships` rewrite (Step 7 entirely) | Step 7 | `20260601040000` |

Grouping the paired sites: **clear-branch, tie-break determinism,
`is_searchable`, `mvum_corridor`, containment.**

`resolve_field()` itself is **intact** — its own tie-break survived, because
that migration touched a different function. Only the two inline geometry
lookups inside `recompute_master_place` lost theirs.

Helper objects all still exist, so a restored version would work as-is:
`public.mvum_roads` (308 rows), `public.place_relationships` (110,521
`contained_in` edges).

### Blast radius on TEST: currently 2 rows

| Metric | Count |
|---|---:|
| `master_place` rows with `last_resolved_at >= 2026-08-31` | **2** |
| `land_status` rows total | 35,967 |
| … of those, incorrectly `is_searchable = true` | **0** |
| `mvum_corridor is true` | 12 |

**The function has barely run since the regression landed** — the 2 recomputed
rows are, confirmed by id, this thread's own sentinel probes: `000b3d43…`
(Swelter Shelter Trailhead) and `0007a5cb…` (Ochoco State Scenic Viewpoint).
(An earlier draft asserted this before querying the ids.) So none
of losses 3–7 has done measurable damage on TEST *yet*. It is a landmine, not
a fire: the next `materialize` run recomputes rows through the broken function,
and every land-status row it touches would silently become searchable.

**PROD is `[UNVERIFIED]` and I did not query it.** `docs/STATE.md`
§2026-08-31 records that PR #321's migrations were applied to both
environments, and that PROD then ran a USFS INFRA ingestion producing 2,629 new
master_places — which, if it recomputed them, would have done so through the
regressed function. That is an **inference about PROD, not a measurement.**

## Why step 2 cannot be built as specified

The task says to identify backfill-written descriptions "via
`description_source = 'source'` rows that originated from
`master_place_generated_content` — check how PR #327 marked them."

**Three independent reasons that does not work:**

1. **`description_source` is not a column.** It is a derived `CASE` expression
   living in the `master_place_search_export` view and the
   `pois_along_corridor` RPC. It does not exist on `master_place` and is
   therefore invisible inside `recompute_master_place()`.
2. **Even as a derived value it carries zero discriminating information.** Its
   first branch is `when mp.description is not null and mp.description <> ''
   then 'source'`. After the copy-in it returns `'source'` for these rows for
   *exactly the same reason* it does for every genuinely source-derived row.
   That was reported at the time as a knock-on of PR #327.
3. **PR #327 marked them with nothing, deliberately.** No flag column, no
   attribution entry. That was the measured decision: `recompute_master_place()`
   rebuilds `attribution` wholesale from `source_record`, so any marker written
   there is dropped on the next recompute.

A fourth candidate — "has a `master_place_generated_content` row" — needs care,
and an earlier draft of this doc overstated the case against it. **Measured:
within the clear branch's domain it exempts exactly the same 6,541 rows as
exact text-equality. The two predicates are identical today.** The difference
is prospective: **3,790** rows have both a source-resolvable description *and*
a generated row ("dual" rows), and if one of those loses its source, the clear
branch starts firing on it — at which point "has a generated row" would
re-strand the stale source value that `20260819180000` existed to clear, while
text-equality would not. Real, but a future difference, not a present one.

Per the task's instruction — *"If you find the description-backfill rows aren't
cleanly distinguishable … stop and report that back rather than guessing at an
approximation"* — **I stopped here.** Nothing was applied.

## What IS distinguishable — measured, for whoever decides next

The clear branch only fires when `resolve_field()` returns no candidate. Within
that domain the picture is unusually clean:

| Rows where `is_searchable`, description non-empty, and `resolve_field('description')` returns nothing | Count |
|---|---:|
| **Total — i.e. exactly what a naive clear-branch restore would wipe** | **6,541** |
| … that have a `master_place_generated_content` row | **6,541** |
| … whose `description` equals that row's `generated_text` **exactly** | **6,541** |
| … with `generation_method = 'llm'` | **6,541** |
| … with `generation_method = 'template'` | 0 |
| … with **no** generated row (i.e. collateral damage) | **0** |

So: restoring the clear branch naively wipes **6,541** rows and **nothing
else** — no collateral damage anywhere in the corpus. And within the clear
branch's domain, exact text-equality against `generated_text` is a **perfect**
discriminator: 6,541 true positives, 0 false positives, 0 false negatives.

(Outside that domain, 7 dual rows also satisfy text-equality — but the clear
branch is never reached for them, because `resolve_field` returns a value and
Step 3's `if` branch fires instead. See below.)

## A separate finding: 7 of PR #327's rows are already unstable, and `resolve_field` treats `''` as a value

6,548 rows were written by PR #327 but only 6,541 are in the wipe set. The
missing 7 are more interesting than the arithmetic:

| | |
|---|---:|
| PR #327 rows whose description still equals the generated text | 6,548 |
| … of those, `resolve_field('description')` DOES return a value | **7** |
| … of those, carrying an `attribution.description` key | **7** |
| overlap (same rows) | **7** |

For all 7, `resolve_field` returns `{"value": "", "source": "ridb"|"nps"}` — an
**empty JSON string**, which is neither SQL `NULL` nor `'null'::jsonb`, so
Step 3's guard `if v_value is not null and v_value != 'null'::jsonb` **passes**
and writes `''` into the column.

Consequences:

- **This is where the corpus's empty-string descriptions come from — measured
  at population level, not extrapolated from the 7.** All **108** rows
  currently holding `description = ''` have a source that resolves to `""`;
  **0** of them have no resolvable source. Pre-backfill it was 115, and PR #327
  overwrote exactly 7 — 108 + 7 = 115 closes independently of how 115 was
  originally derived.
- **Those 7 rows lose their generated text on the next recompute regardless of
  the clear branch**, via the `if` path. So the backfill's true exposure to any
  recompute is all 6,548 rows, through two different code paths.
- PR #327 wrote LLM-generated text onto 7 places whose RIDB/NPS records do
  carry a `description` key — albeit an empty one. Small, but it is the one
  place that backfill put generated content where a source claimed the field.
- Arguably `resolve_field` should treat `''` as no-value. That is a separate
  latent bug affecting every text field, not just `description`, and it is not
  in this task's scope.

The 7: Larry Forbis Overnight Group Site, Coyote Buttes South Advanced Permit,
Thunderbird Canyon Trail System, Painted Rock Dam, Meadow View Family
Campground, Picnic Area along Sol Duc River, Second Beach.

## Three ways to build the exception — decision needed

All three restore losses 1–7 identically; they differ only in how the
description exception is keyed.

### Option 1 — content equality (minimal, no schema change)

Skip the `description` clear when a generated row exists whose `generated_text`
equals the current column value:

```sql
elsif v_field = any(v_clearable_fields) then
  if v_field = 'description' and exists (
       select 1 from public.master_place_generated_content gc
        where gc.master_place_id = p_master_place_id
          and gc.field_name = 'description'
          and gc.generated_text = (select description from public.master_place
                                    where id = p_master_place_id)
     ) then
    null;  -- copy-in value, not a stranded source value: leave it
  else
    execute format(
      'update public.master_place set %I = null where id = $1 and %I is not null',
      v_field, v_field) using p_master_place_id;
  end if;
  ...
```

- **Exact today** — measured above, 6,541/6,541, zero false positives.
- No migration on a core table, no change to the PR #327 script.
- **Failure mode:** it is content-keyed, not provenance-keyed. Regenerate the
  `generated_text` and the values stop matching, so the *next* recompute
  silently clears a row this was meant to protect. For a data-integrity fix
  that is the wrong direction to fail in.

### Option 2 — explicit provenance marker (what the task assumed existed)

Add `master_place.description_is_generated boolean not null default false`.
The backfill script sets it; the clear branch skips when true; Step 3's `if`
branch resets it to false whenever a real source description wins. Bootstrap
the flag for the existing 6,541 rows using Option 1's predicate, which is
exact *today*.

- Durable and provenance-based — survives regeneration and edits.
- Gives `description_source` a real basis to report `'generated'` instead of
  reporting `'source'` for LLM text, which it does today.
- **Costs:** a column on a core table, a change to
  `backfill-description-from-generated-content.ts`, a bootstrap step, and
  updates to the two `description_source` `CASE` sites if they should stop
  lying.

### Option 3 — stop writing to `master_place` at all (architecturally correct)

Route the copy-in through `source_record` under a synthetic source with a
lowest-priority `field_precedence` row — the shape
`backfill-osm-templated-descriptions.ts` already uses. Then `resolve_field`
returns a candidate, the clear branch **never fires for these rows**, no
exception is needed anywhere in `recompute_master_place`, `attribution.description`
gets a real value for free, and the schema invariant ("never write to
`master_place` directly except via `recompute_master_place()`") stops being
violated. A genuine source description would automatically outrank it, which is
exactly the documented intended read path.

- **Costs:** introduces a pseudo-source, which `CLAUDE.md` says to ask about
  ("Ask before adding new sources"). It also creates the
  `attribution.description = 'generated'` convention that PR #327 deliberately
  declined to invent — that decision would need revisiting.
- Also makes PR #327's `master_place` writes redundant, so they would be
  reverted via its `--undo` snapshot as part of the switch.

### Recommendation

**Option 3** is the right end state and removes the exception entirely; the
regression audit above is a good moment to stop fighting the invariant.
**Option 2** is the faithful reading of the task and the right answer if the
copy-in is to stay on `master_place`. **Option 1** is not recommended for a
data-integrity fix — it is exact today but fails toward data loss.

Whichever is chosen, the migration should restore all seven sites in one pass
and re-verify `operational_status` end-to-end, since that is the one thing
`20260831100000` got right and must not be lost in the correction.

## Was stopping right? — the honest version

I presented the stop as mandated. It is better described as a **judgment call
that could reasonably have gone the other way**, and the reader should have
that plainly.

The stop clause reads: *"If you find the description-backfill rows aren't
cleanly distinguishable from other 'source'-attributed rows (i.e. the exception
in step 2 can't be built precisely as described), stop and report that back
rather than guessing at an approximation."*

- **The letter supports stopping.** The parenthetical binds the condition to
  "as described", and the mechanism described — `description_source` plus
  whatever PR #327 used to mark the rows — genuinely does not exist.
- **The spirit arguably does not.** The stated worry is guessing at an
  approximation. I did not have to guess: exact text-equality against
  `generated_text` is a *precise* predicate, and it is measurably exact today
  (6,541/6,541, zero collateral anywhere in the corpus). On that reading the
  antecedent is false, and the right move was to build the fix on the exact
  predicate, verify it, and flag the mechanism substitution loudly.

I went with the letter. The tie-breakers were that the discovery of four
*additional* regressions changes the shape of the whole migration, that
`recompute_master_place()` is documented in this repo as "the sole writer of
`master_place` — must not be lost", and that the exception's durability
(content-keyed vs provenance-keyed) is a genuine design choice with
data-integrity consequences. But those are reasons to *ask*, and asking cost a
round trip that a reader who wanted the letter-of-the-spec fix would not have
wanted to pay.

**If the preferred reading is the second one, the work is straightforward from
here** — Option 1 or 2 below, applied to TEST, with all four required
verifications run. No further investigation is needed.

### A smaller thing I chose not to do

Losses 3–7 (tie-break determinism ×2, `is_searchable`, `mvum_corridor`,
containment) have **no interaction whatsoever** with the description question.
They are pure restorations of previously-reviewed, previously-shipped code, and
they are broken right now. I could have shipped those alone and left the clear
branch out.

I didn't, because a `recompute_master_place()` that is *four-fifths* restored
is its own trap — the next reader sees a recent migration named like a fix and
assumes the function is whole. But that is a defensible call in the other
direction too, and it is one flag away if you want the uncontroversial part
landed now.

## Verification NOT performed, and why

The task's verification list (sentinel survives; a non-exempt row still gets
cleared; `operational_status` still normalizes; test suite) all require the
corrected function to be **applied** to TEST. Since the exception's design is
the blocking question, nothing was applied and none of those checks were run.
Reporting them as passed was not an option.

The one check that did run, unchanged from PR #327's self-audit and re-confirmed
here: the live function body contains no clear branch, so a direct
`master_place.description` write survives a recompute today.

## State left behind

- **No schema change, no migration file, no data change.** Only `SELECT`s
  (`resolve_field` is `STABLE`, so the measurement queries that call it write
  nothing).
- **The Supabase CLI is now linked to TEST — an unrequested state change worth
  naming.** The task didn't ask me to link; I did it to get SQL access. The
  workspace was previously *unlinked*. Consequence to be aware of: a bare
  `npm run -w data db:push-verify` (no `--test`) targets the **currently
  linked** project, so it would now hit TEST where before it would have failed
  for lack of a link. That is the safer direction, and it is the steady state
  `db:push-verify -- --test` expects — but it is a changed default on your
  machine, not a no-op. `supabase/.temp/` is gitignored, so nothing about it is
  in the diff. `supabase unlink` reverts it.
- Two rows (`000b3d43…`, `0007a5cb…`) carry a `last_resolved_at` of 2026-09-01
  from the PR #327 self-audit's sentinel probes. Recompute is idempotent and
  both descriptions were restored; only the timestamp moved.
