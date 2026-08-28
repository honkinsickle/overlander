/**
 * Family Destinations Guide ingester (CSV-driven, one article at a time).
 *
 * A test-only, editorial-content source. Each article on
 * familydestinationsguide.com yields a per-article CSV (prepared upstream
 * of the ingester — see `.context/family-destinations-guide/geocode.ts`
 * for the fetch → extract → Mapbox-geocode pipeline that produces one).
 * This ingester reads those CSVs and persists each row as a
 * `source_record` on the `family_destinations` source.
 *
 * Data shape produced by the geocode script (columns):
 *   n, name, city, slug, signature_dish, description, photo_url,
 *   article_url, article_author, article_date, lng, lat,
 *   geocode_relevance, geocode_matched
 *
 * Mirrors `atlas-oddities.ts` where the shape matches (CSV parse,
 * normalizeXxx → upsertSourceRecord) and diverges where the source
 * differs:
 *   - description is NON-null on every row (unlike AO, which received
 *     description via a separate manual enrichment pass), so this
 *     writes into `normalized_payload.description` at ingest time.
 *   - photo is NON-null on every row and lives at
 *     `normalized_payload.photo.url` per the shape the corridor RPC +
 *     search export view read for atlas_oddities/wikipedia/nps/ridb.
 *
 * external_id format: `family_destinations:<article-slug>:<row-slug>` —
 * the article slug (folder name minus the `-geocoded.csv` suffix) is
 * embedded so a future ingest of a second article doesn't collide with
 * this one.
 *
 * primary_category (`inferred_category`): `restaurant`. Every row in
 * the first test article is a restaurant, and the codebase's slide bucket
 * `food` already covers this value (web/src/lib/trip-browse/federated.ts).
 * If a future Family Destinations article lists non-restaurant stops
 * (bakeries, groceries, farm stands), extend this to derive per-row
 * rather than hardcode.
 *
 * source_quality_score: 0.4 (editorial curation, similar posture to AO's
 * 0.5 but a notch lower — Family Destinations is a lifestyle blog, not
 * a curated database; content is short blurbs, not multi-paragraph
 * write-ups).
 *
 * Content licensing posture: TEST-only per Adam's 2026-08-28 directive.
 * The scraped content (article prose, images) is not licensed for
 * commercial use. Not scoped for PROD promotion.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source family_destinations --dry-run
 *   npm run -w data ingest:manual -- --source family_destinations
 *
 * Env override:
 *   FAMILY_DESTINATIONS_CSV_DIR — path to the directory holding one or
 *     more `*-geocoded.csv` files. Defaults to
 *     `<repo>/.context/family-destinations-guide/`.
 */

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "family_destinations";
const SOURCE_QUALITY_SCORE = 0.4;
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
  lng: z.string(),
  lat: z.string(),
  geocode_relevance: z.string().optional(),
  geocode_matched: z.string().optional(),
});
export type FamilyDestinationsRow = z.infer<typeof RowSchema>;

/**
 * Minimal RFC-4180-ish CSV parser. Identical shape to the one in
 * atlas-oddities.ts — the CSV format is stable across both sources.
 */
export function parseCsv(text: string): FamilyDestinationsRow[] {
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
  const out: FamilyDestinationsRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    if (cols.length === 1 && cols[0] === "") continue;
    if (cols.length < 12) {
      logger.warn({ row: r, cols: cols.length }, "family_destinations: skipping malformed row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = cols[c] ?? "";
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "family_destinations: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

/** Split a signature dish string into overlander_tags tokens. E.g.
 *  "Artichoke soup and olallieberry pie" → ["artichoke soup",
 *  "olallieberry pie"]. Deliberately loose — this is a hint, not a
 *  taxonomy. */
export function tokenizeSignatureDish(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw
    .split(/,| and | \+ | & /i)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

/** Overlander-tag set derived from the row + article metadata. Includes
 *  the source-marker tag `family_destinations_guide` and an
 *  article-slug tag so future filters can slice by article. */
export function toOverlanderTags(
  row: FamilyDestinationsRow,
  articleSlug: string,
): string[] {
  return [
    "family_destinations_guide",
    articleSlug,
    ...tokenizeSignatureDish(row.signature_dish),
  ];
}

/**
 * Transform one CSV row into `normalized_payload`. Pure — no DB, no
 * network.
 */
export function normalizeFamilyDestinations(
  row: FamilyDestinationsRow,
  articleSlug: string,
): Record<string, unknown> {
  const address = row.geocode_matched?.trim() ?? "";
  const contact = compact({ website: row.article_url || undefined });
  const photo = row.photo_url && row.photo_url.trim().length > 0
    ? { url: row.photo_url.trim(), credit: "familydestinationsguide.com" }
    : null;
  return {
    canonical_name: row.name,
    description: row.description,
    photo,
    overlander_tags: toOverlanderTags(row, articleSlug),
    contact: Object.keys(contact).length ? contact : null,
    address: address || null,
    signature_dish: row.signature_dish || null,
    article_url: row.article_url,
    article_author: row.article_author,
    article_date: row.article_date,
    city: row.city,
  };
}

/** Parse the CSV's string lat/lng into a `[lng, lat]` tuple. Returns
 *  null on unparseable values. */
export function parseCoordinates(row: FamilyDestinationsRow): [number, number] | null {
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
  // data/ingestion/sources/ → data/ingestion → data → <repo> → <repo>/.context/family-destinations-guide
  return resolve(here, "..", "..", "..", ".context", "family-destinations-guide");
}

/** Return the list of `*-geocoded.csv` filenames in the CSV dir. */
async function listCsvFiles(csvDir: string): Promise<string[]> {
  const entries = await readdir(csvDir);
  return entries.filter((f) => f.endsWith("-geocoded.csv")).sort();
}

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(
  row: FamilyDestinationsRow,
  articleSlug: string,
  dryRun: boolean,
): Promise<Outcome> {
  const coords = parseCoordinates(row);
  if (!coords) {
    logger.warn({ external_id: row.slug, lat: row.lat, lng: row.lng }, "family_destinations: unparseable coords — skipped");
    return "skipped";
  }
  const externalId = `family_destinations:${articleSlug}:${row.slug}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name }, "family_destinations: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: INFERRED_CATEGORY,
      point: coords,
      rawPayload: { row, articleSlug, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeFamilyDestinations(row, articleSlug),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "family_destinations: upsert failed");
    return "error";
  }
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvDir = resolveCsvDir(process.env.FAMILY_DESTINATIONS_CSV_DIR);
  logger.info({ csvDir, dryRun }, "family_destinations: ingest starting");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const perArticle: Record<string, { fetched: number; inserted: number; skipped: number; errors: number }> = {};

  const csvFiles = await listCsvFiles(csvDir);
  if (csvFiles.length === 0) {
    logger.warn({ csvDir }, "family_destinations: no *-geocoded.csv files found");
  }

  for (const file of csvFiles) {
    const path = join(csvDir, file);
    const articleSlug = file.replace(/-geocoded\.csv$/, "");
    const text = await readFile(path, "utf8");
    const rows = parseCsv(text);
    logger.info({ articleSlug, path, rows: rows.length }, "family_destinations: article loaded");
    stats.fetched += rows.length;
    const s = { fetched: rows.length, inserted: 0, skipped: 0, errors: 0 };
    for (const row of rows) {
      const outcome = await persistRow(row, articleSlug, dryRun);
      if (outcome === "inserted") { stats.inserted += 1; s.inserted += 1; }
      else if (outcome === "skipped") { stats.skipped += 1; s.skipped += 1; }
      else { stats.errors += 1; s.errors += 1; }
    }
    perArticle[articleSlug] = s;
    logger.info({ articleSlug, ...s }, "family_destinations: article complete");
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
  logger.info({ ...result, perArticle }, "family_destinations: ingest complete");
  return result;
};

export default ingest;
