/**
 * Arizona State Parks visitor-website ingester (JSON-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries) with visitor-facing content scraped from
 * azstateparks.com: descriptions, hours, contact, fees, alerts, and
 * hero photos.
 *
 * Source JSON: `/Users/adamwagner/az-state-parks/data/arizona_parks.json`
 * (33 rows — all AZ state parks scraped 2026-09-01; the find-a-park
 * page lists 35 entries but 2 are administrative — SHPO + State Parks
 * Board — and were dropped).
 *
 * Per-state source_id, in the OR/NV state-prefixed family (no `_web`
 * suffix), separate from the shared `state_parks` GIS pattern that
 * uses one source_id across all six states.
 *
 * external_id format: `arizona_state_parks:<slug>` — the URL slug from
 * azstateparks.com/<slug>, stable across scrapes.
 *
 * NO COORDINATES in the source data (0/33 rows) — azstateparks.com does
 * not expose lat/lon on park pages. Since `source_record.geometry` is
 * NOT NULL, we borrow geometry from the matching existing
 * `state_parks:AZ:park:<GlobalID>` GIS record at ingest time, matched
 * by normalized name. Rows without a name match are skipped with a
 * warning (should be 0 in practice — the two known name-variant pairs,
 * San Rafael and Sonoita Creek, resolve via a small stopword strip).
 *
 * The matched GIS record's `master_place_id` (if any) is captured in
 * `normalized_payload.provenance.intended_master_place_id` so the ER
 * script can auto-link deterministically without depending on
 * matchAll's name-similarity threshold — a hedge for the two variant
 * pairs whose raw name similarity may fall below auto-link floor.
 *
 * License posture: azstateparks.com's own terms (per /privacy) state
 * that photographs, graphics, and maps are NOT public domain and
 * require written consent for use. Adam has accepted the risk of
 * URL-referencing photos (no warehousing) with attribution
 * `© Arizona State Parks and Trails`. This is a deliberate
 * risk-acceptance call, not a resolved license-clear determination.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source arizona_state_parks --dry-run
 *   npm run -w data ingest:manual -- --source arizona_state_parks
 *
 * Env override:
 *   ARIZONA_STATE_PARKS_JSON — path to the JSON file. Defaults to
 *     `/Users/adamwagner/az-state-parks/data/arizona_parks.json`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getDb, upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "arizona_state_parks";
const SOURCE_QUALITY_SCORE = 0.6;
const COPYRIGHT = "© Arizona State Parks and Trails";
const SCRAPED_AT = "2026-09-01";

const DEFAULT_JSON_PATH =
  "/Users/adamwagner/az-state-parks/data/arizona_parks.json";

const RowSchema = z.object({
  state: z.literal("az"),
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  about: z.string(),
  alerts: z.string(),
  hours: z.string(),
  fees: z.string(),
  contact: z.string(),
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  hero: z.string(),
  url: z.string(),
});
type ParkRow = z.infer<typeof RowSchema>;

// ───── Name normalization for GIS lookup ─────────────────────────────
// Handles the two known variant pairs:
//   "San Rafael State Natural Area" ↔ "San Rafael Ranch Natural Area"
//   "Sonoita Creek State Natural Area" ↔ "Sonoita Creek Natural Area"
// by dropping the tokens "state" and "ranch" alongside standard
// lowercasing / punctuation stripping.
const STRIPPABLE_TOKENS = new Set(["state", "ranch"]);

function normalizeParkKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STRIPPABLE_TOKENS.has(t))
    .join(" ");
}

// ───── GIS geometry lookup ───────────────────────────────────────────

interface GisPark {
  externalId: string;
  name: string;
  key: string;
  wkt: string;
  masterPlaceId: string | null;
}

/**
 * Fetch every AZ park-unit source_record and index by normalized name.
 * We use ST_AsEWKT so we get a WKT string with SRID that can be fed
 * straight back to `upsert_source_record` as p_geometry.
 */
async function loadAzGisParks(): Promise<Map<string, GisPark>> {
  const db = getDb();
  const { data, error } = await db.rpc("arizona_state_parks_gis_index");
  if (error) {
    // Fallback for local runs before the migration lands: pull rows and
    // use ST_AsText via a raw select. If the RPC exists, use it; if not,
    // fail loud so the operator knows the migration wasn't applied.
    throw new Error(
      `arizona_state_parks_gis_index RPC failed: ${error.message} — ensure migrations are applied to TEST first`,
    );
  }
  const map = new Map<string, GisPark>();
  for (const r of (data as Array<{
    external_id: string;
    name: string;
    geometry_ewkt: string;
    master_place_id: string | null;
  }>) ?? []) {
    const key = normalizeParkKey(r.name);
    map.set(key, {
      externalId: r.external_id,
      name: r.name,
      key,
      wkt: r.geometry_ewkt,
      masterPlaceId: r.master_place_id,
    });
  }
  return map;
}

// ───── Category inference ────────────────────────────────────────────
// AZ scrape has no `type` column; derive from the name suffix, most
// specific first. Matches the state_parks GIS mapping (§8 of the
// six-state spec): boundary records → recreation_area regardless of
// subtype. We hew to `recreation_area` for camping-capable units and
// `historic` for historic parks so the visitor record's category
// agrees with what the GIS park boundary carries.
function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("state historic park")) return "historic";
  if (n.includes("state natural area")) return "recreation_area";
  if (n.includes("natural area")) return "recreation_area";
  if (n.includes("recreation area")) return "recreation_area";
  if (n.includes("memorial")) return "historic";
  if (n.includes("mansion")) return "historic";
  return "recreation_area";
}

// ───── Contact blob — light parsing ──────────────────────────────────
// AZ contact is a freeform blob (phone + address + reservation number).
// Extract phone + address if cleanly separable; always keep the raw
// blob under `raw` so nothing is lost.
const PHONE_RE = /\(\d{3}\)\s*\d{3}[-\s]?\d{4}|\d{3}-\d{3}-\d{4}/g;

function parseContact(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const phones = trimmed.match(PHONE_RE) ?? [];
  // First phone is usually the park; last is often the shared reservation line.
  const phone = phones[0]?.trim() || undefined;
  return compact({
    raw: trimmed,
    phone,
    website: undefined,
  });
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(
  row: ParkRow,
  gis: GisPark,
): Record<string, unknown> {
  const description = row.about.trim() || null;
  const summary = row.summary.trim() || null;
  const hours = row.hours.trim() || null;
  const fees = row.fees.trim() || null;
  const alerts = row.alerts.trim() || null;
  const contact = parseContact(row.contact);

  const photo =
    row.hero.trim()
      ? {
          url: row.hero.trim(),
          credit: "Arizona State Parks",
          license: "Arizona State Parks",
          source_page: row.url.trim(),
        }
      : null;

  return compact({
    canonical_name: row.name,
    description,
    summary,
    hours: hours ? { raw: hours } : undefined,
    contact: contact && Object.keys(contact).length ? contact : undefined,
    photo,
    fees,
    advisories: alerts,
    copyright: COPYRIGHT,
    provenance: compact({
      source: "azstateparks.com",
      slug: row.slug,
      website: row.url.trim() || undefined,
      scraped_at: SCRAPED_AT,
      matched_gis_park_external_id: gis.externalId,
      intended_master_place_id: gis.masterPlaceId ?? undefined,
    }),
  }) as Record<string, unknown>;
}

// ───── Persistence ───────────────────────────────────────────────────

type Outcome = "inserted" | "skipped" | "error";

async function persistRow(
  row: ParkRow,
  gis: GisPark,
  category: string,
  dryRun: boolean,
): Promise<Outcome> {
  const externalId = `${SOURCE_ID}:${row.slug}`;
  if (dryRun) {
    logger.debug(
      { externalId, name: row.name, category, matched_gis: gis.externalId },
      "arizona_state_parks: dry-run",
    );
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: category,
      point: gis.wkt,
      rawPayload: { row, fetched_at: SCRAPED_AT },
      normalizedPayload: normalizeRow(row, gis),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId, name: row.name }, "arizona_state_parks: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const jsonPath = process.env.ARIZONA_STATE_PARKS_JSON ?? DEFAULT_JSON_PATH;
  logger.info({ jsonPath, dryRun }, "arizona_state_parks: ingest starting");

  const text = await readFile(jsonPath, "utf8");
  const raw = JSON.parse(text) as unknown[];
  const rows: ParkRow[] = [];
  for (const item of raw) {
    const parsed = RowSchema.safeParse(item);
    if (!parsed.success) {
      logger.warn({ item, err: parsed.error.flatten() }, "arizona_state_parks: row failed schema");
      continue;
    }
    rows.push(parsed.data);
  }
  logger.info({ rows: rows.length }, "arizona_state_parks: JSON loaded");

  const gisIndex = await loadAzGisParks();
  logger.info({ gis_parks: gisIndex.size }, "arizona_state_parks: GIS index loaded");

  const stats = { fetched: rows.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const catCounts: Record<string, number> = {};
  const unmatchedNames: string[] = [];
  const variantMatches: Array<{ web: string; gis: string }> = [];

  for (const row of rows) {
    const key = normalizeParkKey(row.name);
    const gis = gisIndex.get(key);
    if (!gis) {
      unmatchedNames.push(row.name);
      logger.warn(
        { name: row.name, key },
        "arizona_state_parks: no matching state_parks:AZ:park GIS record — skipping",
      );
      stats.skipped += 1;
      continue;
    }
    if (gis.name !== row.name) {
      variantMatches.push({ web: row.name, gis: gis.name });
    }

    const category = inferCategory(row.name);
    catCounts[category] = (catCounts[category] ?? 0) + 1;

    const outcome = await persistRow(row, gis, category, dryRun);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }

  logger.info({ catCounts }, "arizona_state_parks: category tally");
  if (variantMatches.length > 0) {
    logger.info(
      { variants: variantMatches },
      "arizona_state_parks: name-variant matches (web ≠ GIS canonical, resolved via normalization)",
    );
  }
  if (unmatchedNames.length > 0) {
    logger.warn(
      { count: unmatchedNames.length, names: unmatchedNames },
      "arizona_state_parks: unmatched web rows (no GIS park by normalized name)",
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
  logger.info(result, "arizona_state_parks: ingest complete");
  return result;
};

export default ingest;
