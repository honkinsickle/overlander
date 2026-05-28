# Phase 2.5: Durable Materialization + Test Isolation — Build Spec

**Phase:** 2.5 (foundation hardening, between the search slice and corridor expansion)
**Duration:** 1–2 days
**Status:** Ready to execute
**Owner:** Adam (ACW Creative)
**Pre-reqs satisfied:** Phase 2 search slice merged; data layer + ER + Typesense sync all working but materialized by hand; D4 test suite currently resets `master_place` on the production project.

---

## 0. Mission

Turn the manually-run pipeline into a repeatable, safe operation, and stop the test suite from destroying real data. Two independent problems, bundled because they share a root cause (the S1 single-project decision means dev, test, and "production" data all live in one Supabase project, and materialization is a sequence of commands run by hand).

This is the unglamorous foundation that has to exist before corridor expansion. At 153 JT places, manual materialization and the test-wipe footgun are tolerable. At corridor scale (thousands of places, real Google API spend per ingest), they're untenable: you can't hand-run the pipeline every time, and you can't have a test run silently delete the dataset you just spent money building.

Out of scope: scheduled/cron automation of the pipeline (that's a later ops concern — this phase makes the pipeline a single repeatable command, not a scheduled job), corridor data expansion itself, and any new search/ER features.

---

## 1. Acceptance criteria

1. A single command runs the full pipeline end-to-end against the configured project: ingest (optional/flagged) → entity resolution → Typesense sync, idempotent, with a clear summary report.
2. The D4 test suite can no longer mutate or reset the production/dev `master_place` data. Either it runs against an isolated target, or the reset is hard-guarded so it physically cannot fire against the real project.
3. Re-running the pipeline produces a stable, deterministic dataset (no orphaned rows, no duplicates, stale documents pruned from Typesense).
4. Clear documentation of how to run the pipeline and how the test isolation works, so future-you (or Claude Code in a fresh session) doesn't have to reverse-engineer it.

---

## Part A — Durable Materialization Pipeline

### A.1 The problem

Right now the dataset exists only because someone ran, by hand, in sequence:
- ingestion scripts (per source)
- `matchAll` + `applyMatches` (entity resolution → master_place)
- `search:sync` (master_place → Typesense)

There's no single entry point, no idempotency guarantees across the whole chain, and no pruning — the Typesense sync upserts but never removes documents for master_places that no longer exist.

### A.2 Deliverable — `data/pipeline/materialize.ts`

A single orchestrator with a CLI, runnable as `npm run -w data materialize`. Stages, each independently skippable via flags:

```
materialize [options]
  --ingest             run source ingestion first (default: false — assumes source_record already populated)
  --sources <list>     comma-separated subset (osm,ridb,nps,google); default all
  --bbox <W,S,E,N>     restrict to a bounding box (default: active corridor)
  --skip-er            skip entity resolution (just re-sync existing master_place)
  --skip-sync          skip Typesense sync (just rebuild master_place)
  --dry-run            report what would happen, mutate nothing
```

Default invocation (`npm run -w data materialize`) runs: ER over current source_record → sync to Typesense. Adding `--ingest` runs the full chain from source fetch.

Stage sequence and behavior:

1. **(Optional) Ingest.** If `--ingest`, run the source ingesters (respecting `--sources` and `--bbox`). Idempotent upserts to source_record, as they already are.

2. **Entity resolution.** Run `matchAll` + `applyMatches` over unresolved source_records. This is the existing Phase 3a logic — wrap it, don't rewrite it. Critically: make this **safely re-runnable on an already-materialized dataset**. Currently ER assumes a clean slate (source_records with `master_place_id IS NULL`). Re-running needs a defined behavior:
   - Option (preferred): a `--rematerialize` mode that first unlinks all source_records and clears master_place + place_match, then re-runs ER from scratch. Deterministic, clean, matches how the dataset was built this session. This is the safe "rebuild everything" path.
   - The plain default (no rematerialize) only processes *new* unresolved source_records — incremental. Useful after an incremental ingest.
   - Document both clearly. For now, `--rematerialize` is the reliable path; incremental is an optimization.

3. **Sync to Typesense — with pruning.** Current sync upserts but doesn't prune. Fix this: after upserting all current master_places, **delete Typesense documents whose IDs no longer exist in master_place**. The clean approach: fetch the set of current master_place IDs, fetch the set of indexed Typesense IDs, delete the difference. Or use a generation/version stamp on each sync and delete documents not carrying the current stamp. Either works; pruning is the requirement.

4. **Summary report.** Print a structured summary: source_record counts per source, master_place count, outcome distribution (new/linked/rolled-up/pending), Typesense docs upserted + pruned, total runtime. This is the "did it work" readout.

### A.3 Idempotency requirement

Running `npm run -w data materialize --rematerialize` twice in a row must produce identical end state: same master_place count, same Typesense doc count, same outcome distribution. This is the determinism the perf-pass ORDER BY fix already enables — verify it holds end-to-end through the orchestrator.

### A.4 What this is NOT

Not a scheduled job. Not a cron. Not a queue. It's one command a human (or later, a CI/cron caller) runs to rebuild the index from sources. Scheduling is a later, separate concern — don't build it here.

---

## Part B — Test Isolation

### B.1 The problem

The D4 suite calls `reset_phase3a_test_state()`, which deletes from `master_place` and `place_match` on the **production project** (S1 = one Supabase project for everything). Running the tests wipes the real dataset. This already happened — master_place was empty at the start of the search-slice session because a prior test run cleared it.

This is a live footgun and gets dangerous the moment there's corridor data (or eventually beta data) you can't afford to lose.

### B.2 Options, in order of robustness

**Option 1 — Separate Supabase test project (most robust).**
Provision a second Supabase project used only by tests. Tests connect via `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_ROLE_KEY`. The test setup migrates the schema into it and seeds the JT fixture corpus. The reset helper runs only against the test project, which contains nothing precious. Pro: complete isolation, tests can do anything. Con: a second project to manage, schema must be kept in sync (migrations applied to both).

**Option 2 — Schema isolation within one project.**
Tests operate in a separate Postgres schema (e.g. `test_overlander`) within the same project. The reset only touches the test schema. Pro: one project, no extra credentials. Con: more plumbing to route the test connection to a schema; Supabase client schema-switching is fiddler.

**Option 3 — Hard guard on the reset (minimum viable).**
Make `reset_phase3a_test_state()` physically incapable of running against real data: require an explicit, loud opt-in that production code/data never carries. For example, the reset checks for a sentinel — a row in a `test_marker` table, or an env var `ALLOW_DESTRUCTIVE_TEST_RESET=true` that only the test runner sets — and raises/aborts otherwise. Pro: trivial to implement, immediate protection. Con: doesn't isolate, just guards; tests still run against the same project, so they still need to seed/clean their own data without clobbering real rows.

### B.3 Recommendation

**Start with Option 3 (the guard) as an immediate safety net, then move to Option 1 (separate test project) as the real fix.** The guard can ship in an hour and removes the acute danger today. The separate test project is the correct long-term state and should follow — but the guard means you're not exposed in the interim.

Concretely for this phase:
- Implement the hard guard now: `reset_phase3a_test_state()` aborts unless an explicit `ALLOW_DESTRUCTIVE_TEST_RESET` signal is present, which only the vitest setup sets. Any accidental invocation (a stray `supabase` call, a fresh session, a mis-run) does nothing.
- Provision a separate Supabase test project and point the test suite at it via `SUPABASE_TEST_*` env vars. Migrate the schema in, seed the JT fixtures. Once tests run green against the isolated project, the guard becomes belt-and-suspenders rather than the only protection.

If provisioning a second project is more than you want to take on right now, ship Option 3 alone this phase and file Option 1 as the immediate next item — but do not leave the suite able to wipe real data.

### B.4 Test data seeding

Once tests run against an isolated target, they need their own copy of the JT corpus to resolve. Add a test-fixture seed: a script or setup step that loads the 207 JT source_records (the OSM/RIDB/NPS/Google records for the JT bbox) into the test target before the suite runs. This decouples the tests from whatever's in the real project entirely — they bring their own data.

---

## 2. Execution order

This is one PR on a branch `feat/durable-materialize`, through the now-standard PR + CI flow.

1. **Part B, Option 3 first (the guard).** Smallest, highest-urgency — removes the acute data-loss risk immediately. Commit `fix(test): hard-guard destructive reset against non-test projects`.
2. **Part A, the materialize orchestrator.** The repeatable pipeline. Commit `feat(pipeline): single-command materialize (ingest→ER→sync) with pruning`.
3. **Part A, sync pruning** if not folded into step 2. Commit `feat(search): prune stale documents on sync`.
4. **Part B, Option 1 (separate test project + seed)** — if taking it on this phase. Commit `test: isolate suite on dedicated supabase project with fixture seed`.
5. **Verify:** run `materialize --rematerialize` twice, confirm identical end state. Run the test suite, confirm it touches only the test target and the real `master_place` is untouched afterward. Document both in the README.

Open as a PR, CI green, review diff, merge via gh.

---

## 3. Provisioning needed from Adam

- **If doing Option 1:** a second Supabase project (free tier is fine — test data is small). You'll provide `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_ROLE_KEY` into a test env file directly (same secret discipline — don't paste in chat). Claude Code migrates the schema and seeds fixtures into it.
- **If Option 3 only:** nothing to provision; it's a code-only change.

Claude Code should pause and ask before assuming you want to stand up a second project.

---

## 4. Constraints

- Existing CLAUDE.md conventions: strict TypeScript, structured logging, no `any`.
- Reuse the Phase 3a ER logic (`matchAll`/`applyMatches`) and the Phase 2 sync — wrap them in the orchestrator, don't reimplement.
- The orchestrator must be safe by default: a bare `npm run -w data materialize` with no flags should never destroy data unexpectedly. Destructive modes (`--rematerialize`) require the explicit flag.
- Pruning must be correct: never delete a Typesense document whose master_place still exists. Verify against the current-IDs set, not a heuristic.
- The test guard must fail closed: if the `ALLOW_DESTRUCTIVE_TEST_RESET` signal is absent or ambiguous, the reset aborts rather than proceeding.

---

## 5. Why this before corridor expansion

Corridor expansion multiplies every fragility here. Manual materialization across thousands of places is error-prone and slow. A test run wiping a hand-built, API-money-costing dataset goes from annoying to expensive. Stale Typesense documents accumulate as the dataset churns through re-ingests. Doing this hardening now — while the dataset is 153 understood places and the pipeline is simple — is far cheaper than retrofitting it after corridor scale buries the problems in volume. It's the foundation that lets corridor expansion be "run one command, watch it work" instead of "re-run a fragile manual sequence and hope a test didn't nuke it."
