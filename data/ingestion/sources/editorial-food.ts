/**
 * Editorial food-guide ingester (CSV-driven, multi-publisher).
 *
 * Test-only editorial source that scales the single-publisher
 * `family_destinations` pattern from PR #316 to a fleet of California
 * road-trip food articles. Each article ships as one `*-geocoded.csv`
 * file in `.context/editorial-food/`, produced upstream by
 * `.context/editorial-food/geocode.ts` (fetch → extract → Mapbox
 * two-phase geocode). This ingester globs all such files and persists
 * each row as a `source_record` under `source_id = 'editorial_food'`.
 *
 * Data shape produced by the geocode script (columns):
 *   n, name, city, slug, signature_dish, description, photo_url,
 *   article_url, article_author, article_date, publisher_slug,
 *   article_slug, lng, lat, geocode_relevance, geocode_matched
 *
 * external_id format:
 *   editorial_food:<publisher_slug>:<article_slug>:<row_slug>
 * — three levels of scoping so a second article from the same publisher
 * (or a re-scrape) doesn't collide with the first.
 *
 * primary_category (`inferred_category`): `restaurant`. Every current
 * source lists restaurants. If a future article covers non-restaurant
 * stops, derive per-row.
 *
 * source_quality_score: 0.35 — a notch below `family_destinations` (0.4).
 * Editorial road-trip lifestyle blogs across multiple publishers are a
 * medium-confidence source; individual articles vary widely in editorial
 * depth (see the density-of-description variance measured in the
 * discovery pass).
 *
 * Licensing posture: TEST-only per Adam's 2026-08-28 directive. The
 * scraped content (article prose, hotlinked images) is not licensed for
 * commercial use. Not scoped for PROD promotion.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source editorial_food --dry-run
 *   npm run -w data ingest:manual -- --source editorial_food
 *
 * Env override:
 *   EDITORIAL_FOOD_CSV_DIR — path to the directory holding one or
 *     more `*-geocoded.csv` files. Defaults to
 *     `<repo>/.context/editorial-food/`.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "editorial_food";
const SOURCE_QUALITY_SCORE = 0.35;
const INFERRED_CATEGORY = "restaurant";

const RowSchema = z.object({
  n: z.string(),
  name: z.string(),
  city: z.string(),
  slug: z.string(),
  signature_dish: z.string(),
  description: z.string(),
  photo_url: z.string(),
  article_url: z.string(),
  article_author: z.string(),
  article_date: z.string(),
  publisher_slug: z.string(),
  article_slug: z.string(),
  lng: z.string(),
  lat: z.string(),
  geocode_relevance: z.string().optional(),
  geocode_matched: z.string().optional(),
});
export type EditorialFoodRow = z.infer<typeof RowSchema>;

/**
 * Minimal RFC-4180-ish CSV parser (same shape as atlas-oddities.ts and
 * family-destinations.ts).
 */
export function parseCsv(text: string): EditorialFoodRow[] {
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
  const out: EditorialFoodRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === "") continue;
    if (cols.length < 14) {
      logger.warn({ row: r, cols: cols.length }, "editorial_food: skipping malformed row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "editorial_food: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

/** Split signature dish string into tokens for overlander_tags. */
export function tokenizeSignatureDish(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(/,| and | \+ | & /i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Overlander-tag set: `editorial_food` marker, publisher, article, and
 *  signature-dish tokens. Downstream filters can slice by publisher or
 *  article. */
export function toOverlanderTags(row: EditorialFoodRow): string[] {
  return [
    "editorial_food",
    row.publisher_slug,
    row.article_slug,
    ...tokenizeSignatureDish(row.signature_dish),
  ];
}

/**
 * Transform one CSV row into `normalized_payload`. Pure — no DB, no
 * network.
 */
export function normalizeEditorialFood(row: EditorialFoodRow): Record<string, unknown> {
  const address = row.geocode_matched?.trim() ?? "";
  const contact = compact({ website: row.article_url || undefined });
  const photoUrl = row.photo_url && row.photo_url.trim() !== "n/a" && row.photo_url.trim().length > 0
    ? row.photo_url.trim()
    : "";
  const photo = photoUrl
    ? { url: photoUrl, credit: row.publisher_slug }
    : null;
  return {
    canonical_name: row.name,
    description: row.description,
    photo,
    overlander_tags: toOverlanderTags(row),
    contact: Object.keys(contact).length ? contact : null,
    address: address || null,
    signature_dish: row.signature_dish || null,
    article_url: row.article_url,
    article_author: row.article_author,
    article_date: row.article_date,
    publisher_slug: row.publisher_slug,
    article_slug: row.article_slug,
    city: row.city,
  };
}

/** Parse coord strings into [lng, lat]. Rows the geocoder couldn't resolve
 *  have empty lng/lat and are skipped here. */
export function parseCoordinates(row: EditorialFoodRow): [number, number] | null {
  if (!row.lng || !row.lat) return null;
  const latNum = parseFloat(row.lat);
  const lngNum = parseFloat(row.lng);
  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) return null;
  if (latNum === 0 && lngNum === 0) return null;
  return [lngNum, latNum];
}

// ───── CSV file discovery ──────────────────────────────────────────────

export function resolveCsvDir(envDir?: string): string {
  if (envDir && envDir.length > 0) return envDir;
  const here = dirname(fileURLToPath(import.meta.url));
  // data/ingestion/sources/ → data/ingestion → data → <repo> → <repo>/.context/editorial-food
  return resolve(here, "..", "..", "..", ".context", "editorial-food");
}

async function listCsvFiles(csvDir: string): Promise<string[]> {
  const entries = await readdir(csvDir);
  return entries.filter((f) => f.endsWith("-geocoded.csv")).sort();
}

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(row: EditorialFoodRow, dryRun: boolean): Promise<Outcome> {
  const coords = parseCoordinates(row);
  if (!coords) {
    logger.warn(
      { publisher: row.publisher_slug, article: row.article_slug, slug: row.slug, name: row.name },
      "editorial_food: unparseable coords — skipped",
    );
    return "skipped";
  }
  const externalId = `editorial_food:${row.publisher_slug}:${row.article_slug}:${row.slug}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name }, "editorial_food: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: INFERRED_CATEGORY,
      point: coords,
      rawPayload: { row, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeEditorialFood(row),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "editorial_food: upsert failed");
    return "error";
  }
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvDir = resolveCsvDir(process.env.EDITORIAL_FOOD_CSV_DIR);
  logger.info({ csvDir, dryRun }, "editorial_food: ingest starting");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const perFile: Record<string, { fetched: number; inserted: number; skipped: number; errors: number }> = {};

  const csvFiles = await listCsvFiles(csvDir);
  if (csvFiles.length === 0) {
    logger.warn({ csvDir }, "editorial_food: no *-geocoded.csv files found");
  }

  for (const file of csvFiles) {
    const path = join(csvDir, file);
    const text = await readFile(path, "utf8");
    const rows = parseCsv(text);
    logger.info({ file, rows: rows.length }, "editorial_food: file loaded");
    stats.fetched += rows.length;
    const s = { fetched: rows.length, inserted: 0, skipped: 0, errors: 0 };
    for (const row of rows) {
      const outcome = await persistRow(row, dryRun);
      if (outcome === "inserted") { stats.inserted += 1; s.inserted += 1; }
      else if (outcome === "skipped") { stats.skipped += 1; s.skipped += 1; }
      else { stats.errors += 1; s.errors += 1; }
    }
    perFile[file] = s;
    logger.info({ file, ...s }, "editorial_food: file complete");
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
  logger.info({ ...result, perFile }, "editorial_food: ingest complete");
  return result;
};

export default ingest;
