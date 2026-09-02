/**
 * Nevada State Parks visitor-website ingester (JSON-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries + campground/facility points) with visitor-facing content
 * scraped from parks.nv.gov: long-form descriptions and hero photos
 * sourced from the separate /galleries/<slug> pages.
 *
 * Source JSON: `/Users/adamwagner/nv-state-parks/data/nevada_parks.json`
 * (28 rows — all NV state parks, scraped 2026-09-01). The sibling CSV
 * is not used; the JSON is richer (adds `state` and `photo_source`
 * provenance keys the CSV lacks).
 *
 * Per-state source_id, following the OR precedent
 * (`oregon_state_parks`) — state-prefixed, no `_web` suffix. NV's data
 * is materially thinner than CA/WA/OR:
 *
 *   - hours:  column present in the source but 0/28 populated (README
 *             confirms "No Hours section on these pages")
 *   - contact: column present in the source but 0/28 populated
 *   - fees:   28/28 populated with the site nav-menu string, NOT real
 *             fee amounts — scraper bug in the upstream pipeline
 *             (sp_extract.py). Raw text is parked in
 *             `normalized_payload.provenance.fees_raw` as a marker for
 *             the future re-scrape; nothing is surfaced. Tracked in
 *             BACKLOG.md.
 *   - alerts: 27/28 rows carry an identical statewide fire-restriction
 *             banner; only Valley of Fire has a genuine park-specific
 *             extra. The banner is stripped in normalization; only the
 *             residual (if any) reaches `normalized_payload.advisories`.
 *
 * Therefore this ingester writes exactly ONE `field_precedence` row:
 * description (priority 2). No hours/contact/amenities/operational_status
 * — the source lacks the data.
 *
 * Photo attribution follows Adam's explicit call: `credit = "Nevada
 * State Parks"`, `license = "Nevada State Parks"` — **NOT** the
 * "government publication" framing CA/WA/OR used. parks.nv.gov carries
 * no reuse grant text and nv.gov's default is "All Rights Reserved";
 * this is Adam's explicit risk acceptance, documented in BACKLOG.md.
 *
 * external_id format: `nevada_state_parks:<slug>` — WA-style (stable
 * slug from parks.nv.gov URL, matches the photo filenames).
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source nevada_state_parks --dry-run
 *   npm run -w data ingest:manual -- --source nevada_state_parks
 *
 * Env override:
 *   NEVADA_STATE_PARKS_JSON — path to the JSON file. Defaults to
 *     `/Users/adamwagner/nv-state-parks/data/nevada_parks.json`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "nevada_state_parks";
const SOURCE_QUALITY_SCORE = 0.6;

const DEFAULT_JSON_PATH =
  "/Users/adamwagner/nv-state-parks/data/nevada_parks.json";

// Statewide fire-restriction banner repeated on 27/28 pages. Stripped
// before persisting to normalized_payload.advisories so per-park
// advisories don't fill up with duplicate boilerplate.
const STATEWIDE_ALERT_BANNER =
  "All Nevada State Parks are now under fire restrictions. Help prevent wildfires in Nevada.";

const RowSchema = z.object({
  state: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  about: z.string(),
  alerts: z.string(),
  hours: z.string(),
  fees: z.string(),
  contact: z.string(),
  lat: z.number(),
  lon: z.number(),
  hero: z.string(),
  url: z.string(),
  photo_source: z.string(),
});
type ParkRow = z.infer<typeof RowSchema>;

// ───── Helpers ───────────────────────────────────────────────────────

/**
 * NV has no `type` column. Category is derived from name tokens,
 * most-specific first, following the OR ingester pattern. Names that
 * don't match a rule fall through to `park` and are logged so the
 * tally is visible in the ingest log.
 *
 * The mappings below reflect the NV investigation's known cases:
 *   - historic: Fort Churchill, Old Las Vegas Mormon Fort, Elgin
 *     Schoolhouse, Ward Charcoal Ovens, Mormon Station, Dayton
 *   - recreation_area: Big Bend of the Colorado, Lahontan, Rye Patch,
 *     South Fork, Walker River, Wild Horse, Echo Canyon
 *   - Berlin-Ichthyosaur and Ice Age Fossils are genuinely ambiguous
 *     (historic-fossil / natural-history); both default to `park`. Flag
 *     these two in the unmatched-tally rather than guessing silently.
 */
function inferCategory(name: string): { category: string; matched: boolean } {
  const n = name.toLowerCase();
  if (n.includes("historic state monument") || n.includes("historic state park")) {
    return { category: "historic", matched: true };
  }
  if (n.includes("state historic park") || n.includes("state historic monument")) {
    return { category: "historic", matched: true };
  }
  if (n.includes("mormon fort") || n.includes("mormon station")) {
    return { category: "historic", matched: true };
  }
  if (n.includes("schoolhouse") || n.includes("charcoal ovens")) {
    return { category: "historic", matched: true };
  }
  if (n.includes("fort churchill")) return { category: "historic", matched: true };
  if (n.includes("dayton")) return { category: "historic", matched: true };
  if (n.includes("state recreation area") || n.includes("recreation area")) {
    return { category: "recreation_area", matched: true };
  }
  if (n.includes("big bend of the colorado") || n.includes("lahontan") ||
      n.includes("rye patch") || n.includes("south fork") ||
      n.includes("walker river") || n.includes("wild horse") ||
      n.includes("echo canyon")) {
    return { category: "recreation_area", matched: true };
  }
  if (n.includes("state park")) return { category: "park", matched: true };
  return { category: "park", matched: false };
}

function chooseDescription(row: ParkRow): string | null {
  const about = row.about.trim();
  const summary = row.summary.trim();
  if (about) return about;
  if (summary) return summary;
  return null;
}

/**
 * Strip the statewide fire banner from the alerts field. Returns the
 * residual (which may be empty). The banner appears at the start of
 * every alert; per-park content follows a " | " separator on the one
 * row (Valley of Fire) that has it.
 */
function stripStatewideBanner(alerts: string): string | null {
  const trimmed = alerts.trim();
  if (!trimmed) return null;
  // Exact-match — the banner is the entire content on 27/28 rows.
  if (trimmed === STATEWIDE_ALERT_BANNER) return null;
  // Banner-prefix — split on " | " and drop the banner segment.
  const parts = trimmed.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const residual = parts.filter((p) => p !== STATEWIDE_ALERT_BANNER);
  if (residual.length === 0) return null;
  return residual.join(" | ");
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(row: ParkRow): Record<string, unknown> {
  const description = chooseDescription(row);
  const advisories = stripStatewideBanner(row.alerts);

  // Photos: attribution per Adam's explicit call (see file header). No
  // "government publication" framing — nv.gov has no reuse grant and
  // defaults to All Rights Reserved.
  const photo = row.hero.trim()
    ? {
        url: row.hero.trim(),
        credit: "Nevada State Parks",
        license: "Nevada State Parks",
        source_page: row.url.trim(),
      }
    : null;

  return compact({
    canonical_name: row.name,
    description,
    advisories,
    photo,
    slug: row.slug.trim() || undefined,
    provenance: compact({
      source: "parks.nv.gov",
      slug: row.slug.trim() || undefined,
      website: row.url.trim() || undefined,
      photo_source: row.photo_source.trim() || undefined,
      // Marker for the future upstream re-scrape. The current value is
      // the site nav-menu string, not real fee amounts. Never surface.
      fees_raw: row.fees.trim() || undefined,
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
  const lat = row.lat;
  const lon = row.lon;
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0);

  if (!hasCoords) {
    logger.warn(
      { name: row.name, slug: row.slug, lat, lon },
      "nevada_state_parks: no valid coordinates — skipping",
    );
    return "skipped";
  }

  const slug = row.slug.trim();
  if (!slug) {
    logger.warn({ name: row.name }, "nevada_state_parks: missing slug — skipping");
    return "skipped";
  }

  const externalId = `${SOURCE_ID}:${slug}`;
  if (dryRun) {
    logger.debug({ externalId, name: row.name, category }, "nevada_state_parks: dry-run");
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
    logger.error({ err, externalId, name: row.name }, "nevada_state_parks: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const jsonPath = process.env.NEVADA_STATE_PARKS_JSON ?? DEFAULT_JSON_PATH;
  logger.info({ jsonPath, dryRun }, "nevada_state_parks: ingest starting");

  const text = await readFile(jsonPath, "utf8");
  const raw = JSON.parse(text) as unknown;
  const rowsResult = z.array(RowSchema).safeParse(raw);
  if (!rowsResult.success) {
    logger.error(
      { err: rowsResult.error.flatten() },
      "nevada_state_parks: input JSON failed schema",
    );
    throw new Error("nevada_state_parks: input JSON failed schema");
  }
  const rows = rowsResult.data;
  logger.info({ rows: rows.length }, "nevada_state_parks: JSON loaded");

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

  logger.info({ catCounts }, "nevada_state_parks: category tally");
  if (unmatchedNames.length > 0) {
    logger.warn(
      { count: unmatchedNames.length, names: unmatchedNames },
      "nevada_state_parks: names that fell through to default 'park' category",
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
  logger.info(result, "nevada_state_parks: ingest complete");
  return result;
};

export default ingest;
