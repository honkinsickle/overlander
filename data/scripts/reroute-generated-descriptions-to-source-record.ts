/**
 * Reroute `master_place_generated_content` descriptions through the NORMAL
 * source_record → recompute_master_place() path.
 *
 * REPLACES the direct-write approach of
 * `backfill-description-from-generated-content.ts` (PR #327), which wrote
 * straight into `master_place.description` and so violated the documented
 * invariant that recompute_master_place() is the sole writer of master_place.
 * Run that script's `--undo` FIRST; this script assumes the direct writes are
 * already reverted (it only targets rows whose description is empty).
 *
 * WHAT IT DOES
 * For every eligible generated row, upsert one `source_record`:
 *   source_id           'generated_llm' | 'generated_template'
 *   external_id         the master_place id (unique within the source)
 *   master_place_id     pre-linked — see WHY NOT upsert_source_record below
 *   normalized_payload  { "description": <generated_text> }
 * then call `recompute_master_place()` so the description lands through
 * field_precedence like any other source. Precedence 20/21 (20260901000100) is
 * below every real description source, so a genuine source always wins.
 *
 * WHY NOT `upsert_source_record()` — the documented write path.
 * That function cannot set `master_place_id`; it is built for the ingest path
 * where entity resolution links the record afterwards. Leaving it null here
 * would be actively harmful: `matcher.ts` selects unlinked source_records
 * (`.is("master_place_id", null)`) as the ER queue, so 13k synthetic rows would
 * enter entity resolution and could spawn or mis-link master_places. These
 * records are already keyed to a master_place by the generated_content FK —
 * there is nothing for ER to resolve. So this uses the batched PostgREST
 * upsert path that `ingestion/lib/ewkt.ts` exists to serve, with the same
 * (source_id, external_id) conflict target the function uses. Flagged in the PR.
 *
 * TEST by default. `--prod` additionally asserts the PROD project ref.
 *   (default)  dry run — measure + sample, write nothing
 *   --confirm  upsert the source_records, then recompute each master_place
 *   --undo     delete this script's source_records, then recompute each again
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/reroute-generated-descriptions-to-source-record.ts
 *   npx tsx --env-file=.env scripts/reroute-generated-descriptions-to-source-record.ts --confirm
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pointEwkt } from "../ingestion/lib/ewkt.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const PROD_REF = "nqzeywzcowujzyegxbsr";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "generated-source-reroute-snapshots");

const SOURCE_LLM = "generated_llm";
const SOURCE_TEMPLATE = "generated_template";
const GENERATED_SOURCES = [SOURCE_LLM, SOURCE_TEMPLATE];
// Well below every real source (padus, the lowest, is 0.5 by default).
const QUALITY = 0.1;
// PostgREST puts `.in()` filters in the URL; ~500 UUIDs overflows the 16KB
// header limit. 150 is comfortably under it.
const ID_CHUNK = 150;
const PAGE = 1000;
const WRITE_BATCH = 500;

type GcRow = {
  master_place_id: string;
  generated_text: string;
  generation_method: string;
  prompt_version: string | null;
  model_version: string | null;
  generated_at: string;
};
type MpRow = {
  id: string;
  canonical_name: string;
  primary_category: string;
  description: string | null;
  is_searchable: boolean;
  geometry: { coordinates: [number, number] } | null;
};

function fail(label: string, r: unknown): never {
  console.log(`QUERY FAILED [${label}]:`, JSON.stringify(r, null, 2));
  throw new Error(label);
}

async function recomputeAll(db: SupabaseClient, ids: string[], label: string) {
  const limit = pLimit(8);
  let done = 0;
  let failed = 0;
  await Promise.all(
    ids.map((id) =>
      limit(async () => {
        const r = await db.rpc("recompute_master_place", { p_master_place_id: id });
        if (r.error) {
          failed++;
          console.log(`  RECOMPUTE FAILED ${id}:`, JSON.stringify(r.error));
          return;
        }
        done++;
        if (done % 1000 === 0) console.log(`  ${label} ${done}/${ids.length}`);
      }),
    ),
  );
  console.log(`  ${label}: ${done} recomputed, ${failed} failed`);
  return { done, failed };
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
  const ref = url.match(/\/\/([^.]+)\./)?.[1] ?? "<none>";
  const prod = process.argv.includes("--prod");
  const expected = prod ? PROD_REF : TEST_REF;
  if (ref !== expected) {
    throw new Error(`Refusing: expected ${prod ? "PROD" : "TEST"} (${expected}), got ${ref}.`);
  }

  const confirm = process.argv.includes("--confirm");
  const undo = process.argv.includes("--undo");
  if (confirm && undo) throw new Error("--confirm and --undo are mutually exclusive");

  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(
    `[env] ${prod ? "PROD" : "TEST"} ${ref}   mode: ${undo ? "UNDO" : confirm ? "WRITE" : "DRY-RUN (pass --confirm to write)"}\n`,
  );

  if (undo) return runUndo(db);

  // ── 1. Eligible generated rows ─────────────────────────────────────────
  const gc: GcRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await db
      .from("master_place_generated_content")
      .select("master_place_id, generated_text, generation_method, prompt_version, model_version, generated_at")
      .eq("field_name", "description")
      .eq("needs_review", false)
      .order("master_place_id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) fail("generated_content scan", r);
    gc.push(...(r.data as unknown as GcRow[]));
    if (r.data.length < PAGE) break;
  }
  console.log(`generated_content (field_name='description', needs_review=false): ${gc.length}`);

  // ── 2. Their master_place rows ─────────────────────────────────────────
  const mps: MpRow[] = [];
  for (let i = 0; i < gc.length; i += ID_CHUNK) {
    const chunk = gc.slice(i, i + ID_CHUNK).map((g) => g.master_place_id);
    const r = await db
      .from("master_place")
      .select("id, canonical_name, primary_category, description, is_searchable, geometry")
      .in("id", chunk);
    if (r.error || r.data == null) fail("master_place fetch", r);
    mps.push(...(r.data as unknown as MpRow[]));
  }
  const byId = new Map(mps.map((m) => [m.id, m]));
  console.log(`matching master_place rows: ${mps.length}`);

  // ── 3. Plan ────────────────────────────────────────────────────────────
  const isEmpty = (s: string | null) => s == null || s.trim() === "";
  type Plan = { mp: MpRow; gc: GcRow; source: string };
  const planned: Plan[] = [];
  let skipHasDescription = 0;
  let skipNotSearchable = 0;
  let skipNoGeometry = 0;
  let skipBlankText = 0;

  for (const g of gc) {
    const mp = byId.get(g.master_place_id);
    if (mp == null) continue;
    if (!mp.is_searchable) { skipNotSearchable++; continue; }
    // Dual rows: a real source description already resolved onto the column.
    // Skipped per the task's stated population. Note that under precedence it
    // would be SAFE to include them (a real source outranks 20/21) and arguably
    // better — a dual row whose source later goes away would degrade to
    // generated text instead of going blank. Flagged, not done.
    if (!isEmpty(mp.description)) { skipHasDescription++; continue; }
    if (g.generated_text.trim() === "") { skipBlankText++; continue; }
    if (mp.geometry?.coordinates == null) { skipNoGeometry++; continue; }
    planned.push({
      mp,
      gc: g,
      source: g.generation_method === "llm" ? SOURCE_LLM : SOURCE_TEMPLATE,
    });
  }

  const bySource = new Map<string, number>();
  for (const p of planned) bySource.set(p.source, (bySource.get(p.source) ?? 0) + 1);

  console.log(`\nPLAN`);
  console.log(`  skipped — description already resolved (dual): ${skipHasDescription}`);
  console.log(`  skipped — not is_searchable:                   ${skipNotSearchable}`);
  console.log(`  skipped — no geometry:                         ${skipNoGeometry}`);
  console.log(`  skipped — generated_text blank:                ${skipBlankText}`);
  console.log(`  TO UPSERT:                                     ${planned.length}`);
  for (const [s, n] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${s}`);

  console.log(`\n=== SAMPLES ===`);
  const stride = Math.max(1, Math.floor(planned.length / 6));
  for (const p of planned.filter((_, i) => i % stride === 0).slice(0, 6)) {
    console.log(`  [${p.source}] ${p.mp.canonical_name} (${p.mp.primary_category})`);
    console.log(`     -> ${p.gc.generated_text.slice(0, 110)}`);
  }

  if (!confirm) {
    console.log(`\nDRY RUN — nothing written. Re-run with --confirm.`);
    return;
  }
  if (planned.length === 0) {
    console.log(`\nNothing to write; snapshot NOT written.`);
    return;
  }

  // ── 4. Snapshot, upsert, recompute ─────────────────────────────────────
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshot = {
    taken_at: new Date().toISOString(),
    project_ref: ref,
    master_place_ids: planned.map((p) => p.mp.id),
    sources: GENERATED_SOURCES,
  };
  const file = join(SNAPSHOT_DIR, `reroute-${ref}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nsnapshot: ${file} (${snapshot.master_place_ids.length} ids)`);

  console.log(`upserting source_records...`);
  let upserted = 0;
  for (let i = 0; i < planned.length; i += WRITE_BATCH) {
    const rows = planned.slice(i, i + WRITE_BATCH).map((p) => ({
      source_id: p.source,
      external_id: p.mp.id,
      master_place_id: p.mp.id,
      geometry: pointEwkt(p.mp.geometry!.coordinates),
      name: p.mp.canonical_name,
      inferred_category: p.mp.primary_category,
      raw_payload: {
        generated_content: {
          generation_method: p.gc.generation_method,
          prompt_version: p.gc.prompt_version,
          model_version: p.gc.model_version,
          generated_at: p.gc.generated_at,
        },
      },
      normalized_payload: { description: p.gc.generated_text },
      source_quality_score: QUALITY,
      is_active: true,
    }));
    const r = await db.from("source_record").upsert(rows, { onConflict: "source_id,external_id" });
    if (r.error) fail("source_record upsert", r);
    upserted += rows.length;
    if (upserted % 2000 === 0 || upserted === planned.length) console.log(`  ${upserted}/${planned.length}`);
  }

  console.log(`recomputing...`);
  await recomputeAll(db, planned.map((p) => p.mp.id), "recompute");

  // ── 5. Verify against exactly what was planned ─────────────────────────
  const want = new Map(planned.map((p) => [p.mp.id, { text: p.gc.generated_text, source: p.source }]));
  const ids = [...want.keys()];
  let exact = 0;
  let attributed = 0;
  let stillEmpty = 0;
  let realSourceWon = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const r = await db
      .from("master_place")
      .select("id, description, attribution")
      .in("id", ids.slice(i, i + ID_CHUNK));
    if (r.error || r.data == null) fail("verify re-read", r);
    for (const row of r.data as { id: string; description: string | null; attribution: Record<string, string> | null }[]) {
      const w = want.get(row.id)!;
      if (row.description === w.text) exact++;
      else if (isEmpty(row.description)) stillEmpty++;
      else realSourceWon++;
      if (row.attribution?.description === w.source) attributed++;
    }
  }
  console.log(`\nVERIFY (${ids.length} rows):`);
  console.log(`  description == generated text:            ${exact}`);
  console.log(`  attribution.description == generated src: ${attributed}`);
  console.log(`  a REAL source outranked the generated one: ${realSourceWon}`);
  console.log(`  still empty:                              ${stillEmpty}`);
}

async function runUndo(db: SupabaseClient) {
  console.log("deleting generated source_records...");
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await db
      .from("source_record")
      .select("master_place_id")
      .in("source_id", GENERATED_SOURCES)
      .not("master_place_id", "is", null)
      .order("master_place_id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) fail("undo scan", r);
    ids.push(...r.data.map((x) => x.master_place_id as string));
    if (r.data.length < PAGE) break;
  }
  const del = await db.from("source_record").delete().in("source_id", GENERATED_SOURCES);
  if (del.error) fail("undo delete", del);
  console.log(`deleted records for ${ids.length} master_places; recomputing...`);
  await recomputeAll(db, [...new Set(ids)], "undo-recompute");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
