/**
 * Throwaway diagnostic: measure cross-source distances + scoring confidence
 * for each of the 5 JT campground fixtures using the current matcher.ts
 * formula. NOT committed; not part of the production code path.
 *
 * Run via:
 *   set -a && source web/.env.local && set +a && \
 *     SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
 *     node_modules/.bin/tsx data/entity-resolution/diagnose.ts
 */

import { getDb } from "../ingestion/lib/db.ts";
import {
  haversineMeters,
  scoreMatch,
  type MasterPlaceCandidate,
  type MatchScore,
} from "./matcher.ts";

const FIXTURES = [
  { label: "Ryan Campground",         pattern: "%ryan campground%" },
  { label: "Hidden Valley Campground", pattern: "%hidden valley%" },
  { label: "White Tank Campground",    pattern: "%white tank%" },
  { label: "Jumbo Rocks Campground",   pattern: "%jumbo rocks%" },
  { label: "Sheep Pass Campground",    pattern: "%sheep pass%" },
];

const CANDIDATE_RADIUS_M = 500;
const NEW_CANDIDATE_RADIUS_M = 500; // widened from 200m in 130200_phase3a_widen_candidate_radius.sql

interface SR {
  id: string;
  source_id: string;
  external_id: string;
  name: string;
  inferred_category: string | null;
  geometry: { type: "Point"; coordinates: [number, number] } | string;
}

function parsePoint(geom: SR["geometry"]): [number, number] | null {
  if (typeof geom === "object" && geom !== null && "coordinates" in geom) {
    const c = geom.coordinates;
    if (Array.isArray(c) && c.length >= 2) return [c[0]!, c[1]!];
  }
  if (typeof geom === "string") {
    try {
      const g = JSON.parse(geom) as { coordinates?: [number, number] };
      if (g.coordinates) return g.coordinates;
    } catch {
      return null;
    }
  }
  return null;
}

async function findAnchor(pattern: string): Promise<SR | null> {
  const db = getDb();
  // Prefer NPS (canonical), then Google, then any.
  for (const preferredSource of ["nps", "google", "ridb", "osm"]) {
    const { data } = await db
      .from("source_record")
      .select("id, source_id, external_id, name, inferred_category, geometry")
      .ilike("name", pattern)
      .eq("source_id", preferredSource)
      .limit(1);
    if (data && data.length > 0) return data[0] as SR;
  }
  return null;
}

async function findClusterAround(point: [number, number]): Promise<SR[]> {
  // Pull a generous geographic window via lat/lng bbox (PostgREST-friendly),
  // then filter precisely by haversine in JS. The window is ±0.01 degrees
  // (~1.1km lat, ~0.93km lng at JT latitude) — wider than 500m to ensure
  // no candidate is lost to box clipping.
  const [lng, lat] = point;
  const pad = 0.01;
  const db = getDb();
  const { data, error } = await db
    .from("source_record")
    .select("id, source_id, external_id, name, inferred_category, geometry");
  if (error) throw error;

  const inWindow = (data ?? []).filter((r) => {
    const p = parsePoint(r.geometry as SR["geometry"]);
    if (!p) return false;
    return (
      p[0] >= lng - pad &&
      p[0] <= lng + pad &&
      p[1] >= lat - pad &&
      p[1] <= lat + pad
    );
  }) as SR[];

  return inWindow.filter((r) => {
    const p = parsePoint(r.geometry);
    if (!p) return false;
    return haversineMeters(point, p) <= CANDIDATE_RADIUS_M;
  });
}

function pairAcrossSources(records: SR[]): Array<[SR, SR]> {
  const pairs: Array<[SR, SR]> = [];
  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      const a = records[i]!;
      const b = records[j]!;
      if (a.source_id === b.source_id) continue; // cross-source only
      pairs.push([a, b]);
    }
  }
  return pairs;
}

function makeCandidate(b: SR, distance_m: number): MasterPlaceCandidate {
  return {
    id: b.id,
    canonical_name: b.name,
    primary_category: b.inferred_category ?? "unknown",
    distance_m,
  };
}

/**
 * Apply matcher.ts rule order to a cross-source pair. The diagnostic
 * pairs are constructed cross-source by definition, so the same-source
 * guard passes by construction. fed_exact and amenity_rollup are not
 * evaluated here (they have different I/O dependencies); this function
 * simulates rules 3, 4, 5 of matchOne.
 */
function ruleVerdict(score: MatchScore): string {
  // Rule 3: name_dominant
  if (
    score.distance_meters <= 500 &&
    score.name_similarity >= 0.85 &&
    score.category_compatibility >= 0.8
  ) {
    return "auto[name_dom]";
  }
  // Rule 4: close_nameless
  if (
    score.distance_meters <= 100 &&
    score.category_compatibility >= 0.8 &&
    score.name_similarity < 0.85
  ) {
    return "review[close_nl]";
  }
  // Rule 5: blended
  if (score.combined_confidence >= 0.85) return "auto[blended]";
  if (score.combined_confidence >= 0.6) return "review[blended]";
  return "new";
}

function row(
  fixture: string,
  a: SR,
  b: SR,
  distance_m: number,
): string {
  const score = scoreMatch(
    { name: a.name, inferred_category: a.inferred_category },
    makeCandidate(b, distance_m),
  );
  const aLabel = `${a.source_id}:${a.inferred_category ?? "-"}`;
  const bLabel = `${b.source_id}:${b.inferred_category ?? "-"}`;
  const verdict = ruleVerdict(score);
  const flags: string[] = [];
  if (distance_m > NEW_CANDIDATE_RADIUS_M) flags.push("EXCLUDED");
  return [
    fixture.padEnd(26),
    aLabel.padEnd(22),
    bLabel.padEnd(22),
    distance_m.toFixed(1).padStart(8),
    score.name_similarity.toFixed(3).padStart(9),
    score.category_compatibility.toFixed(2).padStart(10),
    score.combined_confidence.toFixed(3).padStart(7),
    verdict.padEnd(17),
    flags.join(",").padEnd(10),
    `[${a.name}] vs [${b.name}]`,
  ].join(" | ");
}

async function main(): Promise<void> {
  const header = [
    "fixture".padEnd(26),
    "a (source:cat)".padEnd(22),
    "b (source:cat)".padEnd(22),
    "dist_m".padStart(8),
    "name_sim".padStart(9),
    "cat_compat".padStart(10),
    "conf".padStart(7),
    "rule".padEnd(17),
    "flags".padEnd(10),
    "names",
  ].join(" | ");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const fix of FIXTURES) {
    const anchor = await findAnchor(fix.pattern);
    if (!anchor) {
      console.log(`${fix.label}: NO ANCHOR FOUND`);
      continue;
    }
    const anchorPoint = parsePoint(anchor.geometry);
    if (!anchorPoint) {
      console.log(`${fix.label}: anchor has no parseable geometry`);
      continue;
    }
    const cluster = await findClusterAround(anchorPoint);

    // Restrict to records whose name/category is plausibly part of this
    // fixture's cluster. Otherwise nearby OSM peaks/springs/etc. dominate
    // the table. Keep: anything in PARENT_CATEGORIES (campground/facility/
    // recreation_area/lodging) — these are the cross-source-same-place
    // candidates we care about. Drop amenity nodes, peaks, etc.
    const PARENT_CATEGORIES = new Set([
      "campground",
      "facility",
      "recreation_area",
      "lodging",
    ]);
    const clusterFiltered = cluster.filter((r) => {
      if (r.inferred_category && PARENT_CATEGORIES.has(r.inferred_category)) return true;
      return false;
    });

    const pairs = pairAcrossSources(clusterFiltered);
    pairs.sort((p, q) => {
      const pa = parsePoint(p[0].geometry)!;
      const pb = parsePoint(p[1].geometry)!;
      const qa = parsePoint(q[0].geometry)!;
      const qb = parsePoint(q[1].geometry)!;
      return haversineMeters(pa, pb) - haversineMeters(qa, qb);
    });
    if (pairs.length === 0) {
      console.log(`${fix.label}: no cross-source pairs in cluster (cluster size=${clusterFiltered.length})`);
      continue;
    }
    for (const [a, b] of pairs) {
      const pa = parsePoint(a.geometry)!;
      const pb = parsePoint(b.geometry)!;
      const dist = haversineMeters(pa, pb);
      console.log(row(fix.label, a, b, dist));
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error("diagnose: fatal", err);
  process.exit(1);
});
