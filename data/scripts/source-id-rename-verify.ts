/**
 * READ-ONLY post-rename verification for
 *   state_parks_web    → california_state_parks
 *   state_parks_web_wa → washington_state_parks
 *
 * Checks the surfaces the rename could plausibly break:
 *   - master_place_search_export still exposes the renamed sources' photos
 *     (the view's lateral join CASE/IN lists name source_ids literally)
 *   - pois_along_corridor still executes and still returns those photos
 *
 * Corridors are deliberately SCOPED to the state under test. A continent-wide
 * route hits the RPC's row cap long before reaching CA/WA parks and reports 0
 * whether the lateral works or not — a check that cannot fail is not evidence.
 *
 * Usage (from data/):
 *   npx tsx --env-file=.env scripts/source-id-rename-verify.ts        # TEST
 *   npx tsx --env-file=.env scripts/source-id-rename-verify.ts prod   # PROD (read-only)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const parse = (p: string) => Object.fromEntries(readFileSync(p, "utf8").split(/\r?\n/)
  .map(l => l.trim()).filter(l => l && !l.startsWith("#") && l.includes("="))
  .map(l => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));

const which = process.argv[2] === "prod" ? "prod" : "test";
const cfg = which === "prod" ? parse(join(REPO, "web", ".env.local")) : parse(join(REPO, "data", ".env"));
const url = which === "prod" ? cfg.NEXT_PUBLIC_SUPABASE_URL : cfg.SUPABASE_URL;
const expect = which === "prod" ? "nqzeywzcowujzyegxbsr" : "znldzjdatkogdktymtvi";
if (!url.includes(expect)) throw new Error(`refusing: ${url} is not ${which}`);
const db = createClient(url, cfg.SUPABASE_SERVICE_ROLE_KEY);
console.log(`[${which.toUpperCase()}] ${url}\n`);

for (const src of ["california_state_parks", "washington_state_parks"]) {
  const srs = await db.from("source_record").select("master_place_id")
    .eq("source_id", src).not("master_place_id", "is", null).limit(1000);
  const ids = [...new Set((srs.data ?? []).map((r: any) => r.master_place_id))];
  if (ids.length === 0) { console.log(`${src}: no linked master_places here\n`); continue; }
  let inView = 0, withPhoto = 0; const hosts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 200) {
    const r = await db.from("master_place_search_export").select("id,photo_url").in("id", ids.slice(i, i + 200));
    if (r.error) throw new Error(JSON.stringify(r.error));
    for (const row of (r.data ?? []) as any[]) {
      inView++;
      if (row.photo_url) { withPhoto++; const h = new URL(row.photo_url).hostname; hosts.set(h, (hosts.get(h) ?? 0) + 1); }
    }
  }
  console.log(`${src}: linked mps ${ids.length} · in export view ${inView} · with photo ${withPhoto}`);
  console.log(`   photo hosts: ${JSON.stringify(Object.fromEntries([...hosts].sort((a,b)=>b[1]-a[1])))}\n`);
}

// Corridor RPC must still execute after the CREATE OR REPLACE chain.
// Corridors are scoped to the states under test - a continent-wide route hits
// the row cap long before reaching CA/WA parks, so it would report 0 whether
// the lateral worked or not.
const CORRIDORS = [
  { label: "CA Big Sur  Monterey->Cambria", host: "parks.ca.gov",
    route: { type: "LineString", coordinates: [[-121.90, 36.60], [-121.80, 36.25], [-121.30, 35.80]] }, buffer: 12000 },
  { label: "WA        Seattle->Spokane", host: "parks.wa.gov",
    route: { type: "LineString", coordinates: [[-122.33, 47.61], [-119.0, 47.5], [-117.42, 47.66]] }, buffer: 40000 },
];
for (const c of CORRIDORS) {
  const rpc = await db.rpc("pois_along_corridor", { p_route: c.route, p_buffer_m: (c as any).buffer ?? 40000, p_categories: null });
  if (rpc.error) throw new Error(`pois_along_corridor FAILED: ${JSON.stringify(rpc.error)}`);
  const rows = (rpc.data ?? []) as any[];
  const photo = rows.filter(r => r.nps_photo_url);
  const hit = photo.filter(r => String(r.nps_photo_url).includes(c.host));
  console.log(`pois_along_corridor [${c.label}]: OK - ${rows.length} rows, ${photo.length} with photo, ${hit.length} from ${c.host}`);
  for (const r of hit.slice(0, 2)) console.log(`     e.g. ${r.canonical_name} -> ${String(r.nps_photo_url).slice(0, 78)}`);
}
