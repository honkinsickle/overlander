/**
 * TEST-only shape validation for the two corrected group definitions in
 * data/merge-groups/2026-09-04-hatrock-saltonsea.json.
 *
 * WHY THIS IS SHAPE VALIDATION AND NOT THE REAL ROWS — read this first.
 * The group definitions carry PROD master_place ids. TEST and PROD are
 * independent corpora with independent UUIDs, so NONE of those ids exist on
 * TEST (verified 2026-09-04: 0 of 7 present). A merge of the literal ids can
 * therefore only ever happen against PROD. What this script does instead is
 * rebuild each group's exact SHAPE out of synthetic fixtures — same source_id
 * composition per member, same polygon/point topology, same pre-existing
 * containment edge — run the real merge_master_place() against it, and assert
 * the outcome. That validates the definition's behaviour, not the specific
 * corpus rows.
 *
 * Fixtures are created and deleted here. No corpus row is read or written.
 * Refuses to run against anything but TEST.
 *
 * Usage:
 *   npx tsx --env-file=data/.env data/scripts/verify-merge-groups-hatrock-saltonsea.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const TAG = "group-shape-verify";

// Hat Rock shape (group 83). Empty country near -119.90/45.90 — the earlier
// exclusion harness measured 0 containment edges there, so nothing real
// interferes.
const HR_CANON = "e0000000-0000-4000-8000-0000000000b0";
const HR_VISITOR = "e0000000-0000-4000-8000-0000000000b1";
const HR_NPS_PARK = "e0000000-0000-4000-8000-0000000000b2";
const HR_ROCK = "e0000000-0000-4000-8000-0000000000b3";
// Salton Sea shape (group 5001), a separate patch of the same empty country.
const SS_CANON = "e0000000-0000-4000-8000-0000000000c1";
const SS_VISITOR = "e0000000-0000-4000-8000-0000000000c2";

const ALL_IDS = [HR_CANON, HR_VISITOR, HR_NPS_PARK, HR_ROCK, SS_CANON, SS_VISITOR];
const HR_GROUP = 990083;
const SS_GROUP = 995001;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures.push(`${name}: ${detail}`);
}

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(TEST_HOST)) throw new Error(`SAFETY: SUPABASE_URL is not TEST (${TEST_HOST}). Got: ${url}`);
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function cleanup(c: SupabaseClient): Promise<void> {
  await c.from("merge_audit_log").delete().in("group_id", [HR_GROUP, SS_GROUP]);
  await c.from("place_relationships").delete().in("child_master_place_id", ALL_IDS);
  await c.from("place_relationships").delete().in("parent_master_place_id", ALL_IDS);
  await c.from("place_match").delete().in("master_place_id", ALL_IDS);
  await c.from("source_record").delete().like("external_id", `${TAG}:%`);
  await c.from("master_place").delete().in("id", ALL_IDS);
}

interface Seed {
  id: string;
  name: string;
  lon: number;
  lat: number;
  sources: string[];
  poly?: [number, number, number, number]; // minLon minLat maxLon maxLat
}

async function seedOne(c: SupabaseClient, s: Seed): Promise<void> {
  const row: Record<string, unknown> = {
    id: s.id,
    canonical_name: s.name,
    primary_category: "park_feature",
    geometry: `SRID=4326;POINT(${s.lon} ${s.lat})`,
    description: `${TAG} fixture`,
    source_count: s.sources.length,
    prominence_score: 1,
    is_searchable: false,
  };
  if (s.poly) {
    const [a, b, x, y] = s.poly;
    // master_place.geometry_polygon is MultiPolygon, not Polygon.
    row.geometry_polygon = `SRID=4326;MULTIPOLYGON(((${a} ${b},${x} ${b},${x} ${y},${a} ${y},${a} ${b})))`;
  }
  const ins = await c.from("master_place").insert(row);
  if (ins.error) throw new Error(`seed ${s.id} failed: ${JSON.stringify(ins.error)}`);
  for (const src of s.sources) {
    const sr = await c.from("source_record").insert({
      source_id: src,
      external_id: `${TAG}:${s.id}:${src}`,
      master_place_id: s.id,
      name: s.name,
      geometry: `SRID=4326;POINT(${s.lon} ${s.lat})`,
      raw_payload: { fixture: TAG },
      normalized_payload: { fixture: TAG },
      is_active: true,
    });
    if (sr.error) throw new Error(`seed source_record ${s.id}/${src} failed: ${JSON.stringify(sr.error)}`);
  }
}

interface Snap {
  row: Record<string, unknown> | null;
  srIds: string[];
  edges: number;
}
async function snap(c: SupabaseClient, id: string): Promise<Snap> {
  const row = await c.from("master_place").select("*").eq("id", id).maybeSingle();
  if (row.error) throw new Error(`snap row FAILED: ${JSON.stringify(row.error)}`);
  const sr = await c.from("source_record").select("id").eq("master_place_id", id).order("id");
  if (sr.error) throw new Error(`snap sr FAILED: ${JSON.stringify(sr.error)}`);
  const ch = await c.from("place_relationships").select("*", { count: "exact", head: true }).eq("child_master_place_id", id);
  const pa = await c.from("place_relationships").select("*", { count: "exact", head: true }).eq("parent_master_place_id", id);
  if (ch.error || ch.count == null || pa.error || pa.count == null) {
    throw new Error(`snap edges FAILED: ${JSON.stringify({ ch, pa })}`);
  }
  return { row: row.data as Record<string, unknown> | null, srIds: (sr.data ?? []).map((r) => (r as { id: string }).id), edges: ch.count + pa.count };
}

/** An orphan edge = either endpoint has zero ACTIVE source_records (the v5 bug class). */
async function orphanEdges(c: SupabaseClient): Promise<number> {
  const rel = await c
    .from("place_relationships")
    .select("child_master_place_id,parent_master_place_id")
    .or(`child_master_place_id.in.(${ALL_IDS.join(",")}),parent_master_place_id.in.(${ALL_IDS.join(",")})`);
  if (rel.error) throw new Error(`orphan scan FAILED: ${JSON.stringify(rel.error)}`);
  let orphans = 0;
  for (const e of (rel.data ?? []) as Array<{ child_master_place_id: string; parent_master_place_id: string }>) {
    for (const endpoint of [e.child_master_place_id, e.parent_master_place_id]) {
      const act = await c.from("source_record").select("*", { count: "exact", head: true }).eq("master_place_id", endpoint).eq("is_active", true);
      if (act.error || act.count == null) throw new Error(`orphan endpoint check FAILED: ${JSON.stringify(act)}`);
      if (act.count === 0) orphans++;
    }
  }
  return orphans;
}

function runExecutor(groupId: number, file: string): { status: number | null; stdout: string } {
  const r = spawnSync(
    "npx",
    ["tsx", join(REPO, "data/scripts/execute-merge-groups.ts"), "--groups", String(groupId),
      "--input", file, "--target=test", "--confirm", "--force-blocked", "--executed-by", TAG],
    { encoding: "utf8", cwd: REPO, env: process.env },
  );
  if (r.stderr) console.error(r.stderr);
  return { status: r.status, stdout: r.stdout };
}

async function main(): Promise<void> {
  const c = db();
  const file = join(REPO, ".context", `${TAG}-groups.json`);
  mkdirSync(dirname(file), { recursive: true });

  console.log("=== group-definition SHAPE validation on TEST ===\n");
  await cleanup(c);

  // ---- Hat Rock shape: polygon canonical, 2 merging points inside, 1 excluded
  //      point also inside (containment is exactly what must NOT drag it in).
  console.log("seeding Hat Rock shape (4 members)...");
  await seedOne(c, { id: HR_CANON, name: `${TAG} HR canonical`, lon: -119.900, lat: 45.900, sources: ["state_parks", "wikipedia"], poly: [-119.905, 45.895, -119.895, 45.905] });
  await seedOne(c, { id: HR_VISITOR, name: `${TAG} HR visitor`, lon: -119.9010, lat: 45.9010, sources: ["oregon_state_parks"] });
  await seedOne(c, { id: HR_NPS_PARK, name: `${TAG} HR nps park`, lon: -119.9020, lat: 45.9020, sources: ["nps"] });
  await seedOne(c, { id: HR_ROCK, name: `${TAG} HR rock`, lon: -119.8990, lat: 45.8990, sources: ["nps"] });

  // Mirror PROD: the rock already sits inside the park polygon as a child edge.
  const edge = await c.from("place_relationships").insert({
    child_master_place_id: HR_ROCK, parent_master_place_id: HR_CANON, relationship_type: "contained_in",
  });
  if (edge.error) throw new Error(`seed containment edge failed: ${JSON.stringify(edge.error)}`);

  // ---- Salton Sea shape: polygon canonical, visitor point just OUTSIDE it.
  console.log("seeding Salton Sea shape (2 members)...");
  await seedOne(c, { id: SS_CANON, name: `${TAG} SS canonical`, lon: -119.800, lat: 45.800, sources: ["state_parks"], poly: [-119.805, 45.795, -119.795, 45.805] });
  await seedOne(c, { id: SS_VISITOR, name: `${TAG} SS visitor`, lon: -119.8060, lat: 45.7940, sources: ["california_state_parks"] });

  const groups = [
    {
      group_id: HR_GROUP, size: 4, states: ["OR"],
      canonical_mp_id: HR_CANON, canonical_reason: "shape fixture",
      absorbed_mp_ids: [HR_VISITOR, HR_NPS_PARK],
      excluded_ids: [HR_ROCK],
      member_sides: [
        { id: HR_CANON, canonical_name: "HR canonical", source_ids: ["state_parks", "wikipedia"], source_count: 2, has_polygon: true },
        { id: HR_VISITOR, canonical_name: "HR visitor", source_ids: ["oregon_state_parks"], source_count: 1, has_polygon: false },
        { id: HR_NPS_PARK, canonical_name: "HR nps park", source_ids: ["nps"], source_count: 1, has_polygon: false },
        { id: HR_ROCK, canonical_name: "HR rock", source_ids: ["nps"], source_count: 1, has_polygon: false },
      ],
      pair_keys: [], conflict_summary: [], risk_summary: [],
    },
    {
      group_id: SS_GROUP, size: 2, states: ["CA"],
      canonical_mp_id: SS_CANON, canonical_reason: "shape fixture",
      absorbed_mp_ids: [SS_VISITOR],
      member_sides: [
        { id: SS_CANON, canonical_name: "SS canonical", source_ids: ["state_parks"], source_count: 1, has_polygon: true },
        { id: SS_VISITOR, canonical_name: "SS visitor", source_ids: ["california_state_parks"], source_count: 1, has_polygon: false },
      ],
      pair_keys: [], conflict_summary: [], risk_summary: [],
    },
  ];
  writeFileSync(file, JSON.stringify(groups, null, 2));

  const rockBefore = await snap(c, HR_ROCK);
  const orphansBefore = await orphanEdges(c);
  console.log(`\nrock before: ${rockBefore.srIds.length} source_record(s), ${rockBefore.edges} edge(s); orphan edges in fixture set: ${orphansBefore}`);

  // ================= Hat Rock =================
  console.log("\n--- executing Hat Rock shape (group 83's corrected definition) ---\n");
  const hr = runExecutor(HR_GROUP, file);
  console.log(hr.stdout.split("\n").filter((l) => /canonical:|absorbed:|EXCLUDED:|moves:|audit_id/.test(l)).join("\n"));

  console.log("\n=== HAT ROCK ASSERTIONS ===");
  check("executor exited 0", hr.status === 0, `exit ${hr.status}`);
  check("state_parks polygon row won canonical", hr.stdout.includes(`canonical: ${TAG} HR canonical`) || hr.stdout.includes(HR_CANON), "canonical was not the GIS row");

  const rockAfter = await snap(c, HR_ROCK);
  check("excluded rock row byte-identical across every column",
    JSON.stringify(rockBefore.row) === JSON.stringify(rockAfter.row), "row changed");
  check("excluded rock still owns its own source_record",
    JSON.stringify(rockBefore.srIds) === JSON.stringify(rockAfter.srIds),
    `before=${JSON.stringify(rockBefore.srIds)} after=${JSON.stringify(rockAfter.srIds)}`);
  check("excluded rock gained zero place_relationships edges",
    rockAfter.edges === rockBefore.edges, `before=${rockBefore.edges} after=${rockAfter.edges}`);
  check("excluded rock keeps its pre-existing contained_in edge to the canonical",
    rockAfter.edges === 1, `edges=${rockAfter.edges}`);

  const hrAudit = await c.from("merge_audit_log").select("*").eq("group_id", HR_GROUP).maybeSingle();
  const hrAbsorbed = (hrAudit.data as { absorbed_mp_ids?: string[] } | null)?.absorbed_mp_ids ?? [];
  check("audit lists exactly the 2 merging members", hrAbsorbed.length === 2, `audit=${JSON.stringify(hrAbsorbed)}`);
  check("excluded rock never appears in merge_audit_log", !hrAbsorbed.includes(HR_ROCK), "rock reached the audit row");

  const hrCanon = await snap(c, HR_CANON);
  check("canonical absorbed both merging members' source_records (2 + 1 + 1 = 4)",
    hrCanon.srIds.length === 4, `canonical owns ${hrCanon.srIds.length}`);
  for (const [label, id] of [["visitor", HR_VISITOR], ["nps park", HR_NPS_PARK]] as const) {
    const act = await c.from("source_record").select("*", { count: "exact", head: true }).eq("master_place_id", id).eq("is_active", true);
    check(`${label} row soft-retired (0 active source_records)`, act.count === 0, `count=${act.count}`);
  }
  check("no orphaned edges in the fixture set after the Hat Rock merge",
    (await orphanEdges(c)) === 0, "orphan edge(s) present");

  // ================= Salton Sea =================
  console.log("\n--- executing Salton Sea shape (net-new group 5001's definition) ---\n");
  const ss = runExecutor(SS_GROUP, file);
  console.log(ss.stdout.split("\n").filter((l) => /canonical:|absorbed:|EXCLUDED:|moves:|audit_id/.test(l)).join("\n"));

  console.log("\n=== SALTON SEA ASSERTIONS ===");
  check("executor exited 0", ss.status === 0, `exit ${ss.status}`);
  check("state_parks polygon row won canonical", ss.stdout.includes(SS_CANON), "canonical was not the GIS row");
  check("no member was excluded (none declared)", !ss.stdout.includes("EXCLUDED:"), "an exclusion appeared");
  const ssCanon = await snap(c, SS_CANON);
  check("canonical absorbed the visitor's source_record (1 + 1 = 2)", ssCanon.srIds.length === 2, `owns ${ssCanon.srIds.length}`);
  const ssAct = await c.from("source_record").select("*", { count: "exact", head: true }).eq("master_place_id", SS_VISITOR).eq("is_active", true);
  check("visitor row soft-retired (0 active source_records)", ssAct.count === 0, `count=${ssAct.count}`);
  check("no orphaned edges in the fixture set after the Salton Sea merge",
    (await orphanEdges(c)) === 0, "orphan edge(s) present");

  console.log("\ncleaning up fixtures...");
  await cleanup(c);
  if (existsSync(file)) rmSync(file);
  const left = await c.from("master_place").select("*", { count: "exact", head: true }).in("id", ALL_IDS);
  check("all fixture rows removed", left.count === 0, `${left.count} left`);

  console.log(`\n=== ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`} ===`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
