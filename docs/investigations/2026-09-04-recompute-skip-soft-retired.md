# 2026-09-04 — recompute_master_place() v5: skip soft-retired mps at the root

## Purpose

Replace PR #383's v4 workaround. v4 sweeps up bad `place_relationships`
rows inside `merge_master_place()` AFTER `recompute_master_place()`
inserts them. v5 fixes the class of bug at the source: recompute's
containment scan itself excludes soft-retired mps, so the bad rows are
never inserted in the first place.

**Bottom line:** applied to TEST via `db:push-verify -- --test`. Corpus
re-verification (110 canonicals + 119 absorbed mps from PR #383's audit
trail) shows **0 orphan `place_relationships` edges post-recompute** —
the pattern that reproducibly generated ~40 orphans pre-v5. Hermetic
regression test passes 3/3.

## Confidence tags

- `[literal]` — measured / directly verified this session.
- `[strong]` — derived from an artifact + cross-checked.
- `[unverified]` — plausible but not measured.

## The class bug (recap)

`recompute_master_place()` Step 7 has two roles that scan `master_place`
by geometry:

- **(a) child role.** Recomputed mp is the child; find polygons that cover
  its point.
- **(b) parent role.** Recomputed mp has a polygon; find other mps whose
  points it covers.

Pre-v5, neither role filtered on the "other" side's retire state. When
`merge_master_place()` calls `recompute_master_place(canonical)`,
role (b) picks up soft-retired absorbed mps whose points still sit inside
canonical's polygon (they were duplicates, that's why they were merged),
and inserts `(child=absorbed, parent=canonical, contained_in)` rows.
Role (a) has the symmetric hazard for any recompute whose canonical's
point sits inside an old absorbed mp's polygon.

v4 caught these AFTER the fact by deleting any place_relationships row
involving an absorbed mp at the end of the merge. That fixes THIS merge,
not the class — any future recompute on an unrelated canonical whose
polygon covers an old absorbed mp's point re-creates the pattern. v4's
sweep is scoped to `p_absorbed_mp_ids` of the current merge; it doesn't
scan or delete anything else.

## v5 design

Two decisions, explicitly weighed:

### 1. What signal marks "soft-retired"?

- **A. `EXISTS (active source_record)`** — chosen. Precise. Excludes
  soft-retired absorbed mps (merge repointed all their SRs) and
  naturally-orphaned mps (all SRs deactivated). Does NOT exclude
  land_status mps (PADUS boundaries etc., which have real SRs and
  legitimately participate as parents). Does NOT exclude generated-only
  mps (which have `source_count = 0` by design but real geometry).
- B. `source_count > 0` — rejected. Excludes generated-only mps
  unnecessarily.
- C. New `is_retired` boolean column — rejected. Cleaner semantically but
  a schema change; A gets us there without one.

### 2. Where to apply the filter?

- **α. Both roles + guard the whole Step 7 on the recomputed mp's own
  active-SR presence.** Chosen. Symmetric fix; minimal blast radius on
  the non-retired path.
- β. Early-return the whole function if the recomputed mp is
  soft-retired. Rejected — more aggressive; skips Steps 1-6 which are
  idempotent-safe on a soft-retired mp anyway.
- γ. Filter only role (b). Rejected — leaves role (a) hazard for a
  symmetric future recompute pattern.

## v5 concrete changes

Only Step 7 changes. Steps 1-6 preserved byte-for-byte from v0.5. `[literal]`

```sql
-- v5: cache whether the recomputed mp has any active source_records
select exists (
  select 1 from public.source_record sr
   where sr.master_place_id = p_master_place_id
     and sr.is_active = true
) into v_self_has_active_sr;

-- role (a): child role
delete from public.place_relationships
 where child_master_place_id = p_master_place_id
   and relationship_type = 'contained_in';

if v_self_has_active_sr then
  insert into public.place_relationships (...)
  select s.id, p.id, 'contained_in'
  from public.master_place s
  join public.master_place p on p.id <> s.id
                            and p.geometry_polygon is not null
                            and st_covers(p.geometry_polygon, s.geometry)
  where s.id = p_master_place_id
    -- v5: skip soft-retired / orphaned parents
    and exists (
      select 1 from public.source_record sr
       where sr.master_place_id = p.id
         and sr.is_active = true
    )
  on conflict do nothing;
end if;

-- role (b): parent role — same pattern, filter applied to c.id.
```

The DELETE branches still run unconditionally. If someone triggers
recompute on a soft-retired mp, its existing edges get cleaned up
(cleanup) but nothing new is inserted (guard).

## Verification

### Direct-repro on the corpus

`data/scripts/verify-v5-recompute-skip-soft-retired.ts` iterates
`recompute_master_place()` over every mp involved in PR #383's audit
trail: 110 canonicals + 119 absorbed mps. `[literal]`

- Definition of "orphan edge" used: `place_relationships` row where
  either endpoint currently has 0 active source_records (i.e. is
  currently soft-retired). Uses CURRENT state, not the audit's absorbed
  list — this correctly excludes mps that were absorbed then reversed
  (Fort Churchill, Alamo Lake) and now have active SRs again.
- Result: **0 orphan edges after 229 recompute calls.** `[literal]`
- Pre-v5, this exact scenario reproduced the ~40-orphan pattern (that's
  what the v4 cleanup script found on PR #383). `[strong — mechanism
  traced, cross-checked with PR #383's earlier count]`

### Hermetic regression

`data/scripts/regression-recompute-skip-soft-retired.ts` seeds three
master_places in a controlled Arctic coordinate (89°N, 179°E — off any
real corpus polygon):

- **canonical**: polygon 0.02° × 0.02°, 1 active SR with matching
  `normalized_payload.geometry_polygon`.
- **soft-retired**: point at (179, 89), 0 active SRs, `is_searchable=false`,
  `source_count=0`.
- **normal-other**: point at (179, 89), 1 active SR. Positive control.

Calls `recompute_master_place(canonical)`. Asserts:

1. ✓ **normal-other IS linked** as `(child=normal, parent=canonical,
   contained_in)` — positive control confirms the JOIN is working.
2. ✓ **soft-retired NOT linked** — v5 filter fires.
3. ✓ `recompute_master_place(soft-retired)` inserts no edges on either
   side — v5 self-guard fires.

**Non-vacuity check:** the test cannot pass with a broken v5. A vacuous
pass would need both (a) the JOIN to fail (breaking positive control)
AND (b) the filter to always exclude (letting negative control pass by
accident). Both can't be true at once.

### Dependency review (fresh-apply substitute)

`supabase db reset` requires docker, which isn't running in this
environment. Substitute: enumerated every symbol v5 references and
found the first migration to define each:

| Symbol | First defined in |
|---|---|
| `master_place` | 20260527120100 |
| `source_record` | 20260527120200 |
| `field_precedence` | 20260527120500 |
| `compute_prominence`, `recompute_aggregated_fields`, `resolve_field` | 20260527130000 |
| `place_relationships` | 20260601030000 |
| `mvum_roads` | 20260603010000 |
| `is_generated_source` | 20260901000100 |

All strictly before v5 (`20260904120000`). Chain is topologically clean
under standard chronological apply. `[strong — inference from static
migration files, not from an actual fresh apply]`

**Real fresh-apply is Adam's step** (or a CI job with a temporary
Postgres). Recommended before PROD apply.

## Relationship to v4

v4's post-recompute sweep inside `merge_master_place()` is UNCHANGED. It
runs after `recompute_master_place(canonical)` and issues:

```sql
delete from place_relationships
 where child_master_place_id = any(p_absorbed_mp_ids)
    or parent_master_place_id = any(p_absorbed_mp_ids);
```

With v5 in place, this DELETE finds nothing to sweep (recompute never
inserted anything against absorbed mps in the first place). It's a
no-op belt-and-suspenders. Removing it is a follow-up, not urgent — the
current shape means a regression in either function is caught by the
other.

## Follow-up work

- **Fresh-DB apply verification** via `supabase db reset --linked` on a
  spare project, or CI job. Non-blocking but recommended before PROD.
- **Consider removing v4's sweep** once PROD proves out v5 across at
  least one merge cycle. Not urgent.
- **PR #383's other follow-ups still stand** (enrich `merge_audit_log.before_snapshot`
  to include place_relationships / generated_content / photo_candidate
  for full-scope reversal).

## Files touched

- `supabase/migrations/20260904120000_recompute_master_place_skip_soft_retired.sql` (new)
- `data/scripts/verify-v5-recompute-skip-soft-retired.ts` (new)
- `data/scripts/regression-recompute-skip-soft-retired.ts` (new)
- `docs/investigations/2026-09-03-merge-executor-full-run.md` (v5-supersedes-v4 footer)
- `docs/LOG.md` (2026-09-04 entry)
- `docs/STATE.md` (later 29 header)

## Zero-PROD-writes confirmation

- `db:push-verify -- --test` — verifier pinned to TEST project ref.
- Every script hard-checks `SUPABASE_URL === 'https://znldzjdatkogdktymtvi.supabase.co'`
  before doing anything.
- `data/.env` still on TEST. `[literal — checked before every RPC]`
