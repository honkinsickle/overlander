/** Phase 3 scope-only audit. TEST+PROD READS ONLY, no writes.
 *  1. PROD waste_disposal blast radius: sole/co-linked + trip refs
 *  2. TEST ER queue state: pending/confirmed/rejected + dump-in-queue count
 *  3. Project PROD OSM re-ingest → manual_review growth
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

async function main() {
  const prodEnv = parseEnv(PROD_ENV);
  const prodUrl = prodEnv.SUPABASE_URL;
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY;
  if (!prodUrl?.includes("nqzeywzcowujzyegxbsr")) throw new Error("prod env not prod");
  const prod = createClient(prodUrl, prodKey!, { auth: { persistSession: false } });

  const testUrl = process.env.SUPABASE_URL!;
  const testKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!testUrl.includes("znldzjdatkogdktymtvi")) throw new Error("current shell env not test");
  const test = createClient(testUrl, testKey, { auth: { persistSession: false } });

  console.log(`[env] test=${testUrl.match(/\/\/([^.]+)\./)?.[1]}  prod=${prodUrl.match(/\/\/([^.]+)\./)?.[1]}\n`);

  // ─── 1. PROD blast radius ──────────────────────────────────────────
  console.log("═══ PROD BLAST RADIUS — 1,723 waste_disposal rows ═══");
  const wd: { id: string; master_place_id: string | null }[] = [];
  {
    const size = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await prod
        .from("source_record")
        .select("id, raw_payload, master_place_id")
        .eq("source_id", "osm")
        .order("id")
        .range(from, from + size - 1);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.raw_payload?.element?.tags?.amenity === "waste_disposal") {
          wd.push({ id: r.id, master_place_id: r.master_place_id });
        }
      }
      if (rows.length < size) break;
      from += size;
    }
  }
  const linked = wd.filter((r) => r.master_place_id !== null);
  const unlinked = wd.filter((r) => r.master_place_id === null);
  console.log(`  total waste_disposal source_records : ${wd.length}`);
  console.log(`  linked to a master_place            : ${linked.length}`);
  console.log(`  unlinked (no MP)                    : ${unlinked.length}`);

  const linkedMpIds = [...new Set(linked.map((r) => r.master_place_id!))];
  const perMp = new Map<string, number>();
  const chunk = 200;
  for (let i = 0; i < linkedMpIds.length; i += chunk) {
    const slice = linkedMpIds.slice(i, i + chunk);
    const { data, error } = await prod.from("source_record").select("master_place_id").in("master_place_id", slice);
    if (error) throw error;
    for (const r of (data ?? []) as any[]) perMp.set(r.master_place_id, (perMp.get(r.master_place_id) ?? 0) + 1);
  }
  let orphanIfRemoved = 0, coLinked = 0;
  const orphanIds: string[] = [];
  for (const mpId of linkedMpIds) {
    if ((perMp.get(mpId) ?? 0) <= 1) { orphanIfRemoved++; orphanIds.push(mpId); }
    else coLinked++;
  }
  console.log(`  distinct MPs touched                : ${linkedMpIds.length}`);
  console.log(`  ORPHAN if removed (sole source)     : ${orphanIfRemoved}`);
  console.log(`  co-linked (MP would survive)        : ${coLinked}`);

  // Baked-corridor + trip.payload check: search for any "mp:<uuid>" in trips
  // and reference_trips.payload. Sample 100 orphan ids for the search.
  const sample = orphanIds.slice(0, 100);
  let refHits = 0, tripHits = 0;
  for (const id of sample) {
    const { count: rc } = await prod.from("reference_trips").select("id", { count: "exact", head: true }).ilike("payload::text", `%${id}%`);
    const { count: tc } = await prod.from("trips").select("id", { count: "exact", head: true }).ilike("payload::text", `%${id}%`);
    if ((rc ?? 0) > 0) refHits++;
    if ((tc ?? 0) > 0) tripHits++;
  }
  console.log(`  100-sample: reference_trips containing MP id : ${refHits}`);
  console.log(`  100-sample: trips containing MP id (bare or mp:<uuid>) : ${tripHits}`);

  // ─── 2. TEST ER queue state ───────────────────────────────────────
  console.log(`\n═══ TEST ER QUEUE STATE ═══`);
  const pmPending = await test.from("place_match").select("id", { count: "exact", head: true }).eq("status", "pending");
  const pmConfirmed = await test.from("place_match").select("id", { count: "exact", head: true }).eq("status", "confirmed");
  const pmRejected = await test.from("place_match").select("id", { count: "exact", head: true }).eq("status", "rejected");
  console.log(`  place_match pending  : ${pmPending.count}`);
  console.log(`  place_match confirmed: ${pmConfirmed.count}`);
  console.log(`  place_match rejected : ${pmRejected.count}`);

  // Dump-in-queue count on TEST: pending place_match whose source_record is a sanitary_dump_station
  const { data: pendingRows } = await test
    .from("place_match")
    .select("source_record_id")
    .eq("status", "pending");
  const pendingSrIds = (pendingRows ?? []).map((r: any) => r.source_record_id);
  let dumpInQueue = 0;
  for (let i = 0; i < pendingSrIds.length; i += 200) {
    const slice = pendingSrIds.slice(i, i + 200);
    const { data: srs } = await test
      .from("source_record")
      .select("raw_payload")
      .in("id", slice);
    for (const r of (srs ?? []) as any[]) {
      if (r.raw_payload?.element?.tags?.amenity === "sanitary_dump_station") dumpInQueue++;
    }
  }
  console.log(`  → of pending, sanitary_dump_station rows : ${dumpInQueue}`);

  // ─── 3. TEST: near-duplicate dump pairs ────────────────────────────
  console.log(`\n═══ TEST DUMP DUPLICATE RATE (26 rows) ═══`);
  const dumpNodes: { id: string; mp: string | null; lat: number; lon: number }[] = [];
  {
    const size = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await test
        .from("source_record")
        .select("id, master_place_id, raw_payload")
        .eq("source_id", "osm")
        .order("id")
        .range(from, from + size - 1);
      if (error) throw error;
      const rows = (data ?? []) as any[];
      if (rows.length === 0) break;
      for (const r of rows) {
        if (r.raw_payload?.element?.tags?.amenity !== "sanitary_dump_station") continue;
        const el = r.raw_payload.element;
        dumpNodes.push({ id: r.id, mp: r.master_place_id, lat: el.lat, lon: el.lon });
      }
      if (rows.length < size) break;
      from += size;
    }
  }
  console.log(`  total dumps                          : ${dumpNodes.length}`);
  const linkedDumps = dumpNodes.filter((d) => d.mp !== null);
  const unlinkedDumps = dumpNodes.filter((d) => d.mp === null);
  console.log(`  linked to MP                         : ${linkedDumps.length}`);
  console.log(`  UNLINKED (pending or auto-linked but unresolved) : ${unlinkedDumps.length}`);
  const distinctMps = new Set(linkedDumps.map((d) => d.mp!));
  console.log(`  distinct MPs                         : ${distinctMps.size}   (${linkedDumps.length - distinctMps.size} = pairs that ER merged)`);
  // Near-duplicate detection: pairs within 20m
  let near = 0;
  for (let i = 0; i < dumpNodes.length; i++) {
    for (let j = i + 1; j < dumpNodes.length; j++) {
      const a = dumpNodes[i]!, b = dumpNodes[j]!;
      const dLat = (a.lat - b.lat) * 111_320;
      const dLon = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      if (dist < 20) near++;
    }
  }
  console.log(`  near-duplicate pairs (<20m apart)    : ${near}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
