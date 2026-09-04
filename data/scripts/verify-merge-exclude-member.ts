/**
 * TEST-only integration check for the executor's `excluded_ids` capability.
 *
 * What it proves (the claim the unit tests CANNOT reach): given a 3-member
 * group with one member excluded, a real merge_master_place() call collapses
 * only the other two and leaves the excluded master_place COMPLETELY
 * untouched — same column values, same source_record ownership, and not one
 * new place_relationships edge.
 *
 * Why a dedicated harness rather than a vitest case: this writes to the TEST
 * database. It is deliberately kept out of `npm run -w data test` (which CI
 * runs) for the same reason `test:er` is — CI has no business mutating TEST.
 *
 * Fixtures are synthetic rows created and deleted by this script. It never
 * touches corpus data. It refuses to run against anything but TEST.
 *
 * Usage:
 *   npx tsx --env-file=data/.env data/scripts/verify-merge-exclude-member.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const TAG = "exclude-member-verify";

/** Fixed UUIDs so a crashed run is cleanable by re-running. */
const CANON = "e0000000-0000-4000-8000-00000000c001";
const ABSORB = "e0000000-0000-4000-8000-00000000a002";
const EXCLUDED = "e0000000-0000-4000-8000-00000000e003";
const GROUP_ID = 990001;

interface Failure {
  check: string;
  detail: string;
}
const failures: Failure[] = [];
function check(name: string, ok: boolean, detail: string): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures.push({ check: name, detail });
}

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(TEST_HOST)) {
    throw new Error(`SAFETY: refusing to run — SUPABASE_URL is not TEST (${TEST_HOST}). Got: ${url}`);
  }
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

/** Every table merge_master_place() writes, plus master_place itself. */
async function cleanup(c: SupabaseClient): Promise<void> {
  const ids = [CANON, ABSORB, EXCLUDED];
  await c.from("merge_audit_log").delete().eq("group_id", GROUP_ID);
  await c.from("place_relationships").delete().in("child_master_place_id", ids);
  await c.from("place_relationships").delete().in("parent_master_place_id", ids);
  await c.from("place_match").delete().in("master_place_id", ids);
  await c.from("source_record").delete().like("external_id", `${TAG}:%`);
  await c.from("master_place").delete().in("id", ids);
}

async function seed(c: SupabaseClient): Promise<void> {
  // Three distinct points ~200m apart near Hat Rock, OR — realistic geometry,
  // far from any real corpus row so containment recompute finds nothing.
  const mps = [
    { id: CANON, canonical_name: `${TAG} canonical`, lon: -119.9001, lat: 45.9001 },
    { id: ABSORB, canonical_name: `${TAG} absorbed`, lon: -119.9003, lat: 45.9003 },
    { id: EXCLUDED, canonical_name: `${TAG} excluded`, lon: -119.9005, lat: 45.9005 },
  ];
  for (const m of mps) {
    const ins = await c.from("master_place").insert({
      id: m.id,
      canonical_name: m.canonical_name,
      primary_category: "park_feature",
      geometry: `SRID=4326;POINT(${m.lon} ${m.lat})`,
      description: `${TAG} fixture`,
      source_count: 1,
      prominence_score: 1,
      is_searchable: false,
    });
    if (ins.error) throw new Error(`seed master_place ${m.id} failed: ${JSON.stringify(ins.error)}`);

    const sr = await c.from("source_record").insert({
      source_id: "nps",
      external_id: `${TAG}:${m.id}`,
      master_place_id: m.id,
      name: m.canonical_name,
      geometry: `SRID=4326;POINT(${m.lon} ${m.lat})`,
      raw_payload: { fixture: TAG },
      normalized_payload: { fixture: TAG },
      is_active: true,
    });
    if (sr.error) throw new Error(`seed source_record for ${m.id} failed: ${JSON.stringify(sr.error)}`);
  }
}

interface Snapshot {
  row: Record<string, unknown> | null;
  srIds: string[];
  edgeCount: number;
}

async function snapshot(c: SupabaseClient, mpId: string): Promise<Snapshot> {
  const row = await c.from("master_place").select("*").eq("id", mpId).maybeSingle();
  if (row.error) throw new Error(`snapshot master_place failed: ${JSON.stringify(row.error)}`);
  const sr = await c.from("source_record").select("id").eq("master_place_id", mpId).order("id");
  if (sr.error) throw new Error(`snapshot source_record failed: ${JSON.stringify(sr.error)}`);
  const asChild = await c
    .from("place_relationships")
    .select("*", { count: "exact", head: true })
    .eq("child_master_place_id", mpId);
  const asParent = await c
    .from("place_relationships")
    .select("*", { count: "exact", head: true })
    .eq("parent_master_place_id", mpId);
  if (asChild.error || asChild.count == null) throw new Error(`snapshot edges(child) FAILED: ${JSON.stringify(asChild)}`);
  if (asParent.error || asParent.count == null) throw new Error(`snapshot edges(parent) FAILED: ${JSON.stringify(asParent)}`);
  return {
    row: row.data as Record<string, unknown> | null,
    srIds: (sr.data ?? []).map((r) => (r as { id: string }).id),
    edgeCount: asChild.count + asParent.count,
  };
}

async function main(): Promise<void> {
  const c = db();
  const groupFile = join(REPO, ".context", `${TAG}-groups.json`);

  console.log(`=== ${TAG} — TEST-only integration check ===\n`);
  console.log("cleaning any residue from a prior run...");
  await cleanup(c);

  console.log("seeding 3 fixture master_places (+1 source_record each)...");
  await seed(c);

  // The excluded member scores identically to the others (all 1 source, no
  // state_parks), so it genuinely ties — exactly the Group 83 shape.
  const group = [
    {
      group_id: GROUP_ID,
      size: 3,
      states: ["OR"],
      canonical_mp_id: CANON,
      canonical_reason: "fixture",
      absorbed_mp_ids: [ABSORB, EXCLUDED],
      member_sides: [
        { id: CANON, canonical_name: `${TAG} canonical`, source_ids: ["nps", "wikipedia"], source_count: 2, has_polygon: false },
        { id: ABSORB, canonical_name: `${TAG} absorbed`, source_ids: ["nps"], source_count: 1, has_polygon: false },
        { id: EXCLUDED, canonical_name: `${TAG} excluded`, source_ids: ["nps"], source_count: 1, has_polygon: false },
      ],
      pair_keys: [],
      conflict_summary: [],
      risk_summary: [],
      excluded_ids: [EXCLUDED],
    },
  ];
  mkdirSync(dirname(groupFile), { recursive: true });
  writeFileSync(groupFile, JSON.stringify(group, null, 2));

  const before = await snapshot(c, EXCLUDED);
  console.log(`\nexcluded row before: ${before.srIds.length} source_record(s), ${before.edgeCount} edge(s)`);

  console.log("\nrunning the executor (--target=test --confirm)...\n");
  const run = spawnSync(
    "npx",
    [
      "tsx", join(REPO, "data/scripts/execute-merge-groups.ts"),
      "--groups", String(GROUP_ID),
      "--input", groupFile,
      "--target=test", "--confirm",
      "--executed-by", TAG,
    ],
    { encoding: "utf8", cwd: REPO, env: process.env },
  );
  console.log(run.stdout);
  if (run.stderr) console.error(run.stderr);

  console.log("\n=== ASSERTIONS ===");
  check("executor exited 0", run.status === 0, `exit ${run.status}`);
  check(
    "executor printed the excluded member as EXCLUDED",
    run.stdout.includes(`EXCLUDED:`) && run.stdout.includes(EXCLUDED),
    "no EXCLUDED line naming the held-out id",
  );

  const after = await snapshot(c, EXCLUDED);

  // 1. The excluded master_place row is byte-identical.
  const beforeJson = JSON.stringify(before.row);
  const afterJson = JSON.stringify(after.row);
  check("excluded master_place row unchanged (every column)", beforeJson === afterJson,
    `before=${beforeJson?.slice(0, 200)} after=${afterJson?.slice(0, 200)}`);

  // 2. Its source_record is still its own — not moved to the canonical.
  check("excluded row still owns its source_record(s)",
    JSON.stringify(before.srIds) === JSON.stringify(after.srIds),
    `before=${JSON.stringify(before.srIds)} after=${JSON.stringify(after.srIds)}`);

  // 3. Not one new relationship edge, in either direction.
  check("excluded row gained no place_relationships edge",
    after.edgeCount === before.edgeCount,
    `before=${before.edgeCount} after=${after.edgeCount}`);

  // 4. The other two DID merge — otherwise the above passes vacuously.
  const canon = await snapshot(c, CANON);
  const absorbed = await c.from("master_place").select("id,source_count").eq("id", ABSORB).maybeSingle();
  check("canonical absorbed the non-excluded member's source_record", canon.srIds.length === 2,
    `canonical owns ${canon.srIds.length} source_record(s), expected 2`);
  check("absorbed row was soft-retired (0 active source_records)",
    (await c.from("source_record").select("*", { count: "exact", head: true }).eq("master_place_id", ABSORB).eq("is_active", true)).count === 0,
    "absorbed row still owns active source_records");
  check("absorbed master_place row still exists (soft-retire, not delete)", absorbed.data != null, "row vanished");

  // 5. The audit row records the exclusion.
  const audit = await c.from("merge_audit_log").select("*").eq("group_id", GROUP_ID).maybeSingle();
  const absorbedInAudit = (audit.data as { absorbed_mp_ids?: string[] } | null)?.absorbed_mp_ids ?? [];
  check("audit row lists exactly one absorbed id", absorbedInAudit.length === 1,
    `audit absorbed_mp_ids=${JSON.stringify(absorbedInAudit)}`);
  check("audit row does NOT list the excluded id", !absorbedInAudit.includes(EXCLUDED),
    "excluded id reached merge_audit_log");

  console.log("\ncleaning up fixtures...");
  await cleanup(c);
  if (existsSync(groupFile)) rmSync(groupFile);
  const residue = await c.from("master_place").select("*", { count: "exact", head: true }).in("id", [CANON, ABSORB, EXCLUDED]);
  check("all fixture rows removed", residue.count === 0, `${residue.count} fixture row(s) left behind`);

  console.log(`\n=== ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`} ===`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f.check}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
