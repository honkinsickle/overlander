/**
 * OSM ingester (Overpass API).
 *
 * Spec section 8.1. Fetches overlander-relevant POIs by tiling the corridor
 * bbox into ~50km × 50km cells and issuing one Overpass query per cell.
 *
 * Source quality score: 0.4 (OSM tags are inconsistent; lowest of all sources).
 * external_id format: `osm:<type>:<id>` (e.g. `osm:node:1234567`).
 *
 * Run via CLI:
 *   npm run -w data ingest:manual -- --source osm --bbox W,S,E,N
 */

import { z } from "zod";
import { upsertSourceRecord } from "../lib/db.ts";
import { logger } from "../lib/logger.ts";
import { defaultRetry } from "../lib/retry.ts";
import { limits } from "../lib/rate-limit.ts";
import { tileBbox, type BoundingBox } from "../lib/geometry.ts";
import { getActiveCorridorBbox } from "../lib/corridor.ts";
import { compact } from "../lib/normalize.ts";
import type { IngestFn, IngestOptions, IngestResult } from "./_types.ts";

const SOURCE_ID = "osm";
const SOURCE_QUALITY_SCORE = 0.4;
const TILE_SIZE_KM = 50;
const OVERPASS_TIMEOUT_S = 60;

// Matches the existing repo's env var convention (`bin/preflight` uses OVERPASS_URL).
// Default mirror chosen to match what `bin/preflight` validates as healthy.
const OVERPASS_URL =
  process.env.OVERPASS_URL ?? "https://overpass.kumi.systems/api/interpreter";

// Overpass mirrors enforce User-Agent. Identify the client clearly so abuse
// can be reported to a real party. Spec section 8.1 ("Be conservative —
// Overpass is community-run") motivates this.
const USER_AGENT = "overlander-data-ingestion/0.0.1 (+https://github.com/honkinsickle/overlander)";

// ──────────────────────────────────────────────────────────────────────
// Overpass response validation
// ──────────────────────────────────────────────────────────────────────

const OverpassElementSchema = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  tags: z.record(z.string()).optional(),
});

const OverpassResponseSchema = z.object({
  version: z.number().optional(),
  generator: z.string().optional(),
  elements: z.array(OverpassElementSchema),
});

type OverpassElement = z.infer<typeof OverpassElementSchema>;

// ──────────────────────────────────────────────────────────────────────
// Category mapping
// ──────────────────────────────────────────────────────────────────────

/**
 * Maps from primary OSM tag to canonical overlander category.
 * Order in the array matters: the first matching tag wins.
 */
const TAG_TO_CATEGORY: Array<[tagKey: string, tagValue: RegExp, category: string]> = [
  ["tourism", /^(camp_site|caravan_site)$/, "campground"],
  ["tourism", /^picnic_site$/, "picnic_area"],
  ["tourism", /^viewpoint$/, "viewpoint"],
  ["tourism", /^(alpine_hut|wilderness_hut)$/, "hut"],
  ["amenity", /^drinking_water$/, "water"],
  ["amenity", /^shower$/, "shower"],
  ["amenity", /^toilets$/, "toilet"],
  ["amenity", /^sanitary_dump_station$/, "dump_station"],
  ["highway", /^(services|rest_area)$/, "rest_area"],
  ["highway", /^trailhead$/, "trailhead"],
  ["shop", /^(supermarket|convenience)$/, "grocery"],
  ["shop", /^outdoor$/, "outdoor_gear"],
  ["shop", /^hardware$/, "hardware"],
  ["natural", /^spring$/, "spring"],
  ["natural", /^peak$/, "peak"],
  ["natural", /^beach$/, "beach"],
  ["man_made", /^(water_well|water_tap)$/, "water"],
  ["leisure", /^(park|nature_reserve)$/, "park"],
];

function inferCategory(tags: Record<string, string> | undefined): string | null {
  if (!tags) return null;
  // Phase 2 (PR-B): a camp_site tagged backcountry=yes or informal=yes is a
  // dispersed/backcountry site, not a developed campground — split it to the
  // dispersed_camping category (PR-0). caravan_site (RV-oriented) and plain
  // camp_site stay campground. No new Overpass fetch — camp_site is already
  // queried; this is a classification refinement on tags we already pull.
  if (
    tags.tourism === "camp_site" &&
    (tags.backcountry === "yes" || tags.informal === "yes")
  ) {
    return "dispersed_camping";
  }
  for (const [key, valuePattern, category] of TAG_TO_CATEGORY) {
    const tagValue = tags[key];
    if (tagValue && valuePattern.test(tagValue)) return category;
  }
  return null;
}

function inferName(tags: Record<string, string> | undefined, category: string | null): string {
  if (tags?.name) return tags.name;
  if (tags?.["name:en"]) return tags["name:en"];
  if (tags?.brand) return tags.brand;
  if (tags?.operator) return tags.operator;
  return category ? `Unnamed ${category.replace(/_/g, " ")}` : "Unnamed OSM feature";
}

// ──────────────────────────────────────────────────────────────────────
// Overpass query — tag families + scope shape
// ──────────────────────────────────────────────────────────────────────

/** Named tag families the ingest can restrict to. Each maps to one or more
 *  Overpass predicates; the union across selected families is what gets fetched. */
export type TagFamily =
  | "camping"
  | "tourism_misc"
  | "water_san"
  | "trailheads"
  | "shops"
  | "spring"
  | "peak"
  | "beach"
  | "leisure";

/** Every family the adapter knows about. Used by parseFamilies to validate a
 *  CLI --families argument. `shops` is defined here but excluded from
 *  DEFAULT_FAMILIES — see the comment below. */
export const ALL_FAMILIES: readonly TagFamily[] = [
  "camping",
  "tourism_misc",
  "water_san",
  "trailheads",
  "shops",
  "spring",
  "peak",
  "beach",
  "leisure",
] as const;

/** The families that run when --families is not passed. Excludes `shops`.
 *
 *  Retail rationale (measured 2026-08-10, UT + NV, `shop~^(supermarket|
 *  convenience|outdoor|hardware)$` under ISO3166-2 area scope):
 *  - 33.7% (UT) / 45.5% (NV) of retail nodes carry brand OR operator
 *  - 31.6% / 26.7% carry opening_hours
 *  - 35.9% / 30.9% carry ≥3 of (name, hours, phone, website, addr:street)
 *  - 29.5% / 16.8% are name-only pins with no contact/hours/branding
 *  The community's `shop=` completeness bottom-rung is a stub. Google Places
 *  is the correct source for retail — its data model requires hours, phone,
 *  and categories by design. OSM retail can still be fetched explicitly via
 *  `--families shops` (kept for opt-in ingest); it is off by default so a
 *  bare `--source osm` run doesn't spend materialize/ER cycles on sparse pins.
 */
export const DEFAULT_FAMILIES: readonly TagFamily[] = ALL_FAMILIES.filter(
  (f): f is TagFamily => f !== "shops",
);

/** Predicates per family. `%SCOPE%` is substituted with the bbox or area filter
 *  at build time. Each family maps to one or more Overpass predicates; the union
 *  across selected families is fetched (Overpass dedups the outer union). The
 *  `natural` bundle was split into single-value `spring`/`peak`/`beach` families
 *  so each can be requested independently, and the `fuel` bundle
 *  (fuel/charging_station/bbq/fire_pit) was retired entirely — Google Places
 *  covers gas and EV charging live, fire_pit has zero six-state nodes, and bbq
 *  is amenity noise (see the natural/fuel audit, 2026-08-11). */
const FAMILY_PREDICATES: Record<TagFamily, readonly string[]> = {
  camping: [
    'node["tourism"~"^(camp_site|caravan_site)$"](%SCOPE%)',
    'node["tourism"="camp_site"]["backcountry"="yes"](%SCOPE%)',
    'node["tourism"="camp_site"]["informal"="yes"](%SCOPE%)',
  ],
  tourism_misc: [
    'node["tourism"~"^(picnic_site|viewpoint|alpine_hut|wilderness_hut)$"](%SCOPE%)',
  ],
  water_san: [
    'node["amenity"~"^(drinking_water|toilets|shower|sanitary_dump_station)$"](%SCOPE%)',
    'node["man_made"~"^(water_well|water_tap)$"](%SCOPE%)',
  ],
  trailheads: [
    'node["highway"~"^(services|rest_area|trailhead)$"](%SCOPE%)',
  ],
  shops: [
    'node["shop"~"^(supermarket|convenience|outdoor|hardware)$"](%SCOPE%)',
  ],
  spring: [
    'node["natural"="spring"](%SCOPE%)',
  ],
  peak: [
    'node["natural"="peak"](%SCOPE%)',
  ],
  beach: [
    'node["natural"="beach"](%SCOPE%)',
  ],
  leisure: [
    'node["leisure"~"^(park|nature_reserve)$"](%SCOPE%)',
  ],
};

/** Overpass query timeout in seconds. Bbox queries fetch a ~50km tile;
 *  area queries scope the whole state and need substantially longer
 *  (600s+ measured, 900s used here for headroom). */
const OVERPASS_TIMEOUT_AREA_S = 900;

interface QueryScope {
  /** `bbox` or `area`. Exactly one shape per query. */
  kind: "bbox" | "area";
  /** Overpass predicate scope: "s,w,n,e" for bbox, "area.sa" for area. */
  predicate: string;
  /** Only for area: the ISO 3166-2 code to bind to `.sa`. */
  isoCode?: string;
  /** Per-query Overpass internal timeout override. */
  timeoutS: number;
}

function bboxScope(bbox: BoundingBox): QueryScope {
  const [w, s, e, n] = bbox;
  return { kind: "bbox", predicate: `${s},${w},${n},${e}`, timeoutS: OVERPASS_TIMEOUT_S };
}

function areaScope(isoCode: string): QueryScope {
  return { kind: "area", predicate: "area.sa", isoCode, timeoutS: OVERPASS_TIMEOUT_AREA_S };
}

interface BuildOverpassQueryOpts {
  /** Which families to include. Default: ALL_FAMILIES. */
  families?: readonly TagFamily[];
}

// TODO(week-2): nodes-only. Campgrounds, parks, and rest areas are frequently
// tagged on ways (polygons) or relations (multipolygons) rather than nodes.
// Expect ~10–20% miss on federal campgrounds and parks at this stage.
// Upgrade plan: union in `way[...]` + `rel[...]` clauses for the polygon-prone
// tags (tourism=camp_site, leisure=park, highway=services), and switch the
// output statement to `out body geom;` so each way carries its centerpoint.
// Then teach elementCoords() to read `center` for non-node elements.
function buildOverpassQuery(scope: QueryScope, opts: BuildOverpassQueryOpts = {}): string {
  const families = opts.families ?? DEFAULT_FAMILIES;
  const predicates = families.flatMap((f) => FAMILY_PREDICATES[f]);
  const body = predicates.map((p) => `  ${p.replace("%SCOPE%", scope.predicate)};`).join("\n");
  const areaBinding =
    scope.kind === "area" ? `area["ISO3166-2"="${scope.isoCode}"]->.sa;\n` : "";
  return `[out:json][timeout:${scope.timeoutS}];\n${areaBinding}(\n${body}\n);\nout body;`;
}

/** Parse + validate a comma-separated family list from the CLI. Throws on
 *  unknown names so a typo fails loudly at boot rather than silently
 *  producing an empty query. */
export function parseFamilies(csv: string): TagFamily[] {
  const parts = csv.split(",").map((s) => s.trim()).filter(Boolean);
  const known = new Set<string>(ALL_FAMILIES);
  const bad = parts.filter((p) => !known.has(p));
  if (bad.length > 0) {
    throw new Error(
      `Unknown tag families: ${bad.join(", ")}. Available: ${ALL_FAMILIES.join(", ")}`,
    );
  }
  return parts as TagFamily[];
}

async function fetchTile(scope: QueryScope, families?: readonly TagFamily[]): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(scope, { families });
  return defaultRetry(async () => {
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        "User-Agent": USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Overpass ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const parsed = OverpassResponseSchema.safeParse(json);
    if (!parsed.success) {
      logger.warn({ err: parsed.error.flatten() }, "overpass response failed validation");
      throw new Error("overpass response failed validation");
    }
    return parsed.data.elements;
  }, "overpass.fetchTile");
}

// ──────────────────────────────────────────────────────────────────────
// Normalization
// ──────────────────────────────────────────────────────────────────────

interface NormalizedOsm {
  canonical_name: string;
  description: string | null;
  amenities: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  access: Record<string, unknown> | null;
  // Dispersed-camping advisory (only set for category dispersed_camping).
  dispersed_camping?: string;
  verify_locally?: boolean;
  mvum_corridor?: null;
}

function normalizeOsm(
  tags: Record<string, string> | undefined,
  name: string,
  category: string | null,
): NormalizedOsm {
  const t = tags ?? {};

  const amenities = compact({
    water: t.drinking_water === "yes" || t.amenity === "drinking_water" ? true : undefined,
    toilet: t.toilets === "yes" || t.amenity === "toilets" ? true : undefined,
    shower: t.shower === "yes" || t.amenity === "shower" ? true : undefined,
    dump_station: t.amenity === "sanitary_dump_station" ? true : undefined,
    fire_ring: t.amenity === "fire_pit" || t.amenity === "bbq" ? true : undefined,
    picnic: t.tourism === "picnic_site" ? true : undefined,
  });

  const contact = compact({
    phone: t.phone ?? t["contact:phone"],
    website: t.website ?? t["contact:website"],
    email: t.email ?? t["contact:email"],
  });

  const access = compact({
    fee: t.fee,
    vehicle: t.vehicle,
    motor_vehicle: t.motor_vehicle,
    surface: t.surface,
    smoothness: t.smoothness,
    operator: t.operator,
    access: t.access,
  });

  const hours = t.opening_hours ? { raw: t.opening_hours } : null;
  const description = t.description ?? t.note ?? null;

  const result: NormalizedOsm = {
    // canonical_name lets field_precedence resolve master_place.canonical_name
    // from OSM at priority 5. OSM names are passed through unchanged — they're
    // already proper-cased by convention, unlike RIDB's screaming caps.
    canonical_name: name,
    description,
    amenities: Object.keys(amenities).length > 0 ? amenities : null,
    hours,
    contact: Object.keys(contact).length > 0 ? contact : null,
    access: Object.keys(access).length > 0 ? access : null,
  };

  // Dispersed-camping advisory (mirrors usfs.ts): a backcountry/informal
  // camp_site offers dispersed camping → likely_allowed, ALWAYS paired with
  // verify_locally (coarse/advisory). mvum_corridor stubbed until PR-C.
  if (category === "dispersed_camping") {
    result.dispersed_camping = "likely_allowed";
    result.verify_locally = true;
    result.mvum_corridor = null;
  }

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// Element → upsert
// ──────────────────────────────────────────────────────────────────────

/**
 * Resolve coordinates from an Overpass element. Nodes carry lat/lon directly;
 * ways and relations carry `center` when `out center` is requested. We use
 * `out body` which omits centers, so non-node elements get skipped — fine for
 * Phase 1, where Overpass's tag-based POIs are predominantly nodes.
 */
function elementCoords(el: OverpassElement): [number, number] | null {
  if (el.lat !== undefined && el.lon !== undefined) return [el.lon, el.lat];
  if (el.center) return [el.center.lon, el.center.lat];
  return null;
}

async function persistElement(el: OverpassElement, dryRun: boolean): Promise<"inserted" | "skipped" | "error"> {
  const coords = elementCoords(el);
  if (!coords) return "skipped";

  const category = inferCategory(el.tags);
  if (!category) return "skipped"; // Tag combination wasn't overlander-relevant.

  const name = inferName(el.tags, category);
  const normalized = normalizeOsm(el.tags, name, category);
  const externalId = `osm:${el.type}:${el.id}`;

  if (dryRun) {
    logger.debug({ externalId, name, category, coords }, "dry-run — would upsert");
    return "inserted";
  }

  try {
    await upsertSourceRecord({
      sourceId: SOURCE_ID,
      externalId,
      name,
      inferredCategory: category,
      point: coords,
      rawPayload: { element: el, fetched_at: new Date().toISOString() },
      normalizedPayload: normalized,
      sourceQualityScore: SOURCE_QUALITY_SCORE,
    });
    return "inserted";
  } catch (err) {
    logger.error({ err, externalId }, "upsert failed");
    return "error";
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main entry point
// ──────────────────────────────────────────────────────────────────────

export const ingest: IngestFn = async (opts: IngestOptions): Promise<IngestResult> => {
  const startedAt = Date.now();

  if (opts.iso && opts.bbox) {
    throw new Error("osm: --iso and --bbox are mutually exclusive");
  }

  const families =
    opts.families && opts.families.length > 0
      ? parseFamilies(opts.families.join(","))
      : undefined;
  if (families) logger.info({ families }, "osm: restricted tag families");

  // Build the query scope(s). Area mode issues ONE untiled query per state —
  // Overpass area filters cannot be sub-tiled the way bboxes can (an area
  // filter binds a named polygon set; tiling it would require intersecting
  // the polygon with each sub-bbox, which the Overpass DSL does not directly
  // support). Bbox mode preserves the existing 50km tile-fanout.
  let scopes: QueryScope[];
  if (opts.iso) {
    scopes = [areaScope(opts.iso)];
    logger.info({ iso: opts.iso, timeoutS: OVERPASS_TIMEOUT_AREA_S }, "osm: using area filter (untiled)");
  } else {
    let bbox: BoundingBox;
    if (opts.bbox) {
      bbox = opts.bbox;
      logger.info({ bbox }, "osm: using manual bbox override");
    } else {
      const corridor = await getActiveCorridorBbox();
      if (!corridor) {
        throw new Error(
          "No active corridor found. Either pass --bbox, --iso, or run deploy-corridor first.",
        );
      }
      bbox = corridor.bbox;
      logger.info({ corridor: corridor.name, bbox }, "osm: using corridor bbox");
    }
    const tiles = tileBbox(bbox, TILE_SIZE_KM);
    logger.info({ tileCount: tiles.length, tileSizeKm: TILE_SIZE_KM }, "osm: tiling complete");
    scopes = tiles.map(bboxScope);
  }

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.osm;

  await Promise.all(
    scopes.map((scope, idx) =>
      limit(async () => {
        try {
          const elements = await fetchTile(scope, families);
          stats.fetched += elements.length;
          logger.debug({ tile: idx + 1, of: scopes.length, fetched: elements.length }, "osm: scope fetched");

          for (const el of elements) {
            const outcome = await persistElement(el, opts.dryRun ?? false);
            if (outcome === "inserted") stats.inserted += 1;
            else if (outcome === "skipped") stats.skipped += 1;
            else if (outcome === "error") stats.errors += 1;
          }
        } catch (err) {
          logger.error({ err, scope }, "osm: scope failed");
          stats.errors += 1;
        }
      }),
    ),
  );

  const duration_ms = Date.now() - startedAt;
  const result: IngestResult = { source_id: SOURCE_ID, duration_ms, ...stats };
  logger.info(result, "osm: ingestion complete");
  return result;
};

export default ingest;

// Test seam: pure helpers exercised without network or DB.
export const _internals = {
  inferCategory,
  normalizeOsm,
  buildOverpassQuery,
  bboxScope,
  areaScope,
  FAMILY_PREDICATES,
};

// Allow direct execution: `tsx ingestion/sources/osm.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  ingest({ dryRun: process.argv.includes("--dry-run") })
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(result, null, 2));
      process.exit(result.errors > 0 ? 1 : 0);
    })
    .catch((err) => {
      logger.error({ err }, "osm: fatal");
      process.exit(1);
    });
}
