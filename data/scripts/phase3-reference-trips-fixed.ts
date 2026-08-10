/** PROD READ-only: reference_trips with the CORRECT column names, plus
 *  proper error handling. Also does the 26 BC-edge spot-check + 8 USFS
 *  no-MP raw_payload inspection. */
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

  // ─── 1a. Wrong column name test — reproduce the earlier bug ────────
  console.log(`─── reproducing prior bug (SELECT with wrong column 'name') ───`);
  const bad = await db.from("reference_trips").select("id, name");
  console.log(`  error   : ${JSON.stringify(bad.error)}`);
  console.log(`  data    : ${JSON.stringify(bad.data)}`);
  console.log(`  status  : ${(bad as any).status}`);

  // ─── 1b. CORRECT column names ─────────────────────────────────────
  console.log(`\n─── correct SELECT (id, title, source_version, updated_at) ───`);
  const good = await db.from("reference_trips").select("id, title, source_version, updated_at");
  console.log(`  error   : ${JSON.stringify(good.error)}`);
  console.log(`  rows returned: ${good.data?.length ?? 0}`);
  for (const r of (good.data ?? []) as any[]) {
    console.log(`    ${r.id.padEnd(24)}  title="${r.title}"  version="${r.source_version}"  updated=${r.updated_at}`);
  }

  // ─── 1c. Per-payload coord scope check ────────────────────────────
  console.log(`\n─── per-payload scope check ───`);
  for (const r of (good.data ?? []) as any[]) {
    const { data, error } = await db.from("reference_trips").select("payload").eq("id", r.id).maybeSingle();
    if (error) { console.log(`  ${r.id}  ERROR: ${error.message}`); continue; }
    const txt = data?.payload ? JSON.stringify(data.payload) : "";
    const size = txt.length;
    const coordRe = /\[\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*\]/g;
    let inS = 0, outS = 0;
    const outLocs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = coordRe.exec(txt)) !== null) {
      const lng = Number(m[1]), lat = Number(m[2]);
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      if (Math.abs(lng) < 90 && Math.abs(lat) > 90) continue;
      if (inFootprint(lng, lat)) inS++;
      else { outS++; if (outLocs.length < 3) outLocs.push(`[${lng.toFixed(3)},${lat.toFixed(3)}]`); }
    }
    console.log(`  ${r.id.padEnd(24)}  payload=${size.toLocaleString()}b  in-scope=${inS}  out-scope=${outS}${outS > 0 ? "  first-3-out: " + outLocs.join(" ") : ""}`);
  }

  // ─── 2. Codebase readers of reference_trips (grep-side, no live query needed) ──
  // Grep is deferred to caller/user — this script just does the DB reads.

  // ─── 3. 26 BC-edge rows spot-check ────────────────────────────────
  console.log(`\n─── 26 BC-edge rows (in-scope classification) ───`);
  const bcSources = ["bc_rec_sites_poly", "bc_rec_sites_points_highvalue", "bc_rest_areas"];
  const bcRows: any[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, source_id, external_id, name, master_place_id, raw_payload, normalized_payload")
      .in("source_id", bcSources)
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as any[];
    if (batch.length === 0) break;
    bcRows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  const mpIds = [...new Set(bcRows.map((r) => r.master_place_id).filter((x) => !!x))];
  const mpCoords = new Map<string, { lng: number; lat: number; canonical_name: string; primary_category: string }>();
  const chunk = 200;
  for (let i = 0; i < mpIds.length; i += chunk) {
    const slice = mpIds.slice(i, i + chunk);
    const [geoRes, baseRes] = await Promise.all([
      db.from("master_place_search_export").select("id, lng, lat").in("id", slice),
      db.from("master_place").select("id, canonical_name, primary_category").in("id", slice),
    ]);
    const nameById = new Map((baseRes.data ?? []).map((r: any) => [r.id, { canonical_name: r.canonical_name, primary_category: r.primary_category }]));
    for (const r of (geoRes.data ?? []) as any[]) {
      const meta = nameById.get(r.id) ?? { canonical_name: "?", primary_category: "?" };
      mpCoords.set(r.id, { lng: r.lng, lat: r.lat, ...meta });
    }
  }
  const inScopeBc: any[] = [];
  for (const r of bcRows) {
    if (!r.master_place_id) continue;
    const mp = mpCoords.get(r.master_place_id);
    if (!mp) continue;
    const state = inFootprint(mp.lng, mp.lat);
    if (state) inScopeBc.push({ ...r, mp, state });
  }
  console.log(`  found ${inScopeBc.length} in-scope BC-edge rows`);
  for (const r of inScopeBc) {
    console.log(`    ${r.source_id.padEnd(32)} state=${r.state}  coords=[${r.mp.lng.toFixed(4)}, ${r.mp.lat.toFixed(4)}]  MP="${r.mp.canonical_name}" (${r.mp.primary_category})   ext=${r.external_id}`);
  }

  // ─── 4. USFS 8 no-MP rows — full raw_payload inspection ──────────
  console.log(`\n─── USFS no-MP rows — raw_payload structure + coord evidence ───`);
  const usfsRows: any[] = [];
  from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("id, external_id, name, master_place_id, raw_payload, normalized_payload, geometry")
      .eq("source_id", "usfs")
      .order("id")
      .range(from, from + size - 1);
    if (error) throw error;
    const batch = (data ?? []) as any[];
    if (batch.length === 0) break;
    usfsRows.push(...batch);
    if (batch.length < size) break;
    from += size;
  }
  const usfsNoMp = usfsRows.filter((r) => r.master_place_id == null);
  console.log(`  usfs total=${usfsRows.length}  no-MP=${usfsNoMp.length}`);
  for (const r of usfsNoMp) {
    const rawKeys = Object.keys(r.raw_payload ?? {}).join(",");
    const props = r.raw_payload?.props ?? {};
    const propKeys = Object.keys(props).slice(0, 15).join(",");
    const geomAttr = r.geometry;
    console.log(`\n  ─ ${r.id}`);
    console.log(`    external_id : ${r.external_id}`);
    console.log(`    name        : ${r.name}`);
    console.log(`    raw keys    : ${rawKeys}`);
    console.log(`    props keys  : ${propKeys}`);
    // Check for any coord-like data
    const rawTxt = JSON.stringify(r.raw_payload ?? {});
    const coordRe = /-?\d+\.\d+/g;
    const nums = rawTxt.match(coordRe) ?? [];
    console.log(`    numeric tokens in raw_payload: ${nums.length}   sample: ${nums.slice(0, 6).join(", ")}${nums.length > 6 ? "..." : ""}`);
    // Point geometry column has an EWKB hex encoding via PostgREST — presence signals a point
    console.log(`    geometry column present: ${geomAttr ? "yes (EWKB) — this is a POINT/LINE/etc encoded" : "no"}`);
    console.log(`    normalized_payload keys: ${Object.keys(r.normalized_payload ?? {}).join(",")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
