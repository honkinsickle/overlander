/**
 * PAD-US land-status ingester (Phase 1, land-status foundation).
 *
 * Source: USGS Protected Areas Database of the United States (PAD-US 4.1),
 * the authoritative federal+state+local+private land-manager inventory — the
 * US land-status backbone for the dispersed-camping signal. Per ADR
 * 2026-06-02-land-status-and-dispersed-camping-sources, PAD-US + BLM SMA are
 * ONE combined source (PAD-US primary); SMA is a later BLM/USFS tie-breaker,
 * not a sibling source.
 *
 * Endpoint (this phase — Fee-first):
 *   - Fee Managers (ArcGIS Online FeatureServer):
 *     https://services.arcgis.com/v01gqwM5QqNysAAi/.../Fee_Managers_PADUS/FeatureServer/0
 *     PAD-US 4.1, all managers. Carries the negative signal (private/BLM/local).
 *
 * ── HARD PRE-PROD GATE: Wilderness (Designation class) ────────────────────
 * The Fee class EXCLUDES Wilderness (des_tp='WA' lives in PAD-US's separate
 * Designation feature class). Under Fee-first, a point inside a Wilderness
 * inherits the enclosing forest's `likely_allowed` — a wrong "camp here".
 * Harmless on test (validates tuple/dissolve/split/containment/dispersed for
 * everything but Wilderness), but BEFORE ANY PROD SHIP the Designation
 * endpoint must be wired AND a `WA` record shown both carrying
 * `likely_restricted` and OVERRIDING the enclosing forest's `likely_allowed`
 * (restricted-beats-allowed precedence at containment-resolution time).
 * `deriveDispersedCamping` already returns `likely_restricted` for des_tp='WA';
 * the missing pieces are the Designation endpoint + the multi-parent
 * resolution rule. Tracked: entity-resolution/README.md.
 *
 * Key (locked, see ADR): one source_record per PAD-US *unit*, dissolved across
 * its polygon shards into one MultiPolygon. external_id is attribute-derived,
 * NOT Source_PAID (which regenerates across PAD-US major versions — Gate B):
 *   padus:<sha1(lower(mang_name|mang_type|unit_nm|des_tp))>
 * Source_PAID is demoted to a normalized_payload provenance attribute.
 *
 * Entity model split (ADR): named units (des_tp ∈ NAMED_DES_TP) → category
 * `public_land` (searchable via the park_boundary path); generic ownership /
 * jurisdiction parcels → category `land_status` (search-excluded via the
 * is_searchable column set in recompute_master_place).
 *
 * Run via:
 *   npm run -w data ingest:manual -- --source padus --bbox W,S,E,N
 */

import { createHash } from "node:crypto";

import { z } from "zod";

import { upsertSourceRecord } from "../lib/db.ts";
import { fetchEsriCount, fetchEsriFeatures } from "../lib/esri.ts";
import { bboxCentroid, extractPolygon, type GeoJsonFeature } from "../lib/geojson.ts";
import { logger } from "../lib/logger.ts";
import { compact } from "../lib/normalize.ts";
import { limits } from "../lib/rate-limit.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "padus";
const SOURCE_QUALITY_SCORE = 0.8;
const USER_AGENT =
  "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

const ENDPOINTS = {
  fee: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0",
} as const;

// ───── Attribute schema ────────────────────────────────────────────────
//
// `.passthrough()` — PAD-US carries many fields we don't normalize. f=geojson
// preserves the layer's PascalCase field names.
const FeePropsSchema = z
  .object({
    Mang_Name: z.string().nullable().optional(),
    Mang_Type: z.string().nullable().optional(),
    Unit_Nm: z.string().nullable().optional(),
    Loc_Nm: z.string().nullable().optional(),
    Des_Tp: z.string().nullable().optional(),
    State_Nm: z.string().nullable().optional(),
    Own_Type: z.string().nullable().optional(),
    Pub_Access: z.string().nullable().optional(),
    GAP_Sts: z.union([z.string(), z.number()]).nullable().optional(),
    Source_PAID: z.string().nullable().optional(),
  })
  .passthrough();

type FeeProps = z.infer<typeof FeePropsSchema>;

// ───── Category split: named public_land vs generic land_status ─────────
//
// Exhaustive classification of the 49 distinct des_tp values observed in the
// PAD-US 4.1 national Fee service (pulled 2026-06-02). Every code is explicit;
// only truly novel/malformed codes fall through to the review log. This kills
// the fail-to-hidden class: an unmapped code is logged and lands as land_status
// (search-excluded) but the logger.warn surfaces it so it's not silent.
//
// 'WA' (Wilderness) is named — it only arrives from the Designation endpoint
// (see the pre-prod gate above). Listed here so the type-check survives.

/** Named, destination-worthy units a user would search → public_land (searchable). */
const NAMED_DES_TP = new Set<string>([
  // Federal — named destinations
  "NF",   // National Forest
  "NG",   // National Grassland
  "NLS",  // National Lakeshore / Seashore
  "NM",   // National Monument
  "NP",   // National Park
  "NRA",  // National Recreation Area
  "NCA",  // National Conservation Area
  "NWR",  // National Wildlife Refuge
  "NSBV", // National Scenic Byway / Scenic-Byway-related area
  "NT",   // National Trail (corridor)
  "WSR",  // Wild & Scenic River
  "WA",   // Wilderness Area (Designation class — pre-prod gate)
  "WPA",  // Waterfowl Production Area (FWS)
  "REA",  // Research Natural Area / Experimental Area (searchable federal unit)
  "REC",  // National Recreation Area (alternate code)
  "ACC",  // Area of Critical Environmental Concern (BLM ACEC — named federal mgmt area)
  "FORE", // National Forest / Forest Reserve (variant)
  // State — named destinations
  "SP",   // State Park
  "SW",   // State Wilderness
  "SDA",  // State Desert / Natural Area (named state unit)
  "SREC", // State Recreation Area
  // Private/NGO — named destination parks open to the public
  "PPRK", // Private Park (public-access named recreation area)
  "PROC", // Private Recreation / Open-access Conservation
]);

/** Generic ownership, management, or jurisdiction parcels → land_status (search-excluded). */
const GENERIC_DES_TP = new Set<string>([
  // BLM / USFS generic management designations
  "PUB",  // Public Land (generic BLM multiple-use)
  "ND",   // Not Designated / no special designation
  "UNK",  // Unknown / unclassified
  "RMA",  // Resource Management Area (generic)
  "SRMA", // Special Recreation Management Area
  "LRMA", // Local Recreation Management Area
  // Federal agency overlay / admin units
  "MIL",  // Military
  "MIT",  // Military Installation / Test Range
  "FOTH", // Federal Other (USBR, TVA, USACE generic parcels)
  "HCA",  // Hardwood Conservation Area / Habitat Conservation Area (overlay)
  "PHCA", // Private Hardwood / Habitat Conservation Area
  "SHCA", // State Hardwood / Habitat Conservation Area
  "LHCA", // Local Hardwood / Habitat Conservation Area
  // State generic
  "SCA",  // State Conservation Area (generic state land)
  "SOTH", // State Other
  "PAGR", // Private Agricultural Easement / Working Lands
  // Private / NGO conservation (no dispersed camping; not destination-searchable)
  "PCON", // Private Conservation (NGO — Nature Conservancy, land trusts, etc.)
  "PFOR", // Private Forest
  "POTH", // Private Other
  "PRAN", // Private Ranch / Working Lands
  // Local / regional (parks, rec, open space — not dispersed-camping land)
  "LP",   // Local Park
  "LREC", // Local Recreation Area
  "LOTH", // Local Other
  "LCA",  // Local Conservation Area
  // Tribal (trust land — restricted by definition)
  "TRIBL", // Tribal / American Indian trust or fee land
  // Easements / special designations
  "CONE", // Conservation Easement (overlay, not a standalone place)
]);

function trimOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function inferCategory(desTp: string | null): "public_land" | "land_status" {
  if (!desTp) return "land_status";
  const code = desTp.toUpperCase();
  if (NAMED_DES_TP.has(code)) return "public_land";
  if (GENERIC_DES_TP.has(code)) return "land_status";
  // Novel/malformed code not in either set. Log it so it's never silent, then
  // default to land_status (search-excluded) — safer than promoting unknown
  // codes into search. Surface in the ingestion run log for classification.
  logger.warn({ des_tp: desTp }, "padus: unrecognized des_tp — defaulting to land_status; add to NAMED_DES_TP or GENERIC_DES_TP");
  return "land_status";
}

// ───── dispersed_camping derivation (const manager+designation map) ─────
//
// Coarse, ADVISORY signal — always paired with verify_locally. Restricted
// beats allowed (Wilderness / closed access win). mvum_corridor stubbed null
// until the USFS phase wires MVUM. See ADR.
export type DispersedFlag = "likely_allowed" | "likely_restricted" | "unknown";

function deriveDispersedCamping(p: {
  mangName: string | null;
  mangType: string | null;
  desTp: string | null;
  pubAccess: string | null;
}): { dispersed_camping: DispersedFlag; verify_locally: true; mvum_corridor: null } {
  const flag = ((): DispersedFlag => {
    const des = p.desTp?.toUpperCase() ?? "";
    const name = p.mangName?.toUpperCase() ?? "";
    const type = p.mangType?.toUpperCase() ?? "";
    const access = p.pubAccess?.toUpperCase() ?? "";
    // restricted-beats-allowed
    if (des === "WA") return "likely_restricted"; // Wilderness
    if (access === "XA") return "likely_restricted"; // closed access
    if (name === "BLM") return "likely_allowed";
    if (name === "USFS") return "likely_allowed";
    if (name === "NPS" || name === "FWS") return "likely_restricted";
    if (type === "STAT" && des === "SP") return "likely_restricted"; // state parks
    if (type === "PVT") return "likely_restricted"; // private land
    if (type === "LOC") return "likely_restricted"; // local/city parks
    if (type === "NGO") return "likely_restricted"; // NGO/conservancy — no dispersed camping
    if (type === "DIST") return "likely_restricted"; // special-district parks
    if (type === "TRIB") return "likely_restricted"; // tribal land — restricted by definition (no permission assumed)
    return "unknown";
  })();
  return { dispersed_camping: flag, verify_locally: true, mvum_corridor: null };
}

function dispersedTag(flag: DispersedFlag): string {
  if (flag === "likely_allowed") return "dispersed_camping_likely";
  if (flag === "likely_restricted") return "no_dispersed_camping";
  return "dispersed_camping_unknown";
}

// ───── Locked external_id key (unit grain, attribute-derived) ──────────
function tupleKey(p: FeeProps): string {
  return [p.Mang_Name, p.Mang_Type, p.Unit_Nm, p.Des_Tp]
    .map((v) => (typeof v === "string" ? v.trim().toLowerCase() : ""))
    .join("|");
}

function externalIdFor(key: string): string {
  return `padus:${createHash("sha1").update(key).digest("hex")}`;
}

// ───── Dissolve: group polygon shards into one MultiPolygon per unit ────

interface DissolvedUnit {
  key: string;
  props: FeeProps; // representative attributes (constant within the tuple by construction)
  members: unknown[]; // MultiPolygon member coordinate arrays
  sourcePaids: Set<string>; // provenance — Source_PAID demoted to an attribute
}

function dissolveByTuple(features: GeoJsonFeature[]): DissolvedUnit[] {
  const byKey = new Map<string, DissolvedUnit>();
  for (const feature of features) {
    const parsed = FeePropsSchema.safeParse(feature.properties);
    if (!parsed.success) continue;
    const props = parsed.data;
    const poly = extractPolygon(feature.geometry);
    if (!poly) continue;

    const key = tupleKey(props);
    let unit = byKey.get(key);
    if (!unit) {
      unit = { key, props, members: [], sourcePaids: new Set() };
      byKey.set(key, unit);
    }
    // Polygon coordinates = array of rings → one MultiPolygon member.
    // MultiPolygon coordinates = array of members → spread.
    if (poly.type === "Polygon") {
      unit.members.push(poly.coordinates);
    } else {
      for (const member of poly.coordinates as unknown[]) unit.members.push(member);
    }
    const paid = trimOrNull(props.Source_PAID);
    if (paid) unit.sourcePaids.add(paid);
  }
  return [...byKey.values()];
}

// ───── Normalizer ──────────────────────────────────────────────────────

function normalizeUnit(
  unit: DissolvedUnit,
  name: string,
  multiPolygon: { type: "MultiPolygon"; coordinates: unknown[] },
): Record<string, unknown> {
  const p = unit.props;
  const desTp = trimOrNull(p.Des_Tp);
  const dispersed = deriveDispersedCamping({
    mangName: trimOrNull(p.Mang_Name),
    mangType: trimOrNull(p.Mang_Type),
    desTp,
    pubAccess: trimOrNull(p.Pub_Access),
  });
  return {
    canonical_name: name,
    description: null,
    overlander_tags: ["public_land", dispersedTag(dispersed.dispersed_camping)],
    contact: null,
    access: compact({ public_access: trimOrNull(p.Pub_Access) }),
    amenities: null,
    hours: null,
    // Promoted to master_place.geometry_polygon by recompute_master_place via
    // the padus geometry_polygon field_precedence row.
    geometry_polygon: multiPolygon,
    // Land-status attributes (drive is_searchable via category + the flag).
    land_manager: trimOrNull(p.Mang_Name),
    manager_type: trimOrNull(p.Mang_Type),
    designation: desTp,
    gap_status: p.GAP_Sts != null ? String(p.GAP_Sts) : null,
    state_name: trimOrNull(p.State_Nm),
    // Source_PAID demoted to provenance (Gate B: not refresh-stable as identity).
    source_paids: [...unit.sourcePaids],
    dispersed_camping: dispersed.dispersed_camping,
    verify_locally: dispersed.verify_locally,
    mvum_corridor: dispersed.mvum_corridor,
  };
}

// ───── Persistence ─────────────────────────────────────────────────────

type PersistOutcome = "inserted" | "skipped" | "error";

async function persistUnit(
  unit: DissolvedUnit,
  dryRun: boolean,
): Promise<PersistOutcome> {
  const multiPolygon = { type: "MultiPolygon" as const, coordinates: unit.members };
  const centroid = bboxCentroid({ type: "MultiPolygon", coordinates: unit.members });
  if (!centroid) return "skipped";

  const name = trimOrNull(unit.props.Unit_Nm) ?? `PAD-US ${unit.props.Des_Tp ?? "land"} unit`;
  const externalId = externalIdFor(unit.key);
  const inferredCategory = inferCategory(trimOrNull(unit.props.Des_Tp));

  if (dryRun) {
    logger.debug({ externalId, name, inferredCategory }, "padus: dry-run unit");
    return "inserted";
  }
  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory,
      point: centroid,
      rawPayload: { props: unit.props, source_paids: [...unit.sourcePaids], fetched_at: new Date().toISOString() },
      normalizedPayload: normalizeUnit(unit, name, multiPolygon),
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "padus: unit upsert failed");
    return "error";
  }
}

// ───── Entry ───────────────────────────────────────────────────────────

export const ingest: IngestFn = async (
  opts: IngestOptions,
): Promise<IngestResult> => {
  const startedAt = Date.now();
  const bbox = opts.bbox;
  if (!bbox) {
    throw new Error(
      "padus: --bbox is required. PAD-US is queried by geographic envelope; there is no unit-code filter.",
    );
  }
  logger.info({ bbox }, "padus: ingest start");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.padus;
  if (!limit) throw new Error("padus: rate limiter missing — check lib/rate-limit.ts");
  const dryRun = opts.dryRun ?? false;

  await limit(async () => {
    // Pre-flight count — size the corridor before pulling geometry.
    const count = await fetchEsriCount(ENDPOINTS.fee, bbox, {
      where: "1=1",
      label: "padus.fee",
      userAgent: USER_AGENT,
    });
    logger.info({ count }, "padus: fee feature count (pre-flight)");

    const features = await fetchEsriFeatures(ENDPOINTS.fee, bbox, {
      where: "1=1",
      label: "padus.fee",
      userAgent: USER_AGENT,
    });
    stats.fetched += features.length;

    const units = dissolveByTuple(features);
    logger.info(
      { features: features.length, units: units.length },
      "padus: dissolved fee shards into units",
    );
    for (const unit of units) {
      const outcome = await persistUnit(unit, dryRun);
      if (outcome === "inserted") stats.inserted += 1;
      else if (outcome === "skipped") stats.skipped += 1;
      else stats.errors += 1;
    }
  });

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "padus: ingestion complete");
  return result;
};

export default ingest;

// Test seam: pure helpers exercised without network or DB.
export const _internals = {
  deriveDispersedCamping,
  dispersedTag,
  dissolveByTuple,
  externalIdFor,
  inferCategory,
  normalizeUnit,
  tupleKey,
};
