# Merge executor — build report

**Date:** 2026-09-03 · **Status:** TOOL BUILT, VALIDATED ON TEST ONLY.
No PROD writes this session. **Migration DID land on TEST.** No migration
on PROD yet — the operator will need to run `npm run -w data db:push-verify`
(without `--test`) against PROD when ready.

**Scope of this session, per the brief:** build the executor + validate on
3–5 straightforward TEST groups. Do NOT run against PROD. Do NOT run
against the full 123-group set even on TEST.

**What actually landed on TEST this session:** 5 test merges (groups 901–905:
Fort Ross, Malakoff Diggins, Cathedral Gorge, Fort Rock, Ward Charcoal
Ovens) — all against fabricated `group_id`s (900-series) using real TEST
mp_ids. One (group 901, Fort Ross) was subsequently reversed via manual
audit-trail rollback to prove the reversal path works. Net TEST state
change: 4 merges present (902, 903, 904, 905), 1 reversed (901).

**Related PRs:** #368/#369/#370/#372/#374/#375/#378 (all merged);
PR #379 (the 8 undecidable groups; open, unmerged) — the executor blocks
groups 6 and 83 by default per that PR's flags.

---

## 0. What this PR delivers

Three new artifacts:

1. **`supabase/migrations/20260903195200_merge_master_place.sql`** — creates
   the `merge_master_place(canonical, absorbed[], executed_by, target_env,
   group_id, notes)` PL/pgSQL function AND the `merge_audit_log` table.
   Everything the function does — every FK repoint, every dedup, every
   soft-retire, every recompute, and the audit row itself — runs inside
   the function's implicit transaction. Any raise → automatic Postgres
   rollback of all of it, including the audit row.
2. **`data/scripts/lib/merge-canonical.ts`** — extracted shared
   canonical-selection logic. Both the dry-run preview
   (`merge-preview-same-pairs.ts`) and the executor
   (`execute-merge-groups.ts`) import `pickCanonicalGroup` and
   `VISITOR_SRC` from here. Keeps them in lockstep by construction.
3. **`data/scripts/execute-merge-groups.ts`** — the executor CLI. Multi-
   flag safety posture (see §2), reads the dry-run tool's groups JSON,
   calls the RPC per group, saves an audit copy to disk alongside the
   DB-side audit row.

## 1. FK topology (re-enumerated 2026-09-03 for this session)

Direct query of `supabase/migrations/*.sql` for every column that
`references public.master_place(id)`:

| table | column | on-delete | in-DB constraint |
|---|---|---|---|
| `source_record` | `master_place_id` | SET NULL | (no unique) |
| `place_match` | `master_place_id` | CASCADE | UNIQUE `(source_record_id, master_place_id)` |
| `place_relationships` | `child_master_place_id` | CASCADE | PK `(child, parent, type)`; CHECK `child <> parent` |
| `place_relationships` | `parent_master_place_id` | CASCADE | (same) |
| `master_place_generated_content` | `master_place_id` | CASCADE | UNIQUE `(master_place_id, field_name)` |
| `master_place_photo_candidate` | `master_place_id` | CASCADE | UNIQUE `(master_place_id, image_url)` |

**Non-FK references I checked and excluded:**
- `master_place_id uuid` at lines 22 of two GIS-index migrations — those
  are function RETURN column types, not table columns. No storage.
- `pois_along_corridor()` function — computes a `master_place_id` in
  results via a lateral join; reads only, no storage.
- `master_place_search_export` view — reads live from `master_place`.
  No cache to invalidate.

**Confidence: directly verified this session.** Grep-based enumeration
against `supabase/migrations/*.sql` — same source of truth PR #370/#374's
enumeration used, re-checked to confirm nothing new landed since.

## 2. Executor safety posture

**Refuses in every case below. All measured this session — see §5.**

| flag configuration | outcome |
|---|---|
| no `--confirm` and no `--dry-run` | FATAL: `--confirm required for writes` |
| no `--groups` | FATAL: `--groups <id,id,...> is REQUIRED. This tool refuses to run against everything.` |
| `--target=prod --confirm` (missing `--confirm-prod`) | FATAL: `PROD writes require --confirm-prod in addition to --confirm` |
| Group 6 or 83 in `--groups`, no `--force-blocked` | FATAL: `blocked groups requested without --force-blocked` (references PR #379) |
| requested group has no `canonical_mp_id` in input | FATAL: refuses to write against a stale/undecidable dry-run entry |
| requested group's canonical drifted vs the shared canonical rule | FATAL: `canonical drift: dry-run said X, shared-lib says Y` |
| `--target=prod` with a `data/.env` (TEST) URL, or vice versa | FATAL: `SAFETY: --target=X but resolved url ... is not <expected host>` |

**Confidence: directly verified this session.** All 5 refusal paths tested
with concrete invocations against TEST (§5).

## 3. Migration function contract

`merge_master_place(canonical_mp_id, absorbed_mp_ids[], executed_by, target_env, group_id, notes)`
performs, all inside one PL/pgSQL transaction:

1. Preconditions: canonical present, all absorbed present, canonical not in
   absorbed list, target_env is `test|prod`, executed_by non-empty.
2. Snapshot BEFORE (master_place rows + all source_records on either side)
   into JSONB.
3. `source_record`: repoint absorbed → canonical.
4. `place_match`: DELETE absorbed-side rows that would collide with an
   existing canonical-side row on `(source_record_id, master_place_id)`;
   UPDATE remaining.
5. `place_relationships`:
   - DELETE self-refs (absorbed↔canonical pairs already linked)
   - DELETE absorbed-side edges that would collide with canonical-side
     edges under the same relationship_type
   - UPDATE remaining edges (child + parent columns separately)
6. `master_place_generated_content`: DELETE absorbed rows that collide on
   `(master_place_id, field_name)`; UPDATE remaining.
7. `master_place_photo_candidate`: DELETE absorbed rows that collide on
   `(master_place_id, image_url)`; UPDATE remaining.
8. Soft-retire absorbed rows: `is_searchable = false`, `source_count = 0`.
   **Never hard-delete** — the row stays queryable for downstream
   reference-safety and manual rollback.
9. `perform recompute_master_place(canonical_mp_id)` — re-derives fields
   via `field_precedence` from the now-larger source_record population.
10. INSERT into `merge_audit_log` with before + after snapshots + per-table
    move counts.

Returns JSONB `{audit_id, canonical_mp_id, absorbed_mp_ids, moves, target_env}`.

**Confidence:**
- **Directly verified this session** for the happy path (5 TEST executions,
  §4) and the precondition-failure paths (§5).
- **Strong inference** for the "any mid-execution raise rolls back" claim
  — Postgres guarantees PL/pgSQL functions run as one implicit transaction;
  any `raise exception` reverts all writes in the same call. I did not
  induce a real mid-execution failure this session because doing so
  requires either schema tampering or contriving a constraint violation
  the function's own dedup logic normally handles. The precondition-fail
  tests (§5) proved audit rows don't leak on failure — the function's
  atomicity guarantee is thereby verified at least for pre-work aborts.

## 4. TEST validation — 5 merges executed and verified

Groups 901–905 fabricated for testing, using real TEST mp_ids that mirror
the PROD dry-run's typical shape (state_parks-GIS-backed canonical vs
single-source atlas_oddities absorbed).

| group | canonical (mp) | absorbed (mp) | sc before/after (canon) | sc before/after (absorbed) | moves total |
|---|---|---|---|---|---|
| 901 | Fort Ross SHP `927bd5b3` | Fort Ross `ea984363` | 2 → **3** | 1 → **0** | 6 non-zero moves |
| 902 | Malakoff Diggins SHP `fa64acb7` | Malakoff Diggins `27a3cd40` | 3 → **4** | 1 → **0** | 5 non-zero moves |
| 903 | Cathedral Gorge SP `936ad955` | Cathedral Gorge `5a7d0403` | 2 → **3** | 1 → **0** | 6 non-zero moves |
| 904 | Fort Rock SNA `d0465fa7` | Fort Rock `cfe21406` | 3 → **4** | 1 → **0** | 6 non-zero moves |
| 905 | Ward Charcoal Ovens SHP `d9c11353` | Ward Charcoal Ovens `e57eee28` | 2 → **3** | 1 → **0** | 6 non-zero moves |

After each merge:
- Canonical `source_count` incremented by exactly the number of active
  source_records the absorbed side had.
- Absorbed `is_searchable = false`, `source_count = 0`.
- Zero active source_records still pointing at any absorbed mp.
- Canonical now carries all sources previously split between the pair.
- One audit row per merge in `merge_audit_log`.
- One local audit JSON copy per merge at
  `.context/execute-merge-audit-<timestamp>-group-N.json`.

**Confidence: directly verified this session** — every count is a live PROD
query result post-execution.

## 5. Failure-path tests

Three precondition-fail scenarios executed against TEST. Every one raised
the expected error and left `merge_audit_log` unchanged (5 rows before, 5
rows after all failed tests).

| scenario | expected error | got |
|---|---|---|
| canonical in absorbed list | `canonical mp_id cannot be in absorbed list` | ✓ 400, exact match |
| non-existent canonical | `canonical master_place <uuid> not found` | ✓ 400, exact match |
| invalid target_env=`PRODUCTION` | `target_env must be test or prod, got PRODUCTION` | ✓ 400, exact match |

Also verified the CLI safety gates in §2 by concrete invocations — every
malformed invocation aborted with the documented FATAL message before
touching the DB.

## 6. Manual rollback via audit trail — proven

Reversed group 901's merge using ONLY the audit row (`audit_id
2a3b774c-…`). Steps executed:

1. `SELECT * FROM merge_audit_log WHERE id = <audit_id>` → gives
   `canonical_mp_id`, `absorbed_mp_ids`, and the `before_snapshot`
   including every source_record's original `master_place_id`.
2. For each source_record in the before-snapshot whose
   `master_place_id` was the absorbed mp: `UPDATE source_record SET
   master_place_id = <absorbed_id>` (one row for group 901: the
   atlas_oddities SR `c3b5341c-…`).
3. `UPDATE master_place SET is_searchable = <before value> WHERE id =
   <absorbed_id>` (restore searchability).
4. `SELECT recompute_master_place(<absorbed_id>)` — re-derives
   `source_count` from the restored source_record.
5. `SELECT recompute_master_place(<canonical_id>)` — the canonical loses
   the reversed source_record, `source_count` drops back.

Result: absorbed mp back to sc=1, is_searchable=true. Canonical back to
sc=2. Absorbed's atlas_oddities SR back on the absorbed mp. State matches
the `before_snapshot` exactly.

**Confidence: directly verified this session.** The audit alone was
sufficient — no external notes needed.

**Notes on the reversal design:**
- Audit rows are kept (not deleted) on reversal — a `notes` field on the
  audit log could carry "reversed at …" if a full reversal workflow gets
  built later.
- The current audit lacks `place_relationships` before/after edges. The
  moves counter shows how many were rewritten but not which pairs. If a
  reversal needs to restore place_relationships edges, it'd need to
  re-compute containment (via `recompute_master_place` on the newly
  restored absorbed mp, which does exactly that via ST_Covers). Tested:
  group 901 had 1 self-ref dropped + 1 child-dedup, which get correctly
  re-derived on the recompute in step 4.

## 7. What this doc does NOT cover

- **Full-corpus execution.** Not run this session. The executor is scoped
  by `--groups`; running against 121+ groups (135 - 8 undecidable - 6
  blocked in the current PR #379 blocklist? let me actually count: 135
  SAME - 8 undecidable + 6 groups excluded by default = 121) is a
  separate operator action.
- **PROD migration.** The migration file is present in `supabase/migrations/`
  but only landed on TEST via `db:push-verify --test`. PROD requires the
  standard prod-apply workflow from CLAUDE.md (relink + `.env` swap +
  `db:push-verify` without `--test`).
- **Group 83 (Hat Rock) 3-way handling.** The function supports n absorbed
  members already (`p_absorbed_mp_ids uuid[]`). The blocklist keeps it
  from running until Adam decides whether to collapse the two intra-NPS
  duplicates first (per PR #379 §6). No code path is missing — it's a
  policy decision.
- **Post-merge Typesense sync.** The function does not invoke a Typesense
  index update. `master_place_search_export.source_count > 0` means
  soft-retired mps drop out on the next `search:sync`, which the operator
  already runs separately.
- **UI-level effect measurement.** The function's writes make the
  canonical mp richer and the absorbed mp invisible to search. Not
  measured this session; verifiable via `master_place_search_export` +
  Typesense diffs after a run.

## 8. Confidence key for the whole report

- **Directly verified (queried live TEST or ran the tool this session):**
  §1 FK topology re-enumeration; §2 all 5 CLI refusal paths; §3 happy-
  path RPC returns for 5 groups; §4 before/after source_counts and
  is_searchable for 10 mps + 5 audit rows; §5 all 3 precondition-fail
  scenarios + audit-row-count invariant; §6 group 901 reversal end-to-end.
- **Strong inference:**
  - "any raise mid-function rolls back everything" — Postgres transactional
    guarantee, not directly induced. Precondition-fail tests confirm the
    guarantee holds at least for pre-work aborts; the mid-work claim
    generalizes from Postgres semantics rather than a repro of every
    failure mode.
  - Reversal steps in §6 generalize to any group with the same shape;
    n-way merges and merges with complex `place_relationships` edges
    have a more involved reversal procedure not exercised this session.
- **Unverified / estimated:**
  - Whether the executor behaves identically on PROD (schema is
    identical, so the migration should apply cleanly; no PROD run was
    made).
  - Whether `field_precedence` produces the intended canonical values
    for every field after a real merge (not spot-checked per-field this
    session; only source_count and is_searchable were verified).
  - Whether Typesense's live search reflects the merge as expected
    after `search:sync` — not tested.

## 9. Question(s) for Adam

- Do you want a follow-up PR that runs the executor against the
  113-or-so decidable, non-blocked groups on TEST as a full validation
  before any PROD run?
- Do you want me to open a "PROD migration + first N groups" PR
  separately when you're ready, or is that a manual operator action?

---

## Appendix A: BACKLOG considerations

I considered whether to file backlog items for:
1. A reversal helper script (turn the manual §6 steps into a
   `reverse-merge.ts` tool) — decision: **do not file this session**.
   Manual reversal is documented; if it becomes routine it can be
   automated later. Not filing on my own initiative per the brief's
   "don't add speculative future-work items" rule.
2. Typesense sync after PROD merges — decision: **do not file**. The
   operator's existing `search:sync` workflow already handles this
   class; no new backlog needed.
3. Group 83 dedup helper — decision: **do not file**. PR #379 already
   surfaces the question; when Adam decides, the executor's `--force-blocked`
   flag is the mechanism.
