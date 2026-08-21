# Combined pass: eligibility change + provenance surfacing + review/re-queue mechanism

TEST only (`znldzjdatkogdktymtvi`). No PROD.

## 1. Eligibility change

**Mechanism confirmed**: `data/scripts/lib/eligibility.ts`'s `isStrong()` —
an OR-reduction over `AggregatedSignals`. Added a new field,
`has_template_description`, folded into `isStrong` the same way
`has_real_description` was (per that function's own existing docstring: a
place that already has resolved description content doesn't need more
work, same tier as the other "this place doesn't need work" signals).

**Design note, not asked but load-bearing**: every other field in
`AggregatedSignals` is set via `foldSignalsInto(agg, sourceRecordSignals)`
— a pure function of one `source_record`'s payloads, no DB access.
`has_template_description` is master_place-level data
(`master_place_generated_content`), not per-source_record, so it cannot be
computed that way. It's set directly on the aggregate by the caller after
a separate query. Documented inline; 3 new unit tests added
(`eligibility.test.ts`) covering: template-only row is STRONG, no-signals
row stays NONE, and a WEAK (phone/hours) row is unaffected when the new
signal is false. **37/37 existing + new tests pass, typecheck clean.**

**Corpus-wide before/after** (in-scope population = `master_place_search_export`,
32,734 rows; "before" and "after" computed in the same pass by toggling
only `has_template_description`, mathematically identical to running the
old vs. new code):

| | STRONG | WEAK | NONE | total |
|---|--:|--:|--:|--:|
| Before | 22,107 | 100 | 10,527 | 32,734 |
| After | 32,399 | 100 | 235 | 32,734 |
| Delta | +10,292 | 0 | **-10,292** | — |

10,292 in-scope master_places carry a template description row — every
one of them moved NONE→STRONG, and **WEAK is untouched (100→100)**,
confirming no WEAK-bucket row was carrying template content at the time
of this measurement (consistent with templates only ever having been
generated for rows that were NONE-bucket at generation time).

## 2. Provenance surfacing — `description_source` on `master_place_search_export`

**Investigated before adding, as asked — and the premise needed
correcting.** `master_place_search_export` is **not** what the frontend
queries live for browse/map search. It's the sync source
`data/search/sync-typesense.ts` reads to build the Typesense `places`
collection, which is what `web/src/lib/search.ts`'s `SearchClient`
actually queries at request time. The view IS read directly by
`web/src/lib/trip-browse/hydrate.ts`, but only for a narrow
`id/lng/lat/photo_url` projection — `description_source` isn't consumed
there today.

Added anyway, as the literal task asked, via a `LEFT JOIN LATERAL` to
`master_place_generated_content` (same shape as the existing photo_url
lateral) — additive, row count and every existing column unchanged.
Precedence:

```
'source'   — mp.description is non-null and non-empty (wins even when a
             template/llm row also exists as an unused fallback)
'llm'      — no source description, an llm-generated row exists
'template' — no source description, a template-generated row exists
null       — no description of any kind
```

This exactly matches the generated-content table's own documented read
path (`20260821000000_master_place_generated_content.sql`: "show
master_place.description when present; fall back to this table only when
null. Never both.").

**Confirmed live** (sample of 2,000 rows via the view): `{ source: 191,
null: 417, template: 392 }` — no `llm` values present, consistent with no
`llm`-method rows existing in the corpus yet.

**Gap flagged, not closed here**: reaching an actual map filter toggle
additionally requires adding `description_source` to
`sync-typesense.ts`'s `SCHEMA`/`transformRow` and re-running
`search:sync`. Not done in this pass — see §6.

## 3. Review/re-queue mechanism

**Shape decision, investigated rather than assumed**: 4 columns directly
on `master_place_generated_content` (`needs_review boolean default
false`, `review_reason text`, `flagged_at timestamptz`, `flagged_by
text`), not a companion table. A companion table would add a join for
both the write and the worklist read with no capability this pass needs —
the actual requirement is one CURRENT flag per row, not a flag history
log. If flag history becomes a real requirement later, that's the point
to introduce one, not before.

Added a partial index (`ON (flagged_at) WHERE needs_review = true`) so
the worklist query stays cheap as the table grows.

**Both required capabilities confirmed queryable directly against TEST:**

- **(a) Flag a specific row by id**: `UPDATE
  master_place_generated_content SET needs_review=true,
  review_reason=$1, flagged_at=now(), flagged_by=$2 WHERE id=$3` — used
  for real in §4 below.
- **(b) Worklist query**: `SELECT * FROM master_place_generated_content
  WHERE needs_review = true` — a plain filter on an indexed boolean,
  confirmed via the same live flag in §4.

## 4. Retroactive flag — The Astoria Column

Three `master_place` rows match "Astoria Column" by name
("The Astoria Column"/oddity, "Astoria Column Park"/land_status,
"Astoria Column"/park_feature). **Confirmed directly which one has any
`master_place_generated_content` row before flagging anything** — only
the oddity row (`a8546007-f5c3-4e02-9e7d-78d7a87d4844`) does; the other
two have none and were left untouched. This is the same row referenced
throughout this session's state-boundary work (the six-state fix report's
spot-check table lists exactly this name/category/state).

```
UPDATE master_place_generated_content SET
  needs_review = true,
  review_reason = 'manual spot-check (2026-08-21 session): confirmed
    WA/OR border-state mislabel — the Astoria Column sits at the WA/OR
    border and was misclassified by the old bbox-based state classifier
    before the six-state TIGER/Line fix; regenerated once already,
    flagging for a human re-check of the corrected text.',
  flagged_at = now(),
  flagged_by = 'manual'
WHERE id = '27aae7bf-027a-478c-b3ca-d6f9010e544e';
```

**Riverside Day Use Area (the row confirmed correct in the earlier
provenance trace) was explicitly NOT touched** — verified by a direct
negative-control query in the same script run, confirmed still
`needs_review = false`.

## 5. Trip generation exclusion — `pois_along_corridor`

Added a `LEFT JOIN LATERAL` computing `any_flagged` and `has_template`
per master_place (scoped to `field_name='description'`), and two new
WHERE predicates:

```sql
and not (mp.description is null and coalesce(desc_gc.has_template, false))
and coalesce(desc_gc.any_flagged, false) = false
```

The template-only exclusion condition is deliberately **not** "has any
template row" — it's "no real `mp.description` AND a template row
exists," the exact same effective-provenance check as
`description_source='template'` on the view. This was the point of the
task's own caveat: a row with a real (even thin) `mp.description` that
also happens to carry an unused template backup — the "dual" rows found
in the prior three-part-cleanup pass — has `description_source='source'`
and is **not** excluded. `needs_review` is checked unconditionally,
independent of `description_source`.

## 6. UI plumbing — confirmed, not built

**Map filter toggle on `description_source`**: the Postgres-level signal
exists and is correct (§2), but the actual map/browse read path is
Typesense, not this view directly. **Missing plumbing, not built here**:
add `description_source` to `sync-typesense.ts`'s `SCHEMA` (a facet-able
string field, same pattern as `primary_category`) and `transformRow`,
then run `search:sync` to backfill existing documents. Until that runs,
the toggle has nothing to filter on in the actual search index.

**Review worklist for whoever handles regeneration**: fully supported by
the schema as built (§3) — `SELECT * FROM master_place_generated_content
WHERE needs_review = true ORDER BY flagged_at` is the whole query, no
further schema work needed. A worklist screen would join to
`master_place` for a human-readable name/location, e.g.:

```sql
select gc.id, gc.master_place_id, mp.canonical_name, gc.review_reason,
       gc.flagged_at, gc.flagged_by, gc.generated_text
from master_place_generated_content gc
join master_place mp on mp.id = gc.master_place_id
where gc.needs_review = true
order by gc.flagged_at;
```

Building either the map toggle UI or the worklist screen itself is out of
scope here, as asked.

## 7. Verification

- **8/8 sampled `description_source='template'` rows**: absent from
  `pois_along_corridor` (a per-row tiny-buffer RPC call around each
  point), present in `master_place_search_export`.
- **The Astoria Column**: `description_source='template'` (correctly
  still `'template'`, not affected by the flag), present in
  `master_place_search_export` (still browsable), **absent from
  `pois_along_corridor`** — confirmed excluded via `needs_review`, not
  via the template-only path (its `description_source` alone wouldn't
  have excluded it if it had a real description; here it's excluded on
  both grounds, but the flag is the one this task asked to confirm).
- **5/5 sampled "dual" rows** (real `mp.description` + an unused template
  backup, `description_source='source'`): **present** in
  `pois_along_corridor` — confirms the exclusion filter does not
  wrongly sweep up rows with real content that merely also carry a
  template row as a secondary signal.
- **Full `data/` test suite**: 29 files, 570 passed, 3 pre-existing skips,
  0 failed. `npm run -w data typecheck` and `npm run -w web typecheck`
  both exit 0.

## Summary

| | |
|---|---|
| NONE count | 10,527 → **235** (-10,292) |
| STRONG count | 22,107 → 32,399 (+10,292) |
| WEAK count | 100 → 100 (unaffected — confirms no WEAK/template overlap existed) |
| `description_source` | live on `master_place_search_export`; values confirmed `source`/`template`/`null` present, `llm` absent (none exist yet) |
| Review schema | 4 columns + partial index on `master_place_generated_content`; both flag-by-id and worklist-query confirmed live |
| Astoria Column | flagged (`needs_review=true`), excluded from `pois_along_corridor`, still browsable in `master_place_search_export` |
| Riverside Day Use Area | confirmed untouched |
| Remaining for actual UI work (out of scope here) | (1) add `description_source` to Typesense schema + re-run `search:sync` before a map toggle has anything to filter on; (2) build the map toggle UI and the review-worklist screen — both are pure reads against schema that already exists and was verified in §7 |

New migrations: `20260821030000_generated_content_review_flags.sql`,
`20260821040000_search_export_description_source.sql`,
`20260821050000_pois_along_corridor_exclude_template_review.sql`. New
durable script: `data/scripts/measure-eligibility-template-signal-2026-08-21.ts`.
Modified: `data/scripts/lib/eligibility.ts`,
`data/scripts/lib/eligibility.test.ts`.
