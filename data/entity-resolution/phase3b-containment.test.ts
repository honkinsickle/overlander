/**
 * Phase 3b — polygon containment (place_relationships) over synthetic fixtures.
 *
 * Validates Step 7 of recompute_master_place (migration 20260601040000):
 * contained_in edges between a child's POINT and a parent park's
 * geometry_polygon via ST_Covers, in both roles (child + parent).
 *
 * Strategy mirrors phase3a.test.ts: build all fixtures once in beforeAll,
 * then each `it` asserts the resulting place_relationships state. Cases that
 * MUTATE (6 polygon-change, 7 cascade) operate on their own isolated
 * fixtures (distinct coords + external_id), so they don't disturb the
 * read-only cases that run before them.
 *
 * Destructive: calls reset_phase3a_test_state() (deletes master_place, which
 * CASCADEs to place_relationships). Gated by ALLOW_DESTRUCTIVE_TEST_RESET
 * (set by test-setup.ts when SUPABASE_TEST_* is present) + the test_marker
 * sentinel row, identical to phase3a.test.ts.
 *
 * All synthetic source_records use the test:containment:* external_id
 * namespace and are deleted in afterAll so they never reach the JT D4
 * matchAll() corpus (which would drift the 219/153/16/17/33 baseline).
 * Coordinates sit at lat ~40–45 / lng ~-110..-99, far from the JT corpus
 * (lat ~34), and each case uses a distinct longitude band so no park
 * accidentally covers another case's amenity.
 */

import { randomUUID } from "node:crypto";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, upsertSourceRecord } from "../ingestion/lib/db.ts";

const db = getDb();

const ALLOW = process.env.ALLOW_DESTRUCTIVE_TEST_RESET === "true";
if (!ALLOW) {
  // eslint-disable-next-line no-console
  console.warn(
    "[phase3b] suite skipped: ALLOW_DESTRUCTIVE_TEST_RESET is not 'true'. " +
      "Destructive suite; must run against the isolated test project.",
  );
}
const describeIfAllowed = ALLOW ? describe : describe.skip;

const NS = "test:containment:";

type Lng = number;
type Lat = number;
type Point = [Lng, Lat];

/** Closed-ring GeoJSON Polygon for an axis-aligned rectangle. */
function rect(minLng: Lng, minLat: Lat, maxLng: Lng, maxLat: Lat) {
  return {
    type: "Polygon",
    coordinates: [
      [
        [minLng, minLat],
        [maxLng, minLat],
        [maxLng, maxLat],
        [minLng, maxLat],
        [minLng, minLat],
      ],
    ],
  };
}

async function srIdByExt(ext: string): Promise<string> {
  const { data, error } = await db
    .from("source_record")
    .select("id")
    .eq("external_id", ext)
    .single();
  expect(error, `source_record lookup failed for ${ext}`).toBeNull();
  return data!.id as string;
}

async function recompute(id: string): Promise<void> {
  const { error } = await db.rpc("recompute_master_place", { p_master_place_id: id });
  expect(error, `recompute_master_place failed for ${id}`).toBeNull();
}

async function parentsOf(childId: string): Promise<string[]> {
  const { data } = await db
    .from("place_relationships")
    .select("parent_master_place_id")
    .eq("child_master_place_id", childId)
    .eq("relationship_type", "contained_in");
  return (data ?? []).map((r) => r.parent_master_place_id as string).sort();
}

async function childrenOf(parentId: string): Promise<string[]> {
  const { data } = await db
    .from("place_relationships")
    .select("child_master_place_id")
    .eq("parent_master_place_id", parentId)
    .eq("relationship_type", "contained_in");
  return (data ?? []).map((r) => r.child_master_place_id as string).sort();
}

// Registry of fixtures: key → { mpId, ext, sourceId }.
const mp: Record<string, string> = {};
const ext = (key: string): string => `${NS}${key}`;

interface ParkSpec {
  key: string;
  point: Point;
  polygon: ReturnType<typeof rect>;
}
interface AmenitySpec {
  key: string;
  point: Point;
}

// Parks (have geometry_polygon, from parks_canada so it promotes).
const PARKS: ParkSpec[] = [
  // Case 1 — single park.
  { key: "park:1", point: [-109.95, 45.05], polygon: rect(-110.0, 45.0, -109.9, 45.1) },
  // Case 2 — nested/overlapping parks.
  { key: "park:outer", point: [-107.9, 45.1], polygon: rect(-108.0, 45.0, -107.8, 45.2) },
  { key: "park:inner", point: [-107.95, 45.05], polygon: rect(-107.96, 45.04, -107.94, 45.06) },
  // Case 3 — boundary.
  { key: "park:3", point: [-105.95, 45.05], polygon: rect(-106.0, 45.0, -105.9, 45.1) },
  // Case 5 — empty park.
  { key: "park:5empty", point: [-99.95, 40.05], polygon: rect(-100.0, 40.0, -99.9, 40.1) },
  // Case 6 — polygon change (initial polygon covers amenity:6, not amenity:6b).
  { key: "park:6", point: [-102.95, 45.05], polygon: rect(-103.0, 45.0, -102.9, 45.1) },
  // Case 7 — cascade (parent delete + child delete).
  { key: "park:7", point: [-100.95, 45.05], polygon: rect(-101.0, 45.0, -100.9, 45.1) },
  { key: "park:7b", point: [-101.45, 45.05], polygon: rect(-101.5, 45.0, -101.4, 45.1) },
];

// Amenities (point only).
const AMENITIES: AmenitySpec[] = [
  { key: "amenity:1", point: [-109.95, 45.05] }, // inside park:1
  { key: "amenity:2", point: [-107.95, 45.05] }, // inside park:inner AND park:outer
  { key: "amenity:3bound", point: [-106.0, 45.05] }, // exactly on park:3 left edge
  { key: "amenity:3out", point: [-106.001, 45.05] }, // just outside park:3
  { key: "amenity:4", point: [-104.0, 40.0] }, // outside all parks
  { key: "amenity:6", point: [-102.95, 45.05] }, // inside park:6 initial; outside shrink; inside grow
  { key: "amenity:6b", point: [-102.8, 45.05] }, // outside park:6 initial; inside grow
  { key: "amenity:7", point: [-100.95, 45.05] }, // inside park:7 (parent-delete cascade)
  { key: "amenity:7b", point: [-101.45, 45.05] }, // inside park:7b (child-delete cascade)
];

// Case-6 polygon variants (re-upserted onto park:6 during the test).
const PARK6_SHRINK = rect(-103.0, 45.0, -102.99, 45.01); // excludes amenity:6
const PARK6_GROW = rect(-103.0, 45.0, -102.7, 45.1); // covers amenity:6 AND amenity:6b

describeIfAllowed("Phase 3b — polygon containment (place_relationships)", () => {
  beforeAll(async () => {
    // Clean slate + remove any leftover namespace records from a prior aborted run.
    await db.rpc("reset_phase3a_test_state");
    await db.from("source_record").delete().like("external_id", `${NS}%`);

    // Seed source_records.
    for (const p of PARKS) {
      await upsertSourceRecord({
        sourceId: "parks_canada",
        externalId: ext(p.key),
        name: p.key,
        inferredCategory: "park_boundary",
        point: p.point,
        rawPayload: { synthetic: true },
        normalizedPayload: { canonical_name: p.key, geometry_polygon: p.polygon },
        sourceQualityScore: 0.95,
      });
    }
    for (const a of AMENITIES) {
      await upsertSourceRecord({
        sourceId: "ridb",
        externalId: ext(a.key),
        name: a.key,
        inferredCategory: "campground",
        point: a.point,
        rawPayload: { synthetic: true },
        normalizedPayload: { canonical_name: a.key },
        sourceQualityScore: 0.85,
      });
    }

    // Create one master_place per record via apply_match_outcomes (new_master_place).
    const outcomes: unknown[] = [];
    for (const p of PARKS) {
      mp[p.key] = randomUUID();
      outcomes.push({
        kind: "new_master_place",
        source_record_id: await srIdByExt(ext(p.key)),
        target: mp[p.key],
        seed_category: "park_boundary",
        seed_geometry: p.point,
        seed_name: p.key,
      });
    }
    for (const a of AMENITIES) {
      mp[a.key] = randomUUID();
      outcomes.push({
        kind: "new_master_place",
        source_record_id: await srIdByExt(ext(a.key)),
        target: mp[a.key],
        seed_category: "campground",
        seed_geometry: a.point,
        seed_name: a.key,
      });
    }
    const { error: applyErr } = await db.rpc("apply_match_outcomes", { p_outcomes: outcomes });
    expect(applyErr, "apply_match_outcomes failed").toBeNull();

    // Deterministic containment: recompute parks first (sets geometry_polygon +
    // parent edges), then amenities (child edges; idempotent on conflict).
    for (const p of PARKS) await recompute(mp[p.key]!);
    for (const a of AMENITIES) await recompute(mp[a.key]!);
  });

  afterAll(async () => {
    await db.rpc("reset_phase3a_test_state");
    await db.from("source_record").delete().like("external_id", `${NS}%`);
  });

  // 1. Amenity inside a single park → exactly one contained_in edge.
  it("amenity inside single park → 1 relationship to that park", async () => {
    expect(await parentsOf(mp["amenity:1"]!)).toEqual([mp["park:1"]!]);
  });

  // 2. Amenity inside two (nested/overlapping) parks → both edges persist;
  //    and the inner park is itself contained_in the outer (nested parks).
  it("amenity inside nested parks → 2 relationships, both persist", async () => {
    expect(await parentsOf(mp["amenity:2"]!)).toEqual(
      [mp["park:inner"]!, mp["park:outer"]!].sort(),
    );
  });
  it("nested park: inner park is contained_in outer park (both relationships persist)", async () => {
    expect(await parentsOf(mp["park:inner"]!)).toEqual([mp["park:outer"]!]);
    // Outer is not contained in inner (its representative point is outside inner).
    expect(await parentsOf(mp["park:outer"]!)).toEqual([]);
  });

  // 3. Amenity exactly on the park boundary → contained (ST_Covers); a control
  //    point just outside is not.
  it("amenity exactly on park boundary → contained (ST_Covers), control outside → not", async () => {
    expect(await parentsOf(mp["amenity:3bound"]!)).toEqual([mp["park:3"]!]);
    expect(await parentsOf(mp["amenity:3out"]!)).toEqual([]);
  });

  // 4. Amenity outside all parks → no relationships.
  it("amenity outside all parks → 0 relationships", async () => {
    expect(await parentsOf(mp["amenity:4"]!)).toEqual([]);
  });

  // 5. Park with no amenities inside → 0 child relationships.
  it("park with no amenities inside → 0 child relationships", async () => {
    expect(await childrenOf(mp["park:5empty"]!)).toEqual([]);
  });

  // 6. Park polygon change → fan-out recomputation (Option B). The SHRINK
  //    sub-case (amenity leaves the park) is what the literal locked #5 wording
  //    handled; the GROW sub-case (amenity becomes newly-contained) is the
  //    Option-B improvement and is asserted explicitly.
  it("park polygon change triggers fan-out recompute of contained amenities (shrink + grow)", async () => {
    // Initial state: park:6 covers amenity:6, not amenity:6b.
    expect(await childrenOf(mp["park:6"]!)).toEqual([mp["amenity:6"]!]);
    expect(await parentsOf(mp["amenity:6"]!)).toEqual([mp["park:6"]!]);
    expect(await parentsOf(mp["amenity:6b"]!)).toEqual([]);

    // SHRINK: polygon no longer covers amenity:6 → edge removed.
    await upsertSourceRecord({
      sourceId: "parks_canada",
      externalId: ext("park:6"),
      name: "park:6",
      inferredCategory: "park_boundary",
      point: [-102.95, 45.05],
      rawPayload: { synthetic: true },
      normalizedPayload: { canonical_name: "park:6", geometry_polygon: PARK6_SHRINK },
      sourceQualityScore: 0.95,
    });
    await recompute(mp["park:6"]!);
    expect(await childrenOf(mp["park:6"]!), "shrink should remove the amenity:6 edge").toEqual([]);
    expect(await parentsOf(mp["amenity:6"]!)).toEqual([]);

    // GROW: polygon now covers BOTH amenity:6 and the previously-uncontained
    // amenity:6b → both edges appear (the case literal #5 fan-out would miss).
    await upsertSourceRecord({
      sourceId: "parks_canada",
      externalId: ext("park:6"),
      name: "park:6",
      inferredCategory: "park_boundary",
      point: [-102.95, 45.05],
      rawPayload: { synthetic: true },
      normalizedPayload: { canonical_name: "park:6", geometry_polygon: PARK6_GROW },
      sourceQualityScore: 0.95,
    });
    await recompute(mp["park:6"]!);
    expect(
      await childrenOf(mp["park:6"]!),
      "grow should (re)add amenity:6 AND newly-cover amenity:6b",
    ).toEqual([mp["amenity:6"]!, mp["amenity:6b"]!].sort());
    expect(await parentsOf(mp["amenity:6b"]!), "amenity:6b is now newly-contained").toEqual([
      mp["park:6"]!,
    ]);
  });

  // 7. ON DELETE CASCADE — deleting either endpoint master_place removes the
  //    place_relationships edge (FK ON DELETE CASCADE).
  it("deleting the parent master_place cascades the place_relationships edge away", async () => {
    // Precondition: park:7 contains amenity:7.
    expect(await childrenOf(mp["park:7"]!)).toEqual([mp["amenity:7"]!]);

    const { error } = await db.from("master_place").delete().eq("id", mp["park:7"]!);
    expect(error, "parent master_place delete failed").toBeNull();

    const { count } = await db
      .from("place_relationships")
      .select("*", { head: true, count: "exact" })
      .eq("parent_master_place_id", mp["park:7"]!);
    expect(count, "edges with the deleted parent must be cascade-removed").toBe(0);
  });
  it("deleting the child master_place cascades the place_relationships edge away", async () => {
    // Precondition: park:7b contains amenity:7b.
    expect(await parentsOf(mp["amenity:7b"]!)).toEqual([mp["park:7b"]!]);

    const { error } = await db.from("master_place").delete().eq("id", mp["amenity:7b"]!);
    expect(error, "child master_place delete failed").toBeNull();

    const { count } = await db
      .from("place_relationships")
      .select("*", { head: true, count: "exact" })
      .eq("child_master_place_id", mp["amenity:7b"]!);
    expect(count, "edges with the deleted child must be cascade-removed").toBe(0);
  });
});
