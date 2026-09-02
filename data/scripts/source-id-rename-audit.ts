/**
 * READ-ONLY blast-radius audit for the `state_parks_web` → `california_state_parks`
 * and `state_parks_web_wa` → `washington_state_parks` source_id rename.
 *
 * Finds every place in TEST and PROD where the old identifiers are stored, not
 * just the ones the rename plan lists. Writes nothing.
 *
 *   TEST creds ← data/.env
 *   PROD creds ← web/.env.local
 *
 * Usage: npx tsx data/scripts/source-id-rename-audit.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

const RENAMES = [
  { old: "state_parks_web", next: "california_state_parks" },
  { old: "state_parks_web_wa", next: "washington_state_parks" },
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

async function countExact(
  db: SupabaseClient,
  table: string,
  column: string,
  value: string,
): Promise<number> {
  const r = await db.from(table).select("id", { count: "exact", head: true }).eq(column, value);
  if (r.error || r.count == null) {
    throw new Error(`QUERY FAILED [${table}.${column}=${value}]: ${JSON.stringify(r, Object.getOwnPropertyNames(r))}`);
  }
  return r.count;
}

async function pagedSourceRecords(
  db: SupabaseClient,
  sourceId: string,
): Promise<{ id: string; externalId: string; masterPlaceId: string | null }[]> {
  const out: { id: string; externalId: string; masterPlaceId: string | null }[] = [];
  for (let off = 0; ; off += 1000) {
    const r = await db
      .from("source_record")
      .select("id, external_id, master_place_id")
      .eq("source_id", sourceId)
      .order("id")
      .range(off, off + 999);
    if (r.error || r.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(r.error)}`);
    for (const x of r.data) {
      out.push({
        id: String(x.id),
        externalId: String(x.external_id),
        masterPlaceId: typeof x.master_place_id === "string" ? x.master_place_id : null,
      });
    }
    if (r.data.length < 1000) break;
  }
  return out;
}

async function audit(label: string, db: SupabaseClient): Promise<void> {
  console.log(`\n${"=".repeat(74)}\n${label}\n${"=".repeat(74)}`);

  for (const { old, next } of RENAMES) {
    console.log(`\n── ${old}  →  ${next}`);

    const srs = await pagedSourceRecords(db, old);
    console.log(`  1. source_record.source_id = '${old}'                 : ${srs.length}`);
    if (srs.length === 0) {
      console.log("     (absent here — nothing to rename)");
      // still check the destination isn't occupied
      const dest = await countExact(db, "source_record", "source_id", next);
      console.log(`     destination '${next}' already present            : ${dest}`);
      continue;
    }

    // external_id prefix — NOT in the rename plan, but it embeds the old name.
    const prefixed = srs.filter((s) => s.externalId.startsWith(`${old}:`)).length;
    console.log(`  2. …of those, external_id starts with '${old}:' : ${prefixed}  ${prefixed === srs.length ? "(ALL)" : "(partial)"}`);
    console.log(`     sample external_id                                  : ${srs[0].externalId}`);

    // destination collision check
    const dest = await countExact(db, "source_record", "source_id", next);
    console.log(`  3. destination source_id '${next}' occupied : ${dest} ${dest === 0 ? "(clear)" : "*** COLLISION ***"}`);

    // field_precedence
    const fp = await db.from("field_precedence").select("field_name,priority").eq("source_id", old);
    if (fp.error || fp.data == null) throw new Error(`QUERY FAILED [field_precedence]: ${JSON.stringify(fp.error)}`);
    console.log(`  4. field_precedence rows                              : ${fp.data.length}  ${JSON.stringify(fp.data.map((x) => x.field_name).sort())}`);

    // place_match.resolved_by / notes carrying the old name
    const ids = srs.map((s) => s.id);
    const stamps = new Map<string, number>();
    let notesHits = 0;
    let pmTotal = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const pm = await db
        .from("place_match")
        .select("resolved_by, notes, status")
        .in("source_record_id", ids.slice(i, i + 200));
      if (pm.error || pm.data == null) throw new Error(`QUERY FAILED [place_match]: ${JSON.stringify(pm.error)}`);
      for (const m of pm.data) {
        pmTotal += 1;
        const rb = m.resolved_by == null ? "(null)" : String(m.resolved_by);
        stamps.set(rb, (stamps.get(rb) ?? 0) + 1);
        if (typeof m.notes === "string" && m.notes.includes(old)) notesHits += 1;
      }
    }
    console.log(`  5. place_match rows                                   : ${pmTotal}`);
    console.log(`     resolved_by values                                 : ${JSON.stringify(Object.fromEntries([...stamps].sort()))}`);
    console.log(`     …containing '${old}' in resolved_by       : ${[...stamps].filter(([k]) => k.includes(old)).reduce((a, [, v]) => a + v, 0)}`);
    console.log(`     …containing '${old}' in notes             : ${notesHits}`);

    // master_place.attribution — the source of truth for which source gave which field
    const mpIds = [...new Set(srs.map((s) => s.masterPlaceId).filter((x): x is string => x != null))];
    let attrRows = 0;
    const attrFields = new Map<string, number>();
    for (let i = 0; i < mpIds.length; i += 200) {
      const mp = await db.from("master_place").select("id, attribution").in("id", mpIds.slice(i, i + 200));
      if (mp.error || mp.data == null) throw new Error(`QUERY FAILED [master_place]: ${JSON.stringify(mp.error)}`);
      for (const row of mp.data) {
        if (!isRecord(row.attribution)) continue;
        let hit = false;
        for (const [field, src] of Object.entries(row.attribution)) {
          if (src === old) {
            hit = true;
            attrFields.set(field, (attrFields.get(field) ?? 0) + 1);
          }
        }
        if (hit) attrRows += 1;
      }
    }
    console.log(`  6. master_place linked                                : ${mpIds.length}`);
    console.log(`     …with attribution.* = '${old}'           : ${attrRows} rows`);
    console.log(`     per-field attribution counts                       : ${JSON.stringify(Object.fromEntries([...attrFields].sort()))}`);

    // description_source on the export view
    const ds = await countExact(db, "master_place_search_export", "description_source", old);
    console.log(`  7. master_place_search_export.description_source='${old}' : ${ds}`);
  }
}

async function main(): Promise<void> {
  const t = parseEnvFile(join(REPO, "data", ".env"));
  const p = parseEnvFile(join(REPO, "web", ".env.local"));
  if (!t.SUPABASE_URL.includes(TEST_HOST)) throw new Error(`data/.env is not TEST: ${t.SUPABASE_URL}`);
  if (!p.NEXT_PUBLIC_SUPABASE_URL.includes(PROD_HOST)) throw new Error("web/.env.local is not PROD");

  await audit(`TEST (${TEST_HOST})`, createClient(t.SUPABASE_URL, t.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  await audit(`PROD (${PROD_HOST})`, createClient(p.NEXT_PUBLIC_SUPABASE_URL, p.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
