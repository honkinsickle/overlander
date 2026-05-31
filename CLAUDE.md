# OVERLANDER_01 — Claude Code Working Document

## Project goal
Federated POI search and trip-planning platform for overlanders. Phase 1 builds
the data foundation: federated ingestion from 10 sources, entity resolution,
field precedence, and prominence scoring against the LA→Deadhorse route corridor.

## Monorepo layout (npm workspaces)
- `web/` — Next.js trip-planning + slideup UI. Pre-existing. See `web/CLAUDE.md` and `web/AGENTS.md` for web-specific conventions.
- `data/` — Phase 1 data foundation. Ingestion, entity resolution, prominence scoring.
- `supabase/migrations/` — single source of truth for all schema. Timestamp-prefixed (Supabase CLI convention). Shared between `web/` and `data/`.

Root has `package.json` with `"workspaces": ["web", "data"]`. **npm**, not pnpm. The spec's pnpm references are translated to npm equivalents (`npm install -w data`, `npm run -w data <script>`).

## Design tokens (when frontend work occurs)
- Typography: Space Mono (data), Barlow (body), Barlow Condensed (headers)
- Base: #0a0b0c
- Amber accent: #c8a96e
- Dark theme only for now

For web client design tokens, see `web/CLAUDE.md` — Phase 1 work in `data/` does not touch them.

## Stack invariants — do not deviate without permission
- Postgres + PostGIS on Supabase (no other DBs)
- TypeScript 5.5+ strict mode, npm workspaces, Node 20
- Geometry stored in PostGIS, NOT in JSON
- Spatial queries always use PostGIS (never compute distance in app code if the values are in the DB)
- All external payloads validated through zod before persistence
- All ingestion idempotent on (source_id, external_id)

## Schema invariants — never violate
- `master_place` is the unit of search and display. Never write to it directly except via `recompute_master_place()`.
- `source_record` is the unit of update. Always upsert via `upsert_source_record()`.
- `master_place.attribution` is the source of truth for which source contributed which field. Never display a field without its attribution available.
- Entity resolution decisions live in `place_match`. Never bypass.

## Coding conventions
- No `any` types. Use `unknown` and narrow.
- All async functions return typed results, including errors.
- Errors are logged with structured context via pino, not console.
- Never log API keys, tokens, or PII. Pino is configured with redact paths.
- One default export per source file in `/data/ingestion/sources/`.
- Tests in `/data/entity-resolution/tests` for matcher edge cases.

## Forbidden patterns
- Don't fetch from Google Places without a field mask.
- Don't cache Google `currentOpeningHours`, `businessStatus`, `regularOpeningHours` longer than 30 days.
- Don't scrape iOverlander without rate limiting (p-limit(1) minimum).
- Don't write geometry as `{lat, lng}` JSON. Use PostGIS POINT type.
- Don't introduce a new dependency without justifying it in PR description.
- Don't compute prominence client-side. Always read from `master_place.prominence_score`.

## When uncertain
- Check the card data matrix for field semantics.
- Check `field_precedence` table for source ranking on any field.
- Ask before adding new sources or new top-level tables.
- Ask before changing the entity resolution thresholds (0.85 auto-link, 0.6 manual review floor).
- `field_precedence` seed values are pending. Until Adam provides them, do NOT seed and do NOT implement code paths that assume specific source priorities.

## Cross-workspace conventions
- `web/` does not import from `data/` at runtime. Phase 2 will expose query helpers via Supabase (RLS-enabled views or RPCs), not via shared TS packages.
- Shared TS types (e.g. `MasterPlace`, `SourceRecord`) will eventually live in a `packages/types` workspace. Not yet needed in Phase 1.
- `supabase/migrations/` is shared. New migrations append by timestamp; never reorder.

## Migration workflow
- Apply migrations via `npm run -w data db:push-verify`, NOT `supabase db push` directly. The wrapper runs `supabase db push` and then verifies expected INSERT-row presence via `data/scripts/verify-migration.ts`. Guards against the 2026-05-30-class CLI bug where `db push` reported success but skipped the migration body.
- CI does not run `db:push-verify` — verification happens at push-time, on the operator's machine. CI checks the verifier's own behavior via unit tests but cannot guard against CLI-side migration-execution bugs. The operator's `db:push-verify` invocation is the safety net.
- v1 verifier covers literal `INSERT INTO <table> VALUES (...), (...), ...` only. ON CONFLICT, INSERT ... SELECT, and DDL (CREATE / ALTER / DROP / functions) are reported as "uncovered" so a green verify on a mixed migration doesn't give false confidence about unchecked DDL.
