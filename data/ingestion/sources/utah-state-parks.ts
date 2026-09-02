/**
 * Utah State Parks visitor-website ingester (JSON-driven).
 *
 * Complements the existing `state_parks` GIS source (ArcGIS park
 * boundaries) with visitor-facing content scraped from
 * stateparks.utah.gov: descriptions, hours, contact, alerts, and
 * hero photos.
 *
 * Source JSON: `/Users/adamwagner/ut-state-parks/data/utah_parks.json`
 * (46 rows — all UT state parks scraped 2026-09-01; park list from
 * wp-sitemap-posts-page-1.xml, 810 URLs under /parks/, 46 are
 * top-level park pages).
 *
 * Per-state source_id, in the OR/NV/AZ state-prefixed family (no
 * `_web` suffix), separate from the shared `state_parks` GIS pattern
 * that uses one source_id across all six states.
 *
 * external_id format: `utah_state_parks:<slug>` — the URL slug from
 * stateparks.utah.gov/parks/<slug>/, stable across scrapes.
 *
 * NO COORDINATES in the source data (0/46 rows) — stateparks.utah.gov
 * does not expose lat/lon on park pages. Since `source_record.geometry`
 * is NOT NULL, we borrow geometry from the matching existing
 * `state_parks:UT:park:<GlobalID>` GIS record at ingest time, matched
 * by normalized name. Rows without a name match are skipped with a
 * warning — expected for ~4 parks (Echo, Historic Union Pacific Rail
 * Trail, This Is The Place Heritage Park, Utahraptor) that may not
 * exist in the GIS corpus.
 *
 * The matched GIS record's `master_place_id` (if any) is captured in
 * `normalized_payload.provenance.intended_master_place_id` so the ER
 * script can auto-link deterministically without depending on
 * matchAll's name-similarity threshold.
 *
 * Hours field contamination: the `hours` column contains phone, fax,
 * management name, and email info mixed in. This ingester mechanically
 * splits at the first Phone:/Management:/Fax:/Email:/E-mail: marker,
 * routing the leading text to hours and the trailing text to contact.
 * Two rows (Antelope Island, Bear Lake) have explicit `contact` blocks
 * — those are preferred over the extracted version.
 *
 * License posture: stateparks.utah.gov's footer (JS-injected) carries
 * "Copyright (c) [year] State of Utah - All rights reserved." The
 * statewide disclaimer (utah.gov/support/disclaimer.html) grants reuse
 * of "information" for "personal or informational use" if unmodified,
 * but explicitly disclaims that photos are copyright-clear. Adam has
 * accepted the risk of URL-referencing photos (no warehousing) with
 * attribution "Utah State Parks". This is a deliberate risk-acceptance
 * call, not a resolved license-clear determination.
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source utah_state_parks --dry-run
 *   npm run -w data ingest:manual -- --source utah_state_parks
 *
 * Env override:
 *   UTAH_STATE_PARKS_JSON — path to the JSON file. Defaults to
 *     `/Users/adamwagner/ut-state-parks/data/utah_parks.json`.
 */

import { readFile } from "node:fs/promises";
import { z } from "zod";
import { getDb, upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "utah_state_parks";
const SOURCE_QUALITY_SCORE = 0.6;
const SCRAPED_AT = "2026-09-01";

const DEFAULT_JSON_PATH =
  "/Users/adamwagner/ut-state-parks/data/utah_parks.json";

const RowSchema = z.object({
  state: z.literal("ut"),
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

// ───── Known name variants ──────────────────────────────────────────
// Web-scrape names that differ from the GIS / RIDB canonical name.
// Mapped BEFORE token-stripping so the GIS geometry lookup resolves.
// GIS names are short forms (e.g. "Escalante" not "Escalante
// Petrified Forest State Park"), so variants map to the GIS short name.
const NAME_VARIANTS: Record<string, string> = {
  "fred hayes state park at starvation": "starvation",
  "jordan river off-highway vehicle state park": "jordan river ohv",
  "escalante petrified forest state park": "escalante",
  "great salt lake state park": "great salt lake marina",
  "historic union pacific rail trail": "rail trail",
};

// ───── Name normalization for GIS lookup ─────────────────────────────
const STRIPPABLE_TOKENS = new Set([
  "state", "park", "museum", "and", "of", "the", "at",
  "recreation", "area", "heritage",
]);

function normalizeParkKey(name: string): string {
  const lower = name.toLowerCase().trim();
  const mapped = NAME_VARIANTS[lower];
  const target = mapped ?? lower;
  return target
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

async function loadUtGisParks(): Promise<Map<string, GisPark>> {
  const db = getDb();
  const { data, error } = await db.rpc("utah_state_parks_gis_index");
  if (error) {
    throw new Error(
      `utah_state_parks_gis_index RPC failed: ${error.message} — ensure migrations are applied to TEST first`,
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
function inferCategory(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("museum")) return "recreation_area";
  if (n.includes("state recreation area")) return "recreation_area";
  if (n.includes("heritage park")) return "historic";
  if (n.includes("rail trail")) return "recreation_area";
  if (n.includes("off-highway vehicle")) return "recreation_area";
  return "recreation_area";
}

// ───── Hours / contact separation ────────────────────────────────────
// The `hours` field on 41/46 parks has phone/management/fax/email info
// concatenated after the actual hours text. We split at the first such
// marker.
const CONTACT_MARKER_RE = /\b(?:Phone:|Management:|Fax:|E-?mail:)/i;

interface SplitHoursResult {
  hours: string | null;
  extractedContact: string | null;
}

function splitHoursContact(raw: string): SplitHoursResult {
  const trimmed = raw.trim();
  if (!trimmed) return { hours: null, extractedContact: null };
  const match = CONTACT_MARKER_RE.exec(trimmed);
  if (!match) return { hours: trimmed, extractedContact: null };
  const hoursText = trimmed.slice(0, match.index).trim() || null;
  const contactText = trimmed.slice(match.index).trim() || null;
  return { hours: hoursText, extractedContact: contactText };
}

// ───── Phone extraction from contact text ────────────────────────────
const PHONE_RE = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/;

function extractPhone(contactText: string): string | undefined {
  const match = contactText.match(PHONE_RE);
  return match?.[0]?.trim();
}

// ───── Alert normalization — pattern-match fire-stage stripping ──────
// UT has 6 distinct fire-restriction boilerplate texts across 2 stages
// (Stage 1 and Stage 2). They all start with "Stage N Restrictions:"
// or "Stage N Fire Restrictions:" followed by policy text. We strip
// these by pattern, keeping only park-specific NOTICE/Closure alerts.
const FIRE_STAGE_RE = /^Stage\s+\d+\s+(?:Fire\s+)?Restrictions?:/i;

function stripFireAlerts(alerts: string): string | null {
  const trimmed = alerts.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const residual = parts.filter((p) => !FIRE_STAGE_RE.test(p));
  if (residual.length === 0) return null;
  return residual.join(" | ");
}

// ───── Normalization ─────────────────────────────────────────────────

function normalizeRow(
  row: ParkRow,
  gis: GisPark,
): Record<string, unknown> {
  const description = row.about.trim() || null;
  const summary = row.summary.trim() || null;

  // Hours/contact separation
  const { hours: hoursText, extractedContact } = splitHoursContact(row.hours);

  // Contact: prefer explicit contact block if present, otherwise use
  // the extracted contact from the hours field
  const explicitContact = row.contact.trim() || null;
  const contactRaw = explicitContact ?? extractedContact;
  const contact = contactRaw
    ? compact({
        raw: contactRaw,
        phone: extractPhone(contactRaw),
      })
    : null;

  // Alerts: strip fire-stage boilerplate, keep park-specific notices
  const advisories = stripFireAlerts(row.alerts);

  const photo = row.hero.trim()
    ? {
        url: row.hero.trim(),
        credit: "Utah State Parks",
        license: "Utah State Parks",
        source_page: row.url.trim(),
      }
    : null;

  return compact({
    canonical_name: row.name,
    description,
    summary,
    hours: hoursText ? { raw: hoursText } : undefined,
    contact: contact && Object.keys(contact).length ? contact : undefined,
    photo,
    advisories,
    provenance: compact({
      source: "stateparks.utah.gov",
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
      "utah_state_parks: dry-run",
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
    logger.error({ err, externalId, name: row.name }, "utah_state_parks: upsert failed");
    return "error";
  }
}

// ───── Entry ─────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const jsonPath = process.env.UTAH_STATE_PARKS_JSON ?? DEFAULT_JSON_PATH;
  logger.info({ jsonPath, dryRun }, "utah_state_parks: ingest starting");

  const text = await readFile(jsonPath, "utf8");
  const raw = JSON.parse(text) as unknown[];
  const rows: ParkRow[] = [];
  for (const item of raw) {
    const parsed = RowSchema.safeParse(item);
    if (!parsed.success) {
      logger.warn({ item, err: parsed.error.flatten() }, "utah_state_parks: row failed schema");
      continue;
    }
    rows.push(parsed.data);
  }
  logger.info({ rows: rows.length }, "utah_state_parks: JSON loaded");

  const gisIndex = await loadUtGisParks();
  logger.info({ gis_parks: gisIndex.size }, "utah_state_parks: GIS index loaded");

  const stats = { fetched: rows.length, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const catCounts: Record<string, number> = {};
  const unmatchedNames: string[] = [];
  const variantMatches: Array<{ web: string; gis: string }> = [];
  let advisoriesRetained = 0;

  for (const row of rows) {
    const key = normalizeParkKey(row.name);
    const gis = gisIndex.get(key);
    if (!gis) {
      unmatchedNames.push(row.name);
      logger.warn(
        { name: row.name, key },
        "utah_state_parks: no matching state_parks:UT:park GIS record — skipping",
      );
      stats.skipped += 1;
      continue;
    }
    if (gis.name !== row.name) {
      variantMatches.push({ web: row.name, gis: gis.name });
    }

    const category = inferCategory(row.name);
    catCounts[category] = (catCounts[category] ?? 0) + 1;

    if (stripFireAlerts(row.alerts)) {
      advisoriesRetained += 1;
    }

    const outcome = await persistRow(row, gis, category, dryRun);
    if (outcome === "inserted") stats.inserted += 1;
    else if (outcome === "skipped") stats.skipped += 1;
    else stats.errors += 1;
  }

  logger.info({ catCounts }, "utah_state_parks: category tally");
  logger.info(
    { advisoriesRetained },
    "utah_state_parks: parks retaining advisories after fire-stage strip",
  );
  if (variantMatches.length > 0) {
    logger.info(
      { variants: variantMatches },
      "utah_state_parks: name-variant matches (web ≠ GIS canonical, resolved via normalization)",
    );
  }
  if (unmatchedNames.length > 0) {
    logger.warn(
      { count: unmatchedNames.length, names: unmatchedNames },
      "utah_state_parks: unmatched web rows (no GIS park by normalized name)",
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
  logger.info(result, "utah_state_parks: ingest complete");
  return result;
};

export default ingest;
