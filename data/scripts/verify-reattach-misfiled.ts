/**
 * TEST-only shape validation for the group-78 fix: reattaching a misfiled
 * source_record and confirming the losing master_place RECOVERS its own
 * description.
 *
 * Mirrors the real PROD shape:
 *   - SNA canonical  : state_parks(no desc) + oregon_state_parks "SNA" (correct)
 *                      + oregon_state_parks "Cave" (MISFILED, currently winning
 *                      the description because both are same-priority and the
 *                      tie-break lands on it)
 *   - Cave master_place : state_parks only, its own row, no visitor record
 *   - atlas landform    : the third group-78 member, present so the follow-on
 *                         merge can be exercised on the CORRECTED record
 *
 * Asserts, in order:
 *   1. Before the fix the SNA row's description is the cave text (repro).
 *   2. After reattaching, the SNA row's description RECOVERS the SNA text.
 *   3. The cave row now owns the record and shows the cave text.
 *   4. The subsequent atlas+SNA merge still works on the corrected record and
 *      leaves the cave row untouched.
 *
 * Fixtures are created and deleted here. Refuses to run against anything but TEST.
 *
 * Usage:
 *   npx tsx --env-file=data/.env data/scripts/verify-reattach-misfiled.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const TAG = "reattach-verify";

const SNA = "e0000000-0000-4000-8000-0000000000f1";
const CAVE = "e0000000-0000-4000-8000-0000000000f2";
const ATLAS = "e0000000-0000-4000-8000-0000000000f3";
const ALL = [SNA, CAVE, ATLAS];
const GROUP = 991078;

const SNA_TEXT = "The State Natural Area protects the tuff ring rising from the high desert.";
const CAVE_TEXT = "Fort Rock Cave is a National Historic Landmark near the natural area; location not shared.";
const ATLAS_TEXT = "A volcanic tuff ring about 4,460 feet in diameter standing 200 feet above the plain.";

const failures: string[] = [];
function check(n: string, ok: boolean, d = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${n}${d ? ` — ${d}` : ""}`);
  if (!ok) failures.push(`${n}${d ? `: ${d}` : ""}`);
}

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? "";
  if (!url.includes(TEST_HOST)) throw new Error(`SAFETY: SUPABASE_URL is not TEST. Got: ${url}`);
  return createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
}

async function cleanup(c: SupabaseClient): Promise<void> {
  await c.from("merge_audit_log").delete().eq("group_id", GROUP);
  await c.from("place_relationships").delete().in("child_master_place_id", ALL);
  await c.from("place_relationships").delete().in("parent_master_place_id", ALL);
  await c.from("place_match").delete().in("master_place_id", ALL);
  await c.from("source_record").delete().like("external_id", `${TAG}:%`);
  await c.from("master_place").delete().in("id", ALL);
}

interface SR { src: string; ext: string; name: string; desc?: string; quality?: number }
async function seed(c: SupabaseClient, id: string, name: string, lon: number, lat: number, srs: SR[], poly = false): Promise<void> {
  const row: Record<string, unknown> = {
    id, canonical_name: name, primary_category: "park_feature",
    geometry: `SRID=4326;POINT(${lon} ${lat})`, source_count: srs.length,
    prominence_score: 1, is_searchable: false,
  };
  if (poly) row.geometry_polygon = `SRID=4326;MULTIPOLYGON(((${lon - 0.006} ${lat - 0.006},${lon + 0.006} ${lat - 0.006},${lon + 0.006} ${lat + 0.006},${lon - 0.006} ${lat + 0.006},${lon - 0.006} ${lat - 0.006})))`;
  const i = await c.from("master_place").insert(row);
  if (i.error) throw new Error(`seed mp ${id}: ${JSON.stringify(i.error)}`);
  for (const s of srs) {
    const payload: Record<string, unknown> = { canonical_name: s.name };
    if (s.desc !== undefined) payload.description = s.desc;
    const r = await c.from("source_record").insert({
      source_id: s.src, external_id: `${TAG}:${s.ext}`, master_place_id: id, name: s.name,
      geometry: `SRID=4326;POINT(${lon} ${lat})`, raw_payload: { fixture: TAG },
      normalized_payload: payload, is_active: true,
      ...(s.quality !== undefined ? { source_quality_score: s.quality } : {}),
    });
    if (r.error) throw new Error(`seed sr ${s.ext}: ${JSON.stringify(r.error)}`);
  }
}

async function desc(c: SupabaseClient, id: string): Promise<{ text: string; src: string; n: number }> {
  const r = await c.from("master_place").select("description,attribution,source_count").eq("id", id).maybeSingle();
  if (r.error) throw new Error(`read: ${JSON.stringify(r.error)}`);
  const d = r.data as { description: string | null; attribution: Record<string, string> | null; source_count: number } | null;
  return { text: d?.description ?? "", src: d?.attribution?.description ?? "(none)", n: d?.source_count ?? 0 };
}

function run(argv: string[]): { status: number | null; out: string } {
  const r = spawnSync("npx", ["tsx", ...argv], { encoding: "utf8", cwd: REPO, env: process.env });
  if (r.status !== 0) { console.log(r.stdout); console.error(r.stderr); }
  return { status: r.status, out: r.stdout };
}

async function main(): Promise<void> {
  const c = db();
  await cleanup(c);
  console.log("=== group-78 fix: shape validation on TEST ===\n");

  // The misfiled cave record is given the HIGHER quality score so it wins the
  // same-priority tie-break — reproducing the PROD symptom deterministically
  // rather than relying on whatever order the DB happens to return.
  await seed(c, SNA, `${TAG} Fort Rock SNA`, -119.30, 45.30, [
    { src: "state_parks", ext: "sna:gis", name: `${TAG} Fort Rock SNA` },
    { src: "oregon_state_parks", ext: "sna:visitor", name: `${TAG} Fort Rock SNA`, desc: SNA_TEXT, quality: 1 },
    { src: "oregon_state_parks", ext: "cave:misfiled", name: `${TAG} Fort Rock Cave`, desc: CAVE_TEXT, quality: 9 },
  ], true);
  await seed(c, CAVE, `${TAG} Fort Rock Cave`, -119.303, 45.303, [
    { src: "state_parks", ext: "cave:gis", name: `${TAG} Fort Rock Cave` },
  ]);
  await seed(c, ATLAS, `${TAG} Fort Rock`, -119.3005, 45.3005, [
    { src: "atlas_oddities", ext: "atlas", name: `${TAG} Fort Rock`, desc: ATLAS_TEXT },
  ]);
  for (const id of ALL) {
    const r = await c.rpc("recompute_master_place", { p_master_place_id: id });
    if (r.error) throw new Error(`seed recompute ${id}: ${JSON.stringify(r.error)}`);
  }

  const before = await desc(c, SNA);
  console.log(`SNA before: desc_from=${before.src}\n  "${before.text.slice(0, 96)}"`);
  check("REPRO — SNA row currently shows the CAVE text", before.text === CAVE_TEXT,
    "could not reproduce the misfiling symptom; the rest of this run would be vacuous");

  // ---- the fix ----
  console.log("\n--- running reattach-misfiled-source-record.ts ---");
  const fix = run([join(REPO, "data/scripts/reattach-misfiled-source-record.ts"),
    "--external-id", `${TAG}:cave:misfiled`, "--from", SNA, "--to", CAVE, "--target=test", "--confirm"]);
  check("reattach exited 0", fix.status === 0, `exit ${fix.status}`);

  const after = await desc(c, SNA);
  const caveAfter = await desc(c, CAVE);
  console.log(`\nSNA after:  desc_from=${after.src}\n  "${after.text.slice(0, 96)}"`);
  console.log(`Cave after: desc_from=${caveAfter.src}\n  "${caveAfter.text.slice(0, 96)}"`);

  check("SNA row RECOVERED its own Fort Rock text", after.text === SNA_TEXT, `got "${after.text.slice(0, 60)}"`);
  check("SNA row no longer shows any cave text", !after.text.includes("Cave"), "cave text still present");
  check("cave row now owns the record and shows the cave text", caveAfter.text === CAVE_TEXT, `got "${caveAfter.text.slice(0, 60)}"`);
  check("cave row's source_count increased to 2", caveAfter.n === 2, `source_count=${caveAfter.n}`);
  check("SNA row's source_count fell to 2", after.n === 2, `source_count=${after.n}`);

  // ---- the follow-on merge, on the CORRECTED record ----
  console.log("\n--- follow-on merge (atlas landform + corrected SNA) ---");
  const file = join(REPO, ".context", `${TAG}-groups.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify([{
    group_id: GROUP, size: 2, states: ["OR"], canonical_mp_id: SNA,
    canonical_reason: "fixture", absorbed_mp_ids: [ATLAS],
    member_sides: [
      { id: SNA, canonical_name: "SNA", source_ids: ["state_parks", "oregon_state_parks"], source_count: 2, has_polygon: true },
      { id: ATLAS, canonical_name: "atlas", source_ids: ["atlas_oddities"], source_count: 1, has_polygon: false },
    ], pair_keys: [], conflict_summary: [], risk_summary: [],
  }], null, 2));
  const merge = run([join(REPO, "data/scripts/execute-merge-groups.ts"), "--groups", String(GROUP),
    "--input", file, "--target=test", "--confirm", "--executed-by", TAG]);
  check("merge on the corrected record exited 0", merge.status === 0, `exit ${merge.status}`);

  const merged = await desc(c, SNA);
  const caveFinal = await desc(c, CAVE);
  console.log(`\nSNA after merge: desc_from=${merged.src}\n  "${merged.text.slice(0, 96)}"`);
  check("merged SNA record still shows the SNA text, not the cave's", merged.text === SNA_TEXT, `got "${merged.text.slice(0, 60)}"`);
  check("cave row untouched by the merge", caveFinal.text === CAVE_TEXT && caveFinal.n === 2, `text/source_count changed`);
  const caveEdges = await c.from("place_relationships").select("*", { count: "exact", head: true }).or(`child_master_place_id.eq.${CAVE},parent_master_place_id.eq.${CAVE}`);
  check("cave row gained no relationship edge from the merge", caveEdges.count === 0, `edges=${caveEdges.count}`);

  console.log("\ncleaning up...");
  await cleanup(c);
  if (existsSync(file)) rmSync(file);
  const left = await c.from("master_place").select("*", { count: "exact", head: true }).in("id", ALL);
  check("all fixture rows removed", left.count === 0, `${left.count} left`);

  console.log(`\n=== ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`} ===`);
  if (failures.length) { failures.forEach((f) => console.error(`  ✗ ${f}`)); process.exit(1); }
}

main().catch((e: unknown) => { console.error("FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
