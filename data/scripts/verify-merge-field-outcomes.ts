/**
 * TEST-only shape validation for what recompute_master_place() actually
 * PRODUCES after a merge — the questions PR #379 left as expectations.
 *
 * Four scenarios, each a real merge_master_place() call against synthetic
 * fixtures whose source composition mirrors a real group:
 *
 *   A  groups 3 / 95  — nps canonical (no hours) absorbing a visitor row that
 *                       HAS hours. #379 assumed the hours survive but flagged
 *                       it unverified. resolve_field() INNER JOINs
 *                       field_precedence, so a source with no precedence row
 *                       for a field is dropped entirely and `hours` is
 *                       clearable — the assumption is not free.
 *   C1 groups 66 / 70 — state_parks canonical with a BLANK description and a
 *                       truncated name ("Dosewallips"), absorbing a visitor
 *                       row with the full text and the fuller name.
 *   C2 group 24       — visitor+state_parks canonical whose description is
 *                       driving directions, absorbing an atlas row carrying
 *                       the substantive text.
 *   D  groups 24/86/88 — the "self-reference hazard": absorbed is ALREADY in a
 *                       place_relationships row with the canonical before the
 *                       merge. Checks the edge is neither orphaned, duplicated,
 *                       nor left as a self-reference.
 *
 * Fixtures are created and deleted here; no corpus row is read or written.
 * Refuses to run against anything but TEST.
 *
 * Usage:
 *   npx tsx --env-file=data/.env data/scripts/verify-merge-field-outcomes.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const TAG = "field-outcome-verify";

const ID = (n: string) => `e0000000-0000-4000-8000-0000000000${n}`;
const A_CANON = ID("a1"), A_ABS = ID("a2");
const C1_CANON = ID("d1"), C1_ABS = ID("d2");
const C2_CANON = ID("d3"), C2_ABS = ID("d4");
const D_CANON = ID("e1"), D_ABS = ID("e2");
const ALL = [A_CANON, A_ABS, C1_CANON, C1_ABS, C2_CANON, C2_ABS, D_CANON, D_ABS];
const G = { A: 991003, C1: 991066, C2: 991024, D: 991086 };

const failures: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}
function note(name: string, value: unknown): void {
  console.log(`  · ${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

function db(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(TEST_HOST)) throw new Error(`SAFETY: SUPABASE_URL is not TEST. Got: ${url}`);
  return createClient(url, key, { auth: { persistSession: false } });
}

async function cleanup(c: SupabaseClient): Promise<void> {
  await c.from("merge_audit_log").delete().in("group_id", Object.values(G));
  await c.from("place_relationships").delete().in("child_master_place_id", ALL);
  await c.from("place_relationships").delete().in("parent_master_place_id", ALL);
  await c.from("place_match").delete().in("master_place_id", ALL);
  await c.from("source_record").delete().like("external_id", `${TAG}:%`);
  await c.from("master_place").delete().in("id", ALL);
}

interface SR { src: string; name: string; description?: string; hours?: unknown }
async function seed(c: SupabaseClient, id: string, name: string, lon: number, lat: number, srs: SR[], poly = false): Promise<void> {
  const row: Record<string, unknown> = {
    id, canonical_name: name, primary_category: "park_feature",
    geometry: `SRID=4326;POINT(${lon} ${lat})`, source_count: srs.length,
    prominence_score: 1, is_searchable: false,
  };
  if (poly) row.geometry_polygon = `SRID=4326;MULTIPOLYGON(((${lon - 0.01} ${lat - 0.01},${lon + 0.01} ${lat - 0.01},${lon + 0.01} ${lat + 0.01},${lon - 0.01} ${lat + 0.01},${lon - 0.01} ${lat - 0.01})))`;
  const ins = await c.from("master_place").insert(row);
  if (ins.error) throw new Error(`seed mp ${id}: ${JSON.stringify(ins.error)}`);
  for (const s of srs) {
    // normalized_payload is what resolve_field() reads.
    const payload: Record<string, unknown> = { canonical_name: s.name };
    if (s.description !== undefined) payload.description = s.description;
    if (s.hours !== undefined) payload.hours = s.hours;
    const r = await c.from("source_record").insert({
      source_id: s.src, external_id: `${TAG}:${id}:${s.src}`, master_place_id: id,
      name: s.name, geometry: `SRID=4326;POINT(${lon} ${lat})`,
      raw_payload: { fixture: TAG }, normalized_payload: payload, is_active: true,
    });
    if (r.error) throw new Error(`seed sr ${id}/${s.src}: ${JSON.stringify(r.error)}`);
  }
}

function runExecutor(groupId: number, file: string): number | null {
  const r = spawnSync("npx", ["tsx", join(REPO, "data/scripts/execute-merge-groups.ts"),
    "--groups", String(groupId), "--input", file, "--target=test", "--confirm",
    "--force-blocked", "--executed-by", TAG], { encoding: "utf8", cwd: REPO, env: process.env });
  if (r.status !== 0) { console.log(r.stdout); console.error(r.stderr); }
  return r.status;
}

async function mp(c: SupabaseClient, id: string) {
  const r = await c.from("master_place").select("*").eq("id", id).maybeSingle();
  if (r.error) throw new Error(`read mp: ${JSON.stringify(r.error)}`);
  return r.data as Record<string, unknown> | null;
}

async function main(): Promise<void> {
  const c = db();
  const file = join(REPO, ".context", `${TAG}-groups.json`);
  mkdirSync(dirname(file), { recursive: true });
  await cleanup(c);

  const NPS_DESC = "NPS long-form history of the park, several paragraphs worth.";
  const VIS_DESC = "Short visitor blurb about living history programs.";
  const HOURS = { monday: "9-5", tuesday: "9-5" };

  // A — nps canonical (no hours) + visitor absorbed (has hours)
  await seed(c, A_CANON, "A nps park", -119.70, 45.70, [{ src: "nps", name: "A nps park", description: NPS_DESC }]);
  await seed(c, A_ABS, "A visitor park", -119.7005, 45.7005, [{ src: "california_state_parks", name: "A visitor park", description: VIS_DESC, hours: HOURS }]);

  // C1 — state_parks canonical, blank description, truncated name
  await seed(c, C1_CANON, "Dosewallips", -119.60, 45.60, [{ src: "state_parks", name: "Dosewallips" }], true);
  await seed(c, C1_ABS, "Dosewallips State Park", -119.6005, 45.6005, [{ src: "washington_state_parks", name: "Dosewallips State Park", description: "Full WA visitor text about camping, elk herds and the river." }]);

  // C2 — visitor+state_parks canonical whose description is directions
  await seed(c, C2_CANON, "Malakoff Diggins SHP", -119.50, 45.50, [
    { src: "california_state_parks", name: "Malakoff Diggins SHP", description: "Travel 11-miles north on highway-49 toward Downieville." },
    { src: "state_parks", name: "Malakoff Diggins SHP" }], true);
  await seed(c, C2_ABS, "Malakoff Diggins", -119.5005, 45.5005, [{ src: "atlas_oddities", name: "Malakoff Diggins", description: "Long atlas text about the largest hydraulic mine and the Humbug boomtown." }]);

  // D — self-reference hazard: edge already exists between the two
  await seed(c, D_CANON, "D canonical park", -119.40, 45.40, [
    { src: "nevada_state_parks", name: "D canonical park", description: "State park text." },
    { src: "state_parks", name: "D canonical park" }], true);
  await seed(c, D_ABS, "D atlas feature", -119.4005, 45.4005, [{ src: "atlas_oddities", name: "D atlas feature", description: "Atlas text." }]);
  const e = await c.from("place_relationships").insert({ child_master_place_id: D_ABS, parent_master_place_id: D_CANON, relationship_type: "contained_in" });
  if (e.error) throw new Error(`seed edge: ${JSON.stringify(e.error)}`);

  const mkGroup = (gid: number, canon: string, abs: string, canonSrc: string[], absSrc: string[]) => ({
    group_id: gid, size: 2, states: ["XX"], canonical_mp_id: canon,
    canonical_reason: "fixture", absorbed_mp_ids: [abs],
    member_sides: [
      { id: canon, canonical_name: "canon", source_ids: canonSrc, source_count: canonSrc.length, has_polygon: false },
      { id: abs, canonical_name: "abs", source_ids: absSrc, source_count: absSrc.length, has_polygon: false },
    ],
    pair_keys: [], conflict_summary: [], risk_summary: [],
  });
  // Group A mirrors groups 3/95: both members score 1, so the rule TIES and
  // the merge is only reachable through an explicit canonical_override — which
  // is itself part of what this scenario proves.
  const groupA = {
    ...mkGroup(G.A, A_CANON, A_ABS, ["nps"], ["california_state_parks"]),
    canonical_override: { mp_id: A_CANON, decided_by: "verify-harness", reason: "groups 3/95 shape — NPS canonical per #379" },
  };
  writeFileSync(file, JSON.stringify([
    groupA,
    mkGroup(G.C1, C1_CANON, C1_ABS, ["state_parks"], ["washington_state_parks"]),
    mkGroup(G.C2, C2_CANON, C2_ABS, ["california_state_parks", "state_parks"], ["atlas_oddities"]),
    mkGroup(G.D, D_CANON, D_ABS, ["nevada_state_parks", "state_parks"], ["atlas_oddities"]),
  ], null, 2));

  // ---------------- A ----------------
  console.log("\n=== A — groups 3/95 shape: does the visitor row's HOURS survive an NPS-canonical merge? ===");
  check("merge executed", runExecutor(G.A, file) === 0);
  const a = await mp(c, A_CANON);
  const aHours = a?.hours as unknown;
  const aAttr = (a?.attribution ?? {}) as Record<string, string>;
  note("hours after merge", aHours);
  note("attribution.hours", aAttr.hours ?? "(absent)");
  note("description source", aAttr.description ?? "(absent)");
  check("HOURS SURVIVED on the NPS-canonical record", aHours != null && JSON.stringify(aHours) !== "null",
    "hours was dropped — #379's caveat would be REAL");
  check("hours attributed to the visitor source", aAttr.hours === "california_state_parks", `got ${aAttr.hours}`);
  check("NPS description won (precedence 1 over visitor 2)", String(a?.description ?? "").startsWith("NPS long-form"), String(a?.description ?? "").slice(0, 40));

  // ---------------- C1 ----------------
  console.log("\n=== C1 — groups 66/70 shape: blank canonical description + truncated name ===");
  check("merge executed", runExecutor(G.C1, file) === 0);
  const c1 = await mp(c, C1_CANON);
  note("canonical_name after merge", c1?.canonical_name);
  note("description after merge", String(c1?.description ?? "(null)").slice(0, 70));
  note("attribution", c1?.attribution);
  check("description was PICKED UP from the absorbed visitor row",
    String(c1?.description ?? "").includes("elk herds"), "description stayed blank");
  check("name stayed the TRUNCATED canonical form (no visitor canonical_name precedence)",
    c1?.canonical_name === "Dosewallips", `got '${c1?.canonical_name}'`);

  // ---------------- C2 ----------------
  console.log("\n=== C2 — group 24 shape: thin directions description vs rich atlas text ===");
  check("merge executed", runExecutor(G.C2, file) === 0);
  const c2 = await mp(c, C2_CANON);
  note("description after merge", String(c2?.description ?? "(null)").slice(0, 70));
  note("attribution.description", ((c2?.attribution ?? {}) as Record<string, string>).description ?? "(absent)");
  const c2KeptDirections = String(c2?.description ?? "").startsWith("Travel 11-miles");
  check("outcome recorded (either is a real answer; reported not asserted)", true,
    c2KeptDirections ? "directions kept, atlas text NOT surfaced" : "atlas text won");

  // ---------------- D ----------------
  console.log("\n=== D — groups 24/86/88 shape: pre-existing edge between canonical and absorbed ===");
  const before = await c.from("place_relationships").select("*").or(`child_master_place_id.eq.${D_ABS},parent_master_place_id.eq.${D_ABS},child_master_place_id.eq.${D_CANON},parent_master_place_id.eq.${D_CANON}`);
  note("edges before merge", (before.data ?? []).length);
  check("merge executed", runExecutor(G.D, file) === 0);
  const after = await c.from("place_relationships").select("*").or(`child_master_place_id.eq.${D_ABS},parent_master_place_id.eq.${D_ABS},child_master_place_id.eq.${D_CANON},parent_master_place_id.eq.${D_CANON}`);
  const rows = (after.data ?? []) as Array<{ child_master_place_id: string; parent_master_place_id: string }>;
  note("edges after merge", rows.length);
  for (const r of rows) note("  edge", `${r.child_master_place_id.slice(-4)} -> ${r.parent_master_place_id.slice(-4)}`);
  check("no SELF-REFERENCE edge (child = parent) survived", !rows.some((r) => r.child_master_place_id === r.parent_master_place_id), "self-reference present");
  check("no edge still points at the absorbed row (orphan)",
    !rows.some((r) => r.child_master_place_id === D_ABS || r.parent_master_place_id === D_ABS), "orphan edge present");
  const dupes = new Set(rows.map((r) => `${r.child_master_place_id}|${r.parent_master_place_id}`));
  check("no duplicate edges", dupes.size === rows.length, `${rows.length} rows, ${dupes.size} distinct`);

  console.log("\ncleaning up...");
  await cleanup(c);
  if (existsSync(file)) rmSync(file);
  const left = await c.from("master_place").select("*", { count: "exact", head: true }).in("id", ALL);
  check("all fixture rows removed", left.count === 0, `${left.count} left`);

  console.log(`\n=== ${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`} ===`);
  if (failures.length > 0) { for (const f of failures) console.error(`  ✗ ${f}`); process.exit(1); }
}

main().catch((e: unknown) => { console.error("FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
