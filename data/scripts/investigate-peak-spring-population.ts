/**
 * Read-only, TEST-only: verify whether peak (33,457) and spring (30,848)
 * master_place counts are real or inflated by a duplication/scoping bug,
 * before a pending decision to remove these categories from the corpus.
 *
 * Checks, in order:
 *   1. Duplicate osm external_ids within peak/spring (should be zero — the
 *      upsert is keyed on (source_id, external_id), so a true duplicate
 *      here would mean the write path itself is broken, not just a
 *      scoping artifact).
 *   2. fetch_timestamp distribution — does it cluster around the
 *      documented six-state OSM natural-family campaign, or show a
 *      different/earlier origin (e.g. an old corridor-bbox run)?
 *   3. Geographic bounds — do any peak/spring points fall outside the six
 *      target states' bounding boxes? (--iso area-scoping uses the real
 *      state polygon, so genuine leakage would be a strong scoping-bug
 *      signal; --bbox rectangles commonly spill over.)
 *   4. Near-duplicate detection within ~50m — grid-bucketed (not O(n^2))
 *      proximity check per category, catching same-node-twice or
 *      same-physical-feature-two-OSM-nodes cases.
 *   5. Random sample of 20 peak + 20 spring rows for manual inspection.
 *
 * NOT modifying anything.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const PAGE = 1000;
const CATEGORIES = ["peak", "spring"];

// Generous (rectangular, approximate) six-state bounding boxes — same
// classifier shape as measure-llm-eligibility.ts's classifyState(), used
// here only as a coarse "is this even remotely in scope" check, not a
// precise state-boundary test.
const STATE_BBOXES: Record<string, [number, number, number, number]> = {
  // [west, south, east, north]
  AZ: [-114.82, 31.333, -109.045, 37.0],
  UT: [-114.05, 37.0, -109.04, 42.0],
  NV: [-120.01, 35.0, -114.04, 42.0],
  WA: [-124.85, 45.85, -117.04, 49.0],
  OR: [-124.75, 41.99, -116.45, 46.30],
  CA: [-124.50, 32.534, -114.13, 42.01],
};

function inAnyState(lng: number, lat: number): boolean {
  return Object.values(STATE_BBOXES).some(
    ([w, s, e, n]) => lng >= w && lng <= e && lat >= s && lat <= n,
  );
}

type MPRow = { id: string; canonical_name: string; lng: number; lat: number };

async function fetchCategoryRows(db: SupabaseClient, category: string): Promise<MPRow[]> {
  const mps: { id: string; canonical_name: string }[] = [];
  let from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, canonical_name")
      .eq("primary_category", category).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    mps.push(...(r.data as any[]));
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  const geo = new Map<string, { lng: number; lat: number }>();
  const GEO_CHUNK = 200;
  for (let i = 0; i < mps.length; i += GEO_CHUNK) {
    const chunk = mps.slice(i, i + GEO_CHUNK).map((m) => m.id);
    const r = await db.from("master_place_search_export").select("id, lng, lat").in("id", chunk);
    if (r.error || r.data == null) { console.error("QUERY FAILED (geo):", r); throw new Error(""); }
    for (const row of r.data as any[]) geo.set(row.id, { lng: row.lng, lat: row.lat });
  }
  const out: MPRow[] = [];
  for (const m of mps) {
    const g = geo.get(m.id);
    if (g) out.push({ id: m.id, canonical_name: m.canonical_name, lng: g.lng, lat: g.lat });
  }
  return out;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Grid-bucketed near-duplicate search — O(n) not O(n^2). Bucket size
 *  (~0.001deg, ~90-110m at these latitudes) is a superset of the true 50m
 *  threshold; haversineM enforces the real cutoff on candidate pairs. */
function findNearDuplicates(rows: MPRow[], thresholdM: number): { a: MPRow; b: MPRow; distM: number }[] {
  const CELL = 0.001;
  const buckets = new Map<string, MPRow[]>();
  const cellKey = (lng: number, lat: number) => `${Math.floor(lng / CELL)}:${Math.floor(lat / CELL)}`;
  for (const r of rows) {
    const k = cellKey(r.lng, r.lat);
    const arr = buckets.get(k) ?? [];
    arr.push(r);
    buckets.set(k, arr);
  }
  const pairs: { a: MPRow; b: MPRow; distM: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const [cx, cy] = [Math.floor(r.lng / CELL), Math.floor(r.lat / CELL)];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = buckets.get(`${cx + dx}:${cy + dy}`) ?? [];
        for (const other of neighbors) {
          if (other.id === r.id) continue;
          const pairKey = [r.id, other.id].sort().join("|");
          if (seen.has(pairKey)) continue;
          const d = haversineM([r.lng, r.lat], [other.lng, other.lat]);
          if (d <= thresholdM) {
            seen.add(pairKey);
            pairs.push({ a: r, b: other, distM: d });
          }
        }
      }
    }
  }
  return pairs;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db = createClient(url, key, { auth: { persistSession: false } });

  for (const category of CATEGORIES) {
    console.log(`\n\n======== ${category.toUpperCase()} ========`);

    // ── 1. External-id duplicate check ──
    const extIds: string[] = [];
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("external_id, master_place_id, fetch_timestamp")
        .eq("source_id", "osm").eq("inferred_category", category)
        .order("id").range(from, from + PAGE - 1);
      if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
      for (const row of r.data as any[]) extIds.push(row.external_id);
      if (r.data.length < PAGE) break;
      from += PAGE;
    }
    const extIdCounts = new Map<string, number>();
    for (const id of extIds) extIdCounts.set(id, (extIdCounts.get(id) ?? 0) + 1);
    const dupExtIds = [...extIdCounts.entries()].filter(([, c]) => c > 1);
    console.log(`  [1] total osm source_records (any is_active): ${extIds.length}`);
    console.log(`      distinct external_ids: ${extIdCounts.size}`);
    console.log(`      DUPLICATE external_ids (should be 0): ${dupExtIds.length}`);
    if (dupExtIds.length > 0) console.log("      samples:", dupExtIds.slice(0, 5));

    // ── 2. fetch_timestamp distribution ──
    from = 0;
    const timestamps: string[] = [];
    while (true) {
      const r = await db.from("source_record").select("fetch_timestamp")
        .eq("source_id", "osm").eq("inferred_category", category).eq("is_active", true)
        .order("id").range(from, from + PAGE - 1);
      if (r.error || r.data == null) { console.error("QUERY FAILED (ts):", r); throw new Error(""); }
      for (const row of r.data as any[]) timestamps.push(row.fetch_timestamp);
      if (r.data.length < PAGE) break;
      from += PAGE;
    }
    const days = new Map<string, number>();
    for (const t of timestamps) {
      const day = t.slice(0, 10);
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    console.log(`  [2] active source_record fetch_timestamp by day:`);
    for (const [day, count] of [...days.entries()].sort()) console.log(`      ${day}: ${count}`);

    // ── 3. Geographic bounds ──
    const rows = await fetchCategoryRows(db, category);
    const outside = rows.filter((r) => !inAnyState(r.lng, r.lat));
    console.log(`  [3] master_place rows with geometry: ${rows.length}`);
    console.log(`      OUTSIDE all six state bboxes: ${outside.length} (${((outside.length / rows.length) * 100).toFixed(2)}%)`);
    if (outside.length > 0) console.log("      samples:", outside.slice(0, 5).map((r) => `${r.canonical_name} @ ${r.lng},${r.lat}`));

    // ── 4. Near-duplicate detection ──
    const dupes = findNearDuplicates(rows, 50);
    console.log(`  [4] near-duplicate pairs within 50m: ${dupes.length} (of ${rows.length} rows)`);
    for (const p of dupes.slice(0, 10)) {
      console.log(`      "${p.a.canonical_name}" (${p.a.id}) <-> "${p.b.canonical_name}" (${p.b.id})  ${p.distM.toFixed(1)}m`);
    }

    // ── 5. Random sample ──
    const shuffled = [...rows].sort(() => Math.random() - 0.5).slice(0, 20);
    writeFileSync(
      `../.context/measurements/sample-${category}-20.json`,
      JSON.stringify(shuffled, null, 2),
    );
    console.log(`  [5] wrote 20-row random sample to .context/measurements/sample-${category}-20.json`);

    // Extra: full duplicate pair export for further inspection if any found.
    if (dupes.length > 0) {
      writeFileSync(
        `../.context/measurements/near-duplicates-${category}.json`,
        JSON.stringify(dupes, null, 2),
      );
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
