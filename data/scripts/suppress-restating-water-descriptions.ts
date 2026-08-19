/**
 * Clears the stored `normalized_payload.description` on rows whose templated
 * text only restates the category — the 13 water rows that hold exactly
 * "Drinking water.".
 *
 * Cause: the template's first revision judged a lone lead by PROVENANCE
 * (`drinking_water=yes` is an explicit tag, so "specialized") rather than by the
 * rendered text. Provenance is invisible to a reader; "Drinking water." beside a
 * place already labelled Water says nothing. The module now judges the text
 * (RESTATING_LEADS), so those rows should carry no description.
 *
 * Scope: recomputes EVERY row in all three templated categories, then writes
 * ONLY the rows whose stored value disagrees with the current template AND
 * whose stored value is not a real OSM description. Reports any unexpected
 * divergence instead of writing it blindly, so a side effect on the other rows
 * cannot pass silently.
 *
 * Does not touch `is_active`. TEST-only. Snapshot + paired undo.
 *
 *   (default)  dry run   --apply   --undo
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildTemplatedDescription,
  TEMPLATED_CATEGORIES,
} from "../ingestion/lib/osm-description-templates.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "description-backfill-snapshots");

type Row = {
  id: string;
  external_id: string;
  inferred_category: string;
  is_active: boolean;
  raw_payload: { element?: { tags?: Record<string, string> } } | null;
  normalized_payload: Record<string, unknown> | null;
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  console.log(`[env] TEST ${ref}   mode: ${undo ? "UNDO" : apply ? "APPLY" : "DRY RUN"}\n`);

  if (undo) {
    const files = existsSync(SNAPSHOT_DIR)
      ? readdirSync(SNAPSHOT_DIR).filter((f) => f.startsWith("suppress-restating") && f.endsWith(".json")).sort()
      : [];
    const newest = files.at(-1);
    if (!newest) throw new Error("No suppress-restating snapshot to undo from.");
    const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as {
      project_ref: string; rows: { id: string; prior_description: unknown }[];
    };
    if (snap.project_ref !== TEST_REF) throw new Error("Snapshot is not TEST.");
    for (const r of snap.rows) {
      const cur = await db.from("source_record").select("normalized_payload").eq("id", r.id).single();
      if (cur.error || cur.data == null) { console.log("READ FAILED:", JSON.stringify(cur, null, 2)); throw new Error("undo read"); }
      const np = { ...(cur.data.normalized_payload as Record<string, unknown>), description: r.prior_description };
      const u = await db.from("source_record").update({ normalized_payload: np }).eq("id", r.id);
      if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
    }
    console.log(`restored ${snap.rows.length} rows from ${newest}`);
    return;
  }

  const page = 1000;
  const all: Row[] = [];
  for (const cat of TEMPLATED_CATEGORIES) {
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("id, external_id, inferred_category, is_active, raw_payload, normalized_payload")
        .eq("source_id", "osm").eq("inferred_category", cat)
        .order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error(`scan ${cat}`); }
      all.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }
  }
  console.log(`scanned ${all.length} rows across ${TEMPLATED_CATEGORIES.join(" / ")}`);

  const toClear: Row[] = [];
  const unexpected: { row: Row; stored: unknown; expected: string | null }[] = [];

  for (const row of all) {
    const tags = row.raw_payload?.element?.tags ?? {};
    const realDesc = tags.description ?? tags.note ?? null;
    const stored = row.normalized_payload?.description ?? null;

    // A real OSM description is authoritative and out of scope here.
    if (realDesc != null && stored === realDesc) continue;

    const expected = buildTemplatedDescription(row.inferred_category, tags);
    const storedStr = typeof stored === "string" ? stored : null;
    if (storedStr === expected) continue; // already agrees

    if (storedStr !== null && expected === null) toClear.push(row);
    else unexpected.push({ row, stored, expected });
  }

  console.log(`\nrows whose stored description must be CLEARED (template now yields null): ${toClear.length}`);
  const byCat = new Map<string, number>();
  for (const r of toClear) byCat.set(r.inferred_category, (byCat.get(r.inferred_category) ?? 0) + 1);
  for (const [c, n] of byCat) console.log(`    ${c}: ${n}`);
  const storedValues = new Map<string, number>();
  for (const r of toClear) {
    const s = String(r.normalized_payload?.description);
    storedValues.set(s, (storedValues.get(s) ?? 0) + 1);
  }
  console.log(`  distinct stored values being cleared:`);
  for (const [v, n] of storedValues) console.log(`    ${n}x  ${JSON.stringify(v)}`);

  console.log(`\nUNEXPECTED divergences (stored != template, not a simple clear): ${unexpected.length}`);
  for (const u of unexpected.slice(0, 20)) {
    console.log(`    ${u.row.external_id} [${u.row.inferred_category}] stored=${JSON.stringify(u.stored)} expected=${JSON.stringify(u.expected)}`);
  }
  if (unexpected.length > 0) throw new Error("Refusing: unexpected divergence — investigate before writing.");

  if (!apply) { console.log("\nDRY RUN — nothing written."); return; }
  if (toClear.length === 0) { console.log("\nNothing to clear; snapshot NOT written."); return; }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const file = join(SNAPSHOT_DIR, `suppress-restating-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({
    taken_at: new Date().toISOString(), project_ref: TEST_REF,
    rows: toClear.map((r) => ({ id: r.id, external_id: r.external_id, prior_description: r.normalized_payload?.description ?? null })),
  }, null, 2));
  console.log(`\nsnapshot: ${file} (${toClear.length} rows)`);

  let cleared = 0;
  for (const r of toClear) {
    const np = { ...(r.normalized_payload ?? {}), description: null };
    const u = await db.from("source_record").update({ normalized_payload: np }).eq("id", r.id);
    if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("write failed"); }
    cleared += 1;
  }
  console.log(`cleared ${cleared}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
