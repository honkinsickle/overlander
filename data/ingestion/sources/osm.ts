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

const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT ?? "https://overpass-api.de/api/interpreter";

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
  ["amenity", /^fuel$/, "gas_station"],
  ["amenity", /^charging_station$/, "ev_charging"],
  ["amenity", /^drinking_water$/, "water"],
  ["amenity", /^shower$/, "shower"],
  ["amenity", /^toilets$/, "toilet"],
  ["amenity", /^waste_disposal$/, "dump_station"],
  ["amenity", /^(bbq|fire_pit)$/, "fire_pit"],
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
// Overpass query
// ──────────────────────────────────────────────────────────────────────

function buildOverpassQuery(bbox: BoundingBox): string {
  // Overpass bbox format: south,west,north,east
  const [w, s, e, n] = bbox;
  const bboxStr = `${s},${w},${n},${e}`;

  // TODO(week-2): nodes-only. Campgrounds, parks, and rest areas are frequently
  // tagged on ways (polygons) or relations (multipolygons) rather than nodes.
  // Expect ~10–20% miss on federal campgrounds and parks at this stage.
  // Upgrade plan: union in `way[...]` + `rel[...]` clauses for the polygon-prone
  // tags (tourism=camp_site, leisure=park, highway=services), and switch the
  // output statement to `out body geom;` so each way carries its centerpoint.
  // Then teach elementCoords() to read `center` for non-node elements.
  return `[out:json][timeout:${OVERPASS_TIMEOUT_S}];
(
  node["tourism"~"^(camp_site|caravan_site|picnic_site|viewpoint|alpine_hut|wilderness_hut)$"](${bboxStr});
  node["amenity"~"^(fuel|drinking_water|shower|toilets|waste_disposal|charging_station|bbq|fire_pit)$"](${bboxStr});
  node["highway"~"^(services|rest_area|trailhead)$"](${bboxStr});
  node["shop"~"^(supermarket|convenience|outdoor|hardware)$"](${bboxStr});
  node["natural"~"^(spring|peak|beach)$"](${bboxStr});
  node["man_made"~"^(water_well|water_tap)$"](${bboxStr});
  node["leisure"~"^(park|nature_reserve)$"](${bboxStr});
);
out body;`;
}

async function fetchTile(bbox: BoundingBox): Promise<OverpassElement[]> {
  const query = buildOverpassQuery(bbox);
  return defaultRetry(async () => {
    const res = await fetch(OVERPASS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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
  description: string | null;
  amenities: Record<string, unknown> | null;
  hours: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  access: Record<string, unknown> | null;
}

function normalizeOsm(tags: Record<string, string> | undefined): NormalizedOsm {
  const t = tags ?? {};

  const amenities = compact({
    water: t.drinking_water === "yes" || t.amenity === "drinking_water" ? true : undefined,
    toilet: t.toilets === "yes" || t.amenity === "toilets" ? true : undefined,
    shower: t.shower === "yes" || t.amenity === "shower" ? true : undefined,
    dump_station: t.amenity === "waste_disposal" ? true : undefined,
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

  return {
    description,
    amenities: Object.keys(amenities).length > 0 ? amenities : null,
    hours,
    contact: Object.keys(contact).length > 0 ? contact : null,
    access: Object.keys(access).length > 0 ? access : null,
  };
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
  const normalized = normalizeOsm(el.tags);
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
  let bbox: BoundingBox;

  if (opts.bbox) {
    bbox = opts.bbox;
    logger.info({ bbox }, "osm: using manual bbox override");
  } else {
    const corridor = await getActiveCorridorBbox();
    if (!corridor) {
      throw new Error(
        "No active corridor found. Either pass --bbox or run deploy-corridor first.",
      );
    }
    bbox = corridor.bbox;
    logger.info({ corridor: corridor.name, bbox }, "osm: using corridor bbox");
  }

  const tiles = tileBbox(bbox, TILE_SIZE_KM);
  logger.info({ tileCount: tiles.length, tileSizeKm: TILE_SIZE_KM }, "osm: tiling complete");

  const stats = { fetched: 0, inserted: 0, updated: 0, skipped: 0, errors: 0 };
  const limit = limits.osm;

  await Promise.all(
    tiles.map((tile, idx) =>
      limit(async () => {
        try {
          const elements = await fetchTile(tile);
          stats.fetched += elements.length;
          logger.debug({ tile: idx + 1, of: tiles.length, fetched: elements.length }, "osm: tile fetched");

          for (const el of elements) {
            const outcome = await persistElement(el, opts.dryRun ?? false);
            if (outcome === "inserted") stats.inserted += 1;
            else if (outcome === "skipped") stats.skipped += 1;
            else if (outcome === "error") stats.errors += 1;
          }
        } catch (err) {
          logger.error({ err, tile }, "osm: tile failed");
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
