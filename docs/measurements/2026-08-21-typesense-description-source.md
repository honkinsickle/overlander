# Wire description_source into Typesense sync

TEST only (`znldzjdatkogdktymtvi`). No PROD.

## 1-4. Investigation + schema change

Read `data/search/sync-typesense.ts`'s `SCHEMA` and `transformRow`.
Convention confirmed from the existing nullable facet fields (`has_water`,
`has_dump_station`, `is_federal`) rather than `primary_category` (always
non-null on `master_place`, so not the right analogue — `description_source`
can genuinely be null): `{ type: "string", facet: true, optional: true }`
in `SCHEMA`, and in `transformRow`, **omit the document field entirely
when the source value is falsy** rather than send an explicit `null` —
this is the established pattern for every optional field in this file
(`if (row.photo_url) doc.photo_url = row.photo_url;`, etc.), matched
exactly rather than inventing a new null-handling approach:

```ts
if (row.description_source) doc.description_source = row.description_source;
```

Added to `MasterPlaceExportRow` (`"source" | "template" | "llm" | null`)
and `PlaceDocument` (`?: "source" | "template" | "llm"`) accordingly.

## 5. Sync run — and a real gap the literal task missed

First `search:sync` run: **32,734 fetched, 32,734 indexed, 0 failed**,
7,614 stale docs pruned (unrelated — normal prune of docs whose
master_place rows no longer exist).

**Direct post-sync verification against Typesense (not just Postgres)
found the literal task's assumption incomplete, so I implemented the
correction rather than just noting it, per this session's standing
instruction.** `sync-typesense.ts`'s `ensureCollection()` only calls
`.create(SCHEMA)` when the collection doesn't exist. `places_test`
already existed, so adding `description_source` to the `SCHEMA` constant
never reached the **live collection's actual schema** — the importer
still wrote the field onto every document's JSON, but Typesense doesn't
facet/filter on a field it was never told about. A facet query against
it returned an HTTP 404: `Could not find a facet field named
'description_source' in the schema`. The field was present in the data,
invisible to search.

**Fixed** by adding `reconcileSchemaFields()`: on every sync, diff `SCHEMA`
against the live collection's fields and PATCH-add anything missing via
Typesense's documented `collections(name).update({ fields: [...] })`
"add field" operation, then let the existing full re-import populate the
new field(s) in the index.

**This surfaced a second, independent, pre-existing instance of the exact
same gap**: `photo_url` (added to `SCHEMA` back in migration
`20260810180400`) was *also* never reconciled onto the live collection —
same root cause, just never caught until this direct verification. Left
in scope to fix alongside `description_source` since the mechanism is
identical and it was already broken.

**One bug in my own fix, caught and corrected before it did damage**: the
first version of the diff treated Typesense's implicit `id` field as
"missing" (it's never listed in `retrieve()`'s `fields` array) and tried
to PATCH it in — Typesense rejected with `Field 'id' cannot be altered`
(HTTP 400), and the sync run failed cleanly (0 documents touched, no
partial state). Fixed by excluding `name === "id"` from the reconciliation
candidates, documented inline with the exact error that caught it.

**Second (working) sync run**: schema patch added `photo_url` and
`description_source` to the live collection, logged explicitly; then the
full re-import — **32,734 fetched, 32,734 indexed, 0 failed**, 0 pruned
(nothing stale this time, confirming the first run's prune already
cleared it).

## 6. Verification against the live Typesense index (not Postgres)

| sample row | expected | live Typesense doc |
|---|---|---|
| Cold Spring Camp | template | `description_source: "template"` ✓ |
| Wildhorse Creek Wild And Scenic River | source | `description_source: "source"` ✓ |
| ChargePoint | null | field **absent** from the document (matches the omit-when-null convention) ✓ |

Live collection schema for the field, retrieved directly:
`{ name: "description_source", type: "string", facet: true, optional:
true, index: true, store: true, ... }` — correctly declared, not just
present on documents.

**Facet query against the live index** (previously 404'd, now works):

```
source:   15,582
template:  8,535
```

## 7. Confirm nothing existing broke

**No existing search test suite found** (`web/src/lib/search.ts` has no
test file, and no `data/search` test file exists) — noted rather than
fabricated.

Spot-checked directly against the live index instead:

- **Normal query** (`q: "campground"`, same `query_by`/weights/`sort_by`
  as `web/src/lib/search.ts` uses, no filter): 4,530 hits, same ranking
  shape as before (`_text_match` then `prominence_score`) — the field
  addition changes nothing about relevance since it's not in `query_by`.
- **New capability, confirmed end-to-end**: filtering the same query by
  `description_source:=template` returns 591 matches, all correctly
  `description_source: "template"` — this is the exact query a future map
  toggle would issue.
- **Full `data/` test suite**: 29 files, 570 passed, 3 pre-existing skips,
  0 failed.
- `npm run -w data typecheck` and `npm run -w web typecheck` both exit 0.

## Summary

| | |
|---|---|
| Schema change | `description_source` added to `SCHEMA` + `transformRow`, matching the existing optional-facet-field convention exactly |
| Sync result | 32,734 fetched / 32,734 indexed / 0 failed (both runs) |
| Gap found + fixed | Collection already existed, so the schema addition alone never reached Typesense — added `reconcileSchemaFields()` to PATCH missing fields into an existing collection before re-import |
| Second gap found + fixed | `photo_url` had the identical pre-existing gap (added to `SCHEMA` in an earlier migration, never reconciled) — fixed in the same pass |
| Self-correction | First reconciliation attempt wrongly targeted the implicit `id` field; Typesense rejected it cleanly (HTTP 400, no partial state); excluded `id` and re-ran successfully |
| Live verification | 3/3 sample rows correct in the actual Typesense index; facet query now returns real counts (source: 15,582, template: 8,535) instead of 404ing |
| Existing functionality | No existing search test suite to run (noted); normal query ranking unaffected; new `description_source` filter confirmed working (591 matches); full data test suite (570 tests) and both typecheck gates pass |

Modified: `data/search/sync-typesense.ts` only. No new migrations (the
Postgres-side `description_source` column already existed from the prior
pass).
