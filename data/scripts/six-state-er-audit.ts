/**
 * READ-ONLY audit of the six state-park visitor-content sources on TEST.
 *
 * For each source: source_record count, place_match status/method tallies, and
 * the distinct `resolved_by` values. `resolved_by` is the tell for
 * commit-completeness — an ER script stamps `auto:<source>_er`, so a source
 * whose links carry some other stamp was resolved by machinery that may not
 * exist in the repo.
 *
 * TEST only. Refuses to run against anything but the TEST project ref.
 *
 * Usage: npx tsx data/scripts/six-state-er-audit.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";

const SOURCES = [
  "state_parks_web",
  "state_parks_web_wa",
  "oregon_state_parks",
  "nevada_state_parks",
  "arizona_state_parks",
  "utah_state_parks",
] as const;

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

interface MatchRow {
  source_record_id: string;
  status: string;
  match_method: string;
  resolved_by: string | null;
}

async function pagedIds(db: SupabaseClient, sourceId: string): Promise<string[]> {
  const ids: string[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const r = await db
      .from("source_record")
      .select("id")
      .eq("source_id", sourceId)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [ids ${sourceId}]: ${JSON.stringify(r.error)}`);
    ids.push(...r.data.map((x) => x.id as string));
    if (r.data.length < PAGE) break;
  }
  return ids;
}

async function auditSource(db: SupabaseClient, sourceId: string): Promise<void> {
  const ids = await pagedIds(db, sourceId);
  console.log(`\n── ${sourceId} ──  source_record: ${ids.length}`);
  if (ids.length === 0) return;

  const matches: MatchRow[] = [];
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const r = await db
      .from("place_match")
      .select("source_record_id,status,match_method,resolved_by")
      .in("source_record_id", ids.slice(i, i + CHUNK));
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [place_match ${sourceId}]: ${JSON.stringify(r.error)}`);
    matches.push(...(r.data as MatchRow[]));
  }

  const status = new Map<string, number>();
  const method = new Map<string, number>();
  const resolvedBy = new Map<string, number>();
  const linked = new Set<string>();
  for (const m of matches) {
    status.set(m.status, (status.get(m.status) ?? 0) + 1);
    if (m.status === "confirmed") {
      method.set(m.match_method, (method.get(m.match_method) ?? 0) + 1);
      resolvedBy.set(m.resolved_by ?? "(null)", (resolvedBy.get(m.resolved_by ?? "(null)") ?? 0) + 1);
      linked.add(m.source_record_id);
    }
  }

  console.log(`   linked ${linked.size}/${ids.length}` +
    ` · pending ${status.get("pending") ?? 0}` +
    ` · rejected ${status.get("rejected") ?? 0}`);
  console.log(`   confirmed by match_method: ${JSON.stringify(Object.fromEntries([...method].sort()))}`);
  console.log(`   confirmed by resolved_by : ${JSON.stringify(Object.fromEntries([...resolvedBy].sort()))}`);
}

async function main(): Promise<void> {
  const env = parseEnvFile(join(REPO, "data", ".env"));
  const url = env.SUPABASE_URL;
  if (!url.includes(TEST_HOST)) {
    throw new Error(`refusing — data/.env is not TEST (${TEST_HOST}); got ${url}`);
  }
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  console.log(`Six-state ER audit — TEST (${TEST_HOST})`);
  for (const s of SOURCES) await auditSource(db, s);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
