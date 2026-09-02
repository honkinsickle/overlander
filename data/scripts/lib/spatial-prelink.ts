/**
 * Shared point-in-polygon pre-link logic for the state-park visitor-content
 * ER scripts (CA / WA / OR / NV).
 *
 * Extracted for the same reason `eligibility.ts` was: the four scripts carried
 * independently-duplicated copies of this containment logic, and a bug in it
 * was fixed in one and left stale in the others. Concretely — CA's script
 * originally took the FIRST containing polygon, which is both wrong and
 * order-dependent, because **state-park polygons overlap**. Measured on TEST
 * 2026-09-02, first-match-wins disagreed with CA's recorded links on exactly
 * the 3 records that sit inside 2 units:
 *
 *   State Indian Museum SHP  → picked Sutter's Fort SHP
 *   Manchester SP            → picked Brush Creek/Lagoon Lake Wetlands NP
 *   Point Dume SB            → picked Point Dume NP
 *
 * In all three the correct unit was the name-matching one. `chooseContaining`
 * therefore disambiguates on name using the same pairing `scoreMatch` uses
 * (Jaro-Winkler over `normalizeName`), tie-broken on `mpId` so the result does
 * not depend on row order.
 *
 * `or-state-parks-er.ts` and `nv-state-parks-er.ts` carried the same
 * first-match-wins behaviour and now call through here.
 */

import natural from "natural";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeName } from "../../entity-resolution/matcher.ts";

const jaroWinkler = natural.JaroWinklerDistance;

export type Ring = number[][];

export interface GeoPolygon {
  type: "Polygon";
  coordinates: Ring[];
}
export interface GeoMultiPolygon {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
/** Any GeoJSON-shaped value; non-polygon types simply never contain a point. */
export type Geometry = GeoPolygon | GeoMultiPolygon | { type: string };

export interface ParkPolygon {
  mpId: string;
  canonicalName: string;
  polygon: Geometry;
}

/** Ray-casting point-in-polygon. Handles Polygon and MultiPolygon. */
export function pointInPolygon(pt: [number, number], poly: Geometry): boolean {
  const [px, py] = pt;
  let rings: Ring[] = [];
  if (poly.type === "Polygon") rings = (poly as GeoPolygon).coordinates;
  else if (poly.type === "MultiPolygon") rings = (poly as GeoMultiPolygon).coordinates.flat();

  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** Every polygon in `polys` that contains the point, in input order. */
export function containingPolygons(
  pt: [number, number],
  polys: readonly ParkPolygon[],
): ParkPolygon[] {
  return polys.filter((p) => pointInPolygon(pt, p.polygon));
}

/**
 * Pick the right park for a visitor point.
 *
 * Returns null when nothing contains the point. When exactly one does, that's
 * the answer. When several do (overlapping units), the one whose canonical
 * name best matches `sourceName` wins; ties break on `mpId` so the choice is
 * independent of the order rows came back from the database.
 */
export function chooseContaining(
  pt: [number, number],
  sourceName: string,
  polys: readonly ParkPolygon[],
): { chosen: ParkPolygon; among: ParkPolygon[] } | null {
  const among = containingPolygons(pt, polys);
  if (among.length === 0) return null;
  if (among.length === 1) return { chosen: among[0], among };

  const normalizedSource = normalizeName(sourceName);
  const chosen = among
    .map((p) => ({ p, sim: jaroWinkler(normalizedSource, normalizeName(p.canonicalName)) }))
    .sort((a, b) => b.sim - a.sim || a.p.mpId.localeCompare(b.p.mpId))[0].p;
  return { chosen, among };
}

// ───── Shared phase-1 driver + verifier ───────────────────────────────

/** Minimal shape phase 1 needs from a visitor-content source_record. */
export interface PrelinkRecord {
  id: string;
  name: string;
  lon: number;
  lat: number;
}

export interface SpatialMatch {
  srcId: string;
  mpId: string;
  srcName: string;
  mpName: string;
}

/**
 * Run phase-1 containment over `records`. Records with unusable coordinates,
 * or with no containing polygon, come back in `unmatched` for phase 2.
 */
export function computeSpatialMatches<T extends PrelinkRecord>(
  records: readonly T[],
  polys: readonly ParkPolygon[],
  onOverlap?: (src: T, chosen: ParkPolygon, among: ParkPolygon[]) => void,
): { matched: SpatialMatch[]; unmatched: T[] } {
  const matched: SpatialMatch[] = [];
  const unmatched: T[] = [];
  for (const src of records) {
    if (Number.isNaN(src.lon) || Number.isNaN(src.lat)) {
      unmatched.push(src);
      continue;
    }
    const hit = chooseContaining([src.lon, src.lat], src.name, polys);
    if (!hit) {
      unmatched.push(src);
      continue;
    }
    if (hit.among.length > 1 && onOverlap) onOverlap(src, hit.chosen, hit.among);
    matched.push({
      srcId: src.id,
      mpId: hit.chosen.mpId,
      srcName: src.name,
      mpName: hit.chosen.canonicalName,
    });
  }
  return { matched, unmatched };
}

export interface VerifyReport {
  recorded: number;
  rederived: number;
  agree: number;
  disagree: { srcId: string; srcName: string; recordedMpId: string; rederivedMpId: string }[];
  missing: string[];
  extra: string[];
  exact: boolean;
}

/**
 * Re-derive phase 1 over `records` and diff against the `spatial_containment`
 * rows already in `place_match`. Writes nothing.
 *
 * This exists because the obvious check is vacuous: once a source is fully
 * linked, a `--dry-run` finds zero unlinked rows and reports success without
 * exercising any containment logic. A check that cannot fail is not evidence.
 */
export async function verifyAgainstRecorded(
  sb: SupabaseClient,
  records: readonly PrelinkRecord[],
  polys: readonly ParkPolygon[],
): Promise<VerifyReport> {
  const { matched } = computeSpatialMatches(records, polys);
  const proposed = new Map(matched.map((m) => [m.srcId, m.mpId]));
  const nameById = new Map(records.map((r) => [r.id, r.name]));

  const truth = new Map<string, string>();
  const ids = records.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb
      .from("place_match")
      .select("source_record_id, master_place_id")
      .in("source_record_id", ids.slice(i, i + 200))
      .eq("match_method", "spatial_containment")
      .eq("status", "confirmed");
    if (r.error || r.data == null) {
      throw new Error(`verify: place_match fetch failed: ${JSON.stringify(r.error)}`);
    }
    for (const row of r.data) truth.set(String(row.source_record_id), String(row.master_place_id));
  }

  let agree = 0;
  const disagree: VerifyReport["disagree"] = [];
  const missing: string[] = [];
  const extra: string[] = [];

  for (const [srcId, recordedMpId] of truth) {
    const rederivedMpId = proposed.get(srcId);
    if (rederivedMpId == null) missing.push(srcId);
    else if (rederivedMpId === recordedMpId) agree += 1;
    else disagree.push({ srcId, srcName: nameById.get(srcId) ?? "?", recordedMpId, rederivedMpId });
  }
  for (const srcId of proposed.keys()) if (!truth.has(srcId)) extra.push(srcId);

  return {
    recorded: truth.size,
    rederived: proposed.size,
    agree,
    disagree,
    missing,
    extra,
    exact: disagree.length === 0 && missing.length === 0 && extra.length === 0,
  };
}

/** Print a `VerifyReport` in the shape every state's --verify uses. */
export function printVerifyReport(label: string, polyCount: number, tested: number, r: VerifyReport): void {
  console.log(`\n──────── ${label}: phase-1 re-derivation vs recorded ground truth ────────`);
  console.log(`  polygons in substrate        : ${polyCount}`);
  console.log(`  source_records tested        : ${tested}`);
  console.log(`  recorded spatial_containment : ${r.recorded}`);
  console.log(`  re-derived matches           : ${r.rederived}`);
  console.log(`  AGREE (same src → same mp)   : ${r.agree}`);
  console.log(`  DISAGREE (different mp)      : ${r.disagree.length}`);
  console.log(`  MISSING (recorded, not found): ${r.missing.length}`);
  console.log(`  EXTRA (found, not recorded)  : ${r.extra.length}`);
  for (const d of r.disagree) {
    console.log(`    DISAGREE ${d.srcName}`);
    console.log(`       recorded  ${d.recordedMpId}`);
    console.log(`       re-derived ${d.rederivedMpId}`);
  }
  if (r.missing.length) console.log(`    missing ids: ${JSON.stringify(r.missing.slice(0, 10))}`);
  if (r.extra.length) console.log(`    extra ids  : ${JSON.stringify(r.extra.slice(0, 10))}`);
  console.log(
    `\n  VERDICT: ${r.exact
      ? "phase 1 reproduces the recorded spatial_containment set exactly"
      : "phase 1 DIVERGES from the recorded set — investigate before applying"}`,
  );
}
