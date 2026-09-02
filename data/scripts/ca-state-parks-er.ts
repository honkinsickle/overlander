/**
 * Two-phase entity resolution for `state_parks_web` (CA).
 *
 * Reconstructs the step that produced CA's TEST linkage on 2026-09-01 but was
 * never committed — commit `379c213` changed only `matcher.ts` and docs, so
 * unlike OR/NV/AZ/UT there was no `ca-state-parks-er.ts`. Modelled on
 * `or-state-parks-er.ts`, which its own header describes as mirroring the CA
 * pattern; this file closes that loop.
 *
 *   Phase 1 — spatial pre-link: point-in-polygon against existing CA
 *     `state_parks` GIS boundaries. The standard 500m ER radius is far too
 *     small for large parks whose polygon centroids sit kilometres from the
 *     website point (measured 2026-09-01: Auburn SRA 10.9 km, Anza-Borrego
 *     7.4 km, Mt. Tamalpais 3.6 km).
 *   Phase 2 — standard `matchAll` → `applyMatches` for the remainder.
 *
 * Modes:
 *   (default)   apply both phases
 *   --dry-run   compute both phases, write nothing
 *   --verify    recompute phase 1 over EVERY CA record regardless of current
 *               link state, and diff the proposals against the
 *               `spatial_containment` rows already in `place_match`.
 *
 * Why --verify exists: on TEST all 283 records are already linked, so
 * `--dry-run` finds zero unlinked rows and reports success while exercising
 * none of the polygon logic — a check that cannot fail is not evidence
 * (CLAUDE.md). `--verify` ignores link state, so it actually re-derives the
 * matches and can disagree with the recorded ground truth.
 *
 * Run (TEST):
 *   npx tsx --env-file=.env scripts/ca-state-parks-er.ts --verify
 *   npx tsx --env-file=.env scripts/ca-state-parks-er.ts --dry-run
 */

import { createClient } from "@supabase/supabase-js";
import natural from "natural";
import { matchAll, normalizeName } from "../entity-resolution/matcher.ts";
import { applyMatches } from "../entity-resolution/promote.ts";
import { logger } from "../ingestion/lib/logger.ts";

const jaroWinkler = natural.JaroWinklerDistance;

const SOURCE_ID = "state_parks_web";
/** The CA slice of the `state_parks` GIS source — the pre-link substrate. */
const GIS_PREFIX = "state_parks:CA:%";
const RESOLVED_BY = "auto:state_parks_web_er";

const DRY_RUN = process.argv.includes("--dry-run");
const VERIFY = process.argv.includes("--verify");

const sb = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

// ───── Types ──────────────────────────────────────────────────────────

type Ring = number[][];
interface GeoPolygon {
  type: "Polygon";
  coordinates: Ring[];
}
interface GeoMultiPolygon {
  type: "MultiPolygon";
  coordinates: Ring[][];
}
type Geometry = GeoPolygon | GeoMultiPolygon | { type: string };

interface ParkPolygon {
  mpId: string;
  canonicalName: string;
  polygon: Geometry;
}

interface SourceRow {
  id: string;
  externalId: string;
  name: string;
  masterPlaceId: string | null;
  lon: number;
  lat: number;
}

interface SpatialMatch {
  srcId: string;
  mpId: string;
  srcName: string;
  mpName: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ───── Phase 1 — polygon substrate ────────────────────────────────────

/**
 * Assemble CA park polygons keyed by the master_place they resolved to.
 *
 * Reads `normalized_payload.geometry_polygon` off the `state_parks` source
 * records rather than `master_place.geometry_polygon` — the latter is a PostGIS
 * type that PostgREST won't project as GeoJSON without a bespoke RPC. Same
 * approach as `or-state-parks-er.ts`.
 */
async function fetchCaParkPolygons(): Promise<ParkPolygon[]> {
  const rows: unknown[] = [];
  for (let off = 0; ; off += 1000) {
    const p = await sb
      .from("source_record")
      .select("master_place_id, normalized_payload")
      .eq("source_id", "state_parks")
      .ilike("external_id", GIS_PREFIX)
      .not("master_place_id", "is", null)
      .order("id")
      .range(off, off + 999);
    if (p.error || p.data == null) {
      throw new Error(`fetch state_parks CA failed: ${JSON.stringify(p.error)}`);
    }
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }
  logger.info({ gisRows: rows.length }, "ca-er: fetched CA state_parks GIS source_records");

  const byMp = new Map<string, ParkPolygon>();
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const mpId = r.master_place_id;
    const np = r.normalized_payload;
    if (typeof mpId !== "string" || !isRecord(np)) continue;
    const poly = np.geometry_polygon;
    if (!isRecord(poly) || typeof poly.type !== "string") continue;
    if (byMp.has(mpId)) continue;
    byMp.set(mpId, {
      mpId,
      canonicalName: typeof np.canonical_name === "string" ? np.canonical_name : "",
      polygon: poly as unknown as Geometry,
    });
  }
  const result = [...byMp.values()];
  logger.info({ polygons: result.length }, "ca-er: assembled distinct park polygons");
  return result;
}

/** Ray-casting point-in-polygon; handles Polygon and MultiPolygon. */
function pointInPolygon(pt: [number, number], poly: Geometry): boolean {
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

/**
 * Fetch CA visitor-content source_records. `onlyUnlinked` is the normal ER
 * path; --verify passes false so every record is re-derived regardless of the
 * link state already recorded.
 */
async function fetchSourceRecords(onlyUnlinked: boolean): Promise<SourceRow[]> {
  const rows: unknown[] = [];
  for (let off = 0; ; off += 1000) {
    let q = sb
      .from("source_record")
      .select("id, external_id, name, master_place_id, raw_payload")
      .eq("source_id", SOURCE_ID);
    if (onlyUnlinked) q = q.is("master_place_id", null);
    const p = await q.order("id").range(off, off + 999);
    if (p.error || p.data == null) {
      throw new Error(`fetch ${SOURCE_ID} failed: ${JSON.stringify(p.error)}`);
    }
    rows.push(...p.data);
    if (p.data.length < 1000) break;
  }

  const out: SourceRow[] = [];
  for (const r of rows) {
    if (!isRecord(r)) continue;
    const raw = isRecord(r.raw_payload) && isRecord(r.raw_payload.row) ? r.raw_payload.row : {};
    out.push({
      id: String(r.id),
      externalId: String(r.external_id),
      name: typeof r.name === "string" ? r.name : "",
      masterPlaceId: typeof r.master_place_id === "string" ? r.master_place_id : null,
      lon: parseFloat(String(raw.lon)),
      lat: parseFloat(String(raw.lat)),
    });
  }
  return out;
}

/**
 * Run phase-1 point-in-polygon over the given records.
 *
 * CA park polygons OVERLAP — a visitor point can sit inside two units at once
 * (a beach inside a natural preserve, a museum inside an adjacent fort, a park
 * inside a larger wetlands unit). Taking the first containing polygon is
 * therefore both wrong and order-dependent: measured on TEST 2026-09-02, plain
 * first-match-wins disagreed with the recorded links on exactly the 3 records
 * that have 2 containing polygons — State Indian Museum SHP (picked Sutter's
 * Fort SHP), Manchester SP (picked Brush Creek/Lagoon Lake NP), Point Dume SB
 * (picked Point Dume NP).
 *
 * So when more than one polygon contains the point, disambiguate by name using
 * the same Jaro-Winkler-over-normalizeName pairing `scoreMatch` uses, and break
 * ties on mpId so the result is deterministic regardless of row order.
 * `or-state-parks-er.ts` still has the plain first-match behaviour.
 */
function computeSpatialMatches(
  records: SourceRow[],
  polys: ParkPolygon[],
): { matched: SpatialMatch[]; unmatched: SourceRow[] } {
  const matched: SpatialMatch[] = [];
  const unmatched: SourceRow[] = [];
  for (const src of records) {
    if (Number.isNaN(src.lon) || Number.isNaN(src.lat)) {
      unmatched.push(src);
      continue;
    }
    const containing = polys.filter((p) => pointInPolygon([src.lon, src.lat], p.polygon));
    if (containing.length === 0) {
      unmatched.push(src);
      continue;
    }
    const best = containing
      .map((p) => ({ p, sim: jaroWinkler(normalizeName(src.name), normalizeName(p.canonicalName)) }))
      .sort((a, b) => b.sim - a.sim || a.p.mpId.localeCompare(b.p.mpId))[0].p;
    if (containing.length > 1) {
      logger.debug(
        { src: src.name, chose: best.canonicalName, among: containing.map((c) => c.canonicalName) },
        "ca-er: overlapping polygons — disambiguated by name",
      );
    }
    matched.push({ srcId: src.id, mpId: best.mpId, srcName: src.name, mpName: best.canonicalName });
  }
  return { matched, unmatched };
}

async function applySpatialLink(m: SpatialMatch): Promise<void> {
  const u = await sb.from("source_record").update({ master_place_id: m.mpId }).eq("id", m.srcId);
  if (u.error) throw new Error(`spatial link update failed for ${m.srcId}: ${u.error.message}`);

  const i = await sb.from("place_match").insert({
    source_record_id: m.srcId,
    master_place_id: m.mpId,
    distance_meters: 0,
    name_similarity: 0,
    category_compatibility: 0,
    combined_confidence: 1.0,
    match_method: "spatial_containment",
    status: "confirmed",
    resolved_by: RESOLVED_BY,
    resolved_at: new Date().toISOString(),
    notes: `Spatial pre-link: ${m.srcName} → ${m.mpName}`,
  });
  if (i.error && !i.error.message.includes("duplicate")) {
    throw new Error(`place_match insert failed: ${i.error.message}`);
  }

  const r = await sb.rpc("recompute_master_place", { p_master_place_id: m.mpId });
  if (r.error) logger.warn({ err: r.error, mpId: m.mpId }, "ca-er: recompute_master_place returned error");
}

// ───── --verify ───────────────────────────────────────────────────────

/**
 * Diff freshly-computed phase-1 proposals against the `spatial_containment`
 * rows already in `place_match`. Writes nothing.
 */
async function verify(polys: ParkPolygon[]): Promise<void> {
  const all = await fetchSourceRecords(false);
  logger.info({ records: all.length }, "ca-er/verify: source_records under test");

  const { matched } = computeSpatialMatches(all, polys);

  // Ground truth: existing spatial_containment confirmations.
  const truth = new Map<string, string>();
  const ids = all.map((r) => r.id);
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb
      .from("place_match")
      .select("source_record_id, master_place_id, match_method, status")
      .in("source_record_id", ids.slice(i, i + 200))
      .eq("match_method", "spatial_containment")
      .eq("status", "confirmed");
    if (r.error || r.data == null) throw new Error(`verify fetch failed: ${JSON.stringify(r.error)}`);
    for (const row of r.data) truth.set(String(row.source_record_id), String(row.master_place_id));
  }

  const proposed = new Map(matched.map((m) => [m.srcId, m.mpId]));
  let agree = 0;
  const disagree: string[] = [];
  const missing: string[] = []; // in truth, not re-derived
  const extra: string[] = []; // re-derived, not in truth

  for (const [srcId, mpId] of truth) {
    const p = proposed.get(srcId);
    if (p == null) missing.push(srcId);
    else if (p === mpId) agree += 1;
    else disagree.push(srcId);
  }
  for (const srcId of proposed.keys()) if (!truth.has(srcId)) extra.push(srcId);

  console.log("\n──────── phase-1 re-derivation vs recorded ground truth ────────");
  console.log(`  polygons in substrate        : ${polys.length}`);
  console.log(`  CA source_records tested     : ${all.length}`);
  console.log(`  recorded spatial_containment : ${truth.size}`);
  console.log(`  re-derived matches           : ${proposed.size}`);
  console.log(`  AGREE (same src → same mp)   : ${agree}`);
  console.log(`  DISAGREE (different mp)      : ${disagree.length}`);
  console.log(`  MISSING (recorded, not found): ${missing.length}`);
  console.log(`  EXTRA (found, not recorded)  : ${extra.length}`);
  if (disagree.length) console.log(`    disagree ids: ${JSON.stringify(disagree.slice(0, 10))}`);
  if (missing.length) console.log(`    missing ids : ${JSON.stringify(missing.slice(0, 10))}`);
  if (extra.length) console.log(`    extra ids   : ${JSON.stringify(extra.slice(0, 10))}`);
  console.log(
    `\n  VERDICT: ${agree === truth.size && disagree.length === 0 && missing.length === 0
      ? "phase 1 reproduces the recorded spatial_containment set exactly"
      : "phase 1 DIVERGES from the recorded set — investigate before applying"}`,
  );
}

// ───── Main ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info({ dryRun: DRY_RUN, verify: VERIFY, sourceId: SOURCE_ID }, "ca-er: starting");

  const polys = await fetchCaParkPolygons();

  if (VERIFY) {
    await verify(polys);
    return;
  }

  const unlinked = await fetchSourceRecords(true);
  logger.info({ unlinked: unlinked.length }, "ca-er: fetched unlinked source_records");
  if (unlinked.length === 0) {
    logger.info({}, "ca-er: nothing unlinked — no work. (Use --verify to re-derive phase 1.)");
    return;
  }

  const { matched, unmatched } = computeSpatialMatches(unlinked, polys);
  logger.info(
    { spatialLinked: matched.length, remaining: unmatched.length },
    "ca-er: phase 1 spatial pre-link result",
  );

  if (!DRY_RUN) {
    for (const m of matched) {
      try {
        await applySpatialLink(m);
      } catch (err) {
        logger.error({ err, match: m }, "ca-er: spatial link apply failed");
      }
    }
  }
  logger.info({ applied: DRY_RUN ? 0 : matched.length, dryRun: DRY_RUN }, "ca-er: phase 1 apply complete");

  if (unmatched.length === 0) {
    logger.info({}, "ca-er: nothing left for phase 2");
    return;
  }

  logger.info({ n: unmatched.length }, "ca-er: phase 2 — matchAll on the remainder");
  const outcomes = await matchAll(unmatched.map((m) => m.id));
  logger.info({ outcomes: outcomes.length }, "ca-er: matchAll returned");

  if (DRY_RUN) {
    const byKind: Record<string, number> = {};
    for (const o of outcomes) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
    logger.info({ byKind }, "ca-er: dry-run — outcome breakdown (not applied)");
    return;
  }

  const result = await applyMatches(outcomes);
  logger.info({ result }, "ca-er: applyMatches complete");
}

main().catch((e: unknown) => {
  logger.error({ err: e }, "ca-er: fatal");
  process.exit(1);
});
