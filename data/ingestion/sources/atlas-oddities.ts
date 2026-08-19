/**
 * Atlas Obscura oddities ingester (CSV-driven, not API).
 *
 * Reads the six per-state anchor CSVs prepared in `.context/ao-*-anchors.csv`
 * (schema: `name, latitude, longitude, address, categories, ao_url,
 * external_id, website`; 2,866 rows total across CA/AZ/WA/NV/OR/UT). The
 * scoping analysis in `.context/ao-anchors-analysis.md` is the source of
 * truth for what the data looks like and every quality flag encoded below.
 *
 * external_id format: `atlasobscura:<slug>` — comes verbatim from the CSV;
 * every row already carries one and they are globally unique across all six
 * files. Source quality score: 0.5 (curated content, not authoritative).
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source atlas_oddities --dry-run
 *   npm run -w data ingest:manual -- --source atlas_oddities
 *
 * ─── PENDING taxonomy decision — flagged, not resolved ──────────────────
 *
 * `inferred_category` is set to the PROPOSED value `"oddity"` on every row
 * (see PROPOSED_INFERRED_CATEGORY). This is a proposal pending Adam's
 * sign-off, not a decision — see the report accompanying the ingest run.
 * `oddity` is not currently in the client-side SLIDE_TO_PRIMARY_CATEGORY
 * map (`web/src/lib/trip-browse/federated.ts`); the closest existing bucket
 * is `oddity` which today owns `roadside_attraction` + `tourist_attraction`.
 *
 * Safety: the materialize pipeline's category allowlist is fail-closed
 * (`data/pipeline/materialize.ts` §onlyCategories) — with any non-empty
 * `--only-categories` list, rows whose `inferred_category` is not in the
 * list are held back from entity resolution. So a routine materialize
 * that doesn't pass `--only-categories oddity` will NOT accidentally flow
 * these into ER. Adam can UPDATE `inferred_category` to a different value
 * (e.g. `roadside_attraction`, `attraction`, a new taxonomy value) via a
 * single SQL statement before the first ER run.
 *
 * Empty-categories rows (52 measured): ingested with `inferred_category =
 * "oddity"` — the category is NOT derived from the tag list here; the tag
 * list only becomes `overlander_tags`. So a row with no tags is not a
 * blocker.
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "atlas_oddities";
const SOURCE_QUALITY_SCORE = 0.5;

/**
 * PROPOSED value for `inferred_category` on every AO row. See the header
 * for the safety story and the sign-off requirement. Kept as an exported
 * constant so a follow-up UPDATE statement and the ingest run reference
 * the same identifier.
 */
export const PROPOSED_INFERRED_CATEGORY = "oddity";

/**
 * The six per-state CSVs, checked into `.context/` (gitignored per
 * workspace — copied from `victoria/.context/` as part of the scoping pass).
 * File names and state labels are fixed; if the source of truth ever moves
 * to a data/ path, update here.
 */
const STATE_FILES: ReadonlyArray<{ state: string; file: string }> = [
  { state: "california", file: "ao-california-anchors.csv" },
  { state: "arizona", file: "ao-arizona-anchors.csv" },
  { state: "washington", file: "ao-washington-anchors.csv" },
  { state: "nevada", file: "ao-nevada-anchors.csv" },
  { state: "oregon", file: "ao-oregon-anchors.csv" },
  { state: "utah", file: "ao-utah-anchors.csv" },
];

/**
 * Per-row coordinate corrections, keyed by external_id. Documented so that
 * every override is reviewable in code, not a silent CSV mutation. Each
 * entry asserts the EXPECTED bad value from the CSV — if the source is
 * ever fixed upstream (or the fix here is applied twice), the assertion
 * fails loudly rather than double-correcting.
 *
 * `.context/ao-anchors-analysis.md` §Task 6 documents the one confirmed
 * data bug: "The Great Chamber" (UT) has longitude +112.4566 which lands
 * in W China; the correct value is -112.4566.
 */
export const COORDINATE_CORRECTIONS: Record<
  string,
  { expected: { lng?: number; lat?: number }; corrected: { lng?: number; lat?: number }; note: string }
> = {
  "atlasobscura:the-great-chamber": {
    expected: { lng: 112.4566 },
    corrected: { lng: -112.4566 },
    note:
      "CSV lng +112.4566 lands in W China; corrected to -112.4566. See .context/ao-anchors-analysis.md §Task 6.",
  },
};

/**
 * Non-taxonomic / campaign tokens observed in the AO categories field.
 * Dropped from `overlander_tags` but preserved in `raw_payload.categories`
 * so nothing is lost. See `.context/ao-anchors-analysis.md` §Task 6.
 */
const CAMPAIGN_TAGS: ReadonlySet<string> = new Set([
  "Travelnevada",
  "Ao Loves Halloween",
  "Day Of Rivals",
  "Obscura Day 2016",
  "Obscura Day Locations",
  "Aletrail",
]);

// ───── CSV parsing ─────────────────────────────────────────────────────

const RowSchema = z.object({
  name: z.string(),
  latitude: z.string(),
  longitude: z.string(),
  address: z.string(),
  categories: z.string(),
  ao_url: z.string(),
  external_id: z.string(),
  website: z.string(),
});

export type OdditiesRow = z.infer<typeof RowSchema>;

/**
 * Minimal RFC-4180-ish CSV parser: handles quoted fields with embedded
 * commas, newlines, and escaped `""` quotes. Deliberately small — the six
 * CSVs sum to ~2,866 rows / ~660 KB and their shape is stable (verified in
 * the scoping pass). If the input format grows, replace with a dep.
 */
export function parseCsv(text: string): OdditiesRow[] {
  const rows: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let i = 0;
  // Normalize CRLF → LF so newline handling has one branch.
  const src = text.replace(/\r\n?/g, "\n");
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ",") {
      record.push(field);
      field = "";
      i += 1;
      continue;
    }
    if (c === "\n") {
      record.push(field);
      rows.push(record);
      record = [];
      field = "";
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  // Flush final field/record (files may not end in newline).
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    rows.push(record);
  }
  if (rows.length === 0) return [];
  const header = rows[0];
  const expected = [
    "name", "latitude", "longitude", "address",
    "categories", "ao_url", "external_id", "website",
  ];
  if (header.length !== expected.length || !expected.every((h, idx) => header[idx] === h)) {
    throw new Error(
      `atlas_oddities: CSV header mismatch — expected ${JSON.stringify(expected)}, got ${JSON.stringify(header)}`,
    );
  }
  const out: OdditiesRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r];
    // Skip fully empty trailing rows (a blank line after the last record).
    if (cols.length === 1 && cols[0] === "") continue;
    if (cols.length !== expected.length) {
      logger.warn({ row: r, cols: cols.length }, "atlas_oddities: skipping malformed CSV row");
      continue;
    }
    const obj: Record<string, string> = {};
    for (let c = 0; c < expected.length; c++) obj[expected[c]] = cols[c];
    const parsed = RowSchema.safeParse(obj);
    if (!parsed.success) {
      logger.warn({ row: r, err: parsed.error.flatten() }, "atlas_oddities: row failed schema");
      continue;
    }
    out.push(parsed.data);
  }
  return out;
}

// ───── Field normalization ─────────────────────────────────────────────

/**
 * Split AO's `categories` field on `; ` (semicolon+space is the observed
 * delimiter; a bare `;` never appears). Trims each token. Empty input →
 * empty array — the 52 rows with empty categories return `[]` here.
 */
export function splitCategories(raw: string): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return raw.split(";").map((t) => t.trim()).filter((t) => t.length > 0);
}

/** Drop the six known campaign / non-taxonomic tokens (case-sensitive to
 *  match the CSV's Title-Case; the token list itself is Title-Case). */
export function filterCampaignTags(tags: string[]): string[] {
  return tags.filter((t) => !CAMPAIGN_TAGS.has(t));
}

/**
 * Strip UTM tracking params from a URL. Keeps every other query param.
 * Returns the URL unchanged if it cannot be parsed (e.g. a raw domain
 * without scheme — AO's `website` field is always fully-qualified in the
 * sample, but be defensive).
 */
export function stripUtm(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    const toDelete: string[] = [];
    for (const key of u.searchParams.keys()) {
      if (key.toLowerCase().startsWith("utm_")) toDelete.push(key);
    }
    for (const key of toDelete) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Strip the literal `, None,` sequence that appears in some addresses as
 * a scraper artifact (see `.context/ao-anchors-analysis.md` §Task 6 —
 * one confirmed row: `881 Innes Avenue, None, San Francisco, CA 94124`).
 * Collapses the resulting double-comma back to a single one.
 */
export function stripAddressNoneToken(address: string): string {
  return address.replace(/,\s*None\s*,/g, ",").replace(/\s{2,}/g, " ").trim();
}

/**
 * Build `overlander_tags` for a row: the source marker `"atlas_obscura"`
 * plus the filtered AO tag tokens (campaign tags removed). Tokens are kept
 * in their original Title-Case; the entity-resolution matcher lowercases
 * separately when it needs to compare.
 */
export function toOverlanderTags(rawCategories: string): string[] {
  const tokens = filterCampaignTags(splitCategories(rawCategories));
  return ["atlas_obscura", ...tokens];
}

// ───── Coordinate handling ─────────────────────────────────────────────

/**
 * Parse the CSV's string lat/lng into a `[lng, lat]` tuple, applying any
 * documented per-row correction. Returns `null` on unparseable values.
 * On correction, asserts the CSV still carries the expected bad value —
 * if AO fixes the source upstream, this throws so the correction map is
 * updated deliberately rather than silently drifting.
 */
export function parseCoordinates(row: OdditiesRow): [number, number] | null {
  const latNum = parseFloat(row.latitude);
  const lngNum = parseFloat(row.longitude);
  if (Number.isNaN(latNum) || Number.isNaN(lngNum)) return null;
  if (latNum === 0 && lngNum === 0) return null;

  const correction = COORDINATE_CORRECTIONS[row.external_id];
  if (!correction) return [lngNum, latNum];

  // Assert the CSV still has the value we expected to correct.
  if (correction.expected.lng !== undefined && lngNum !== correction.expected.lng) {
    throw new Error(
      `atlas_oddities: coord correction for ${row.external_id} expected lng ${correction.expected.lng}, ` +
        `got ${lngNum} — CSV changed; review COORDINATE_CORRECTIONS.`,
    );
  }
  if (correction.expected.lat !== undefined && latNum !== correction.expected.lat) {
    throw new Error(
      `atlas_oddities: coord correction for ${row.external_id} expected lat ${correction.expected.lat}, ` +
        `got ${latNum} — CSV changed; review COORDINATE_CORRECTIONS.`,
    );
  }
  const fixedLng = correction.corrected.lng ?? lngNum;
  const fixedLat = correction.corrected.lat ?? latNum;
  logger.warn(
    { external_id: row.external_id, from: [lngNum, latNum], to: [fixedLng, fixedLat], note: correction.note },
    "atlas_oddities: applied coordinate correction",
  );
  return [fixedLng, fixedLat];
}

// ───── Normalization ───────────────────────────────────────────────────

/**
 * Transform one CSV row into the shape stored on
 * `source_record.normalized_payload`. Pure — no DB, no network.
 *
 * Fields written:
 *   - canonical_name: AO's `name`. Preserves the display name (which can
 *     differ from the slug, e.g. "The Neon Museum" → `neon-boneyard`).
 *     Do NOT derive from the slug.
 *   - description: null. AO CSV has no description column; the AO page
 *     itself would need a separate scrape+ToS check.
 *   - overlander_tags: `["atlas_obscura", ...filtered categories]`.
 *   - contact: `{ website }` with UTM stripped; null when AO has no
 *     website (~41% of rows).
 *   - address: `raw_payload.address` with the `, None,` scraper artifact
 *     stripped. Kept in `normalized_payload` too so downstream doesn't
 *     have to know about the fix.
 *   - ao_url: preserved on `normalized_payload.ao_url` (the canonical
 *     AO permalink; 100% of rows match `atlasobscura.com/places/<slug>`).
 *   - categories_raw: the original `; `-delimited string, in case
 *     downstream wants the unfiltered vocabulary.
 */
export function normalizeOddities(row: OdditiesRow): Record<string, unknown> {
  const website = row.website ? stripUtm(row.website) : "";
  const address = stripAddressNoneToken(row.address);
  const contact = compact({ website: website || undefined });
  return {
    canonical_name: row.name,
    description: null,
    overlander_tags: toOverlanderTags(row.categories),
    contact: Object.keys(contact).length ? contact : null,
    access: null,
    amenities: null,
    hours: null,
    address: address || null,
    ao_url: row.ao_url,
    categories_raw: row.categories,
  };
}

// ───── Persistence ─────────────────────────────────────────────────────

type Outcome = "inserted" | "skipped" | "error";

async function persistOddity(
  row: OdditiesRow,
  state: string,
  dryRun: boolean,
): Promise<Outcome> {
  const coords = parseCoordinates(row);
  if (!coords) {
    logger.warn({ external_id: row.external_id, state, lat: row.latitude, lng: row.longitude }, "atlas_oddities: unparseable coords — skipped");
    return "skipped";
  }
  const externalId = row.external_id;
  if (dryRun) {
    logger.debug({ externalId, name: row.name, state }, "atlas_oddities: dry-run");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name: row.name,
      inferredCategory: PROPOSED_INFERRED_CATEGORY,
      point: coords,
      rawPayload: { row, state, fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeOddities(row),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "atlas_oddities: upsert failed");
    return "error";
  }
}

// ───── CSV file discovery ──────────────────────────────────────────────

/**
 * Locate the `.context/` directory holding the AO CSVs. Order:
 *   1. env `ATLAS_CSV_DIR` (explicit override)
 *   2. `<repo>/.context/` relative to this file (`data/ingestion/sources/`)
 *
 * Kept as a function so tests can stub or point at fixtures.
 */
export function resolveCsvDir(envDir?: string): string {
  if (envDir && envDir.length > 0) return envDir;
  const here = dirname(fileURLToPath(import.meta.url));
  // data/ingestion/sources/ → data/ingestion → data → <repo> → <repo>/.context
  return resolve(here, "..", "..", "..", ".context");
}

async function readState(csvDir: string, state: string, file: string): Promise<OdditiesRow[]> {
  const path = join(csvDir, file);
  const text = await readFile(path, "utf8");
  const rows = parseCsv(text);
  logger.info({ state, path, rows: rows.length }, "atlas_oddities: state loaded");
  return rows;
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();
  const dryRun = opts.dryRun ?? false;
  const csvDir = resolveCsvDir(process.env.ATLAS_CSV_DIR);
  logger.info({ csvDir, dryRun }, "atlas_oddities: ingest starting");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const perState: Record<string, { fetched: number; inserted: number; skipped: number; errors: number }> = {};

  for (const { state, file } of STATE_FILES) {
    const rows = await readState(csvDir, state, file);
    stats.fetched += rows.length;
    const s = { fetched: rows.length, inserted: 0, skipped: 0, errors: 0 };
    for (const row of rows) {
      const outcome = await persistOddity(row, state, dryRun);
      if (outcome === "inserted") {
        stats.inserted += 1;
        s.inserted += 1;
      } else if (outcome === "skipped") {
        stats.skipped += 1;
        s.skipped += 1;
      } else {
        stats.errors += 1;
        s.errors += 1;
      }
    }
    perState[state] = s;
    logger.info({ state, ...s }, "atlas_oddities: state complete");
  }

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info({ ...result, perState }, "atlas_oddities: ingestion complete");
  return result;
};

export default ingest;

if (import.meta.url === `file://${process.argv[1]}`) {
  const dryRun = process.argv.includes("--dry-run");
  ingest({ dryRun })
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      logger.error({ err }, "atlas_oddities: fatal");
      process.exit(1);
    });
}
