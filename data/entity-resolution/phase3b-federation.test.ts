/**
 * Phase 3b — federation + ongoing-computation tests for polygon containment.
 *
 * place_relationships is written by recompute_master_place Step 7 but not yet
 * read by any card/search code (that federation/RPC layer is Phase 2). These
 * tests validate the QUERY PATTERN a future card-assembly layer will use —
 * realistic place_relationships ⋈ master_place joins that produce card-shaped
 * data — against the real test DB, plus that fresh data gets edges inline (not
 * only via the one-time backfill).
 *
 * Covers:
 *   - "campgrounds in [park]"  (parent → contained children, category-filtered)
 *   - "located in [park]"      (child → containing park name/category for the card)
 *   - no false near-miss edges (an amenity NEAR but not covered → 0 edges)
 *   - edge stability across repeated recompute (Δ0, no non-deterministic churn)
 *   - ONGOING computation: a freshly-applied amenity gets its edge INLINE via
 *     apply_match_outcomes (the production apply path), with NO backfill call.
 *
 * Same gating/reset/cleanup discipline as phase3a/phase3b-containment:
 * ALLOW_DESTRUCTIVE_TEST_RESET + test_marker; test:federation:3b:* namespace
 * deleted in afterAll so it never reaches the JT D4 corpus. Coordinates at
 * lat ~45 / lng ~-110, far from the JT corpus (lat ~34).
 */

import { randomUUID } from "node:crypto";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, upsertSourceRecord } from "../ingestion/lib/db.ts";

const db = getDb();

const ALLOW = process.env.ALLOW_DESTRUCTIVE_TEST_RESET === "true";
if (!ALLOW) {
  // eslint-disable-next-line no-console
  console.warn("[phase3b-federation] suite skipped: ALLOW_DESTRUCTIVE_TEST_RESET is not 'true'.");
}
const describeIfAllowed = ALLOW ? describe : describe.skip;

const NS = "test:federation:3b:";
const ext = (k: string) => `${NS}${k}`;

function rect(minLng: number, minLat: number, maxLng: number, maxLat: number) {
  return {
    type: "Polygon",
    coordinates: [[[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat], [minLng, minLat]]],
  };
}

const mp: Record<string, string> = {};

async function srId(extId: string): Promise<string> {
  const { data, error } = await db.from("source_record").select("id").eq("external_id", extId).single();
  expect(error, `sr lookup ${extId}`).toBeNull();
  return data!.id as string;
}
async function recompute(id: string) {
  const { error } = await db.rpc("recompute_master_place", { p_master_place_id: id });
  expect(error, `recompute ${id}`).toBeNull();
}

// ── Federation-style query helpers (the card-assembly contract) ──
// "Campgrounds in [park]": children of a park, joined to master_place and
// filtered by category — a single embedded PostgREST query (the shape a
// search/browse RPC would run), not raw edge inspection.
async function campgroundsInPark(parkId: string): Promise<string[]> {
  const { data, error } = await db
    .from("place_relationships")
    .select("child:master_place!child_master_place_id(id, canonical_name, primary_category)")
    .eq("parent_master_place_id", parkId)
    .eq("relationship_type", "contained_in");
  expect(error, "campgroundsInPark join failed").toBeNull();
  return (data ?? [])
    .map((r: any) => r.child)
    .filter((c: any) => c && c.primary_category === "campground")
    .map((c: any) => c.canonical_name as string)
    .sort();
}
// "Located in [park]": the containing park(s) for an amenity card — child →
// parent embed returning the park's display name + category.
async function locatedIn(amenityId: string): Promise<{ name: string; category: string }[]> {
  const { data, error } = await db
    .from("place_relationships")
    .select("parent:master_place!parent_master_place_id(canonical_name, primary_category)")
    .eq("child_master_place_id", amenityId)
    .eq("relationship_type", "contained_in");
  expect(error, "locatedIn join failed").toBeNull();
  return (data ?? []).map((r: any) => ({
    name: r.parent.canonical_name as string,
    category: r.parent.primary_category as string,
  }));
}

interface Spec { key: string; category: string; point: [number, number]; polygon?: ReturnType<typeof rect>; }

// One park + amenities inside + one near-miss outside.
const PARK: Spec = { key: "park", category: "national_park_boundary", point: [-109.9, 45.1], polygon: rect(-110.0, 45.0, -109.8, 45.2) };
const INSIDE: Spec[] = [
  { key: "cg1", category: "campground", point: [-109.9, 45.1] },
  { key: "cg2", category: "campground", point: [-109.85, 45.05] },
  { key: "picnic", category: "picnic_area", point: [-109.95, 45.15] },
];
const NEAR_MISS: Spec = { key: "nearmiss", category: "campground", point: [-110.05, 45.1] }; // ~4 km W of the park, NOT covered

async function seed(spec: Spec): Promise<void> {
  mp[spec.key] = randomUUID();
  await upsertSourceRecord({
    sourceId: spec.polygon ? "parks_canada" : "ridb",
    externalId: ext(spec.key),
    name: spec.key,
    inferredCategory: spec.category,
    point: spec.point,
    rawPayload: { synthetic: true },
    normalizedPayload: spec.polygon
      ? { canonical_name: spec.key, geometry_polygon: spec.polygon }
      : { canonical_name: spec.key },
    sourceQualityScore: 0.9,
  });
}
async function applyNew(spec: Spec): Promise<void> {
  const { error } = await db.rpc("apply_match_outcomes", {
    p_outcomes: [
      {
        kind: "new_master_place",
        source_record_id: await srId(ext(spec.key)),
        target: mp[spec.key],
        seed_category: spec.category,
        seed_geometry: spec.point,
        seed_name: spec.key,
      },
    ],
  });
  expect(error, `apply ${spec.key}`).toBeNull();
}

describeIfAllowed("Phase 3b — federation query pattern + ongoing computation", () => {
  beforeAll(async () => {
    await db.rpc("reset_phase3a_test_state");
    await db.from("source_record").delete().like("external_id", `${NS}%`);

    const all = [PARK, ...INSIDE, NEAR_MISS];
    for (const s of all) await seed(s);
    for (const s of all) await applyNew(s);
    // Park first (sets polygon + parent edges), then the rest (idempotent).
    await recompute(mp[PARK.key]!);
    for (const s of [...INSIDE, NEAR_MISS]) await recompute(mp[s.key]!);
  });

  afterAll(async () => {
    await db.rpc("reset_phase3a_test_state");
    await db.from("source_record").delete().like("external_id", `${NS}%`);
  });

  it('"campgrounds in [park]" returns the contained campgrounds (not picnic, not near-miss)', async () => {
    expect(await campgroundsInPark(mp[PARK.key]!)).toEqual(["cg1", "cg2"]);
  });

  it('"located in [park]" surfaces the containing park name + category for a card', async () => {
    const ctx = await locatedIn(mp["cg1"]!);
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toEqual({ name: "park", category: "national_park_boundary" });
  });

  it("no false near-miss edge: an amenity near but not covered has 0 relationships", async () => {
    const { count } = await db
      .from("place_relationships")
      .select("*", { head: true, count: "exact" })
      .eq("child_master_place_id", mp["nearmiss"]!)
      .eq("relationship_type", "contained_in");
    expect(count, "near-miss amenity must not be contained").toBe(0);
    // And it must not leak into the park's campground federation results.
    expect(await campgroundsInPark(mp[PARK.key]!)).not.toContain("nearmiss");
  });

  it("edge is stable across repeated recompute (Δ0, no non-deterministic churn)", async () => {
    const read = async () =>
      (await db
        .from("place_relationships")
        .select("parent_master_place_id, computed_at")
        .eq("child_master_place_id", mp["cg1"]!)
        .eq("relationship_type", "contained_in")).data ?? [];
    const before = await read();
    expect(before).toHaveLength(1);
    await recompute(mp["cg1"]!);
    await recompute(mp["cg1"]!);
    const after = await read();
    expect(after).toHaveLength(1);
    expect(after[0]!.parent_master_place_id).toBe(before[0]!.parent_master_place_id);
  });

  it("ONGOING computation: a freshly-applied amenity gets its edge INLINE (no backfill)", async () => {
    const fresh: Spec = { key: "fresh", category: "campground", point: [-109.92, 45.08] }; // inside the park
    await seed(fresh);
    // Production apply path ONLY — apply_match_outcomes runs recompute_master_place
    // internally. No explicit recompute(), no backfill script.
    await applyNew(fresh);

    const { data, error } = await db
      .from("place_relationships")
      .select("parent_master_place_id")
      .eq("child_master_place_id", mp["fresh"]!)
      .eq("relationship_type", "contained_in");
    expect(error).toBeNull();
    expect(
      (data ?? []).map((r) => r.parent_master_place_id),
      "fresh amenity should be contained_in the park immediately after apply (inline Step 7)",
    ).toEqual([mp[PARK.key]!]);
  });
});
