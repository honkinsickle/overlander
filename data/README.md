# data/ — OVERLANDER_01 Phase 1 data foundation

Federated POI ingestion + entity resolution + prominence scoring against the LA→Deadhorse corridor.

## Status

Phase 1, week 1. Workspace scaffolded; OSM ingester implemented end-to-end. **Migrations not yet applied** (Supabase CLI not installed locally — see "Applying migrations" below). Other sources, entity resolution, and field precedence pending.

## Layout

```
data/
├── ingestion/
│   ├── lib/                          shared utilities
│   │   ├── db.ts                     Supabase service-role client + RPC helpers
│   │   ├── logger.ts                 pino, with redact paths for secrets
│   │   ├── retry.ts                  p-retry defaults
│   │   ├── rate-limit.ts             p-limit pools per source
│   │   ├── corridor.ts               active-corridor lookup + bbox helpers
│   │   ├── geometry.ts               turf-based geo utilities
│   │   └── normalize.ts              shared normalization helpers
│   ├── sources/
│   │   ├── _types.ts                 IngestOptions, IngestResult
│   │   └── osm.ts                    OSM (Overpass API) ingester
│   ├── orchestrator.ts               scheduled-run entry point (stub)
│   └── manual.ts                     CLI for ad-hoc runs (one source, one bbox)
├── entity-resolution/                week 3 — stubbed
├── scripts/                          deploy-corridor, run-all-ingestion, audit-coverage (stubs)
└── tsconfig.json, package.json, .env.example
```

## Local setup

```bash
# From repo root:
npm install                            # installs both workspaces
cp data/.env.example data/.env.local   # then paste real Supabase keys
```

Supabase URL + service-role key can be copied from `web/.env.local` — same project per S1 decision.

## Applying migrations

Phase 1 adds 6 timestamp-prefixed migrations under `../supabase/migrations/`:

- `20260527120000_phase1_extensions.sql`
- `20260527120100_phase1_master_place.sql`
- `20260527120200_phase1_source_record.sql`
- `20260527120300_phase1_place_match.sql`
- `20260527120400_phase1_ingestion_corridor.sql`
- `20260527120500_phase1_functions.sql`

To apply, install the Supabase CLI and link the project:

```bash
brew install supabase/tap/supabase
cd /Users/adamwagner/Code/overlander
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

Alternatively, paste the Postgres connection string (from Supabase Dashboard → Project Settings → Database → Connection string) and apply with psql:

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/20260527120000_phase1_extensions.sql
# ...for each file in order.
```

## Running OSM end-to-end (after migrations are applied)

```bash
# From repo root:
npm run -w data ingest:manual -- --source osm --bbox 34.00,-118.50,34.10,-118.40 --dry-run
# Drop --dry-run to actually write to source_record.
```

The bbox above is a tiny (~10km × 10km) cell in central LA. Use it as a smoke test before priming the full corridor.

## Out of scope (week 1)

- iOverlander, RIDB, NPS, Google Places ingesters (week 2)
- Entity resolution / `place_match` population (week 3)
- `field_precedence` seed values + `resolve_field()` (blocked on card data matrix)
- `recompute_master_place()`, `compute_prominence()` (week 3)
- GitHub Actions schedules (week 2 once all sources ingest cleanly)
