/**
 * One-shot CSV exporter for source_record.
 *
 * Dumps every active source_record across all sources to a single CSV
 * with all available fields, plus lng/lat split out from PostGIS
 * geometry. raw_payload and normalized_payload are JSON-stringified
 * into their own cells so the CSV stays one-row-per-record while still
 * carrying the full source-specific payload (different shape per
 * source — OSM has `tags`, RIDB has Facility*, NPS has campground +
 * place fields, Google has `place` body).
 *
 * Output: data/.cache/source-records.csv (gitignored).
 *
 * Paginated read; safe to run while materialize is active in another
 * process — no writes, no locks.
 *
 * Run:
 *   npx tsx --env-file=data/.env data/scripts/export-source-records.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(HERE, "../.cache/source-records.csv");
const PAGE = 500;

// ──────────────────────────────────────────────────────────────────────
// Columns. Order = CSV column order.
// ──────────────────────────────────────────────────────────────────────

const COLUMNS = [
  "id",
  "source_id",
  "external_id",
  "name",
  "inferred_category",
  "lng",
  "lat",
  "source_quality_score",
  "master_place_id",
  "is_active",
  "fetch_timestamp",
  "created_at",
  "updated_at",
  "normalized_payload",
  "raw_payload",
] as const;

// ──────────────────────────────────────────────────────────────────────
// CSV
// ──────────────────────────────────────────────────────────────────────

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s: string;
  if (typeof value === "string") s = value;
  else if (typeof value === "number" || typeof value === "boolean") s = String(value);
  else s = JSON.stringify(value);
  // RFC 4180-ish: wrap in quotes if it contains comma, quote, CR, or LF.
  // Escape embedded quotes by doubling.
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function csvRow(values: readonly unknown[]): string {
  return values.map(csvCell).join(",");
}

// ──────────────────────────────────────────────────────────────────────
// Fetch + write
// ──────────────────────────────────────────────────────────────────────

interface SourceRecordViewRow {
  id: string;
  source_id: string;
  external_id: string;
  name: string;
  inferred_category: string | null;
  lng: number;
  lat: number;
  master_place_id: string | null;
  source_quality_score: number;
  is_active: boolean;
}

interface SourceRecordPayloadRow {
  id: string;
  fetch_timestamp: string;
  created_at: string;
  updated_at: string;
  normalized_payload: unknown;
  raw_payload: unknown;
}

async function main(): Promise<void> {
  const db = getDb();

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  // Write header first so we can stream-append rows.
  let csv = csvRow(COLUMNS) + "\n";

  let offset = 0;
  let total = 0;
  while (true) {
    // View has the flat fields + lng/lat; separate query for the jsonb
    // payloads + timestamps to keep response sizes manageable per page.
    const [{ data: viewData, error: viewErr }, { data: payloadData, error: payloadErr }] =
      await Promise.all([
        db
          .from("source_record_view")
          .select(
            "id, source_id, external_id, name, inferred_category, lng, lat, master_place_id, source_quality_score, is_active",
          )
          .order("source_id")
          .order("external_id")
          .range(offset, offset + PAGE - 1),
        db
          .from("source_record")
          .select("id, fetch_timestamp, created_at, updated_at, normalized_payload, raw_payload")
          .order("source_id")
          .order("external_id")
          .range(offset, offset + PAGE - 1),
      ]);
    if (viewErr) throw viewErr;
    if (payloadErr) throw payloadErr;

    const view = (viewData ?? []) as SourceRecordViewRow[];
    const payloads = (payloadData ?? []) as SourceRecordPayloadRow[];
    if (view.length === 0) break;

    // Pair by id (page-aligned but we don't trust ordering — index by id).
    const byId = new Map<string, SourceRecordPayloadRow>();
    for (const p of payloads) byId.set(p.id, p);

    for (const v of view) {
      const p = byId.get(v.id);
      const row = [
        v.id,
        v.source_id,
        v.external_id,
        v.name,
        v.inferred_category,
        v.lng,
        v.lat,
        v.source_quality_score,
        v.master_place_id,
        v.is_active,
        p?.fetch_timestamp ?? null,
        p?.created_at ?? null,
        p?.updated_at ?? null,
        p?.normalized_payload ?? null,
        p?.raw_payload ?? null,
      ];
      csv += csvRow(row) + "\n";
      total += 1;
    }

    logger.info({ page: offset / PAGE + 1, fetched: view.length, total }, "export: page");
    if (view.length < PAGE) break;
    offset += PAGE;
  }

  writeFileSync(OUT_PATH, csv);
  logger.info({ path: OUT_PATH, rows: total }, "export: complete");
  // eslint-disable-next-line no-console
  console.log(`\nWrote ${total} rows to ${OUT_PATH}`);
}

main().catch((err) => {
  logger.error({ err }, "export: fatal");
  process.exit(1);
});
