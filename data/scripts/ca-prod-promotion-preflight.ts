/**
 * READ-ONLY preflight for the `california_state_parks` (CA) TEST → PROD promotion.
 *
 * Writes nothing, to either database. Does not touch the Supabase CLI link.
 * Reads env inline via the same seam `promotion-trace-test-and-prod.ts` uses:
 *   TEST creds ← data/.env      (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
 *   PROD creds ← web/.env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
 * Refuses to run if a resolved URL doesn't match its expected project ref.
 *
 * Reports, for both databases:
 *   1. `california_state_parks` linkage state — source_record count, place_match status
 *      distribution, match_method tally, linked/pending/rejected.
 *   2. field_precedence coverage — which source_ids have rows. The TEST↔PROD
 *      delta here is the migration gap.
 *   3. The `state_parks` GIS CA slice — the substrate the spatial pre-link phase
 *      matches against. If PROD's differs from TEST's, the ER outcome cannot
 *      match TEST's regardless of method.
 *   4. Corpus scale per source_id — exact head-counts, never a capped page.
 *
 * Usage: npx tsx data/scripts/ca-prod-promotion-preflight.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";
const SOURCE_ID = "california_state_parks";

/** Every source_id this repo has ingested, per docs/DATA_INVENTORY.md + migrations. */
const KNOWN_SOURCES = [
  "nps", "ridb", "osm", "wikipedia", "google", "usfs", "blm", "state_parks",
  "atlas_oddities", "family_destinations", "family_destinations_guide",
  "tasteatlas", "editorial_food", "california_state_parks", "washington_state_parks",
  "oregon_state_parks", "nevada_state_parks", "arizona_state_parks",
  "utah_state_parks",
] as const;

interface PgError {
  code?: string;
  message?: string;
}

interface CountResult {
  error: PgError | null;
  count: number | null;
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

function makeClient(url: string, key: string, expectHost: string, label: string): SupabaseClient {
  if (!url || !key) throw new Error(`${label}: missing url/key`);
  if (!url.includes(expectHost)) {
    throw new Error(`${label}: refusing — resolved url does not match ${expectHost}`);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * A null count is a FAILURE signal, not a data value (CLAUDE.md, 2026-08-10).
 * Logs the whole response — not just `error?.message`, which prints empty for
 * some PostgREST error shapes.
 */
function requireCount(label: string, r: CountResult): number {
  if (r.error || r.count == null) {
    throw new Error(`QUERY FAILED [${label}]: ${JSON.stringify(r, Object.getOwnPropertyNames(r))}`);
  }
  return r.count;
}

async function countRows(
  db: SupabaseClient,
  table: string,
  opts: { eq?: [string, string]; like?: [string, string] } = {},
): Promise<number> {
  let q = db.from(table).select("id", { count: "exact", head: true });
  if (opts.eq) q = q.eq(opts.eq[0], opts.eq[1]);
  if (opts.like) q = q.like(opts.like[0], opts.like[1]);
  const label = `${table} ${JSON.stringify(opts)}`;
  return requireCount(label, (await q) as CountResult);
}

/** Page through ids — PostgREST caps rows per request, so a bare select is a SAMPLE. */
async function allSourceRecordIds(db: SupabaseClient): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const r = await db
      .from("source_record")
      .select("id")
      .eq("source_id", SOURCE_ID)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      throw new Error(`QUERY FAILED [source_record ids]: ${JSON.stringify(r.error)}`);
    }
    ids.push(...r.data.map((x) => x.id as string));
    if (r.data.length < PAGE) break;
  }
  return ids;
}

async function reportLinkage(db: SupabaseClient): Promise<void> {
  const srCount = await countRows(db, "source_record", { eq: ["source_id", SOURCE_ID] });
  console.log(`1. source_record  source_id='${SOURCE_ID}'  → ${srCount}`);

  if (srCount === 0) {
    console.log("   (source absent here — no linkage to measure)");
    return;
  }

  const srIds = await allSourceRecordIds(db);
  console.log(`   paged ids fetched: ${srIds.length} (must equal ${srCount})`);

  const matches: { source_record_id: string; status: string; match_method: string }[] = [];
  const CHUNK = 200;
  for (let i = 0; i < srIds.length; i += CHUNK) {
    const r = await db
      .from("place_match")
      .select("source_record_id,status,match_method")
      .in("source_record_id", srIds.slice(i, i + CHUNK));
    if (r.error || r.data == null) {
      throw new Error(`QUERY FAILED [place_match]: ${JSON.stringify(r.error)}`);
    }
    matches.push(...(r.data as typeof matches));
  }

  const byStatus = new Map<string, number>();
  const byMethod = new Map<string, number>();
  const linked = new Set<string>();
  for (const m of matches) {
    byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1);
    if (m.status === "confirmed") {
      byMethod.set(m.match_method, (byMethod.get(m.match_method) ?? 0) + 1);
      linked.add(m.source_record_id);
    }
  }

  console.log(`   place_match rows: ${matches.length}`);
  for (const [k, v] of [...byStatus].sort()) console.log(`      status ${k.padEnd(11)} ${v}`);
  for (const [k, v] of [...byMethod].sort()) console.log(`      method ${k.padEnd(21)} ${v}`);
  const noRow = srIds.filter((id) => !matches.some((m) => m.source_record_id === id)).length;
  console.log(`   LINKED ${linked.size}/${srCount} · PENDING ${byStatus.get("pending") ?? 0} · REJECTED ${byStatus.get("rejected") ?? 0} · NO place_match row ${noRow}`);
}

async function reportPrecedence(db: SupabaseClient): Promise<void> {
  const r = await db.from("field_precedence").select("field_name,source_id,priority").range(0, 999);
  if (r.error || r.data == null) {
    throw new Error(`QUERY FAILED [field_precedence]: ${JSON.stringify(r.error)}`);
  }
  const rows = r.data as { field_name: string; source_id: string; priority: number }[];
  const sources = [...new Set(rows.map((x) => x.source_id))].sort();
  console.log(`\n2. field_precedence: ${rows.length} rows, ${sources.length} distinct source_ids`);
  console.log(`   ${JSON.stringify(sources)}`);
  const ca = rows.filter((x) => x.source_id === SOURCE_ID).sort((a, b) => a.field_name.localeCompare(b.field_name));
  console.log(`   rows for '${SOURCE_ID}': ${ca.length}`);
  for (const x of ca) console.log(`      ${x.field_name.padEnd(20)} priority ${x.priority}`);
}

async function reportGisSubstrate(db: SupabaseClient): Promise<void> {
  console.log("\n3. state_parks GIS corpus, CA slice (spatial pre-link substrate):");
  for (const pat of ["state_parks:CA:%", "state_parks:CA:park:%", "state_parks:CA:campground:%"]) {
    const n = await countRows(db, "source_record", {
      eq: ["source_id", "state_parks"],
      like: ["external_id", pat],
    });
    console.log(`   external_id LIKE '${pat}'`.padEnd(52) + n);
  }
}

async function reportScale(db: SupabaseClient): Promise<void> {
  console.log("\n4. corpus scale (exact head-counts):");
  console.log(`   master_place total  ${await countRows(db, "master_place")}`);
  console.log(`   source_record total ${await countRows(db, "source_record")}`);
  for (const s of KNOWN_SOURCES) {
    const n = await countRows(db, "source_record", { eq: ["source_id", s] });
    if (n > 0) console.log(`      ${s.padEnd(28)} ${n}`);
  }
}

async function report(label: string, db: SupabaseClient): Promise<void> {
  console.log(`\n${"=".repeat(72)}\n${label}\n${"=".repeat(72)}`);
  await reportLinkage(db);
  await reportPrecedence(db);
  await reportGisSubstrate(db);
  await reportScale(db);
}

async function main(): Promise<void> {
  const testEnv = parseEnvFile(join(REPO, "data", ".env"));
  const prodEnv = parseEnvFile(join(REPO, "web", ".env.local"));

  await report(
    `TEST  (${TEST_HOST})`,
    makeClient(testEnv.SUPABASE_URL, testEnv.SUPABASE_SERVICE_ROLE_KEY, TEST_HOST, "TEST"),
  );
  await report(
    `PROD  (${PROD_HOST})`,
    makeClient(prodEnv.NEXT_PUBLIC_SUPABASE_URL, prodEnv.SUPABASE_SERVICE_ROLE_KEY, PROD_HOST, "PROD"),
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
