/**
 * READ-ONLY sizing survey for a possible human-readable address field.
 * NO external API calls of any kind (no geocoding). TEST only.
 *
 * Measures, over the in-scope corpus (master_place_search_export = searchable +
 * source_count>0 + six-state footprint), how many master_places already have
 * address-like data in EXISTING source fields, per source, and how big the
 * remaining gap is (rows that would need external reverse-geocoding).
 *
 * Address-field paths (from the 2026-08-21 shape probe):
 *   osm            raw_payload.element.tags addr:* (housenumber/street/city/state/postcode)
 *   atlas_oddities normalized_payload.address (free-form string)
 *   ridb           raw_payload.facility.FACILITYADDRESS[] (street/city/state/zip when non-empty)
 *   google         normalized_payload.formatted_address (tiny; non-compliant to persist — flagged)
 *   usfs/nps/state_parks/blm/padus/google_resolved: no structured address field
 *
 * Run: cd data && npx tsx --env-file=.env scripts/measure-address-coverage-2026-08-21.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PAGE = 1000;
function fmt(n: number) { return n.toLocaleString(); }
function pct(n: number, d: number) { return d === 0 ? "—" : `${((n / d) * 100).toFixed(1)}%`; }

type Addr = { any: boolean; streetCity: boolean; street: boolean; city: boolean; state: boolean; source: string | null };

function osmAddr(rp: any): Addr {
  const tags = rp?.element?.tags ?? rp?.tags;
  const t = (tags && typeof tags === "object" && !Array.isArray(tags)) ? tags : {};
  const street = !!(t["addr:street"]);
  const housenumber = !!(t["addr:housenumber"]);
  const city = !!(t["addr:city"]);
  const state = !!(t["addr:state"]);
  const postcode = !!(t["addr:postcode"]);
  const any = street || housenumber || city || state || postcode;
  return { any, streetCity: street && city, street: street || housenumber, city, state, source: any ? "osm" : null };
}
function atlasAddr(np: any): Addr {
  const a = np?.address;
  if (typeof a !== "string" || a.trim().length === 0) return { any: false, streetCity: false, street: false, city: false, state: false, source: null };
  const parts = a.split(",").map((s: string) => s.trim()).filter(Boolean);
  const hasState = /\b[A-Z]{2}\b/.test(a) || parts.length >= 2;
  const hasStreetNum = /\d+\s+\S/.test(parts[0] ?? "");        // leading "123 Something" => street line
  // free-form: "complete" heuristic = a street-ish first part + >=3 comma parts (street, city, state[/zip])
  const streetCity = hasStreetNum && parts.length >= 3;
  return { any: true, streetCity, street: hasStreetNum, city: parts.length >= 2, state: hasState, source: "atlas_oddities" };
}
function ridbAddr(rp: any): Addr {
  const fa = rp?.facility?.FACILITYADDRESS;
  if (!Array.isArray(fa) || fa.length === 0) return { any: false, streetCity: false, street: false, city: false, state: false, source: null };
  const a = fa[0] ?? {};
  const street = !!(a.FacilityStreetAddress1 && String(a.FacilityStreetAddress1).trim());
  const city = !!(a.City && String(a.City).trim());
  const state = !!((a.AddressStateCode ?? a.StateCode) && String(a.AddressStateCode ?? a.StateCode).trim());
  const any = street || city || state || !!(a.PostalCode);
  return { any, streetCity: street && city, street, city, state, source: any ? "ridb" : null };
}
function googleAddr(np: any): Addr {
  const a = np?.formatted_address;
  if (typeof a !== "string" || a.trim().length === 0) return { any: false, streetCity: false, street: false, city: false, state: false, source: null };
  const parts = a.split(",").map((s: string) => s.trim()).filter(Boolean);
  return { any: true, streetCity: parts.length >= 3, street: /\d+\s+\S/.test(parts[0] ?? ""), city: parts.length >= 2, state: /\b[A-Z]{2}\b/.test(a), source: "google" };
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  console.log(`Run: ${new Date().toISOString()}\n`);

  // ── in-scope set (export view) + category/state from master_place ──
  const inScope = new Set<string>();
  let from = 0;
  while (true) {
    const r = await db.from("master_place_search_export").select("id").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (export):", r); throw new Error(""); }
    for (const row of r.data as any[]) inScope.add(row.id);
    if (r.data.length < PAGE) break; from += PAGE;
  }
  console.log(`In-scope master_place (export view = searchable + source_count>0 + six-state footprint): ${fmt(inScope.size)}`);

  const cat = new Map<string, string>();
  const st = new Map<string, string | null>();
  from = 0;
  while (true) {
    const r = await db.from("master_place").select("id, primary_category, state").order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (mp):", r); throw new Error(""); }
    for (const row of r.data as any[]) if (inScope.has(row.id)) { cat.set(row.id, row.primary_category); st.set(row.id, row.state); }
    if (r.data.length < PAGE) break; from += PAGE;
  }

  // ── per-MP aggregation + per-source SR-level tallies ──
  type MPAgg = { any: boolean; streetCity: boolean; sources: Set<string> };
  const mp = new Map<string, MPAgg>();
  for (const id of inScope) mp.set(id, { any: false, streetCity: false, sources: new Set() });

  // per-source SR tallies (only SRs linked to an in-scope MP)
  const srTotal = new Map<string, number>();
  const srAny = new Map<string, number>();
  const srStreetCity = new Map<string, number>();
  const inc = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

  from = 0;
  let scanned = 0;
  while (true) {
    const r = await db.from("source_record")
      .select("master_place_id, source_id, normalized_payload, raw_payload")
      .eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr):", r); throw new Error(""); }
    for (const row of r.data as any[]) {
      const mid = row.master_place_id;
      if (!mid || !inScope.has(mid)) continue;
      scanned++;
      const src = row.source_id as string;
      inc(srTotal, src);
      let a: Addr;
      if (src === "osm") a = osmAddr(row.raw_payload);
      else if (src === "atlas_oddities") a = atlasAddr(row.normalized_payload);
      else if (src === "ridb") a = ridbAddr(row.raw_payload);
      else if (src === "google") a = googleAddr(row.normalized_payload);
      else a = { any: false, streetCity: false, street: false, city: false, state: false, source: null };
      if (a.any) {
        inc(srAny, src);
        const agg = mp.get(mid)!;
        agg.any = true; agg.sources.add(src);
        if (a.streetCity) { agg.streetCity = true; inc(srStreetCity, src); }
      }
    }
    if (r.data.length < PAGE) break; from += PAGE;
    if (from % 20000 === 0) process.stderr.write(`  … sr ${from}\n`);
  }
  console.log(`Active source_record rows linked to in-scope MPs scanned: ${fmt(scanned)}\n`);

  // ── per-source coverage table ──
  console.log(`== PER-SOURCE address-field coverage (active source_record level, in-scope MPs only) ==`);
  console.log(`  source           SRs     any-addr   (%)      street+city  (%)`);
  const sources = [...srTotal.keys()].sort((a, b) => (srTotal.get(b)! - srTotal.get(a)!));
  for (const s of sources) {
    const tot = srTotal.get(s)!, any = srAny.get(s) ?? 0, sc = srStreetCity.get(s) ?? 0;
    console.log(`  ${s.padEnd(16)} ${fmt(tot).padStart(7)}  ${fmt(any).padStart(8)}  ${pct(any, tot).padStart(6)}   ${fmt(sc).padStart(9)}  ${pct(sc, tot).padStart(6)}`);
  }

  // ── MP-level rollup ──
  let mpAny = 0, mpStreetCity = 0;
  for (const agg of mp.values()) { if (agg.any) mpAny++; if (agg.streetCity) mpStreetCity++; }
  console.log(`\n== MP-LEVEL (in-scope = ${fmt(inScope.size)}) ==`);
  console.log(`  MPs with ANY address token from any source:        ${fmt(mpAny)}  (${pct(mpAny, inScope.size)})`);
  console.log(`  MPs with a street+city (complete-ish) address:     ${fmt(mpStreetCity)}  (${pct(mpStreetCity, inScope.size)})`);

  // ── GAP: MPs with no address token at all ──
  const gap: string[] = [];
  for (const [id, agg] of mp) if (!agg.any) gap.push(id);
  console.log(`\n== GAP (in-scope MPs with NO address token in any existing source) ==`);
  console.log(`  gap count: ${fmt(gap.length)}  (${pct(gap.length, inScope.size)} of in-scope)`);

  // gap by dominant source set: which single source is on the MP (most gap MPs are single-source)
  // Reconstruct which sources each gap MP has from the SR scan is not stored; recompute a source-set map cheaply:
  // We only kept sources on MPs that had an address. Recompute source membership for gap MPs via a second light pass.
  const srcSet = new Map<string, Set<string>>();
  for (const id of gap) srcSet.set(id, new Set());
  from = 0;
  while (true) {
    const r = await db.from("source_record").select("master_place_id, source_id").eq("is_active", true).order("id").range(from, from + PAGE - 1);
    if (r.error || r.data == null) { console.error("QUERY FAILED (sr2):", r); throw new Error(""); }
    for (const row of r.data as any[]) { const s = srcSet.get(row.master_place_id); if (s) s.add(row.source_id); }
    if (r.data.length < PAGE) break; from += PAGE;
  }
  const gapBySource = new Map<string, number>();
  for (const id of gap) {
    const s = srcSet.get(id)!;
    const key = s.size === 1 ? [...s][0] : "multi:" + [...s].sort().join("+");
    gapBySource.set(key, (gapBySource.get(key) ?? 0) + 1);
  }
  console.log(`\n  gap by source composition (top 15):`);
  for (const [k, v] of [...gapBySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`    ${k.padEnd(28)} ${fmt(v)}`);

  // gap by category
  const gapByCat = new Map<string, number>();
  for (const id of gap) { const c = cat.get(id) ?? "(unknown)"; gapByCat.set(c, (gapByCat.get(c) ?? 0) + 1); }
  console.log(`\n  gap by primary_category (top 20):`);
  for (const [k, v] of [...gapByCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`    ${k.padEnd(24)} ${fmt(v)}  (${pct(v, gap.length)})`);

  // rural/remote proxy bucketing
  const REMOTE = new Set(["dispersed_camping","trailhead","viewpoint","peak","spring","campground","picnic_area","beach","park_feature","recreation_area","fishing","boat_ramp","hot_spring","waterfall","cave","natural_feature"]);
  const DEVELOPED = new Set(["grocery","ev_charging","hardware","gas_station","restaurant","cafe","toilet","water","dump_station","lodging","hotel","park","visitor_center","fuel","supermarket","pharmacy","charging_station","laundry"]);
  let remote = 0, developed = 0, other = 0;
  for (const id of gap) { const c = cat.get(id) ?? ""; if (REMOTE.has(c)) remote++; else if (DEVELOPED.has(c)) developed++; else other++; }
  console.log(`\n  gap rural/remote PROXY (category-based, NOT a measured geocoder-accuracy rate):`);
  console.log(`    remote/backcountry-leaning categories: ${fmt(remote)}  (${pct(remote, gap.length)})`);
  console.log(`    developed/urban-leaning categories:    ${fmt(developed)}  (${pct(developed, gap.length)})`);
  console.log(`    other/uncategorized:                   ${fmt(other)}  (${pct(other, gap.length)})`);
}

main().catch(e => { console.error(e); process.exit(1); });
