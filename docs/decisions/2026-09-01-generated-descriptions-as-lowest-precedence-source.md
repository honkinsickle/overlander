# 2026-09-01 — Generated descriptions become a real source, not a direct write

## Context

`master_place_generated_content` holds LLM- and template-generated description
text, deliberately kept in a separate table so it can never be mistaken for
source-of-truth data. Its documented read path: *"show
master_place.description when present; fall back to this table only when null.
Never both."*

Nothing ever implemented the fallback. The day-detail bake path
(`pois_along_corridor` → `mapMasterPlaceRow`) reads only
`master_place.description`, so places with generated text rendered a
mapper fallback string instead.

PR #327 closed that gap by copying `generated_text` straight into
`master_place.description`. That worked, but it violated the schema invariant
that `recompute_master_place()` is the sole writer of `master_place` — and the
only reason the writes survived was an accident: `20260831100000` had removed
the clear-branch from `recompute_master_place()`, so nothing cleared them back
out. Restoring the clear-branch (this branch's actual job) would have wiped
every one of those rows.

The obvious repair is an exemption in the clear-branch. It cannot be built
cleanly: `description_source` is a derived `CASE` in a view and an RPC, not a
column, so it is invisible inside the function; and PR #327 wrote no marker of
any kind. The only exact discriminator available was byte-equality between the
column and `generated_text` — precise today, but content-keyed, so it fails
toward data loss the moment anything regenerates the text.

## Decision

**Deliver generated text through `source_record` and `field_precedence`, like
any other source, and drop the idea of an exemption entirely.**

Two synthetic source ids, `generated_llm` and `generated_template`, at
description precedence **20** and **21** — below every real source (`padus`,
the lowest, is 10). Each eligible place gets one `source_record` whose
`normalized_payload.description` carries the generated text, pre-linked to its
`master_place_id`. `recompute_master_place()` then resolves it normally.

Everything that was hard becomes structural:

- The invariant holds — recompute writes the column.
- `attribution.description` gets a real value instead of being absent.
- A genuine source **automatically outranks** generated text, which is exactly
  the read path the table documented from day one.
- **The clear-branch needs no exception.** `resolve_field()` returns a
  candidate, so the clear-branch is never reached for these rows. Measured
  after the reroute: the number of rows a clear-branch restore would still
  wipe is **0**.

### Why two source ids and not one

Load-bearing, not cosmetic. ADR `2026-08-21-template-eligibility-provenance-
review-decisions.md` §2 excludes template-only rows from trip-stop candidacy.
`pois_along_corridor` encoded that as `not (mp.description is null and
has_template)` — a predicate that tests whether the column is *empty*, so it
silently stops excluding the moment anything populates it. PR #327 populated
it and the exclusion stopped firing (measured: a template row went from
not-returned to returned). Routing template text through `source_record` would
break it the same way. A distinct `source_id` lets the exclusion be
re-expressed as `attribution.description <> 'generated_template'`, which
survives the description being present.

### Consequences deliberately neutralised

Routing generated text through `source_record` would otherwise change two
signals that mean "how much real-world evidence backs this place":

- `compute_prominence()` scores `count(distinct source_id) * 2.0`, so every
  affected place would gain **+2.0** and `pois_along_corridor` (which orders by
  prominence) would silently reorder.
- `source_count` is a gate in `master_place_search_export` and
  `pois_along_corridor`, and is exported to Typesense as `n`.

Both now exclude generated sources via `is_generated_source()`. Measured after
the reroute: average prominence over searchable rows is **0.8606**, identical
to the pre-reroute baseline, and `master_place_search_export` row count is
**33,047**, also identical.

### `description_source` stops lying

Its `CASE` tested `mp.description` first, so once generated text landed in the
column it reported `'source'` — claiming LLM text was source-derived. Both the
RPC and the export view now consult `attribution` first, so generated rows
report `'llm'` / `'template'` truthfully. The old branches remain beneath as a
fallback for rows not yet rerouted.

## Consequences

- New migrations `20260901000100`–`20260901000500`. TEST only; PROD needs
  separate sign-off.
- New script `data/scripts/reroute-generated-descriptions-to-source-record.ts`.
  `backfill-description-from-generated-content.ts` is marked **SUPERSEDED**;
  its writes were reverted via `--undo` before the reroute.
- `upsert_source_record()` is **not** used, which deviates from "always upsert
  via `upsert_source_record()`". It cannot set `master_place_id`, and leaving
  that null would put ~14k synthetic rows into the entity-resolution queue
  (`matcher.ts` selects unlinked records) where there is nothing to resolve.
  The batched PostgREST upsert path that `ingestion/lib/ewkt.ts` exists to
  serve is used instead, with the same `(source_id, external_id)` conflict
  target. Flagged rather than hidden.
- Dual rows — those with a real description *and* a generated row — were left
  alone, per the task's stated population. Under precedence it would be safe
  to include them, and arguably better: a dual row whose source later goes away
  would then degrade to generated text instead of going blank. Not done.
- Typesense must be re-synced for the corrected `description_source` to reach
  the index. Not run here.

## Scope — what this decision covers that was not asked for

Recorded so a later reader can unpick it cleanly:

- Changing `pois_along_corridor` was **required**: the task demanded ADR §2 keep
  holding, and the old predicate could not.
- Changing `compute_prominence()` and `source_count` was **required to avoid
  causing harm**, not requested. Without them the reroute would have added
  `+2.0` prominence to every affected place and silently reordered corridor
  results. `compute_prominence()` is a core scoring function; touching it was a
  judgement call. Reversible by removing `is_generated_source()` from both.
- Changing `master_place_search_export` (`20260901000400`) was **optional —
  scope creep**. It corrects `description_source` reporting `'source'` for
  generated text, a pre-existing inaccuracy that the reroute does not worsen.
  It also leaves Postgres and Typesense disagreeing until `search:sync` runs,
  which was not run. Drop it if you'd rather it shipped with its own sync.
- `is_generated_source()` is a new database object where three inline predicates
  would have worked. Single-sourcing the list, not a necessity.
