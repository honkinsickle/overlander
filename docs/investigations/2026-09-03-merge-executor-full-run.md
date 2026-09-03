# 2026-09-03 — merge executor full run against decidable-set on TEST

## Purpose
Execute `execute-merge-groups.ts` against every decidable, non-blocked
group on TEST (no PROD writes). Capture what the run surfaced, apply
in-place fixes to `merge_master_place()`, re-run, verify.

**Bottom line: 106 groups executed successfully on TEST.** Two failures
surfaced during the run — one PK conflict, one CHECK-constraint violation
— each producing clean Postgres rollbacks (audit-invariant held: no audit
row for a failed group; mp states unchanged). Fixes shipped as v2, v3
migrations. A third, quieter finding — 41 orphaned `place_relationships`
rows post-merge — traced to `recompute_master_place()` running inside the
merge function; workaround shipped as v4 with a clean-up sweep. Two
reversals performed (one 2-way, one 4-way n-way). Field-precedence
outcomes hand-checked on 20 canonicals: 92/92 checkable assertions match.

## Scope + confidence labels
- Confidence tags: `[literal]` = counted from the artifact / DB in this
  session; `[strong]` = derived from an artifact and cross-checked; `[unverified]`
  = model or plausible but not measured.
- Nothing on this branch touched PROD.
- Migration versions applied to TEST: v2 (`20260903203500`), v3
  (`20260903211000`), v4 (`20260903213500`). PROD still on v1.

## What ran + counts
- **Preview vs run:** 123 dry-run groups on PROD, minus 8 undecidable
  (PR #379), minus 2 blocked (groups 6, 83) → 113 decidable non-blocked
  groups on PROD `[literal, from prior-session count re-cited]`.
- **TEST mapping:** 106 of those 113 mapped to TEST equivalents by
  canonical_name + source_id overlap. 6 had no TEST equivalent (mps
  already merged in prior session); 3 undecidable canonical `[literal]`.
- **Group sizes across 106 executed:** 103 × 2-way, 7 × 3-way, 1 × 4-way
  (Fort Churchill NV, group 89) `[literal, tabulated across audit files]`.

## Failures + fixes

### Group 55 — Ginkgo Petrified Forest 3-way → v2
- **Symptom:** PK violation on `place_relationships`. Two absorbed mps
  each had a `contained_in` edge pointing at the same outside parent
  (`47941ff5`). First UPDATE to repoint child→canonical succeeded; second
  UPDATE tried to create a duplicate row `(canonical, 47941ff5,
  contained_in)`.
- **Root cause:** the v1 dedup logic only checked collisions between
  absorbed rows and the canonical row — not between two absorbed rows
  that share a constraint tuple. Same shape for `place_match`,
  `generated_content`, `photo_candidate` — an n-way merge where two
  absorbed rows share `(source_record_id, mp_id)` or `(field_name, mp_id)`
  or `(image_url, mp_id)` would hit the same class of bug.
- **Fix:** v2 migration adds a symmetric dedup rule: also drop absorbed
  rows that would collide with ANOTHER absorbed row, keeping the smallest
  id deterministically. `[literal — see 20260903203500 comment + step 3b/3c]`
- **Verified rollback:** audit row count unchanged after failure (no
  audit inserted for group 55); mp states unchanged.
- **Post-fix:** group 55 re-ran successfully under v2.

### Group 89 — Fort Churchill NV 4-way → v3
- **Symptom:** CHECK constraint `place_relationships_no_self_ref_chk`
  violation. Row `(0e8e7c64, 0e8e7c64, contained_in)`. The absorbed pair
  `child=7c3cc7e2 (absorbed), parent=e727a4b3 (absorbed)` collapsed after
  BOTH column UPDATEs ran: child UPDATE set absorbed→canonical, then
  parent UPDATE set the other absorbed→canonical, producing
  `(canonical, canonical)` — a forbidden self-ref.
- **Root cause:** the v2 self-ref cleanup dropped only absorbed↔canonical
  edges (either direction). Absorbed↔absorbed was untouched, and would
  collapse to self-ref.
- **Fix:** v3 migration extends the self-ref cleanup delete to also
  include absorbed↔absorbed. `[literal — see 20260903211000 step 3a]`
- **Verified rollback:** same as group 55.
- **Post-fix:** group 89 re-ran successfully under v3.

## The quieter finding — 41 orphan place_relationships rows

After the run completed under v3, a corpus scan found 41 `place_relationships`
rows referencing a soft-retired absorbed mp on one side or the other.
Pattern: `child = absorbed, parent = canonical, type = contained_in,
computed_at = seconds after the merge's own execution` `[literal]`.

**Mechanism:** step 7 of the merge function calls
`recompute_master_place(canonical)`. Its containment scan finds every mp
whose Point sits inside canonical's polygon (or whose polygon covers
canonical's Point). Absorbed mps are soft-retired but their geometry is
intact, so recompute treats them as legitimate children of canonical and
inserts fresh `contained_in` edges. The merge's earlier
self-ref/dedup/repoint work is silently undone by its own recompute step.

**Fix, scoped:** v4 migration adds a post-recompute cleanup that deletes
any `place_relationships` row involving an absorbed mp on either side.
Safe because the earlier step 3d has already repointed every legitimate
edge off absorbed — anything involving absorbed after recompute is
post-recompute garbage. `[literal — see 20260903213500]`

**Fix, class-level (deferred):** v4 does not solve the underlying issue.
Any future `recompute_master_place()` on an unrelated canonical whose
polygon covers (or is covered by) an OLD absorbed mp will keep
re-inserting garbage edges. The real fix is `recompute_master_place()`
skipping soft-retired mps (`is_searchable = false, source_count = 0`).
Filed as follow-up work; not landed on this branch. `[unverified — the
fix hasn't been designed yet; class hazard is inferred from the
mechanism, not directly measured on a second unrelated recompute]`

**Update 2026-09-04:** the class-level fix landed as v5
(`20260904120000_recompute_master_place_skip_soft_retired.sql`). v5 adds
an `EXISTS(active source_record)` filter to Step 7's containment scan on
both sides and guards the re-insert on the recomputed mp's own active-SR
presence. Actual signal turned out to be "has active source_record", not
`(is_searchable=false AND source_count=0)` — the latter would falsely
exclude land_status mps (which use is_searchable=false legitimately) and
generated-only mps (which have source_count=0 by design). With v5 in
place, v4's post-recompute sweep still runs but is a no-op. See
`docs/investigations/2026-09-04-recompute-skip-soft-retired.md`.

**Historical cleanup:** the 41 pre-existing orphans were swept via
`data/scripts/cleanup-post-recompute-orphans.ts --confirm`. Post-delete
count on TEST: 0 `[literal]`.

## Reversals — one 2-way, one 4-way

### Alamo Lake SP (2-way), audit `ecd51935-…`
- Reversal: `data/scripts/reverse-merge.ts --audit-id=ecd51935-…
  --confirm`. Preflight assert on mp state matched after-snapshot ✓; 1
  source_record repointed back; 2 master_place rows restored;
  `place_match` repointed via `sync-place-match-post-reversal.ts`
  (1 row).
- Marker row inserted in `merge_audit_log` with
  `moves.reversed_from = <original audit id>`.

### Fort Churchill NV (4-way), audit `6301d7de-…`
- Same procedure. 5 source_records repointed; 4 master_places restored;
  5 `place_match` rows repointed.
- **This is the n-way case explicitly requested in PR #381 §6.** Not
  synthesized; drawn from the actual run.

**Reversal scope, called out loud:** the reverse script + place_match
sync unwind `source_record`, `master_place`, and `place_match`. They do
NOT unwind `place_relationships`, `generated_content`, or
`photo_candidate`. Those tables' before-state was not captured in the
audit snapshot. Fine for the "prove reversibility" exercise; a
production reversal path would need snapshots of those tables too.
`[literal — see reverse-merge.ts scope comment]`

## Field-precedence hand-check — 20 canonicals

Ran `data/scripts/verify-field-precedence.ts` against 20 canonicals from
the current run (excluding the two reversed): 17 × 2-way + 3 × 3-way.
Verdict tally: **92 MATCH, 40 UNCHECKABLE, 0 MISMATCH** `[literal]`.

`UNCHECKABLE` = geometry columns not fetched (12 rows across 20
canonicals × 2 fields) + attribution keys with no source_record mapping
in the check script (`contact`, `operational_status` were initially
unmapped and are now mapped, but geometry stays uncheckable pending a
PostGIS-aware compare).

Every checkable field's cited source was the highest-priority source in
`field_precedence` among the sources currently present on the canonical.
`[literal — see /tmp/fp-20.log; verdict lines printed per field]`

## Self-review — what could still be broken

Solicited from a fresh subagent. Top three items:
1. **v4 is scoped too narrowly.** Any future `recompute_master_place()`
   on an UNRELATED canonical will re-create the same class of orphan
   against long-retired mps. Real fix is recompute skipping soft-retired
   rows. Filed as follow-up. `[strong — mechanism is clear; class hazard
   not directly demonstrated on a second unrelated recompute]`
2. **Reversal scope originally understated.** Extended the reversal to
   include `place_match` mid-review; without it, the next matcher run
   could silently re-merge the reversed pair via a stale place_match
   still pointing at canonical. `place_relationships`,
   `generated_content`, `photo_candidate` remain drifted on both
   reversed audits. Documented above.
3. **Sample-size caveat.** 20/106 for field-precedence + 106 groups of
   which only 8 are 3+-way means most exotic collision shapes weren't
   observed. The v2/v3/v4 fixes stand on mechanism, not corpus coverage.
   `[strong]`

Lower-severity items surfaced (non-blocking):
- `cleanup-post-recompute-orphans.ts` is non-transactional (41 sequential
  deletes). Fine for one-shot cleanup on a single operator; not
  production-grade.
- Groups 55/89 rollback was verified by "audit rows for those groups
  don't exist", not by a stored diff of table row counts around the
  failure moment. Sufficient for this pass but worth stronger evidence
  before PROD.

## Follow-up work
- Fix `recompute_master_place()` to skip soft-retired mps → drops the
  need for v4's cleanup sweep entirely. Land as v5 or as a separate
  migration.
- Extend `merge_audit_log.before_snapshot` to include
  `place_relationships`, `generated_content`, `photo_candidate` rows for
  affected mps → makes reversals structurally complete.
- Apply v2 + v3 + v4 to PROD before executing on PROD groups.

## Files touched
- `supabase/migrations/20260903203500_merge_master_place_v2.sql` (new)
- `supabase/migrations/20260903211000_merge_master_place_v3.sql` (new)
- `supabase/migrations/20260903213500_merge_master_place_v4.sql` (new)
- `data/scripts/cleanup-post-recompute-orphans.ts` (new)
- `data/scripts/reverse-merge.ts` (new)
- `data/scripts/sync-place-match-post-reversal.ts` (new)
- `data/scripts/verify-field-precedence.ts` (new)
- `data/scripts/merge-preview-same-pairs.ts` (added `--target=test|prod`,
  `--output-suffix`)

## Zero-PROD-writes confirmation
- Every `db:push-verify` run this session used `-- --test`; verifier
  overrides pinned to TEST.
- Every script above defaults to `--target=test`; the reverse script and
  cleanup script both hard-check `SUPABASE_URL` against the TEST project
  ref and refuse to run on mismatch.
- `data/.env` still points at TEST (`znldzjdatkogdktymtvi`) — verified by
  the executor's env printout at run time. `[literal]`
