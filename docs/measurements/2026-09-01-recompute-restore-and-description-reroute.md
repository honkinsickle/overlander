# `recompute_master_place()` restored + generated descriptions rerouted — TEST

**Date:** 2026-09-01 · **Environment:** TEST (`znldzjdatkogdktymtvi`)
**Branch:** `description` (PR branch `little-rock`)
**Applied to TEST. PROD untouched.**

Closes both open threads: the five regressions from `20260831100000`, and the
invariant-violating direct writes from PR #327. Every number here was computed
in this session. Samples are labelled as samples.

## 1. What each restored piece does

`20260831100000_operational_status.sql`'s function body is the 2026-05-27
original plus two hunks adding `operational_status` to two arrays — so one
`CREATE OR REPLACE` reverted five behaviours across seven code sites.

| # | Restored | Site | From | What it does |
|---|---|---|---|---|
| 1 | Clear-branch, 9 nullable resolved fields | Step 3 | `20260819180000` | When a field's last active source goes away, `resolve_field()` returns no candidate. The pre-fix guarded `if` then skipped the UPDATE, stranding the old value forever. The branch writes an explicit NULL. `canonical_name`/`primary_category`/`geometry` stay excluded — all NOT NULL, nothing to clear to. |
| 2 | Clear-branch, `geometry_polygon` | Step 5 | `20260819180000` | Same bug, the one non-JSONB nullable column. |
| 3 | Tie-break determinism, geometry | Step 4 | `20260601010000` | Steps 4/5 pick geometry with their own inline queries, **not** via `resolve_field` (whose tie-break survived). Ordering by priority alone leaves co-equal sources arbitrary, so the chosen point could differ run to run. Full key: priority, `source_quality_score desc nulls last`, `source_id asc`. |
| 4 | Tie-break determinism, `geometry_polygon` | Step 5 | `20260601010000` | Same, for the polygon lookup. |
| 5 | `is_searchable` derivation | Step 6 | `20260602000000` | A derived fact recomputed every call: `land_status` excluded from search, everything else (incl. NULL category, via `is distinct from`) searchable. Without it a row that becomes `land_status` keeps a stale flag and leaks into the export view and Typesense. |
| 6 | `mvum_corridor` (Step 6.5, entirely) | Step 6.5 | `20260603010000` | `dispersed_camping` within 30 m (geography — the `::geography` casts are load-bearing; without them the unit is degrees) of an open MVUM route. NULL for other categories. |
| 7 | Containment (Step 7, entirely) | Step 7 | `20260601040000` | Rewrites this place's `contained_in` edges in both roles (child of a covering polygon; parent of points it covers), delete-then-reinsert so geometry changes converge. |

`operational_status` resolution from `20260831100000` is **kept verbatim** —
this restores what that migration broke, it does not revert it.

**Proof the restore is faithful:** the new function was generated
programmatically from `20260819180000`'s text, and `diff`ed against it. The only
deltas are the intended ones (operational_status ×2 arrays, the `source_count`
exclusion, comments). All seven sites then re-verified against the **live**
function via `pg_get_functiondef` after apply — 10/10 checks pass.

## 2. A deviation I made, that was wrong, and how it was caught

`20260901000200` also added `operational_status` to `v_clearable_fields`,
reasoning that it is a nullable precedence-resolved text column like the other
nine, so leaving it out would expose it to the very clear-bug being fixed.

**Sound in principle, wrong against the data.** Measured immediately after
apply:

```
select count(*) from source_record
 where is_active and normalized_payload ? 'operational_status';   -->  0
```

Not one `source_record` carries the field where `resolve_field()` looks. Every
value in `master_place.operational_status` was written **directly** by
`data/scripts/backfill-operational-status.ts`, which reads
`raw_payload->'props'->>'seasonal_operational_status'`. 6,324 active `usfs`
records carry the RAW field; **0** carry the normalized one. So `resolve_field`
returns nothing for every row, and with the field in the clearable list every
recompute erased it.

Caught by this branch's own verification step — a recompute of a row with
`operational_status = 'CLOSED'` left it NULL. **One row was lost** (246 → 245),
restored by re-running the PR #321 backfill (246 again, matching baseline).
Reverted by `20260901000500`.

This is structurally the same defect the branch exists to fix: a value written
directly into `master_place`, invisible to the function that owns the column.
PR #321's migration claims to implement operational_status "via the
field_precedence pattern", but for existing data that path is **not wired** —
the USFS normalizer emits it for *new* ingests only. Filed in `docs/BACKLOG.md`.

## 3. The reroute

PR #327's direct writes were reverted first via its `--undo`: **6,548 rows
restored**, and the corpus returned to its pre-backfill values exactly —
empty-string descriptions back to **115**, searchable rows with a non-empty
description back to **19,688**.

Population then re-verified, unchanged from the prior session:

| | Count |
|---|---:|
| `master_place_generated_content`, `field_name='description'` | 17,725 |
| Population A (`is_searchable`, empty description) | **13,942** |
| … `generated_llm` | **6,548** |
| … `generated_template` | **7,394** |
| dual (description already resolved — skipped) | **3,782** |
| `needs_review = true` (excluded) | 1 |

The task's figure for dual-skip was 3,783; the measured value with
`needs_review = false` applied is **3,782**. The difference is the single
`needs_review` row, correctly excluded. 13,942 + 3,782 + 1 = 17,725.

**Result: 13,942 `source_record`s upserted, 13,942 recomputes, 0 failed.**

| | Count |
|---|---:|
| `description` == the generated text | **13,829** |
| `attribution.description` == the generated source | **13,829** |
| a REAL source with text outranked the generated one | **0** |
| still empty | **113** |

The 113 are exactly the rows where a real RIDB/NPS record resolves
`description` to an **empty JSON string**. Precedence correctly preferred the
real source; the real source's value is `""`. This is *better* than PR #327's
direct write, which overwrote 7 of them with generated text. Split: 106
template + 7 llm = 113, and 7,394 − 106 = **7,288** template-attributed rows,
6,548 − 7 = **6,541** llm-attributed — both match the measured attribution
counts.

## 4. The four verifications

| Test | Result |
|---|---|
| **T1** Rerouted row survives recompute (twice) via the proper path | **PASS** — `000b3d43…` description unchanged, `attribution.description = generated_llm` |
| **T2** A row with no exemption still clears under the restored conditions | **PASS** — deactivating its only description source ⇒ `description` NULL; reactivating restores it exactly |
| **T3** `operational_status` normalization still works | **PASS** (after the `20260901000500` correction) — value `CLOSED` preserved across recompute; count back to **246** |
| **T4** Test suite | **PASS** — `npm run -w data test`: **32 files, 626 passed, 3 skipped**, exit 0 |

T1 is the point of the whole design: the description survives **because
`resolve_field()` re-derives it**, not because anything exempts it.

Gates: `npm run -w data typecheck` 0 · `npm run -w web typecheck` 0 ·
`cd web && npx next build` 0 · `npm run -w data test` 0.

## 5. Zero collateral

The check from the prior session — "how many rows would a clear-branch restore
wipe?" — re-run against the corrected, rerouted data:

```
rows a clear branch would still wipe:  0
```

Before the reroute that number was 6,541. **The exemption is not merely
avoidable, it is unnecessary.**

### Corpus deltas, baseline → after

| Metric | Baseline | After | |
|---|---:|---:|---|
| `master_place` total | 161,256 | 161,256 | — |
| searchable | 125,289 | 125,289 | — |
| searchable with a non-empty description | 19,688 | **33,517** | +13,829, intended |
| `description = ''` | 115 | 115 | — |
| `land_status` wrongly searchable | 0 | 0 | — |
| `mvum_corridor is true` | 12 | 12 | — |
| `operational_status` set | 246 | 246 | — |
| `master_place_search_export` rows | 33,047 | 33,047 | — |
| avg prominence (searchable) | 0.8606 | **0.8606** | neutrality confirmed |
| `source_record` total / active | 171,184 / 79,739 | 185,126 / 93,681 | +13,942, intended |
| `sum(source_count)` | 75,189 | 75,172 | −17, explained below |
| `contained_in` edges | 110,519 | 106,335 | −4,184, explained below |

**`sum(source_count)` −17.** Not generated-source leakage — that would be
+13,942. Measured: rows whose stored `source_count` disagrees with a fresh
count of active non-generated records = **0 among the rerouted set**, and **30
corpus-wide**. All 30 are outside the rerouted set, i.e. pre-existing staleness
on rows that have not been recomputed in a long time. The −17 is the correction
of that staleness on the rows this run touched.

**`contained_in` −4,184.** Step 7 was restored and rewrites edges for every
recomputed place, so stale edges were corrected. Verified by sampling (arbitrary
`limit`, **not** randomized — these are samples, not population rates):

| Sample | Edges checked | Not supported by a live `st_covers` |
|---|---:|---:|
| Edges whose child was rerouted | 3,000 | **0** |
| Edges whose child was **not** rerouted | 3,000 | **518** |

Every edge Step 7 rewrote is backed by live geometry; a substantial share of the
untouched ones are not. That is pre-existing staleness from containment not
having run since the regression — a corpus-wide containment recompute is worth
scheduling. Filed in `docs/BACKLOG.md`; **not done here** (161k rows).

## 6. ADR 2026-08-21 §2 — template rows still excluded

Checked at corridor scale, not on one row. `pois_along_corridor` over a
four-point LA → Sacramento → Redding route at the production 16 km buffer:

| | Count |
|---|---:|
| rows returned | **815** |
| `attribution.description = 'generated_template'` | **0** |
| `attribution.description = 'generated_llm'` | 204 |
| `description_source = 'llm'` | 204 |
| `description_source = 'source'` | 609 |
| `description_source = 'template'` | 1 |
| `description_source` null | 1 |

**Zero template-sourced rows surface.** The ADR holds.

The single `description_source = 'template'` row is
`Shasta-Trinity National Forest - Centimudi Boat Ramp`, and it is **not**
generated-sourced: `attribution.description = 'ridb'` and its `description` is
the **empty string**. The legacy exclusion tests `mp.description is null`,
which is false for `''`, so it slips through and falls to the legacy
`has_template` branch of the `CASE`. **Pre-existing, not introduced here** — it
had `''` before the reroute too and would have been returned identically. Same
root cause as the `resolve_field` empty-string bug. Flagged, not fixed: it is a
display-surface behaviour change that was not in scope.

## 7. Still open

- **PROD.** The task states the regression is "confirmed live on PROD". It is
  **not confirmed by me** — I have never queried PROD, and did not this session.
  The claim rests on the migration file plus `STATE.md`'s record that #321 was
  applied to both. A read-only `pg_get_functiondef` against PROD would settle
  it in seconds and needs only authorization.
- `resolve_field()` treating `''` as a value — 115 rows, and the cause of the
  113 that could not take generated text.
- `operational_status` not resolvable from `normalized_payload` (see §2).
- Corpus-wide containment recompute (see §5).
- Typesense re-sync for the corrected `description_source`.
- Dual rows not given a generated fallback (see the ADR's Consequences).
