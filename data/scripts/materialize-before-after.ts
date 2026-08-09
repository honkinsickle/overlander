/**
 * Snapshot master_place state + record a baseline timestamp, so a post-run
 * query can identify any pre-existing rows the run modified.
 *
 * Two modes:
 *   node ... --snapshot          → capture, print JSON to stdout + write to
 *                                   data/.cache/mat-baseline.json
 *   node ... --verify <baseline_iso>
 *                                → compare current state to baseline;
 *                                   report any pre-existing rows with
 *                                   updated_at > baseline (which would
 *                                   indicate recompute touched them)
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CACHE = join(HERE, "..", ".cache", "mat-baseline.json");

async function snapshot() {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "znldzjdatkogdktymtvi") throw new Error(`Refusing: not TEST (got ${ref})`);

  const total = await db.from("master_place").select("id", { count: "exact", head: true });
  const searchable = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("is_searchable", true)
    .neq("primary_category", "land_status");
  const { data: maxUpd } = await db
    .from("master_place")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);

  // The baseline cutoff is captured JUST BEFORE materialize starts. Anything
  // with updated_at > cutoff after materialize finishes was either created
  // or modified by the run.
  const cutoff = new Date().toISOString();

  const snap = {
    ref,
    cutoff,
    master_place_total: total.count,
    master_place_searchable_non_land_status: searchable.count,
    max_updated_at_pre: maxUpd?.[0]?.updated_at ?? null,
  };
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(snap, null, 2));
  console.log(JSON.stringify(snap, null, 2));
  console.log(`\nBaseline written to ${CACHE}`);
}

async function verify() {
  const db = getDb();
  const snap = JSON.parse(readFileSync(CACHE, "utf8"));
  const cutoff = snap.cutoff as string;
  console.log(`[verify] baseline cutoff: ${cutoff}`);
  console.log(`[verify] baseline searchable non-land_status: ${snap.master_place_searchable_non_land_status}`);
  console.log(`[verify] baseline max_updated_at: ${snap.max_updated_at_pre}\n`);

  // POST counts
  const total = await db.from("master_place").select("id", { count: "exact", head: true });
  const searchable = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .eq("is_searchable", true)
    .neq("primary_category", "land_status");
  console.log(`master_place total     : ${snap.master_place_total} → ${total.count}   Δ ${(total.count ?? 0) - snap.master_place_total}`);
  console.log(`master_place searchable: ${snap.master_place_searchable_non_land_status} → ${searchable.count}   Δ ${(searchable.count ?? 0) - snap.master_place_searchable_non_land_status}`);

  // DB-side boundary — using the snapshot's max_updated_at_pre avoids any
  // local-vs-DB clock skew. Every pre-existing row's updated_at was ≤ this
  // value at baseline. Any row with (created_at ≤ this AND updated_at > this)
  // after materialize was UPDATE'd during materialize.
  const boundary = snap.max_updated_at_pre as string;
  console.log(`[verify] using DB-side boundary: max_updated_at_pre = ${boundary}\n`);

  const createdSinceBoundary = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .gt("created_at", boundary);
  console.log(`master_place rows with created_at > baseline      : ${createdSinceBoundary.count}   (expect ${(total.count ?? 0) - snap.master_place_total} new)`);

  const modifiedPreExisting = await db
    .from("master_place")
    .select("id", { count: "exact", head: true })
    .lte("created_at", boundary)
    .gt("updated_at", boundary);
  console.log(`master_place PRE-EXISTING rows (created_at ≤ baseline) with updated_at > baseline: ${modifiedPreExisting.count}   ← must be 0`);

  if ((modifiedPreExisting.count ?? 0) > 0) {
    console.log(`\n⚠️  DIVERGENCE from dry-run prediction. Sampling 5:`);
    const { data } = await db
      .from("master_place")
      .select("id, canonical_name, created_at, updated_at")
      .lte("created_at", boundary)
      .gt("updated_at", boundary)
      .limit(5);
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`\n✓ Zero pre-existing master_place rows touched by recompute. Matches dry-run prediction.`);
  }
}

async function main() {
  const mode = process.argv.find((a) => a === "--snapshot" || a === "--verify");
  if (mode === "--snapshot") await snapshot();
  else if (mode === "--verify") await verify();
  else throw new Error("pass --snapshot or --verify");
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
