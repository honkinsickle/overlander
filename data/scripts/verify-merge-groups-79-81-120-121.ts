/**
 * TEST-only SHAPE validation for the four corrected group definitions in
 * data/merge-groups/2026-09-04-darlingtonia-farewellbend-sumpter-facerock.json.
 *
 * WHY SHAPE, NOT REAL ROWS — the definitions carry PROD master_place ids; TEST
 * is an independent corpus with independent UUIDs, so a merge of the literal ids
 * can only happen against PROD. This rebuilds each group's exact SHAPE from
 * synthetic fixtures (same source composition, polygon/point topology, same
 * pre-existing contained_in edges), runs the real merge_master_place() via the
 * executor, and asserts the outcome. Two mechanics are exercised:
 *   - 79/81/120: GIS-polygon canonical + 2 absorbed points, and the ABSORBED
 *     atlas/nps point carries a contained_in -> canonical edge that must collapse
 *     to a self-ref and be DROPPED (the v2 pre-repoint delete; TEST 55/89 class).
 *   - 5002 (Face Rock park-side): GIS canonical + 1 absorbed visitor, plus a
 *     BYSTANDER (the atlas rock, NOT a member) that carries a contained_in ->
 *     canonical edge which must SURVIVE the merge intact (both endpoints active).
 *
 * Fixtures created + deleted here. No corpus row read or written. Refuses non-TEST.
 * Usage: npx tsx --env-file=data/.env data/scripts/verify-merge-groups-79-81-120-121.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const TAG = "group-shape-verify-4";

// Each group in its own patch of empty OR country (far from the hatrock harness).
type Grp = {
  key: string; groupId: number; lon: number; lat: number;
  // absorbed points, each: [suffix, source_id, hasEdgeToCanonical]
  absorbed: [string, string, boolean][];
  // bystander (not a member): [suffix, source_id, hasEdgeToCanonical] | null
  bystander: [string, string, boolean] | null;
};
const uid = (g: string, s: string) => `e0000000-0000-4000-8000-0000${g}00000${s}`;
const GROUPS: Grp[] = [
  { key: "79", groupId: 990079, lon: -119.70, lat: 45.70, absorbed: [["1", "oregon_state_parks", false], ["2", "atlas_oddities", true]], bystander: null },
  { key: "81", groupId: 990081, lon: -119.60, lat: 45.60, absorbed: [["1", "oregon_state_parks", false], ["2", "nps", true]], bystander: null },
  { key: "20", groupId: 990120, lon: -119.50, lat: 45.50, absorbed: [["1", "oregon_state_parks", false], ["2", "atlas_oddities", true]], bystander: null },
  { key: "02", groupId: 995002, lon: -119.40, lat: 45.40, absorbed: [["1", "oregon_state_parks", false]], bystander: ["9", "atlas_oddities", true] },
];
const canonId = (g: Grp) => uid(g.key, "0");

function allIdsFor(g: Grp): string[] {
  const ids = [canonId(g), ...g.absorbed.map(([s]) => uid(g.key, s))];
  if (g.bystander) ids.push(uid(g.key, g.bystander[0]));
  return ids;
}
const ALL_IDS = GROUPS.flatMap(allIdsFor);
const ALL_GROUP_IDS = GROUPS.map((g) => g.groupId);

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
  await c.from("merge_audit_log").delete().in("group_id", ALL_GROUP_IDS);
  await c.from("place_relationships").delete().in("child_master_place_id", ALL_IDS);
  await c.from("place_relationships").delete().in("parent_master_place_id", ALL_IDS);
  await c.from("place_match").delete().in("master_place_id", ALL_IDS);
  await c.from("source_record").delete().like("external_id", `${TAG}:%`);
  await c.from("master_place").delete().in("id", ALL_IDS);
}

async function seedOne(c: SupabaseClient, id: string, name: string, lon: number, lat: number, sources: string[], poly?: [number, number, number, number]): Promise<void> {
  const row: Record<string, unknown> = {
    id, canonical_name: name, primary_category: "park_feature",
    geometry: `SRID=4326;POINT(${lon} ${lat})`, description: `${TAG} fixture`,
    source_count: sources.length, prominence_score: 1, is_searchable: false,
  };
  if (poly) { const [a, b, x, y] = poly; row.geometry_polygon = `SRID=4326;MULTIPOLYGON(((${a} ${b},${x} ${b},${x} ${y},${a} ${y},${a} ${b})))`; }
  const ins = await c.from("master_place").insert(row);
  if (ins.error) throw new Error(`seed ${id} failed: ${JSON.stringify(ins.error)}`);
  for (const src of sources) {
    const sr = await c.from("source_record").insert({
      source_id: src, external_id: `${TAG}:${id}:${src}`, master_place_id: id, name,
      geometry: `SRID=4326;POINT(${lon} ${lat})`, raw_payload: { fixture: TAG }, normalized_payload: { fixture: TAG }, is_active: true,
    });
    if (sr.error) throw new Error(`seed source_record ${id}/${src} failed: ${JSON.stringify(sr.error)}`);
  }
}

async function snap(c: SupabaseClient, id: string) {
  const row = await c.from("master_place").select("*").eq("id", id).maybeSingle();
  const sr = await c.from("source_record").select("id").eq("master_place_id", id).order("id");
  const ch = await c.from("place_relationships").select("*", { count: "exact", head: true }).eq("child_master_place_id", id);
  const pa = await c.from("place_relationships").select("*", { count: "exact", head: true }).eq("parent_master_place_id", id);
  if (row.error || sr.error || ch.error || ch.count == null || pa.error || pa.count == null) throw new Error(`snap ${id} FAILED`);
  return { row: row.data as Record<string, unknown> | null, srIds: (sr.data ?? []).map((r) => (r as { id: string }).id), edges: ch.count + pa.count };
}

async function activeSr(c: SupabaseClient, id: string): Promise<number> {
  const r = await c.from("source_record").select("*", { count: "exact", head: true }).eq("master_place_id", id).eq("is_active", true);
  if (r.error || r.count == null) throw new Error(`activeSr ${id} FAILED`);
  return r.count;
}

async function orphanEdges(c: SupabaseClient): Promise<number> {
  const rel = await c.from("place_relationships").select("child_master_place_id,parent_master_place_id")
    .or(`child_master_place_id.in.(${ALL_IDS.join(",")}),parent_master_place_id.in.(${ALL_IDS.join(",")})`);
  if (rel.error) throw new Error(`orphan scan FAILED`);
  let orphans = 0;
  for (const e of (rel.data ?? []) as Array<{ child_master_place_id: string; parent_master_place_id: string }>) {
    for (const ep of [e.child_master_place_id, e.parent_master_place_id]) {
      if ((await activeSr(c, ep)) === 0) orphans++;
    }
  }
  return orphans;
}

function runExecutor(groupId: number, file: string): { status: number | null; stdout: string } {
  const r = spawnSync("npx", ["tsx", join(REPO, "data/scripts/execute-merge-groups.ts"),
    "--groups", String(groupId), "--input", file, "--target=test", "--confirm", "--force-blocked", "--executed-by", TAG],
    { encoding: "utf8", cwd: REPO, env: process.env });
  if (r.stderr) console.error(r.stderr);
  return { status: r.status, stdout: r.stdout };
}

async function main(): Promise<void> {
  const c = db();
  const file = join(REPO, ".context", `${TAG}-groups.json`);
  mkdirSync(dirname(file), { recursive: true });
  console.log("=== 4-group SHAPE validation on TEST ===\n");
  await cleanup(c);

  const defs: unknown[] = [];
  for (const g of GROUPS) {
    const canon = canonId(g);
    // canonical: state_parks+wikipedia polygon (scoreMember 112).
    await seedOne(c, canon, `${TAG} ${g.key} canonical`, g.lon, g.lat, ["state_parks", "wikipedia"], [g.lon - 0.005, g.lat - 0.005, g.lon + 0.005, g.lat + 0.005]);
    const members: unknown[] = [{ id: canon, canonical_name: `${g.key} canonical`, source_ids: ["state_parks", "wikipedia"], source_count: 2, has_polygon: true }];
    const absorbedIds: string[] = [];
    let i = 0;
    for (const [suf, src, hasEdge] of g.absorbed) {
      const id = uid(g.key, suf);
      await seedOne(c, id, `${TAG} ${g.key} absorbed ${suf}`, g.lon + 0.001 * (++i), g.lat + 0.001 * i, [src]);
      if (hasEdge) {
        const e = await c.from("place_relationships").insert({ child_master_place_id: id, parent_master_place_id: canon, relationship_type: "contained_in" });
        if (e.error) throw new Error(`edge ${id} failed: ${JSON.stringify(e.error)}`);
      }
      absorbedIds.push(id);
      members.push({ id, canonical_name: `${g.key} absorbed ${suf}`, source_ids: [src], source_count: 1, has_polygon: false });
    }
    // bystander (not a member) with its own edge to the canonical.
    if (g.bystander) {
      const [suf, src, hasEdge] = g.bystander;
      const id = uid(g.key, suf);
      await seedOne(c, id, `${TAG} ${g.key} bystander ${suf}`, g.lon + 0.002, g.lat - 0.002, [src]);
      if (hasEdge) {
        const e = await c.from("place_relationships").insert({ child_master_place_id: id, parent_master_place_id: canon, relationship_type: "contained_in" });
        if (e.error) throw new Error(`bystander edge ${id} failed: ${JSON.stringify(e.error)}`);
      }
    }
    defs.push({ group_id: g.groupId, size: 1 + absorbedIds.length, states: ["OR"], canonical_mp_id: canon, canonical_reason: "shape fixture", absorbed_mp_ids: absorbedIds, member_sides: members, pair_keys: [], conflict_summary: [], risk_summary: [] });
  }
  writeFileSync(file, JSON.stringify(defs, null, 2));

  for (const g of GROUPS) {
    const canon = canonId(g);
    const isBystanderShape = !!g.bystander;
    console.log(`\n--- group ${g.key} (executor group ${g.groupId})${isBystanderShape ? " [bystander shape]" : " [absorbed-edge shape]"} ---`);

    // pre-snapshots of the edge-carrying members
    const edgeMember = g.absorbed.find(([, , e]) => e);
    const preAbsorbedEdge = edgeMember ? await snap(c, uid(g.key, edgeMember[0])) : null;
    const bysId = g.bystander ? uid(g.key, g.bystander[0]) : null;
    const preBystander = bysId ? await snap(c, bysId) : null;

    const res = runExecutor(g.groupId, file);
    console.log(res.stdout.split("\n").filter((l) => /canonical:|absorbed:|EXCLUDED:|moves:|audit_id/.test(l)).join("\n"));

    check(`[${g.key}] executor exited 0`, res.status === 0, `exit ${res.status}`);
    check(`[${g.key}] GIS polygon row won canonical`, res.stdout.includes(canon), "canonical was not the GIS row");

    // canonical absorbed everyone's source_records: 2 (GIS) + 1 per absorbed
    const canonSnap = await snap(c, canon);
    const expectSr = 2 + g.absorbed.length;
    check(`[${g.key}] canonical owns ${expectSr} source_records`, canonSnap.srIds.length === expectSr, `owns ${canonSnap.srIds.length}`);

    for (const [suf] of g.absorbed) {
      const id = uid(g.key, suf);
      check(`[${g.key}] absorbed ${suf} soft-retired (0 active SR)`, (await activeSr(c, id)) === 0, "still active");
    }

    // the absorbed edge-carrying member: its contained_in edge must be DROPPED (self-ref cleanup)
    if (edgeMember && preAbsorbedEdge) {
      const post = await snap(c, uid(g.key, edgeMember[0]));
      check(`[${g.key}] absorbed ${edgeMember[0]}'s contained_in->canonical edge DROPPED`, preAbsorbedEdge.edges === 1 && post.edges === 0, `before=${preAbsorbedEdge.edges} after=${post.edges}`);
    }

    // audit lists exactly the absorbed members (not the bystander)
    const audit = await c.from("merge_audit_log").select("*").eq("group_id", g.groupId).maybeSingle();
    const absorbed = (audit.data as { absorbed_mp_ids?: string[] } | null)?.absorbed_mp_ids ?? [];
    check(`[${g.key}] audit lists exactly ${g.absorbed.length} absorbed`, absorbed.length === g.absorbed.length, `audit=${JSON.stringify(absorbed)}`);

    // bystander: byte-identical, keeps its SR + its edge, never in audit
    if (bysId && preBystander) {
      const post = await snap(c, bysId);
      check(`[${g.key}] BYSTANDER row byte-identical`, JSON.stringify(preBystander.row) === JSON.stringify(post.row), "row changed");
      check(`[${g.key}] BYSTANDER keeps its source_record`, JSON.stringify(preBystander.srIds) === JSON.stringify(post.srIds), "SR changed");
      check(`[${g.key}] BYSTANDER keeps its contained_in edge intact`, preBystander.edges === 1 && post.edges === 1, `before=${preBystander.edges} after=${post.edges}`);
      check(`[${g.key}] BYSTANDER never in merge_audit_log`, !absorbed.includes(bysId), "bystander reached the audit");
    }

    check(`[${g.key}] no orphaned edges in the fixture set`, (await orphanEdges(c)) === 0, "orphan edge(s) present");
  }

  console.log("\ncleaning up fixtures...");
  await cleanup(c);
  if (existsSync(file)) rmSync(file);
  const left = await c.from("master_place").select("*", { count: "exact", head: true }).in("id", ALL_IDS);
  check("all fixture rows removed", left.count === 0, `${left.count} left`);

  console.log(`\n=== ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`} ===`);
  if (failures.length > 0) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}
main().catch((e: unknown) => { console.error("FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
