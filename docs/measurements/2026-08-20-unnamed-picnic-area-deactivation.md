# "Unnamed picnic area" deactivation — 2026-08-20

TEST only (`znldzjdatkogdktymtvi`). No PROD (`nqzeywzcowujzyegxbsr`) changes
of any kind. Mirrors the Phase 0 peak/spring deactivation pattern
(`data/scripts/deactivate-peak-spring.ts`). New script:
`data/scripts/deactivate-unnamed-picnic-area.ts`.

## Scope — narrower than the literal instruction, per explicit user direction

The task named the exact literal `canonical_name` "Unnamed picnic area."
Re-verifying on current TEST state (not assuming the earlier session count
still held — this session already caught real corpus drift once) surfaced
two findings that were flagged before any write:

1. The exact string also appears on rows categorized `campground`, not just
   `picnic_area` — 22 of them. The original count that motivated this task
   had implicitly filtered to `picnic_area` before checking the name.
2. Not every exact-match row is a blank stub. 53 are bucketed STRONG and 1
   WEAK by the eligibility signals (real website/description/tag content
   from another attached source, despite the placeholder display name) —
   source_count on the full exact-match set ranged up to 8.

User's explicit direction: scope to `primary_category = 'picnic_area' AND`
NONE-bucket only. That is what this pass deactivated.

## Investigate → count

Re-computed fresh against current TEST state immediately before writing:

| | Count |
|---|--:|
| Exact-match master_places (`canonical_name` = "Unnamed picnic area", `primary_category` = "picnic_area") | 3,481 |
| — NONE bucket (target) | 3,427 |
| — STRONG bucket (excluded) | 53 |
| — WEAK bucket (excluded) | 1 |
| — no active source_record (excluded) | 0 |

## Deactivate

Same three-step mechanism as `deactivate-peak-spring.ts`:

1. `source_record.is_active = false` on every active source_record attached
   to a target master_place (never a hard delete).
2. `recompute_master_place()` on every target master_place.
3. Delete dangling `pending` `place_match` rows referencing the
   now-inactive source_records.

Applied to TEST:

```
deactivated 3427 source_records
recompute done. ok=3427 failed=0
cleared 0 dangling pending place_match rows
```

0 recompute failures. 0 dangling `place_match` rows found and cleared — these
are single-active-source rows (source_count 1, by construction of "NONE
bucket with a real name-bearing placeholder"), unlike peak/spring where 975
rows had sat unlinked in `place_match` as pending. Zero is the expected
shape here, not a gap.

## Mechanism-match confirmation

Deliberately noted as a structural difference from peak/spring, not a
deviation in mechanism: peak/spring selected source_records to deactivate by
`source_id` + `inferred_category`, independent of which master_place they
belonged to (then separately fetched master_place ids by
`primary_category`). This task's target set is defined at the
master_place level (`canonical_name` + `primary_category` + current
bucket), so "deactivate the target rows" means deactivating every active
source_record attached to each target master_place. That is safe
specifically because the target set was restricted to NONE-bucket — by
definition, none of those attached sources contribute meaningful signal.
The three write steps themselves (source_record.is_active, recompute,
dangling place_match cleanup) are identical to the Phase 0 script, run in
the same order.

## Verify

Before/after computed in the same pass (before = pre-write dry-run counts
above; after = fresh read post-write):

| | Before | After |
|---|--:|--:|
| source_count = 0 (of the 3,481 exact-match set) | 0 | 3,427 |
| source_count > 0 | 3,481 | 54 (exactly the 53 STRONG + 1 WEAK excluded) |
| is_searchable = false | 0 | 0 (untouched, matches the established "not deleted" pattern) |

**Search/browse exclusion:** 0 of the 3,427 now-zeroed rows still appear in
`master_place_search_export` (its `source_count > 0` filter correctly
excludes all of them).

**Generation exclusion — the specific check this task asked for.** Before
spot-checking, confirmed the Phase 0 gap-closing fix
(`20260818160000_pois_along_corridor_source_count.sql`, which added
`mp.source_count > 0` to `pois_along_corridor`'s WHERE clause) is actually
live on TEST, not just present as a migration file: called the live RPC
around a known already-deactivated peak-category row
(`source_count = 0`, `is_searchable = true`) and got 0 results, confirming
the function is enforcing the check today.

Spot-checked 5 of the newly-deactivated rows directly against
`pois_along_corridor` (tight buffer route built around each row's own
coordinates, 5km, filtered to `picnic_area`): **0 of 5 appeared.** None of
the 3,427 deactivated rows surface via search/browse or via corridor-based
trip generation.

## Confirmed scope

- **TEST only.** Script asserts the project ref before any write; no
  `--confirm`/PROD path exists in this script at all (unlike the
  backfill scripts, which do have a gated PROD path — this one doesn't,
  since it was never asked to run there).
- **No code changes beyond the one new script.** No `eligibility.ts`
  changes, no migration, no changes to `pois_along_corridor` or
  `recompute_master_place`.
- 53 STRONG-bucket + 1 WEAK-bucket rows sharing the same placeholder name
  were deliberately left active — real signal preserved.
- 22 `campground`-category rows sharing the same exact literal name were
  deliberately left untouched — out of the confirmed scope.
