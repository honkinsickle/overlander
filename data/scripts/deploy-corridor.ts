/**
 * Deploy the LA→Deadhorse corridor as one or more rows in
 * ingestion_corridor.
 *
 * Source of truth: the day-by-day Trip definition in
 * web/src/lib/trips/alaska.ts. Per spec §3.1 the spec-authorised
 * fallback is "a series of overlapping circles around the trip's
 * day-stop waypoints" — equivalent to a LineString through day-end
 * coords, buffered. We do exactly that. The road-snapped polyline
 * in alaska-route.ts is currently stale (covers only the early
 * exploration loop, not the planned LA→Deadhorse route), so we
 * read the source-of-truth day coords directly instead.
 *
 * Extraction: alaska.ts is hand-written TS with consistent
 * indentation. `coords: [lng, lat]` lines at 6-space indent are
 * day-level (the top-level entries in `days[]`); 10-space indent is
 * sub-waypoint detail inside a day. We extract by indentation —
 * fragile to reformatting but trivially auditable.
 *
 * Segment definitions are day ranges (1-based, inclusive). Adam's
 * call (2026-05-28): start with Segment A = Days 1–3 (LA → Whitefish,
 * MT). Segments B and C land in later PRs once A validates.
 *
 * Buffer: 80km (~50mi), matching the ingestion_corridor default.
 *
 * Idempotent: upserts on `ingestion_corridor.name`. Re-running over
 * the same source produces identical rows.
 *
 * Run:
 *   npm run -w data deploy-corridor
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRIP_FILE = resolve(HERE, "../../web/src/lib/trips/alaska.ts");

const BUFFER_METERS = 80000;

interface SegmentDef {
  name: string;
  /** 1-based day range, inclusive. */
  startDay: number;
  endDay: number;
  /** True for segments that cover the literal start of the trip — prepends startCoords. */
  includeStartCoords: boolean;
}

const SEGMENTS: readonly SegmentDef[] = [
  // Segment A — Adam's 2026-05-28 call: LA → Whitefish, MT (Days 1–3).
  // Bounded "all-US, federal-data-heavy" slice that validates the pipeline
  // on a meaningful but cap-safe corridor before the Canada crossing.
  { name: "segment_a_la_pnw", startDay: 1, endDay: 3, includeStartCoords: true },
] as const;

interface DayCoord {
  /** 1-based, matches the day's position in the days[] array. */
  dayNumber: number;
  /** [lng, lat] per project-wide convention. */
  coord: [number, number];
}

/**
 * Extract day-end coords from alaska.ts.
 *
 * The structure of the file is:
 *   const LA_TO_DEADHORSE_RAW: Trip = {
 *     ...
 *     startCoords: [-118.2437, 34.0522],   // 2-space indent
 *     days: [
 *       {                                   // 4-space indent
 *         coords: [-113.5163, 37.0469],     // 6-space indent — DAY 1
 *         waypoints: [
 *           { coords: [-118.2492, 34.0506] },   // 10-space indent — sub
 *           ...
 *         ],
 *       },
 *       { coords: [...] },                  // 6-space indent — DAY 2
 *       ...
 *     ],
 *   };
 *
 * Indentation discriminates day-level from sub-waypoint coords; the
 * positional `coords:` at 6-space indent is the day-end overnight.
 */
function extractTripCoords(): { startCoords: [number, number]; days: DayCoord[] } {
  const text = readFileSync(TRIP_FILE, "utf8");

  // startCoords: at 2-space indent (top-level of LA_TO_DEADHORSE_RAW).
  const startMatch = text.match(
    /^ {2}startCoords:\s*\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/m,
  );
  if (!startMatch || startMatch[1] === undefined || startMatch[2] === undefined) {
    throw new Error(`Could not locate startCoords in ${TRIP_FILE}`);
  }
  const startCoords: [number, number] = [parseFloat(startMatch[1]), parseFloat(startMatch[2])];

  // Day-level coords: 6-space indent, in route order. RegExp /g over the
  // whole file is fine — alaska.ts is ~3.7K lines, sub-ms.
  const days: DayCoord[] = [];
  const dayRegex = /^ {6}coords:\s*\[\s*(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\s*\]/gm;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = dayRegex.exec(text)) !== null) {
    n += 1;
    const lng = parseFloat(m[1]!);
    const lat = parseFloat(m[2]!);
    days.push({ dayNumber: n, coord: [lng, lat] });
  }

  if (days.length === 0) {
    throw new Error(`Extracted 0 day-level coords from ${TRIP_FILE}; indentation may have shifted`);
  }

  return { startCoords, days };
}

function coordsForSegment(
  seg: SegmentDef,
  startCoords: [number, number],
  days: DayCoord[],
): [number, number][] {
  const out: [number, number][] = [];
  if (seg.includeStartCoords) out.push(startCoords);
  for (const d of days) {
    if (d.dayNumber < seg.startDay || d.dayNumber > seg.endDay) continue;
    out.push(d.coord);
  }
  return out;
}

function toLineStringWkt(coords: [number, number][]): string {
  if (coords.length < 2) {
    throw new Error(`LineString requires at least 2 vertices, got ${coords.length}`);
  }
  const points = coords.map(([lng, lat]) => `${lng} ${lat}`).join(",");
  return `SRID=4326;LINESTRING(${points})`;
}

async function upsertSegment(
  name: string,
  coords: [number, number][],
): Promise<{ id: string; vertices: number; bbox: [number, number, number, number] }> {
  const wkt = toLineStringWkt(coords);

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);
  const bbox: [number, number, number, number] = [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];

  const db = getDb();
  const { data, error } = await db
    .from("ingestion_corridor")
    .upsert(
      {
        name,
        geometry: wkt,
        buffer_meters: BUFFER_METERS,
        active: true,
        status: "pending",
      },
      { onConflict: "name" },
    )
    .select("id")
    .single();

  if (error) throw error;
  return { id: (data as { id: string }).id, vertices: coords.length, bbox };
}

async function main(): Promise<void> {
  logger.info({ source: TRIP_FILE }, "deploy-corridor: extracting day coords");
  const { startCoords, days } = extractTripCoords();
  logger.info(
    {
      startCoords,
      daysExtracted: days.length,
      firstDay: days[0],
      lastDay: days[days.length - 1],
    },
    "deploy-corridor: extracted",
  );

  for (const seg of SEGMENTS) {
    const coords = coordsForSegment(seg, startCoords, days);
    if (coords.length < 2) {
      logger.warn(
        { segment: seg.name, dayRange: [seg.startDay, seg.endDay], vertices: coords.length },
        "deploy-corridor: segment has <2 vertices — skipping (day range out of bounds?)",
      );
      continue;
    }
    const result = await upsertSegment(seg.name, coords);
    logger.info(
      {
        segment: seg.name,
        dayRange: [seg.startDay, seg.endDay],
        id: result.id,
        vertices: result.vertices,
        bbox: result.bbox,
        bufferKm: BUFFER_METERS / 1000,
        coords,
      },
      "deploy-corridor: upserted",
    );
  }

  logger.info("deploy-corridor: complete");
}

main().catch((err) => {
  logger.error({ err }, "deploy-corridor: fatal");
  process.exit(1);
});
