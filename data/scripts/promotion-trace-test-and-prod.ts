/**
 * READ-ONLY diagnostic: promotion trace for source_record → master_place
 * on TEST and PROD, plus source_id distribution across both.
 *
 * Answers:
 *   - Where does "2,874" (RIDB rows) actually hold? TEST? PROD? Neither?
 *   - Every drop stage between source_record and searchable non-land_status
 *     master_place, per source_id.
 *   - Is OSM 1,713/1,749 intentional composition or promotion failure?
 *
 * Reads env inline (no supabase link mutation, no CLI touched):
 *   TEST creds  ← data/.env (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)
 *   PROD creds  ← web/.env.local (NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY)
 *
 * Refuses to run if the resolved URLs don't match the expected project refs.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function buildClient(label: string, url: string, key: string, expectedHost: string): SupabaseClient {
  if (!url.includes(expectedHost)) {
    throw new Error(`[${label}] Refusing to build client: URL is ${url}, expected ${expectedHost}`);
  }
  if (!key || key.length < 20) throw new Error(`[${label}] Missing service role key`);
  return createClient(url, key, { auth: { persistSession: false } });
}

async function countExact(db: SupabaseClient, table: string, filter: (q: any) => any): Promise<number> {
  const q = filter(db.from(table).select("id", { count: "exact", head: true }));
  const { count, error } = await q;
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count ?? 0;
}

async function distinctMasterPlaceIdsBySource(
  db: SupabaseClient,
  sourceId: string,
): Promise<Set<string>> {
  const set = new Set<string>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id")
      .eq("source_id", sourceId)
      .not("master_place_id", "is", null)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) if (r.master_place_id) set.add(r.master_place_id);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return set;
}

async function sourceIdDistribution(db: SupabaseClient): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const pageSize = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from("source_record")
      .select("source_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) counts.set(r.source_id, (counts.get(r.source_id) ?? 0) + 1);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return counts;
}

async function promotionTrace(db: SupabaseClient, sourceId: string, label: string) {
  console.log(`\n[${label}] promotion trace for source_id='${sourceId}'`);

  const stage1 = await countExact(db, "source_record", (q) => q.eq("source_id", sourceId));
  console.log(`  1. source_record rows                                     : ${stage1}`);

  const stage2Linked = await countExact(db, "source_record", (q) =>
    q.eq("source_id", sourceId).not("master_place_id", "is", null),
  );
  console.log(`  2. …with master_place_id set (post-ER link)               : ${stage2Linked}   (drop: ${stage1 - stage2Linked})`);

  const mpIds = await distinctMasterPlaceIdsBySource(db, sourceId);
  console.log(`  3. distinct master_place ids reached                       : ${mpIds.size}`);

  // Filter master_place set for is_searchable + non-land_status
  const idArr = [...mpIds];
  let searchable = 0;
  let nonLandStatus = 0;
  const chunk = 100;
  for (let i = 0; i < idArr.length; i += chunk) {
    const slice = idArr.slice(i, i + chunk);
    const [sRes, cRes] = await Promise.all([
      db.from("master_place").select("id", { count: "exact", head: true }).in("id", slice).eq("is_searchable", true),
      db
        .from("master_place")
        .select("id", { count: "exact", head: true })
        .in("id", slice)
        .eq("is_searchable", true)
        .neq("primary_category", "land_status"),
    ]);
    if (sRes.error) throw sRes.error;
    if (cRes.error) throw cRes.error;
    searchable += sRes.count ?? 0;
    nonLandStatus += cRes.count ?? 0;
  }
  console.log(`  4. …of which is_searchable = true                          : ${searchable}   (drop: ${mpIds.size - searchable})`);
  console.log(`  5. …AND primary_category != 'land_status'                  : ${nonLandStatus}   (drop: ${searchable - nonLandStatus})`);
}

async function corpusSummary(db: SupabaseClient, label: string) {
  console.log(`\n[${label}] CORPUS SUMMARY`);
  const totalMp = await countExact(db, "master_place", (q) => q);
  const searchableMp = await countExact(db, "master_place", (q) => q.eq("is_searchable", true));
  const finalMp = await countExact(db, "master_place", (q) =>
    q.eq("is_searchable", true).neq("primary_category", "land_status"),
  );
  console.log(`  master_place total                                : ${totalMp}`);
  console.log(`  master_place is_searchable=true                   : ${searchableMp}`);
  console.log(`  master_place is_searchable=true & !land_status    : ${finalMp}`);

  const totalSr = await countExact(db, "source_record", (q) => q);
  console.log(`  source_record total                               : ${totalSr}`);

  console.log(`\n[${label}] source_record distribution by source_id`);
  const dist = await sourceIdDistribution(db);
  const sorted = [...dist.entries()].sort((a, b) => b[1] - a[1]);
  for (const [sid, n] of sorted) console.log(`  ${sid.padEnd(24)} ${n}`);

  // google_place_id NULL count in the same population the RPC would surface
  const googleMps = await distinctMasterPlaceIdsBySource(db, "google");
  const googleResolvedMps = await distinctMasterPlaceIdsBySource(db, "google_resolved");
  console.log(`\n[${label}] Google-family reachability on searchable non-land_status master_place`);
  console.log(`  distinct master_place with source_id='google'          : ${googleMps.size}`);
  console.log(`  distinct master_place with source_id='google_resolved' : ${googleResolvedMps.size}`);
  const overlap = [...googleResolvedMps].filter((x) => googleMps.has(x)).length;
  const resolvedOnly = googleResolvedMps.size - overlap;
  console.log(`  overlap (both)                                          : ${overlap}`);
  console.log(`  google_resolved-only (delta unlocked by widened RPC)    : ${resolvedOnly}`);
  console.log(`  searchable non-land_status master_place with NO 'google' : ${finalMp - [...googleMps].length}   (approx — subtracts distinct google-backed set)`);
}

async function run(label: string, db: SupabaseClient) {
  console.log("═".repeat(72));
  console.log(` ${label}`);
  console.log("═".repeat(72));
  await corpusSummary(db, label);
  for (const sid of ["ridb", "osm", "nps", "google", "google_resolved", "usfs", "parks_canada", "bc_parks", "alberta_parks", "padus"]) {
    try {
      await promotionTrace(db, sid, label);
    } catch (e) {
      console.log(`  [${label}] promotion trace ${sid} FAILED:`, (e as Error).message);
    }
  }
}

async function main() {
  const testEnv = parseEnvFile(join(REPO, "data", ".env"));
  const prodEnv = parseEnvFile(join(REPO, "web", ".env.local"));

  const testUrl = testEnv.SUPABASE_URL ?? "";
  const testKey = testEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const prodUrl = prodEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const prodKey = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";

  console.log(`[TEST] ${testUrl}`);
  console.log(`[PROD] ${prodUrl}`);
  console.log(`[CLI-LINK] not touched by this script (pure supabase-js reads)`);

  const test = buildClient("TEST", testUrl, testKey, TEST_HOST);
  const prod = buildClient("PROD", prodUrl, prodKey, PROD_HOST);

  await run("TEST · znldzjdatkogdktymtvi", test);
  await run("PROD · nqzeywzcowujzyegxbsr", prod);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
