/**
 * CA State Parks visitor-website ingester (CSV-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries + campground points) with visitor-facing content scraped
 * from parks.ca.gov: descriptions, hours, phone, amenities, dog
 * policy, fees, advisories, and curated hero photos.
 *
 * Source CSV: `/Users/adamwagner/ca-state-parks/data/california-state-parks.csv`
 * (284 rows — all CA state park units, scraped 2026-09-01).
 *
 * external_id format: `state_parks_web:<page_id>` — the `page_id`
 * query param from the parks.ca.gov URL, unique per unit and stable
 * across scrapes. Same id the photo filenames use (photos/<page_id>.jpg).
 *
 * Photos: stored in `normalized_payload.photo` with full attribution
 * (California State Parks — government publication). Not wired into
 * card rendering yet, pending review.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source state_parks_web --dry-run
 *   npm run -w data ingest:manual -- --source state_parks_web
 *
 * Env override:
 *   STATE_PARKS_WEB_CSV — path to the CSV file. Defaults to
 *     `/Users/adamwagner/ca-state-parks/data/california-state-parks.csv`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "state_parks_web";
const SOURCE_QUALITY_SCORE = 0.6;

const DEFAULT_CSV_PATH =
  "/Users/adamwagner/ca-state-parks/data/california-state-parks.csv";

const RowSchema = z.object({
  n: z.string(),
  name: z.string(),
  type: z.string(),
  region: z.string(),
  county: z.string(),
  city: z.string(),
  district: z.string(),
  status: z.string(),
  lat: z.string(),
  lon: z.string(),
  url: z.string(),
  blurb: z.string(),
  amenities: z.string(),
  hours: z.string(),
  phone: z.string(),
  dogs: z.string(),
  fees: z.string(),
  address: z.string(),
  advisories: z.string(),
  photo_file: z.string(),
  photo_source_url: z.string(),
  description: z.string(),
});
type ParkRow = z.infer<typeof RowSchema>;

// ───── CSV parser ────────────────────────────────────────────────────

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
      logger.warn({ row: r, cols: cols.length }, "state_parks_web: skipping malformed row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "state_parks_web: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

// ───── Helpers ───────────────────────────────────────────────────────

function extractPageId(url: string): string | null {
  const m = url.match(/page_id=(\d+)/);
  return m ? m[1] : null;
}

const TYPE_TO_CATEGORY: Record<string, string> = {
  "State Park": "park",
  "State Beach": "park",
  "State Historic Park": "historic",
  "State Historical Monument": "historic",
  "State Recreation Area": "recreation_area",
  "State Natural Reserve": "park",
  "Park Property": "park",
  "State Vehicular Recreation Area": "recreation_area",
  "Point of Interest": "interest",
  "State Marine Reserve": "park",
  "State Marine Park": "park",
  "Wayside Campground": "campground",
  "State Seashore": "park",
};

function inferCategory(type: string): string {
  return TYPE_TO_CATEGORY[type] ?? "park";
}

function normalizeStatus(status: string): string | null {
  const s = status.trim().toLowerCase();
  if (s === "open" || s === "unreported" || s === "") return null;
  if (s === "closed") return "CLOSED";
  if (s === "restricted") return "RESTRICTED";
  return s.toUpperCase();
}

function normalizeDogPolicy(dogs: string): "yes" | "no" | "restricted" | null {
  const d = dogs.trim();
  if (!d) return null;
  if (d === "No") return "no";
  if (d === "Yes") return "yes";
  if (d.startsWith("Yes:")) return "restricted";
  return null;
}

function parseAmenities(raw: string): string[] | null {
  if (!raw.trim()) return null;
  return raw.split(";").map((s) => s.trim()).filter(Boolean);
}

function chooseDescription(row: ParkRow): string | null {
  const desc = row.description.trim();
  const blurb = row.blurb.trim();
  if (desc) return desc;
  if (blurb) return blurb;
  return null;
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(row: ParkRow, pageId: string): Record<string, unknown> {
  const description = chooseDescription(row);
  const amenities = parseAmenities(row.amenities);
  const opStatus = normalizeStatus(row.status);

  const contact = compact({
    phone: row.phone.trim() || undefined,
    address: row.address.trim() || undefined,
    website: row.url.trim() || undefined,
  });

  const photo =
    row.photo_file.trim() && row.photo_source_url.trim()
      ? {
          url: row.photo_source_url.trim(),
          credit: "California State Parks",
          license: "California State Parks — government publication",
          source_page: row.url.trim(),
        }
      : null;

  const hours = row.hours.trim() || null;

  return compact({
    canonical_name: row.name,
    description,
    designation: row.type,
    hours: hours ? { raw: hours } : undefined,
    contact: Object.keys(contact).length ? contact : undefined,
    amenities: amenities ? { list: amenities } : undefined,
    operational_status: opStatus,
    photo,
    fees: row.fees.trim() || undefined,
    dogs: row.dogs.trim() || undefined,
    dogs_allowed: normalizeDogPolicy(row.dogs),
    advisories: row.advisories.trim() || undefined,
    region: row.region.trim() || undefined,
    district: row.district.trim() || undefined,
    county: row.county.trim() || undefined,
    city: row.city.trim() || undefined,
    provenance: compact({
      source: "parks.ca.gov",
      page_id: pageId,
      district: row.district.trim() || undefined,
      region: row.region.trim() || undefined,
      scraped_at: "2026-09-01",
    }),
  }) as Record<string, unknown>;
}

// ───── Persistence ───────────────────────────────────────────────────

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(
  row: ParkRow,
  pageId: string,
  dryRun: boolean,
): Promise<Outcome> {
  const lat = parseFloat(row.lat);
  const lon = parseFloat(row.lon);
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lon) && !(lat === 0 && lon === 0);

  if (!hasCoords) {
    logger.warn(
      { name: row.name, pageId, lat: row.lat, lon: row.lon },
      "state_parks_web: no valid coordinates — skipping",
    );
    return "skipped";
  }

  const externalId = `state_parks_web:${pageId}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name }, "state_parks_web: dry-run");
    return "inserted";
  }

  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: inferCategory(row.type),
      point: [lon, lat],
      rawPayload: { row, fetched_at: "2026-09-01" },
      normalizedPayload: normalizeRow(row, pageId),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId, name: row.name }, "state_parks_web: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvPath = process.env.STATE_PARKS_WEB_CSV ?? DEFAULT_CSV_PATH;
  logger.info({ csvPath, dryRun }, "state_parks_web: ingest starting");

  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  logger.info({ rows: rows.length }, "state_parks_web: CSV loaded");

  const stats = { fetched: rows.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const pageId = extractPageId(row.url);
    if (!pageId) {
      logger.warn({ name: row.name, url: row.url }, "state_parks_web: no page_id in URL — skipping");
      stats.skipped += 1;
      continue;
    }

    const outcome = await persistRow(row, pageId, dryRun);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
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
  logger.info(result, "state_parks_web: ingest complete");
  return result;
};

export default ingest;
