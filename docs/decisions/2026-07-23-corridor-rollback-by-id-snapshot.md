# Corridor-ingest rollback uses a pre-run primary-key snapshot, not a timestamp

Date: 2026-07-23

## Context

Corridor ingestion is additive and idempotent: every source adapter upserts into
`source_record` on `(source_id, external_id)`. To make a corridor run reversible
on TEST (a plumbing test, a mis-scoped run, a smoke-then-clean cycle), rollback
must identify *exactly* the rows a run added, with nothing else deleted.

Candidate discriminators, and why each was rejected or chosen:

- **`fetch_timestamp >= T` — REJECTED, and it would delete the entire corpus.**
  `source_record.fetch_timestamp` has `default now()` **and** is written per-row
  by the adapters on every upsert, *including updates*. Because writes are
  upserts on `(source_id, external_id)`, re-ingesting an existing record bumps
  its `fetch_timestamp` to the new run time. Measured on TEST before Slice-1:
  **1,748 of 1,749 searchable rows sit inside the Slice-1 Day-1 corridor bbox**
  (LA → Cedar City). The existing SoCal/Joshua-Tree corpus is almost entirely
  within Day-1's footprint, so the run would re-upsert nearly the whole corpus
  and bump its timestamps. `DELETE WHERE fetch_timestamp >= T` would then remove
  the baseline too — the whole corpus. This is the trap that motivated the ADR.

- **Max-id + delete-above — REJECTED.** `source_record.id` is
  `gen_random_uuid()`, not a monotonic sequence. There is no ordered key to
  compare against.

- **Explicit run-id / batch column — DOES NOT EXIST.** The `source_record`
  schema has no run/batch/ingestion-run column; nothing tags a run.

- **`created_at >= T` — viable but weaker.** `created_at` is DB-defaulted and
  not written by any adapter, so it survives upserts (insert-only). But its
  safety rests on "no code path ever writes `created_at` on upsert," and it
  can't tell a re-touched baseline row from an untouched one.

## Decision

Roll back by **pre-run primary-key snapshot + set-difference**, not by any
timestamp. Immediately before a run, snapshot every existing
`source_record.id`, `master_place.id`, and `place_match.id` to a durable file.
After the run, delete only rows whose `id` is **not** in the snapshot.

Re-upserted existing rows keep their `id` (upsert-on-conflict updates in place),
so they are in the snapshot and never deleted. Tooling:
`data/scripts/slice1-snapshot.ts` (`npm run -w data slice:snapshot`) and
`data/scripts/slice1-rollback.ts` (`npm run -w data slice:rollback`, dry-run by
default, `--execute` to delete). Both refuse to run against a non-TEST project.

A **self-test** gates every use: run the snapshot, then immediately dry-run the
rollback. With zero new rows the set-difference must be empty ("SELF-TEST PASS").
Any rows reported means the snapshot/diff is wrong — stop.

## Consequences

- Rollback restores the baseline **row-set and counts exactly**, keyed on the
  immutable PK — immune to the `fetch_timestamp` bump.
- Re-upserted existing rows keep bumped `fetch_timestamp` / `updated_at` /
  `normalized_payload` (a harmless refresh — they are legitimate baseline rows).
- Existing `master_place`s that *absorbed* a now-deleted new `source_record`
  would keep inflated aggregates; the rollback recomputes those masters
  (`recompute_master_place`) so `source_count` / prominence / attribution return
  to baseline.
- `place_match` rows are removed by FK cascade on `source_record` /
  `master_place` deletes; the rollback verifies the `place_match` count against
  the snapshot so a cascade that under-fires is surfaced, not hidden.
- Typesense is pruned by a follow-up `npm run -w data search:sync` (its prune
  pass deletes docs whose `master_place` no longer exists).
- The snapshot must be taken **immediately before** the run and stored durably
  (`~/.config/overlander/…`, not `/tmp`); a stale snapshot taken after other
  writes would mis-classify rows.
- `fetch_timestamp`-based rollback is closed off. Do not reintroduce it.
