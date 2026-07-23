# Slice 1 — prove the corridor pipeline end to end

Status: planned, not yet run. Goal: exercise the never-run corridor workflow
(`ingestion_corridor` is empty) on a small US segment and find where the
plumbing breaks — not coverage. TEST only.

## 1. Segment

`segment_a_la_pnw`, **day range 1–1: LA → Cedar City, UT (~400 mi)**. It reuses
the existing `segment_a_la_pnw` NPS state list and Google anchors — both keyed
by this exact corridor name in `data/scripts/ingest-corridor.ts` — so no new
source config is needed beyond the SEGMENTS entry (`deploy-corridor.ts`).

Confirmed against source: anchors at `ingest-corridor.ts:92-101` (8: LA →
Whitefish), NPS states `["CA","NV","AZ","UT","ID","MT"]` at `:74`, Day-1 endpoint
`[-113.5163, 37.0469]` (Cedar City) at `alaska.ts:80`.

**Scope caveat (by design):** only OSM, RIDB, and Google *enrichment* are
bbox-clipped (`ingest-corridor.ts:493, 510, 591`). NPS (states) and Google
*discovery* (anchors) are keyed by corridor name and **fire the full segment_a
footprint** — 6 states, 8 anchors (LA → Whitefish) — regardless of the day
range (`:528, 596`). For a plumbing test this is fine (every stage exercises);
the ingested data is not geographically confined to the ~400 mi.

## 2. Run sequence (TEST; run from a host that can reach `*.typesense.net`)

Confirm `data/.env` → TEST `znldz…` first.

0. **Snapshot + self-test (the rollback safety gate):**
   ```
   npm run -w data slice:snapshot
   npm run -w data slice:rollback            # dry-run
   ```
   The dry-run MUST print "SELF-TEST PASS" / 0 to delete. If it reports anything,
   STOP — the discriminator is wrong.
1. `npm run -w data deploy-corridor -- --only segment_a_la_pnw`
   Writes the corridor definition only. `--only` keeps it the single active row
   (avoids the LIMIT-1 ambiguity in `lib/corridor.ts`). Success: logs `upserted`
   `segment_a_la_pnw`, `vertices: 2`, `bufferKm: 80`.
2. `npm run -w data ingest-corridor -- --corridor segment_a_la_pnw --skip-google`
   Free pass: OSM → RIDB → NPS. Success: non-zero `osm/ridb` inserts,
   `nps.parkCodes > 0`, `status: complete`.
3. `npm run -w data materialize`  (bare — NOT `--rematerialize`, NOT
   `--only-categories`). Promotes the new source_records. If the inline Typesense
   sync errors on DNS, the DB promotion already committed — proceed to step 6.
4. `npm run -w data ingest-corridor -- --corridor segment_a_la_pnw --skip-enrichment`
   Paid stage: Google discovery (8 anchors), skipping the whole-envelope
   enrichment scan to cap cost.
5. `npm run -w data materialize`  (promote the Google rows).
6. `npm run -w data search:sync`  (full Typesense reindex; run explicitly since
   step 3/5's inline sync may fail on a restricted host).

## 3. Expected yield & cost

- OSM (free): ~100–120 Overpass tiles at `pLimit(2)`, several hundred–~1.5k rows.
- RIDB (free): ~3 latitude-strip queries, tens of rows.
- NPS (free): 6 states, not bbox-clipped → ~80–150 rows across CA/NV/AZ/UT/ID/MT.
- Google discovery (bills): 8 anchors × ~1–3 `searchNearby` @ $0.032 ≈ **$0.30–0.80**.
- Google enrichment, if later un-skipped (bills): ~100–500 × $0.005 ≈ $0.50–2.50.
- **Total Google ≈ $1, or ~$1–3 with enrichment.** Within a few dollars. The
  $100 ledger cap (`GOOGLE_PLACES_BUDGET_USD`) is the hard backstop; the ledger
  persists so retries resume rather than double-bill. (Full Days 1–3 would push
  enrichment to ~$5–20 — the reason for Day-1-only.)

## 4. Proof (in the app)

Dev app points at TEST; the browser must reach the Typesense host (federated
query is browser-side, `NEXT_PUBLIC_TYPESENSE_*`). Open `/trips` → a trip
slideup → the **Find Nearby** panel; pan the map to the St. George / Zion /
Cedar City area (~lat 37) and search a category (camping/fuel) or a name we
ingested (e.g. "Zion", "Cedar Breaks"). The corpus was entirely lat 33.8–34.4
before, so **any corpus (federated) hit above ~34.4 is new**. To isolate corpus
from live Google, check `/api/search-area` `counts.federated > 0` in the network
tab, or use the `/search` dev page (Typesense-only) and query an ingested name.

## 5. What could break (workflow has never executed)

- **OSM / Overpass (highest risk):** ~100+ tiles against a community mirror at
  `pLimit(2)` — 429s / timeouts / flakiness. Mitigation: `--skip-osm`, retry.
- **`deploy-corridor` coord extraction:** regex-scrapes `alaska.ts` by exact
  6-space indent (`:106`); a formatting drift → `Extracted 0 day-level coords`.
- **Missing keys:** NPS/RIDB/Google adapters throw on missing API keys.
- **`materialize` Typesense stage:** known DNS `ENOTFOUND` from a restricted
  host — DB promotion commits, then the sync fails; rely on step 6.
- **Wrong corridor name:** `SEGMENT_ANCHORS[name] ?? []` / `SEGMENT_NPS_STATES[name] ?? []`
  silently return empty; the name must be exactly `segment_a_la_pnw`.
- **Scale: none** at this size — the O(n²) / timeout risks are `--rematerialize`-only.

## 6. Rollback (id-snapshot discriminator)

See `docs/decisions/2026-07-23-corridor-rollback-by-id-snapshot.md` for why this
is not timestamp-based (a `fetch_timestamp` delete would remove the whole corpus:
`fetch_timestamp` bumps on upsert, and 1,748/1,749 existing rows are inside the
Day-1 bbox and would be re-upserted).

1. **Before the run:** `npm run -w data slice:snapshot` records every existing
   `source_record` / `master_place` / `place_match` id + counts to
   `~/.config/overlander/slice1-rollback-snapshot.json` (durable). Gate with the
   self-test dry-run (step 0).
2. **To undo:** `npm run -w data slice:rollback` (dry-run to review the diff),
   then `npm run -w data slice:rollback -- --execute`. It deletes only rows whose
   id is not in the snapshot (cascading `place_match`), recomputes existing
   masters that absorbed a deleted record, and verifies `source_record` /
   `master_place` / `place_match` counts against the snapshot (a place_match
   mismatch means the cascade under-fired — surfaced, not hidden).
3. `npm run -w data search:sync` to prune deleted docs from Typesense.
4. `DELETE FROM ingestion_corridor WHERE name = 'segment_a_la_pnw'` (or set
   `active = false`) and revert the SEGMENTS entry, if fully unwinding.
