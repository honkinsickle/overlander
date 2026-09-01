/**
 * One-time backfill: copy `master_place_generated_content.generated_text`
 * (field_name = 'description') directly into `master_place.description` for
 * rows that have no description of their own.
 *
 * WHY THIS EXISTS
 * ---------------
 * The day-detail bake path reads `master_place.description` via
 * `pois_along_corridor` → `mapMasterPlaceRow`. It never touches
 * `master_place_generated_content`, so a place with generated content but no
 * source description renders the mapper's fallback string
 * (`"{Title} — {Category}."`). Scoped in
 * `docs/measurements/2026-08-31-generated-content-bake-gap.md` (Population A).
 * Copying the text in makes the bake path pick it up with zero code changes.
 *
 * GAP-FILL ONLY. A row whose `master_place.description` is already non-empty
 * is never touched — same precedence the generated_content table documents
 * ("show master_place.description when present; fall back to this table only
 * when null. Never both.").
 *
 * SCOPE — `--method` (default `llm`).
 * Copying a `template` row's text in ALSO un-hides it from
 * `pois_along_corridor`, which deliberately excludes template-only rows from
 * trip-stop candidacy (`and not (mp.description is null and has_template)`,
 * per docs/decisions/2026-08-21-template-eligibility-provenance-review-
 * decisions.md §2). That is a real behavioural change, not a side effect of
 * the description landing — so templates are opt-in, not the default.
 *
 * NOT WRITTEN: `master_place.attribution`. `recompute_master_place()` rebuilds
 * that map wholesale from `source_record` + `field_precedence` on every call,
 * and every existing `attribution.description` value is a `source_id`. There
 * is no established value for "generated, not sourced", and anything written
 * here would be dropped by the next recompute. Provenance stays recoverable
 * via the `master_place_generated_content` row itself.
 *
 * Snapshots are timestamped and an empty result set is never written.
 *
 * TEST by default. `--prod` additionally asserts the PROD project ref.
 *   (default)  dry run — measure + sample, write nothing
 *   --confirm  perform the update (writes a snapshot first)
 *   --undo     restore master_place.description from the newest snapshot
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/backfill-description-from-generated-content.ts
 *   npx tsx --env-file=.env scripts/backfill-description-from-generated-content.ts --confirm
 *   npx tsx --env-file=.env scripts/backfill-description-from-generated-content.ts --method all --confirm
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const PROD_REF = "nqzeywzcowujzyegxbsr";
const SNAPSHOT_DIR = join(homedir(), ".config", "overlander", "generated-content-copyin-snapshots");

// PostgREST puts `.in()` filters in the URL; ~500 UUIDs overflows the 16KB
// header limit. 150 is comfortably under it.
const ID_CHUNK = 150;
const PAGE = 1000;

type Method = "llm" | "template";
const ALL_METHODS: Method[] = ["llm", "template"];

type GcRow = {
  master_place_id: string;
  generated_text: string;
  generation_method: string;
  needs_review: boolean;
};
type MpRow = {
  id: string;
  canonical_name: string;
  description: string | null;
  is_searchable: boolean;
  primary_category: string;
};
type Snapshot = {
  taken_at: string;
  project_ref: string;
  methods: Method[];
  rows: { id: string; prior_description: string | null; written_description: string }[];
};

function fail(label: string, r: unknown): never {
  console.log(`QUERY FAILED [${label}]:`, JSON.stringify(r, null, 2));
  throw new Error(label);
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

  const methodArg = process.argv[process.argv.indexOf("--method") + 1];
  const methods: Method[] =
    process.argv.includes("--method")
      ? methodArg === "all"
        ? ALL_METHODS
        : (() => {
            if (methodArg !== "llm" && methodArg !== "template") {
              throw new Error(`--method must be one of: llm, template, all (got ${methodArg})`);
            }
            return [methodArg];
          })()
      : ["llm"];

  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(
    `[env] ${prod ? "PROD" : "TEST"} ${ref}   mode: ${undo ? "UNDO" : confirm ? "WRITE" : "DRY-RUN (pass --confirm to write)"}   methods: ${methods.join(",")}\n`,
  );

  if (methods.includes("template")) {
    console.log(
      "!! template rows included. Copying a template description in also makes the row\n" +
        "!! a trip-stop candidate in pois_along_corridor, which currently excludes\n" +
        "!! template-only rows on purpose (ADR 2026-08-21 §2). Confirm that is intended.\n",
    );
  }

  if (undo) return runUndo(db, ref);

  // ── 1. Candidate generated_content rows ────────────────────────────────
  const gc: GcRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await db
      .from("master_place_generated_content")
      .select("master_place_id, generated_text, generation_method, needs_review")
      .eq("field_name", "description")
      .eq("needs_review", false)
      .in("generation_method", methods)
      .order("master_place_id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) fail("generated_content scan", r);
    gc.push(...(r.data as unknown as GcRow[]));
    if (r.data.length < PAGE) break;
  }
  console.log(`generated_content candidates (field_name='description', needs_review=false): ${gc.length}`);

  // ── 2. Their master_place rows ─────────────────────────────────────────
  const mps: MpRow[] = [];
  for (let i = 0; i < gc.length; i += ID_CHUNK) {
    const chunk = gc.slice(i, i + ID_CHUNK).map((g) => g.master_place_id);
    const r = await db
      .from("master_place")
      .select("id, canonical_name, description, is_searchable, primary_category")
      .in("id", chunk);
    if (r.error || r.data == null) fail("master_place fetch", r);
    mps.push(...(r.data as unknown as MpRow[]));
  }
  const byId = new Map(mps.map((m) => [m.id, m]));
  console.log(`matching master_place rows: ${mps.length}`);

  // ── 3. Plan — gap-fill only ────────────────────────────────────────────
  const isEmpty = (s: string | null) => s == null || s.trim() === "";
  type Plan = { mp: MpRow; gc: GcRow };
  const planned: Plan[] = [];
  let skippedHasDescription = 0;
  let skippedNotSearchable = 0;
  let skippedMissingMp = 0;
  let skippedEmptyText = 0;

  for (const g of gc) {
    const mp = byId.get(g.master_place_id);
    if (mp == null) { skippedMissingMp++; continue; }
    if (!mp.is_searchable) { skippedNotSearchable++; continue; }
    if (!isEmpty(mp.description)) { skippedHasDescription++; continue; }
    if (g.generated_text.trim() === "") { skippedEmptyText++; continue; }
    planned.push({ mp, gc: g });
  }

  const byMethod = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const p of planned) {
    byMethod.set(p.gc.generation_method, (byMethod.get(p.gc.generation_method) ?? 0) + 1);
    byCategory.set(p.mp.primary_category, (byCategory.get(p.mp.primary_category) ?? 0) + 1);
  }

  console.log(`\nPLAN (gap-fill only; a row with a description is never overwritten)`);
  console.log(`  skipped — description already present: ${skippedHasDescription}`);
  console.log(`  skipped — not is_searchable:           ${skippedNotSearchable}`);
  console.log(`  skipped — no master_place row:         ${skippedMissingMp}`);
  console.log(`  skipped — generated_text blank:        ${skippedEmptyText}`);
  console.log(`  TO WRITE:                              ${planned.length}`);
  console.log(`\n  by generation_method:`);
  for (const [m, n] of [...byMethod].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(6)}  ${m}`);
  console.log(`\n  by primary_category (top 15):`);
  for (const [c, n] of [...byCategory].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    console.log(`    ${String(n).padStart(6)}  ${c}`);
  }

  console.log(`\n=== SAMPLES ===`);
  const stride = Math.max(1, Math.floor(planned.length / 10));
  for (const p of planned.filter((_, i) => i % stride === 0).slice(0, 10)) {
    console.log(`  [${p.gc.generation_method}] ${p.mp.canonical_name} (${p.mp.primary_category})`);
    console.log(`     -> ${p.gc.generated_text}`);
  }

  if (!confirm) {
    console.log(`\nDRY RUN — nothing written. Re-run with --confirm.`);
    return;
  }
  if (planned.length === 0) {
    console.log(`\nNothing to write; snapshot NOT written.`);
    return;
  }

  // ── 4. Snapshot, then write ────────────────────────────────────────────
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const snapshot: Snapshot = {
    taken_at: new Date().toISOString(),
    project_ref: ref,
    methods,
    rows: planned.map((p) => ({
      id: p.mp.id,
      prior_description: p.mp.description,
      written_description: p.gc.generated_text,
    })),
  };
  const file = join(SNAPSHOT_DIR, `copyin-${ref}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  console.log(`\nsnapshot: ${file} (${snapshot.rows.length} rows)`);

  console.log(`applying...`);
  const limit = pLimit(8);
  let written = 0;
  let failed = 0;
  await Promise.all(
    planned.map((p) =>
      limit(async () => {
        const u = await db
          .from("master_place")
          .update({ description: p.gc.generated_text })
          .eq("id", p.mp.id);
        if (u.error) {
          failed++;
          console.log(`  UPDATE FAILED ${p.mp.id}:`, JSON.stringify(u.error));
          return;
        }
        written++;
        if (written % 500 === 0) console.log(`  ${written}/${planned.length}`);
      }),
    ),
  );
  console.log(`  wrote ${written}, failed ${failed}`);

  // ── 5. Verify by re-reading exactly what was planned ───────────────────
  const plannedIds = planned.map((p) => p.mp.id);
  const after = new Map<string, string | null>();
  for (let i = 0; i < plannedIds.length; i += ID_CHUNK) {
    const r = await db
      .from("master_place")
      .select("id, description")
      .in("id", plannedIds.slice(i, i + ID_CHUNK));
    if (r.error || r.data == null) fail("verify re-read", r);
    for (const row of r.data as { id: string; description: string | null }[]) after.set(row.id, row.description);
  }
  const matched = planned.filter((p) => after.get(p.mp.id) === p.gc.generated_text).length;
  const stillEmpty = planned.filter((p) => isEmpty(after.get(p.mp.id) ?? null)).length;
  console.log(`\nVERIFY: ${matched}/${planned.length} rows now hold exactly the generated text; ${stillEmpty} still empty.`);
}

async function runUndo(db: SupabaseClient, ref: string) {
  if (!existsSync(SNAPSHOT_DIR)) throw new Error(`No snapshot dir ${SNAPSHOT_DIR}`);
  const files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json")).sort();
  const newest = files.at(-1);
  if (!newest) throw new Error("No snapshot to undo from.");
  const snap = JSON.parse(readFileSync(join(SNAPSHOT_DIR, newest), "utf8")) as Snapshot;
  if (snap.project_ref !== ref) throw new Error(`Snapshot ref ${snap.project_ref} != current ${ref}`);
  console.log(`restoring ${snap.rows.length} rows from ${newest}`);

  const limit = pLimit(8);
  let restored = 0;
  await Promise.all(
    snap.rows.map((r) =>
      limit(async () => {
        const u = await db
          .from("master_place")
          .update({ description: r.prior_description })
          .eq("id", r.id);
        if (u.error) { console.log("RESTORE FAILED:", JSON.stringify(u, null, 2)); throw new Error("undo write"); }
        restored++;
      }),
    ),
  );
  console.log(`restored ${restored}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
