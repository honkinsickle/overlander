/**
 * Populate `normalized_payload.description` for existing osm toilet / water /
 * dump_station rows from the tag templates in
 * `data/ingestion/lib/osm-description-templates.ts`.
 *
 * `normalizeOsm` now emits these on ingest, so this only backfills rows already
 * in the corpus.
 *
 * GAP-FILL ONLY. A row whose description is already non-empty is skipped — a
 * real OSM `description`/`note` always outranks a generated sentence, matching
 * the precedence `normalizeOsm` applies.
 *
 * DOES NOT touch `is_active`. These three categories are deactivated and stay
 * that way; reactivation is a separate explicit step after review.
 *
 * Snapshots are TIMESTAMPED and an empty result set is never written — the
 * clobber that destroyed the reclassify snapshot earlier this session.
 *
 * TEST-only.
 *   (default)  dry run — measure + snapshot + print samples, write nothing
 *   --apply    perform the update
 *   --undo     restore normalized_payload.description from the newest snapshot
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

type Snapshot = {
  taken_at: string;
  project_ref: string;
  rows: { id: string; external_id: string; prior_description: unknown }[];
};

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ref = (url ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (got ${ref ?? "<none>"}).`);
  const db = createClient(url!, key!, { auth: { persistSession: false } });

  const apply = process.argv.includes("--apply");
  const undo = process.argv.includes("--undo");
  if (apply && undo) throw new Error("--apply and --undo are mutually exclusive");
  console.log(`[env] TEST ${ref}   mode: ${undo ? "UNDO" : apply ? "APPLY" : "DRY RUN"}\n`);

  if (undo) {
    if (!existsSync(SNAPSHOT_DIR)) throw new Error(`No snapshot dir ${SNAPSHOT_DIR}`);
    const files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json")).sort();
    const newest = files.at(-1);
    if (!newest) throw new Error("No snapshot to undo from.");
    const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as Snapshot;
    if (snap.project_ref !== TEST_REF) throw new Error("Snapshot is not TEST.");
    console.log(`restoring ${snap.rows.length} rows from ${newest}`);
    for (const r of snap.rows) {
      const cur = await db.from("source_record").select("normalized_payload").eq("id", r.id).single();
      if (cur.error || cur.data == null) { console.log("READ FAILED:", JSON.stringify(cur, null, 2)); throw new Error("undo read"); }
      const np = { ...(cur.data.normalized_payload as Record<string, unknown>), description: r.prior_description };
      const u = await db.from("source_record").update({ normalized_payload: np }).eq("id", r.id);
      if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
    }
    console.log(`restored ${snap.rows.length}`);
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

  type Plan = { row: Row; description: string };
  const planned: Plan[] = [];
  const stats = new Map<string, { total: number; hasReal: number; templated: number; noTemplate: number }>();
  for (const cat of TEMPLATED_CATEGORIES) stats.set(cat, { total: 0, hasReal: 0, templated: 0, noTemplate: 0 });

  for (const row of all) {
    const s = stats.get(row.inferred_category)!;
    s.total += 1;
    const existing = row.normalized_payload?.description;
    if (typeof existing === "string" && existing.trim().length > 0) { s.hasReal += 1; continue; }
    const desc = buildTemplatedDescription(row.inferred_category, row.raw_payload?.element?.tags);
    if (desc == null) { s.noTemplate += 1; continue; }
    s.templated += 1;
    planned.push({ row, description: desc });
  }

  console.log("PLAN (gap-fill only; rows with a real description are never touched)\n");
  console.log("  category        total   real-desc   templated   no-template   coverage");
  for (const [cat, s] of stats) {
    const cov = s.total > 0 ? ((s.templated / s.total) * 100).toFixed(1) : "0.0";
    console.log(`  ${cat.padEnd(14)} ${String(s.total).padStart(6)} ${String(s.hasReal).padStart(11)} ${String(s.templated).padStart(11)} ${String(s.noTemplate).padStart(13)} ${cov.padStart(9)}%`);
  }
  console.log(`\n  total rows to write: ${planned.length}`);
  console.log(`  is_active is NOT modified by this script.`);

  // Samples per category — real generated output for review.
  console.log("\n=== SAMPLE GENERATED DESCRIPTIONS ===");
  for (const cat of TEMPLATED_CATEGORIES) {
    const forCat = planned.filter((p) => p.row.inferred_category === cat);
    const n = cat === "dump_station" ? forCat.length : 8;
    const stride = Math.max(1, Math.floor(forCat.length / n));
    const show = forCat.filter((_, i) => i % stride === 0).slice(0, n);
    console.log(`\n--- ${cat} (${show.length} of ${forCat.length}) ---`);
    for (const p of show) {
      console.log(`  ${p.row.external_id}`);
      console.log(`     tags: ${JSON.stringify(p.row.raw_payload?.element?.tags ?? {})}`);
      console.log(`     ->   ${p.description}`);
    }
  }

  if (!apply) { console.log("\nDRY RUN — nothing written. Re-run with --apply."); return; }
  if (planned.length === 0) { console.log("\nNothing to write; snapshot NOT written."); return; }

  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshot: Snapshot = {
    taken_at: new Date().toISOString(),
    project_ref: TEST_REF,
    rows: planned.map((p) => ({ id: p.row.id, external_id: p.row.external_id, prior_description: p.row.normalized_payload?.description ?? null })),
  };
  const file = join(SNAPSHOT_DIR, `osm-templated-descriptions-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nsnapshot: ${file} (${snapshot.rows.length} rows)`);

  console.log("applying...");
  let written = 0;
  for (const p of planned) {
    const np = { ...(p.row.normalized_payload ?? {}), description: p.description };
    const u = await db.from("source_record").update({ normalized_payload: np }).eq("id", p.row.id);
    if (u.error) { console.log("UPDATE FAILED:", JSON.stringify(u, null, 2)); throw new Error("write failed"); }
    written += 1;
  }
  console.log(`  wrote ${written} descriptions`);

  // Verify: re-read and confirm counts + that is_active is untouched.
  const after: Row[] = [];
  for (const cat of TEMPLATED_CATEGORIES) {
    let from = 0;
    while (true) {
      const r = await db.from("source_record")
        .select("id, external_id, inferred_category, is_active, raw_payload, normalized_payload")
        .eq("source_id", "osm").eq("inferred_category", cat)
        .order("id").range(from, from + page - 1);
      if (r.error || r.data == null) { console.log("QUERY FAILED:", JSON.stringify(r, null, 2)); throw new Error("verify"); }
      after.push(...(r.data as unknown as Row[]));
      if (r.data.length < page) break;
      from += page;
    }
  }
  console.log("\nAFTER:");
  for (const cat of TEMPLATED_CATEGORIES) {
    const rows = after.filter((r) => r.inferred_category === cat);
    const withDesc = rows.filter((r) => typeof r.normalized_payload?.description === "string" && (r.normalized_payload.description as string).trim().length > 0);
    console.log(`  ${cat.padEnd(14)} ${rows.length} rows, ${withDesc.length} now carry a description, is_active=true ${rows.filter((r) => r.is_active).length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
