/** PROD READ-only final verification for the six-state narrowing.
 *  1) trips row count
 *  2) reference_trips: count vs id-only vs one-by-one payload fetch
 *  3) 105 no-coords rows (82 nps + 20 usfs + 3 curated_fuel) classified
 *     via master_place_search_export view (which has lng/lat if linked)
 *     or raw_payload structure inspection
 *  4) Final deactivation set counts by source_id + affected MP delta
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME!;
const PROD_ENV = join(HOME, ".config/overlander/env-backups/.env.production-backup");

function parseEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
  return out;
}

const STATE_BBOXES: Record<string, [number, number, number, number]> = {
  WA: [-124.85, 45.55, -116.90, 49.00],
  OR: [-124.75, 42.00, -116.45, 46.30],
  CA: [-124.50, 32.53, -114.13, 42.01],
  AZ: [-114.82, 31.33, -109.05, 37.00],
  NV: [-120.01, 35.00, -114.04, 42.00],
  UT: [-114.05, 37.00, -109.04, 42.00],
};
function inFootprint(lng: number, lat: number): string | null {
  for (const [state, [w, s, e, n]] of Object.entries(STATE_BBOXES)) {
    if (lng >= w && lng <= e && lat >= s && lat <= n) return state;
  }
  return null;
}

async function main() {
  const prodEnv = parseEnv(PROD_ENV);
  const url = prodEnv.SUPABASE_URL;
  const key = prodEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!url?.includes("nqzeywzcowujzyegxbsr")) throw new Error("PROD env not PROD");
  const db = createClient(url, key!, { auth: { persistSession: false } });
  console.log(`[env] PROD ${url.match(/\/\/([^.]+)\./)?.[1]}\n`);

  // ─── 1. trips row count ────────────────────────────────────────────
  console.log(`─── 1. trips ───`);
  const tripsCount = await db.from("trips").select("id", { count: "exact", head: true });
  console.log(`  trips row count (head-only) : ${tripsCount.count}`);
  const tripsList = await db.from("trips").select("id");
  console.log(`  trips SELECT id             : ${tripsList.data?.length ?? "(null)"}`);
  if ((tripsList.data?.length ?? 0) > 0) {
    console.log(`  ids: ${(tripsList.data ?? []).map((t: any) => t.id).join(", ")}`);
  }

  // ─── 2. reference_trips ────────────────────────────────────────────
  console.log(`\n─── 2. reference_trips ───`);
  const rtCount = await db.from("reference_trips").select("id", { count: "exact", head: true });
  console.log(`  reference_trips count (head-only) : ${rtCount.count}`);
  const rtIds = await db.from("reference_trips").select("id, name");
  console.log(`  reference_trips id/name (SELECT no payload) : ${rtIds.data?.length ?? "(null)"} rows`);
  for (const r of (rtIds.data ?? []) as any[]) {
    console.log(`    ${r.id}  name="${r.name ?? ""}"`);
  }
  // One-by-one payload fetch to sidestep any large-row SELECT issue
  console.log(`  fetching each payload individually:`);
  for (const r of (rtIds.data ?? []) as any[]) {
    const { data, error } = await db.from("reference_trips").select("payload").eq("id", r.id).maybeSingle();
    if (error) { console.log(`    ${r.id}  ERROR: ${error.message}`); continue; }
    const payloadSize = data?.payload ? JSON.stringify(data.payload).length : 0;
    // Extract coords from payload text and classify
    const txt = data?.payload ? JSON.stringify(data.payload) : "";
    const coordRe = /\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/g;
    let inScope = 0, outScope = 0;
    let m: RegExpExecArray | null;
    while ((m = coordRe.exec(txt)) !== null) {
      const lng = Number(m[1]), lat = Number(m[2]);
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      if (Math.abs(lng) < 90 && Math.abs(lat) > 90) continue;
      if (inFootprint(lng, lat)) inScope++; else outScope++;
    }
    console.log(`    ${r.id}  payload=${payloadSize}b  in-scope=${inScope}  out-scope=${outScope}`);
  }

  // ─── 3. no-coords rows classified via master_place_search_export ────
  console.log(`\n─── 3. classify 82 NPS + 20 usfs + 3 curated_fuel via MP view ───`);
  const targetSources = ["nps", "usfs", "curated_fuel"];
  const rows: { id: string; source_id: string; master_place_id: string | null; raw_payload: any }[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, source_id, master_place_id, raw_payload")
      .in("source_id", targetSources)
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof rows;
    if (batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  console.log(`  fetched ${rows.length} rows across ${targetSources.join(", ")}`);

  // Existing extractor from earlier script (for reference)
  const extractOld = (r: any): [number, number] | null => {
    const nc = r.normalized_payload?.coords;
    if (Array.isArray(nc) && nc.length >= 2) return [Number(nc[0]), Number(nc[1])];
    const el = r.raw_payload?.element;
    if (el?.lat != null && el?.lon != null) return [Number(el.lon), Number(el.lat)];
    const p = r.raw_payload?.place ?? r.raw_payload?.campground ?? r.raw_payload?.park ?? r.raw_payload?.recarea ?? r.raw_payload?.facility;
    if (p?.latitude != null && p?.longitude != null) return [Number(p.longitude), Number(p.latitude)];
    if (p?.FacilityLatitude != null && p?.FacilityLongitude != null) return [Number(p.FacilityLongitude), Number(p.FacilityLatitude)];
    return null;
  };
  const stillNoCoords = rows.filter((r) => extractOld(r as any) === null);
  console.log(`  still-no-coords after old extractor: ${stillNoCoords.length}`);

  // For each still-no-coords row, look up its master_place in the search-export view
  const mpIds = [...new Set(stillNoCoords.map((r) => r.master_place_id).filter((x): x is string => !!x))];
  const mpCoords = new Map<string, { lng: number; lat: number }>();
  const chunk = 200;
  for (let i = 0; i < mpIds.length; i += chunk) {
    const slice = mpIds.slice(i, i + chunk);
    const { data } = await db.from("master_place_search_export").select("id, lng, lat").in("id", slice);
    for (const r of (data ?? []) as any[]) mpCoords.set(r.id, { lng: r.lng, lat: r.lat });
  }

  const bySource: Record<string, { in: number; out: number; unlinked: number; totalRaw: number; sampleTags: string[] }> = {};
  for (const r of stillNoCoords) {
    const b = bySource[r.source_id] ?? { in: 0, out: 0, unlinked: 0, totalRaw: 0, sampleTags: [] };
    b.totalRaw += 1;
    if (r.master_place_id && mpCoords.has(r.master_place_id)) {
      const { lng, lat } = mpCoords.get(r.master_place_id)!;
      if (inFootprint(lng, lat)) b.in += 1; else b.out += 1;
    } else {
      b.unlinked += 1;
      // Capture a raw_payload key sample for the unlinked ones
      if (b.sampleTags.length < 3 && r.raw_payload) {
        b.sampleTags.push(Object.keys(r.raw_payload).slice(0, 5).join(","));
      }
    }
    bySource[r.source_id] = b;
  }
  for (const [src, b] of Object.entries(bySource)) {
    console.log(`  ${src.padEnd(18)}  raw=${b.totalRaw}  in-scope=${b.in}  out-scope=${b.out}  no-MP=${b.unlinked}${b.unlinked > 0 ? "   sample raw_payload keys: " + b.sampleTags.slice(0, 2).join(" | ") : ""}`);
  }

  // Same for the parks_canada + bc_* + yk_parks — by MP view lookup (should confirm out)
  console.log(`\n─── all Canadian sources — MP-view scope check ───`);
  const canSources = ["parks_canada", "bc_parks", "bc_rec_sites_poly", "bc_rec_sites_points_highvalue", "bc_rest_areas", "yk_parks_campgrounds"];
  const canRows: { id: string; source_id: string; master_place_id: string | null }[] = [];
  from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, source_id, master_place_id")
      .in("source_id", canSources)
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as typeof canRows;
    if (batch.length === 0) break;
    canRows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  const canMpIds = [...new Set(canRows.map((r) => r.master_place_id).filter((x): x is string => !!x))];
  const canMpCoords = new Map<string, { lng: number; lat: number }>();
  for (let i = 0; i < canMpIds.length; i += chunk) {
    const slice = canMpIds.slice(i, i + chunk);
    const { data } = await db.from("master_place_search_export").select("id, lng, lat").in("id", slice);
    for (const r of (data ?? []) as any[]) canMpCoords.set(r.id, { lng: r.lng, lat: r.lat });
  }
  const canBySource: Record<string, { in: number; out: number; unlinked: number; total: number }> = {};
  for (const r of canRows) {
    const b = canBySource[r.source_id] ?? { in: 0, out: 0, unlinked: 0, total: 0 };
    b.total += 1;
    if (r.master_place_id && canMpCoords.has(r.master_place_id)) {
      const { lng, lat } = canMpCoords.get(r.master_place_id)!;
      if (inFootprint(lng, lat)) b.in += 1; else b.out += 1;
    } else b.unlinked += 1;
    canBySource[r.source_id] = b;
  }
  for (const [src, b] of Object.entries(canBySource)) {
    console.log(`  ${src.padEnd(32)}  total=${b.total}  in-scope=${b.in}  out-scope=${b.out}  no-MP=${b.unlinked}`);
  }

  // ─── 4. Final deactivation set + affected MP delta ─────────────────
  console.log(`\n─── 4. FINAL DEACTIVATION SET ───`);
  // Out-scope SRs by source_id (from the first script's coord-extractable set) + Canadian sources + any usfs/curated_fuel/nps found to be out
  // Re-derive properly here from what we've measured
  const inScopeMps = new Set<string>();
  const outScopeMps = new Set<string>();

  // Coord-extractable rows: use the SAME 6-state classification the earlier script did
  // via extractOld() applied to ALL rows
  const allRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, source_id, master_place_id, raw_payload, normalized_payload")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as any[];
    if (batch.length === 0) break;
    allRows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  const bySourceOut = new Map<string, number>();
  const bySourceIn = new Map<string, number>();
  for (const r of allRows) {
    let coords: [number, number] | null = extractOld(r);
    if (!coords && r.master_place_id && mpCoords.has(r.master_place_id)) {
      const mc = mpCoords.get(r.master_place_id)!; coords = [mc.lng, mc.lat];
    }
    if (!coords && r.master_place_id && canMpCoords.has(r.master_place_id)) {
      const mc = canMpCoords.get(r.master_place_id)!; coords = [mc.lng, mc.lat];
    }
    if (!coords) {
      // Still unresolvable — treat as out-scope for a safe deactivation.
      bySourceOut.set(r.source_id, (bySourceOut.get(r.source_id) ?? 0) + 1);
      if (r.master_place_id) outScopeMps.add(r.master_place_id);
      continue;
    }
    if (inFootprint(coords[0], coords[1])) {
      bySourceIn.set(r.source_id, (bySourceIn.get(r.source_id) ?? 0) + 1);
      if (r.master_place_id) inScopeMps.add(r.master_place_id);
    } else {
      bySourceOut.set(r.source_id, (bySourceOut.get(r.source_id) ?? 0) + 1);
      if (r.master_place_id) outScopeMps.add(r.master_place_id);
    }
  }
  console.log(`  IN-SCOPE  by source_id:`);
  for (const [s, n] of [...bySourceIn].sort((a, b) => b[1] - a[1])) console.log(`    ${s.padEnd(32)} ${n}`);
  console.log(`\n  OUT-SCOPE (would deactivate) by source_id:`);
  let deactivateTotal = 0;
  for (const [s, n] of [...bySourceOut].sort((a, b) => b[1] - a[1])) { console.log(`    ${s.padEnd(32)} ${n}`); deactivateTotal += n; }
  console.log(`  ────────`);
  console.log(`  TOTAL SRs to deactivate: ${deactivateTotal}`);

  const bothMps = [...inScopeMps].filter((id) => outScopeMps.has(id));
  console.log(`\n  MPs with ≥1 in-scope SR         : ${inScopeMps.size}`);
  console.log(`  MPs with ≥1 out-scope SR        : ${outScopeMps.size}`);
  console.log(`  MPs co-linked across footprint  : ${bothMps.length}`);
  console.log(`  MPs purely in-scope             : ${inScopeMps.size - bothMps.length}`);
  console.log(`  MPs purely out-scope (drop from view) : ${outScopeMps.size - bothMps.length}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
