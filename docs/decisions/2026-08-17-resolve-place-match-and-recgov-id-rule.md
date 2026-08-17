# 2026-08-17 — `resolve_place_match` RPC + deterministic recreation.gov-id queue rule

[PR #230](https://github.com/honkinsickle/overlander/pull/230) (`45e6ede`),
migration `20260817120000_resolve_place_match.sql` + `data/scripts/resolve-recgov-rule.ts`.
**Applied to TEST only — not merged, not on PROD.** PROD application is a separate
authorized step (re-link + `.env` swap per the migration workflow). Closes the
"there is no way to confirm a pending `place_match`" gap and clears the first
evidence-backed slice of the USFS campground review queue.

## Context

The `manual_review` queue reached **5,745 pending `place_match` rows**
`[queried TEST 2026-08-17]` after the four USFS materializes. Two problems blocked
any progress on it:

**1. There was no path to confirm a pending row.** `apply_match_outcomes` (the
only apply RPC) is **INSERT-only**; its `manual_review` branch INSERTs a pending
row and leaves the `source_record` **unlinked**. Confirming an existing pending row
by calling it again collides with `unique(source_record_id, master_place_id)`, and
nothing links the SR or recomputes the MP. (The README's `audit-cli.ts` with a
`confirm`/`reject` command was **never built** — verified 2026-08-17: no such file
in the repo or git history.) So the queue could grow but nothing could drain it.

**2. USFS↔RIDB were believed to share no identifier.** The 2026-08-16 queue
scoping recorded that external lookup (fs.usda.gov ↔ recreation.gov) was "the only
ground truth." Three approaches were tried this session:

- **LLM adjudication, no web ($0.26/60 pairs):** the model abstained just 1 of 60
  and treated *copied federal descriptions* (USFS text mirrored into a ridb record)
  as identity evidence — a same-text ≠ same-place failure. Not usable unsupervised.
- **LLM adjudication, web-enabled:** confirmed the FS↔recreation.gov link is real,
  but cost **$0.40/pair** and exhausted API credits after 17 pairs. Infeasible at
  queue scale.
- **Deterministic (the winner):** the USFS INFRA payload text **already embeds**
  `recreation.gov/camping/campgrounds/<id>` for developed campgrounds. No fetch, no
  model — a regex over stored data. **$0, ~40s for the full queue.** (The stored
  `usda_portal_url` is a *dead* legacy link — it 301s to a generic forest index and
  drops the recid — and `fs.usda.gov` 403-blocks non-browser user agents, so the
  "fetch the FS page" design the LLM path implied is a dead end. The id was in the
  data all along.)

## Decision

**Two generic, symmetric RPCs** (migration `20260817120000`):

- **`resolve_place_match(pm_id, resolved_by)`** — requires the row be `pending`,
  refuses if the SR is already linked to a *different* master_place, links the SR,
  sets `status='confirmed'` + `resolved_by` + `resolved_at`, calls
  `recompute_master_place(target)`.
- **`unresolve_place_match(pm_id, prior_sr_master_place_id)`** — the exact inverse:
  restores the SR link to its snapshotted prior value, flips status back to
  `pending`, nulls the resolver fields, recomputes. Because recompute is a full
  recount/re-resolve over `is_active` source_records, removing the just-added SR
  restores canonical_name/category/source_count **deterministically** — undo is
  exact, not a decrement. Neither RPC deletes rows.

**One deterministic rule** (`resolve-recgov-rule.ts`) that uses them: auto-confirm
a pending **usfs campground** row when its payload's recreation.gov id resolves to
a `ridb` record (`external_id ridb:facility:<id>`) attached to the **same**
master_place the pending row proposes. Tagged `resolved_by='rule:recgov-id:<tag>'`,
snapshot written outside the repo before any write, chunked with health checks.

### Why the payload id, not a fetch and not the LLM

The recreation.gov id is already in the stored payload for the campgrounds that
have it, so the deterministic read dominates on every axis: **$0 vs $0.40/pair**,
no rate limit, no bot-blocking, and — unlike the LLM — it cannot be fooled by
copied descriptions, because it matches on a *facility identifier*, not on text
similarity. The LLM's only real advantage was web-*search* discovering modern FS
URLs; that advantage evaporates once the id is read straight from the payload.

### Why 0 renames was provable from `field_precedence` before it was measured

This is the load-bearing safety argument, and the interesting part is that it did
not need the run to be trusted. Confirming a row adds the usfs SR to the target MP
and recomputes it, so the risk is that the usfs record wins `canonical_name` or
`primary_category` precedence and silently renames the MP (the Thomas-Mountain
failure mode). From `field_precedence` alone:

- **`canonical_name`:** usfs is priority **3**, tied with ridb (also 3). The
  tie-breaker is `source_quality_score DESC, then source_id ASC`. usfs and ridb
  both have quality **0.9**, so it falls to `source_id ASC` — **`ridb` < `usfs`**,
  ridb wins. On a *matched* MP the ridb record is present by definition (that is
  what "matched" means), so usfs can **never** take canonical_name.
- **`primary_category`:** usfs has **no `primary_category` precedence row at all**,
  so the resolver's join excludes it — usfs cannot change primary_category, full
  stop.

So renames/recategorizations were provably **0** before applying anything. The
dry-run simulated it per-MP and predicted 0; the run measured 0 across all 364
affected MPs. Proof first, measurement as confirmation.

### Why different-mp and not-in-corpus are surfaced, not acted on

- **different-mp** — the id resolves to a *different* MP than the matcher proposed.
  That is not a confirm; it is either a mis-pairing or a duplicate MP, and
  re-pointing the SR (or merging two MPs) is a different, higher-blast-radius
  operation. Left pending.
- **not-in-corpus** — the id names a recreation.gov facility we have not ingested.
  A RIDB-coverage gap, not a match decision. Left pending.

## Consequences

- **Applied as tag `full0817`: 370 confirmed, 0 failures, 0 renames, 0
  recategorizations, max source_count 6** `[queried TEST 2026-08-17]`. Health flat
  across 15 chunks of 25 (73–181 ms). Undo verified **exact** on a 2-row round trip
  (canonical_name, primary_category, source_count, and pending status all restored)
  *before* the full run. Snapshot: `~/.config/overlander/queue-snapshots/recgov-full0817.jsonl`.
- **The bridge is a developed-campground feature.** Payload-embedded ids: campground
  **921/2,312 (40%)**; trailhead 5/3,041 · picnic 21/570 · dispersed 0/407 — only
  **26 / 4,018** non-campground SRs carry any id `[queried TEST 2026-08-17]`. The
  other queue categories have no evidence available at any price via this path.
- **Surfaced, pending: 58 different-mp + 28 not-in-corpus** — handling design in
  `BACKLOG.md`.
- **Duplicate master_places exist that the matcher never paired.** The recgov-id
  mechanism is itself a *high-precision* duplicate detector (a shared facility id on
  two MPs is strong same-place evidence, independent of name). Confirmed cases and
  why a corpus-wide count is not cleanly obtainable by name: `BACKLOG.md`.
- **The confirm path is now generic infrastructure.** `resolve_place_match` /
  `unresolve_place_match` are not recgov-specific; any future queue rule or triage
  framework builds on them, not on the insert-only `apply_match_outcomes`.
- **No migration to PROD.** `20260817120000` is on **TEST only**. The rule ran on
  TEST only. PROD application of both is a separate authorized step.
