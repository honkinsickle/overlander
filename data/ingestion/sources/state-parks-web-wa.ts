/**
 * WA State Parks visitor-website ingester (CSV-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries + campground points) with visitor-facing content scraped
 * from parks.wa.gov: descriptions, hours, contact, amenities, dog
 * policy, fees, alerts, activities, features, and hero photos.
 *
 * Source CSV: `/Users/adamwagner/wa-state-parks/data/washington-state-parks.csv`
 * (147 rows — all WA state parks, scraped 2026-09-01).
 *
 * Separate source_id from CA's `state_parks_web` — per-state source_ids
 * going forward (diverges from the single-source `state_parks` GIS
 * pattern, which shares one source_id across all 6 states).
 *
 * external_id format: `state_parks_web_wa:<slug>` — the URL slug from
 * parks.wa.gov/find-parks/state-parks/<slug>, unique per park and
 * stable across scrapes. Same slug the photo filenames use.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source state_parks_web_wa --dry-run
 *   npm run -w data ingest:manual -- --source state_parks_web_wa
 *
 * Env override:
 *   STATE_PARKS_WEB_WA_CSV — path to the CSV file. Defaults to
 *     `/Users/adamwagner/wa-state-parks/data/washington-state-parks.csv`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "state_parks_web_wa";
const SOURCE_QUALITY_SCORE = 0.6;

const DEFAULT_CSV_PATH =
  "/Users/adamwagner/wa-state-parks/data/washington-state-parks.csv";

const RowSchema = z.object({
  n: z.string(),
  name: z.string(),
  city: z.string(),
  address: z.string(),
  lat: z.string(),
  lon: z.string(),
  url: z.string(),
  summary: z.string(),
  activities: z.string(),
  amenities: z.string(),
  features: z.string(),
  hours: z.string(),
  fees: z.string(),
  contact: z.string(),
  rules: z.string(),
  alerts: z.string(),
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
    if (cols.length < 17) {
      logger.warn({ row: r, cols: cols.length }, "state_parks_web_wa: skipping malformed row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "state_parks_web_wa: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

// ───── Helpers ───────────────────────────────────────────────────────

function extractSlug(url: string): string | null {
  const m = url.match(/\/find-parks\/state-parks\/([^/?]+)/);
  return m ? m[1] : null;
}

function parseSemicolonList(raw: string): string[] | null {
  if (!raw.trim()) return null;
  return raw.split(";").map((s) => s.trim()).filter(Boolean);
}

function chooseDescription(row: ParkRow): string | null {
  const desc = row.description.trim();
  const summary = row.summary.trim();
  if (desc) return desc;
  if (summary) return summary;
  return null;
}

function extractDogPolicy(rules: string): { dogs: string | null; dogs_allowed: "yes" | "no" | "restricted" | null } {
  const r = rules.trim();
  if (!r) return { dogs: null, dogs_allowed: null };
  if (r.startsWith("Dogs not Allowed")) return { dogs: "Dogs not Allowed", dogs_allowed: "no" };
  if (r.startsWith("Dogs Allowed on Leash")) return { dogs: "Dogs Allowed on Leash", dogs_allowed: "restricted" };
  if (r.startsWith("Dogs Allowed")) return { dogs: "Dogs Allowed", dogs_allowed: "yes" };
  return { dogs: null, dogs_allowed: null };
}

function parseContact(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const emailMatch = raw.match(/Email\s+(\S+@\S+)/);
  if (emailMatch) out.email = emailMatch[1];
  const phoneMatch = raw.match(/Phone\s+(\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4})/);
  if (phoneMatch) out.phone = phoneMatch[1];
  if (raw.includes("Reservations")) out.reservations_url = "https://parks.wa.gov";
  return out;
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(row: ParkRow, slug: string): Record<string, unknown> {
  const description = chooseDescription(row);
  const amenities = parseSemicolonList(row.amenities);
  const activities = parseSemicolonList(row.activities);
  const features = parseSemicolonList(row.features);
  const dogPolicy = extractDogPolicy(row.rules);

  const parsedContact = parseContact(row.contact);
  const contact = compact({
    ...parsedContact,
    address: row.address.trim() || undefined,
    website: row.url.trim() || undefined,
  });

  const photo =
    row.photo_file.trim() && row.photo_source_url.trim()
      ? {
          url: row.photo_source_url.trim(),
          credit: "Washington State Parks",
          license: "Washington State Parks — government publication",
          source_page: row.url.trim(),
        }
      : null;

  const hours = row.hours.trim() || null;

  return compact({
    canonical_name: row.name,
    description,
    hours: hours ? { raw: hours } : undefined,
    contact: Object.keys(contact).length ? contact : undefined,
    amenities: amenities ? { list: amenities } : undefined,
    photo,
    fees: row.fees.trim() || undefined,
    dogs: dogPolicy.dogs,
    dogs_allowed: dogPolicy.dogs_allowed,
    rules: row.rules.trim() || undefined,
    advisories: row.alerts.trim() || undefined,
    activities: activities ? { list: activities } : undefined,
    features: features ? { list: features } : undefined,
    city: row.city.trim() || undefined,
    provenance: compact({
      source: "parks.wa.gov",
      slug,
      scraped_at: "2026-09-01",
    }),
  }) as Record<string, unknown>;
}

// ───── Persistence ───────────────────────────────────────────────────

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(
  row: ParkRow,
  slug: string,
  dryRun: boolean,
): Promise<Outcome> {
  const lat = parseFloat(row.lat);
  const lon = parseFloat(row.lon);
  const hasCoords = !Number.isNaN(lat) && !Number.isNaN(lon) && !(lat === 0 && lon === 0);

  if (!hasCoords) {
    logger.warn(
      { name: row.name, slug, lat: row.lat, lon: row.lon },
      "state_parks_web_wa: no valid coordinates — skipping",
    );
    return "skipped";
  }

  const externalId = `state_parks_web_wa:${slug}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name }, "state_parks_web_wa: dry-run");
    return "inserted";
  }

  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: "park",
      point: [lon, lat],
      rawPayload: { row, fetched_at: "2026-09-01" },
      normalizedPayload: normalizeRow(row, slug),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId, name: row.name }, "state_parks_web_wa: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvPath = process.env.STATE_PARKS_WEB_WA_CSV ?? DEFAULT_CSV_PATH;
  logger.info({ csvPath, dryRun }, "state_parks_web_wa: ingest starting");

  const text = await readFile(csvPath, "utf8");
  const rows = parseCsv(text);
  logger.info({ rows: rows.length }, "state_parks_web_wa: CSV loaded");

  const stats = { fetched: rows.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };

  for (const row of rows) {
    const slug = extractSlug(row.url);
    if (!slug) {
      logger.warn({ name: row.name, url: row.url }, "state_parks_web_wa: no slug in URL — skipping");
      stats.skipped += 1;
      continue;
    }

    const outcome = await persistRow(row, slug, dryRun);
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
  logger.info(result, "state_parks_web_wa: ingest complete");
  return result;
};

export default ingest;
