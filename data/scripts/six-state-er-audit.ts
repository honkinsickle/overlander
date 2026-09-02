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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const SCRIPTS = HERE;
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";

/** `code` drives the committed-script filename convention `<code>-state-parks-*`. */
const STATES = [
  { sourceId: "california_state_parks", code: "ca" },
  { sourceId: "washington_state_parks", code: "wa" },
  { sourceId: "oregon_state_parks", code: "or" },
  { sourceId: "nevada_state_parks", code: "nv" },
  { sourceId: "arizona_state_parks", code: "az" },
  { sourceId: "utah_state_parks", code: "ut" },
] as const;

const SOURCES = STATES.map((s) => s.sourceId);

/** States whose phase 1 is spatial pre-link and therefore share `runStateParksEr`. */
const SPATIAL_CODES = new Set(["ca", "wa", "or", "nv"]);

/**
 * Repo-side half of the audit: is the tooling committed, AND is it on the shared
 * runner?
 *
 * "Exists" was the right check when scripts were simply missing (the original
 * gap-closure pass). It is no longer sufficient: UT's triage script existed and
 * was committed, but was its own one-shot with no dry-run guard, and invoking it
 * with the shared `--apply/--write` flags caused an unintended PROD write
 * 2026-09-02. The failure mode has moved from MISSING to DIVERGENT, so this now
 * asserts each script actually delegates to the shared runner.
 */
function scriptStatus(code: string): { er: string; triage: string } {
  const check = (file: string, mustImport: string): string => {
    const path = join(SCRIPTS, file);
    if (!existsSync(path)) {
      // A stray .mjs sibling is itself a finding — it sits outside tsc.
      const mjs = file.replace(/\.ts$/, ".mjs");
      return existsSync(join(SCRIPTS, mjs)) ? `${mjs}  *** .mjs — outside tsc, NOT on shared runner ***` : "MISSING";
    }
    const src = readFileSync(path, "utf8");
    return src.includes(mustImport) ? `${file}  (shared: ${mustImport})` : `${file}  *** DIVERGENT — does not use ${mustImport} ***`;
  };
  // ER expectation is per-MECHANISM, not one-size-fits-all. CA/WA/OR/NV do
  // spatial pre-link and share `runStateParksEr`. AZ/UT have no coordinates and
  // use `ingest_time_name_link` (replaying the GIS id the ingester recorded),
  // so they legitimately have their own phase 1 and must NOT be forced onto the
  // spatial runner — asserting otherwise would be a check that demands the
  // wrong thing. They still share phase 2 via applyMatches.
  const erExpect = SPATIAL_CODES.has(code) ? "runStateParksEr" : "applyMatches";
  return {
    er: check(`${code}-state-parks-er.ts`, erExpect),
    triage: check(`${code}-state-parks-triage-apply.ts`, "runStateParksTriage"),
  };
}

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

  console.log(`\n${"=".repeat(72)}\nCOMMIT-COMPLETENESS — is the tooling in the repo?\n${"=".repeat(72)}`);
  let gaps = 0;
  for (const st of STATES) {
    const s = scriptStatus(st.code);
    if (s.er.includes("MISSING") || s.er.includes("***") || s.triage.includes("MISSING") || s.triage.includes("***")) gaps += 1;
    console.log(`\n${st.sourceId} (${st.code})`);
    console.log(`   ER script     : ${s.er}`);
    console.log(`   triage script : ${s.triage}`);
  }
  console.log(
    `\n${gaps === 0 ? "CLOSED — all six states have committed ER + triage scripts, all on the shared runner." : `OPEN — ${gaps} state(s) missing or divergent.`}\n`,
  );
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
