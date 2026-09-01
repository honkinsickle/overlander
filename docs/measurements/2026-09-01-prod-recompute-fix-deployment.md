# PROD deployment — `recompute_master_place()` fix + description reroute

**Date:** 2026-09-01 · **Environment:** PROD (`nqzeywzcowujzyegxbsr`), write
**Authorized by:** Adam, explicitly, including the known content-loss side effect
**Outcome:** migrations applied and verified · reroute a no-op · **repair
recompute NOT run — blocked on a side effect the authorization did not cover**

Every figure below was measured in this session against the environment named.
Nothing is carried over from the TEST run.

## 1. Pre-flight (three gates, all passed)

| Gate | Result |
|---|---|
| Refs aligned on both sides | `data/.env` → `nqzeywzcowujzyegxbsr`, CLI link → `nqzeywzcowujzyegxbsr` |
| Only the intended migrations pending | exactly `20260901000100`–`000500`; **0** PROD ledger versions with no local file |
| Live state matches expectation | pre-apply function = 4,881 chars, no `v_clearable_fields`, no `mvum_corridor`, no `place_relationships` — the regressed body |

`data/.env` was backed up to
`~/.config/overlander/env-backups/.env.test-preop-recompute-fix-prod-20260901-005039`
before the swap, and only the two credential lines were replaced (line count
preserved, 21 → 21). The PROD service key was probed read-only first
(PostgREST HTTP 200) rather than assumed valid. `data/.env` is gitignored, so
credentials were never at risk of being committed.

## 2. Apply

Bare `npm run -w data db:push-verify` — the documented production path, which
targets the currently-linked project. All five applied in ledger order. The
verifier reports each as DDL, "not verified (v1 limitation)", which is its
documented behaviour for `CREATE FUNCTION` / `DROP` — hence the explicit
definition diff below rather than trusting a green verify.

## 3. Drift check — PROD vs TEST, byte-identical

Pulled `pg_get_functiondef` / `pg_get_viewdef` from both environments and
diffed:

| object | PROD | TEST | diff |
|---|---:|---:|---|
| `recompute_master_place(uuid)` | 11,734 chars | 11,734 | **identical** |
| `compute_prominence(uuid)` | 1,314 | 1,314 | **identical** |
| `is_generated_source(text)` | 218 | 218 | **identical** |
| `pois_along_corridor(jsonb,integer,text[])` | 4,226 | 4,226 | **identical** |
| `master_place_search_export` (view) | 2,254 | 2,254 | **identical** |

`field_precedence` description rows for the generated sources: `generated_llm`
priority 20, `generated_template` 21 — same on both. **No environment-specific
drift.**

## 4. The reroute is a no-op on PROD

| | PROD |
|---|---:|
| `master_place_generated_content` rows | **0** |
| … with `field_name = 'description'` | **0** |
| `source_record` in `generated_llm` / `generated_template` | **0** |

There is no generated content on PROD to route anywhere. Stated plainly and
skipped rather than forced into a no-op run, per the task's instruction.
Backfilling PROD the way TEST was backfilled would require running generation
on PROD first — a separate piece of work, not a deployment step.

## 5. Verifications — all four pass

| Test | Result |
|---|---|
| **T1** value delivered through the proper path survives recompute | **PASS** — `0010b6c0…` description and `attribution.description = usfs` both unchanged across two consecutive recomputes; `last_resolved_at` moved, proving the body ran |
| **T2** a row with no exemption still clears, and restores | **PASS** — deactivating its sole description source cleared both `description` and `attribution.description` to NULL; reactivating restored both exactly. Source record confirmed `is_active = true` by an independent re-read |
| **T3** `operational_status` normalization intact | **PASS** — `CLOSED` preserved across recompute on `01111953…` |
| **T4** test suite | **PASS** — `npm run -w data test`: 32 files, **626 passed, 3 skipped**, exit 0 |

The T2 subject was deliberately chosen **outside the six-state footprint** and
with exactly one description-bearing source, so its transient cleared state was
never visible in search and the restore was unambiguous.

Gates: `data typecheck` 0 · `web typecheck` 0 · `data test` 0.

## 6. Post-apply state — zero data change

All seventeen baseline metrics are identical before and after:

| metric | pre-apply | now |
|---|---:|---:|
| `master_place` total / searchable | 28,348 / 28,348 | 28,348 / 28,348 |
| rows with a real (non-empty) description | 13,955 | 13,955 |
| `description = ''` | 96 | 96 |
| `land_status` and searchable | 0 | 0 |
| `mvum_corridor` true / false / null | 52 / 2,810 / 25,486 | 52 / 2,810 / 25,486 |
| `contained_in` edges | 6,217 | 6,217 |
| `source_record` total / active | 37,845 / 29,555 | 37,845 / 29,555 |
| `operational_status` set | 50 | 50 |
| `master_place_search_export` rows | 21,965 | 21,965 |
| avg prominence (searchable) | 2.915338 | 2.915338 |
| `sum(source_count)` | 30,379 | 30,379 |
| regression batch (`last_resolved_at >= 2026-08-31`) | 2,732 | 2,732 |
| `master_place_generated_content` rows | 0 | 0 |

Rows recomputed since the apply: **2** — `Muddy River Picnic Site` and
`LAUGHING WATER TH 98-UPPER`, the two verification subjects, both restored.

**PROD is now protected against further regression damage, and no existing
damage has been repaired.** Those are two different things, and only the first
has happened.

## 7. The blocker

**Applying a migration does not recompute anything.** The clear-branch only
clears a row when that row is next recomputed. So:

- the authorized blanking of the stale descriptions has **not** occurred;
- the 2,732-row batch damaged on 2026-08-31 is **still** damaged — its
  `mvum_corridor` values are still NULL and its containment edges still missing.

Realizing both requires deliberately recomputing the affected rows. The two
populations are **disjoint** (overlap measured: **0**):

| population | rows |
|---|---:|
| damaged by the regression (`last_resolved_at >= 2026-08-31`) | 2,732 |
| stale-description rows | 2,725 |
| **union** | **5,457** |

Measured, inside that union, what a recompute **would** clear — with the
non-null count as a control so a zero could not be mistaken for a broken query:

| field | non-null in population | would clear |
|---|---:|---:|
| `description` | 5,367 | **2,725** ← authorized |
| `contact` | 2,050 | **2,000** ← *not* authorized |
| `access` | 463 | **438** ← *not* authorized |
| `amenities` | 210 | **210** ← *not* authorized |
| `hours` | 38 | **38** ← *not* authorized |

The authorization covered descriptions. It did not cover 2,000 contact records,
438 access blocks, 210 amenity sets and 38 opening-hours blocks. **TEST gave no
warning of this** — there, every non-description clearable field measured 0.
This is a PROD-only population difference, which is exactly why the task asked
for step 5 to be re-measured rather than assumed to transfer.

The task said to proceed without further confirmation on decided items but to
**seek it on anything not covered**. This is not covered, so the recompute was
not run.

### This is latent, not avoided

The clearing has not been prevented — it has been deferred. Any normal
ER/materialize run that recomputes these rows will now clear those fields,
incrementally and without anyone watching. The real choice is:

- **a measured batch now**, under supervision, with before/after counts; or
- **a silent drip later**, spread across future pipeline runs.

Doing nothing selects the second option by default.

## 8. State left behind

- Five migrations applied to PROD; ledger consistent.
- No PROD data changed.
- `data/.env` restored from its pre-op backup, **byte-identical**; CLI relinked
  to TEST. Both confirmed **behaviourally** — a TEST-only fingerprint (13,942
  generated source_records + `is_generated_source()` present) that PROD
  measurably lacks — rather than by reading the ref file.
- Dropped a leftover `public._verify_tmp` table that an earlier session created
  on TEST. No such object was created on PROD; the PROD verification used a
  session-scoped temp table instead, so nothing bypassed the ledger.

## 9. What needs a decision

1. **Run the repair recompute?** 5,457 rows. Clears 2,725 descriptions
   (authorized) plus 2,000 contact / 438 access / 210 amenities / 38 hours (not
   authorized). Repairs `mvum_corridor` for the batch — the prior investigation
   put the floor at 449 rows that should be `true` — and at least 58 missing
   containment edges.
2. **Or narrow it:** recompute only the 2,732 regression batch. That repairs
   `mvum_corridor` and containment and, measured, clears **0** descriptions,
   because no stale-description row is inside that batch. It leaves the 2,725
   stale descriptions in place. This option was not requested; noting it because
   it separates "repair the damage" from "accept the content loss", which the
   task's framing had treated as one action.

   > **⚠️ CORRECTION 2026-09-01 (later).** This option was authorized and then
   > measured properly at execution time, and it is **not** clean. The "clears 0"
   > claim above was only ever measured for `description`; the other clearable
   > fields were never measured *for this batch* (they were measured for the
   > 5,457-row union). Measured directly on the 2,732 batch:
   >
   > | field | non-null in batch (control) | would clear |
   > |---|---:|---:|
   > | `description` | 2,642 | **0** ✅ |
   > | `contact` | 66 | **16** ❌ |
   > | `access` | 41 | **16** ❌ |
   > | `amenities`, `hours`, `services`, `capacity`, `seasonality`, `cell_signal` | 0 | — |
   >
   > It is the **same 16 rows** for both fields — measured, not sampled:
   > `contact` 16, `access` 16, both-on-the-same-row 16, distinct rows affected
   > 16. All 16 are `campground`, all in the USFS INFRA batch, all
   > `master_place.created_at` on 2026-05-29 (16/16), and all with exactly **1**
   > active source_record (16/16).
   >
   > **Corrected after a self-audit:** an earlier draft said "each with 3
   > source_records (google, ridb, usfs)" — that was generalised from a 3-row
   > sample and is wrong. Measured across all 16: **13** have three
   > (`google,ridb,usfs`), **3** have two (`ridb,usfs`).
   >
   > **The cause is now measured rather than inferred.** The only source
   > carrying a `contact` payload for these rows is **`ridb`, and it is inactive
   > in all 16 of them** (`[{"src":"ridb","active":false,"n":16}]`). RIDB
   > supplied the values, RIDB's record was deactivated in the six-state trim,
   > and the regressed function stranded them — the clear-bug signature,
   > confirmed end-to-end.
   >
   > The values are real content rather than placeholder — campground phone
   > numbers with reservation lines, and ADA flags — though that specific
   > judgement rests on a **3-of-16 sample**, not all 16.
   >
   > The recompute was **not run**; see `docs/BACKLOG.md` for the narrowed
   > option.
3. **Typesense** has not been re-synced on PROD. Not needed yet — nothing has
   changed that the index reflects.
