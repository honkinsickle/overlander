/**
 * READ-ONLY post-migration check for the CA PROD promotion.
 *
 * Confirms the 20 state-park migrations landed on PROD and that nothing else
 * moved. Reads PROD creds from web/.env.local, which is NOT touched by the
 * data/.env field swap — so this stays correct regardless of which project
 * data/.env currently points at.
 *
 * Usage: npx tsx data/scripts/ca-prod-post-migration-check.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";

/** Measured on PROD 2026-09-02 immediately before `db:push-verify`. */
const BASELINE = {
  fieldPrecedenceRows: 99,
  fieldPrecedenceSources: 17,
  masterPlace: 28348,
  sourceRecord: 37848,
} as const;

const SIX_STATE_SOURCES = [
  "state_parks_web",
  "state_parks_web_wa",
  "oregon_state_parks",
  "nevada_state_parks",
  "arizona_state_parks",
  "utah_state_parks",
];

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

async function count(db: SupabaseClient, table: string, eq?: [string, string]): Promise<number> {
  let q = db.from(table).select("id", { count: "exact", head: true });
  if (eq) q = q.eq(eq[0], eq[1]);
  const r = await q;
  if (r.error || r.count == null) {
    throw new Error(`QUERY FAILED [${table}]: ${JSON.stringify(r, Object.getOwnPropertyNames(r))}`);
  }
  return r.count;
}

async function precedence(db: SupabaseClient): Promise<{ rows: number; sources: string[] }> {
  const r = await db.from("field_precedence").select("field_name,source_id,priority").range(0, 999);
  if (r.error || r.data == null) throw new Error(`QUERY FAILED [field_precedence]: ${JSON.stringify(r.error)}`);
  const rows = r.data as { source_id: string }[];
  return { rows: rows.length, sources: [...new Set(rows.map((x) => x.source_id))].sort() };
}

async function main(): Promise<void> {
  const prodEnv = parseEnvFile(join(REPO, "web", ".env.local"));
  const url = prodEnv.NEXT_PUBLIC_SUPABASE_URL;
  if (!url.includes(PROD_HOST)) throw new Error(`refusing — web/.env.local is not PROD: ${url}`);
  const prod = createClient(url, prodEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log(`POST-MIGRATION CHECK — PROD (${PROD_HOST})\n`);

  const fp = await precedence(prod);
  console.log("field_precedence");
  console.log(`   rows    : ${BASELINE.fieldPrecedenceRows} → ${fp.rows}  (delta ${fp.rows - BASELINE.fieldPrecedenceRows})`);
  console.log(`   sources : ${BASELINE.fieldPrecedenceSources} → ${fp.sources.length}  (delta ${fp.sources.length - BASELINE.fieldPrecedenceSources})`);
  const present = SIX_STATE_SOURCES.filter((s) => fp.sources.includes(s));
  console.log(`   six-state sources now present: ${present.length}/6 ${JSON.stringify(present)}`);

  console.log("\nper-source field_precedence row counts");
  for (const s of SIX_STATE_SOURCES) {
    const r = await prod.from("field_precedence").select("field_name").eq("source_id", s);
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [${s}]: ${JSON.stringify(r.error)}`);
    console.log(`   ${s.padEnd(22)} ${r.data.length}`);
  }

  console.log("\nunrelated PROD data — must be unchanged (schema-only migrations)");
  const mp = await count(prod, "master_place");
  const sr = await count(prod, "source_record");
  console.log(`   master_place  : ${BASELINE.masterPlace} → ${mp}  ${mp === BASELINE.masterPlace ? "UNCHANGED" : "*** CHANGED ***"}`);
  console.log(`   source_record : ${BASELINE.sourceRecord} → ${sr}  ${sr === BASELINE.sourceRecord ? "UNCHANGED" : "*** CHANGED ***"}`);

  console.log("\nsix-state source_record counts on PROD (all expected 0 until ingest)");
  for (const s of SIX_STATE_SOURCES) {
    console.log(`   ${s.padEnd(22)} ${await count(prod, "source_record", ["source_id", s])}`);
  }

  console.log("\nviews still resolve after the CREATE OR REPLACE chain");
  for (const v of ["master_place_search_export"]) {
    const r = await prod.from(v).select("id,photo_url", { count: "exact", head: true });
    console.log(`   ${v}: ${r.error ? `ERROR ${JSON.stringify(r.error)}` : `OK (rows=${r.count})`}`);
  }

  // Cross-check the shape against TEST, which is the reference for these sources.
  const testEnv = parseEnvFile(join(REPO, "data", ".env"));
  if (testEnv.SUPABASE_URL?.includes(TEST_HOST)) {
    const test = createClient(testEnv.SUPABASE_URL, testEnv.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    const tfp = await precedence(test);
    console.log(`\nTEST cross-check: field_precedence rows ${tfp.rows}, sources ${tfp.sources.length}`);
    console.log(`   PROD matches TEST shape: ${tfp.rows === fp.rows && tfp.sources.length === fp.sources.length ? "YES" : "NO"}`);
  } else {
    console.log("\nTEST cross-check skipped — data/.env is currently swapped to PROD (expected mid-promotion).");
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
