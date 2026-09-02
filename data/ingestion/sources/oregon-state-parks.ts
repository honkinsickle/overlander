/**
 * Oregon State Parks visitor-website ingester (CSV-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries) with visitor-facing content scraped from
 * stateparks.oregon.gov: descriptions, amenities, operational status,
 * hero photos, and booking flags.
 *
 * Source CSV: `/Users/adamwagner/or-state-parks/data/oregon-state-parks.csv`
 * (192 rows — all OR state parks, scraped 2026-09-01).
 *
 * Per-state source_id, separate from CA's `california_state_parks` and WA's
 * `washington_state_parks` — the california/washington_state_parks family diverges from
 * the shared `state_parks` GIS pattern that uses one source_id across
 * all six states.
 *
 * external_id format: `oregon_state_parks:<park_id>` — the numeric
 * OPRD parkId from the URL, unique per park and stable across scrapes.
 *
 * OR's CSV genuinely lacks structured hours/contact data (no dedicated
 * columns in the source pages), so this ingester writes NO field_precedence
 * rows for those fields — description / amenities / operational_status only.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source oregon_state_parks --dry-run
 *   npm run -w data ingest:manual -- --source oregon_state_parks
 *
 * Env override:
 *   OREGON_STATE_PARKS_CSV — path to the CSV file. Defaults to
 *     `/Users/adamwagner/or-state-parks/data/oregon-state-parks.csv`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "oregon_state_parks";
const SOURCE_QUALITY_SCORE = 0.6;

const DEFAULT_CSV_PATH =
  "/Users/adamwagner/or-state-parks/data/oregon-state-parks.csv";

const RowSchema = z.object({
  n: z.string(),
  park_id: z.string(),
  name: z.string(),
  status: z.string(),
  lat: z.string(),
  lon: z.string(),
  url: z.string(),
  reservation_url: z.string(),
  overnight: z.string(),
  reservable: z.string(),
  first_come: z.string(),
  day_use_fee: z.string(),
  amenities: z.string(),
  accessible: z.string(),
  photo_file: z.string(),
  photo_caption: z.string(),
  photo_source_url: z.string(),
  photo_count: z.string(),
  history: z.string(),
  description: z.string(),
});
type ParkRow = z.infer<typeof RowSchema>;

// ───── CSV parser (RFC-4180, shared with state-parks-web.ts pattern) ────────

function parseCsv(text: string): ParkRow[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ",") { record.push(field); field = ""; i += 1; continue; }
    if (c === "\n") { record.push(field); rows.push(record); record = []; field = ""; i += 1; continue; }
    field += c;
    i += 1;
  }
  if (field.length > 0 || record.length > 0) { record.push(field); rows.push(record); }
  if (rows.length === 0) return [];
  const header = rows[0];
  const out: ParkRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === "") continue;
    if (cols.length < 20) {
      logger.warn({ row: r, cols: cols.length }, "oregon_state_parks: skipping malformed row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "oregon_state_parks: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

// ───── Helpers ───────────────────────────────────────────────────────

function parseBool(s: string): boolean {
  return s.trim() === "1";
}

function parseSemicolonList(raw: string): string[] | null {
  if (!raw.trim()) return null;
  return raw.split(";").map((s) => s.trim()).filter(Boolean);
}

/**
 * OR does not have a `type` column, unlike CA. Category is derived from
 * name tokens, most-specific first. Names that don't match a rule
 * fall through to `park` and are logged so the tally is visible.
 */
function inferCategory(name: string): { category: string; matched: boolean } {
  const n = name.toLowerCase();
  if (n.includes("campground")) return { category: "campground", matched: true };
  if (n.includes("trailhead")) return { category: "trailhead", matched: true };
  if (n.includes("scenic viewpoint") || n.includes("state viewpoint") || n.includes("overlook")) {
    return { category: "viewpoint", matched: true };
  }
  if (n.includes("state recreation site") || n.includes("state recreation area") || n.includes("wayside")) {
    return { category: "recreation_area", matched: true };
  }
  if (n.includes("state natural area") || n.includes("state natural site")) {
    return { category: "public_land", matched: true };
  }
  if (n.includes("state scenic corridor")) return { category: "public_land", matched: true };
  if (n.includes("state heritage site") || n.includes("state heritage area") || n.includes("heritage landing")) {
    return { category: "historic", matched: true };
  }
  if (n.includes("state forest")) return { category: "public_land", matched: true };
  if (n.includes("state trail") || n.includes("greenway")) return { category: "public_land", matched: true };
  if (n.includes("hotel")) return { category: "historic", matched: true };
  if (n.includes("watching center") || n.includes("visitor center")) {
    return { category: "visitor_center", matched: true };
  }
  if (n.includes("vista house")) return { category: "viewpoint", matched: true };
  if (n.includes("state park")) return { category: "park", matched: true };
  return { category: "park", matched: false };
}

function normalizeStatus(status: string): string | null {
  const s = status.trim();
  if (!s || s === "Open") return null;
  if (s === "Temporarily Closed") return "CLOSED";
  if (s === "Reduction in Services/Facilities") return "RESTRICTED";
  return s.toUpperCase();
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(row: ParkRow): Record<string, unknown> {
  const description = row.description.trim() || null;
  const history = row.history.trim() || null;
  const amenities = parseSemicolonList(row.amenities);
  const accessible = parseSemicolonList(row.accessible);
  const opStatus = normalizeStatus(row.status);

  const photoCount = parseInt(row.photo_count, 10);

  const photo =
    row.photo_file.trim() && row.photo_source_url.trim()
      ? compact({
          url: row.photo_source_url.trim(),
          credit: "Oregon State Parks",
          license: "Oregon State Parks — government publication",
          source_page: row.url.trim(),
          caption: row.photo_caption.trim() || undefined,
          count: Number.isNaN(photoCount) ? undefined : photoCount,
        })
      : null;

  return compact({
    canonical_name: row.name,
    description,
    history,
    amenities: amenities ? { list: amenities } : undefined,
    accessible: accessible ? { list: accessible } : undefined,
    operational_status: opStatus,
    photo,
    park_id: row.park_id.trim() || undefined,
    reservation_url: row.reservation_url.trim() || undefined,
    overnight: parseBool(row.overnight),
    reservable: parseBool(row.reservable),
    first_come: parseBool(row.first_come),
    day_use_fee: parseBool(row.day_use_fee),
    provenance: compact({
      source: "stateparks.oregon.gov",
      park_id: row.park_id.trim() || undefined,
      website: row.url.trim() || undefined,
      scraped_at: "2026-09-01",
    }),
  }) as Record<string, unknown>;
}

// ───── Persistence ───────────────────────────────────────────────────

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(
  row: ParkRow,
  category: string,
  dryRun: boolean,
): Promise<Outcome> {
  const lat = parseFloat(row.lat);
  const lon = parseFloat(row.lon);
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lon) && !(lat === 0 && lon === 0);

  if (!hasCoords) {
    logger.warn(
      { name: row.name, park_id: row.park_id, lat: row.lat, lon: row.lon },
      "oregon_state_parks: no valid coordinates — skipping",
    );
    return "skipped";
  }

  const parkId = row.park_id.trim();
  if (!parkId) {
    logger.warn({ name: row.name }, "oregon_state_parks: missing park_id — skipping");
    return "skipped";
  }

  const externalId = `${SOURCE_ID}:${parkId}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name, category }, "oregon_state_parks: dry-run");
    return "inserted";
  }

  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: category,
      point: [lon, lat],
      rawPayload: { row, fetched_at: "2026-09-01" },
      normalizedPayload: normalizeRow(row),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId, name: row.name }, "oregon_state_parks: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvPath = process.env.OREGON_STATE_PARKS_CSV ?? DEFAULT_CSV_PATH;
  logger.info({ csvPath, dryRun }, "oregon_state_parks: ingest starting");

  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  logger.info({ rows: rows.length }, "oregon_state_parks: CSV loaded");

  const stats = { fetched: rows.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const catCounts: Record<string, number> = {};
  const unmatchedNames: string[] = [];

  for (const row of rows) {
    const { category, matched } = inferCategory(row.name);
    catCounts[category] = (catCounts[category] ?? 0) + 1;
    if (!matched) unmatchedNames.push(row.name);

    const outcome = await persistRow(row, category, dryRun);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }

  logger.info({ catCounts }, "oregon_state_parks: category tally");
  if (unmatchedNames.length > 0) {
    logger.warn(
      { count: unmatchedNames.length, names: unmatchedNames },
      "oregon_state_parks: names that fell through to default 'park' category",
    );
  }

  const result: IngestResult = {
    source_id: SOURCE_ID,
    fetched: stats.fetched,
    inserted: stats.inserted,
    updated: stats.updated,
    skipped: stats.skipped,
    errors: stats.errors,
    duration_ms: Date.now() - startedAt,
  };
  logger.info(result, "oregon_state_parks: ingest complete");
  return result;
};

export default ingest;
