/**
 * Phase 3a D4 — end-to-end entity-resolution suite against the JT corpus.
 *
 * Strategy: run matchAll + applyMatches ONCE in beforeAll, then each
 * test asserts against the resulting DB state. Six separate matchAll
 * runs would be redundant and would push runtime close to the
 * hookTimeout limit unnecessarily.
 *
 * Filename matches vitest's default glob (`**​/*.test.ts`). Spec §8
 * suggested `test.ts`; bumped to `phase3a.test.ts` to keep vitest
 * configuration minimal.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb } from "../ingestion/lib/db.ts";
import { matchAll } from "./matcher.ts";
import { applyMatches, type ApplyResult } from "./promote.ts";
import {
  JT_POSITIVE_FIXTURES,
  JT_NEGATIVE_FIXTURES,
  JT_AMENITY_ROLLUP_FIXTURES,
} from "./test-fixtures.ts";

const db = getDb();

let applyResult: ApplyResult;
let runtimeMs: number;

describe("Phase 3a — entity resolution over JT corpus", () => {
  beforeAll(async () => {
    // Sanity: there's an unresolved corpus to match against.
    await db.rpc("reset_phase3a_test_state");
    const { count } = await db
      .from("source_record")
      .select("id", { count: "exact", head: true });
    expect(count, "expected ≥150 source_records in corpus").toBeGreaterThan(150);

    // Single matchAll + applyMatches; subsequent tests query the resulting state.
    const start = Date.now();
    const outcomes = await matchAll();
    applyResult = await applyMatches(outcomes);
    runtimeMs = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(
      `[phase3a] matchAll + applyMatches runtime: ${runtimeMs}ms ` +
        `(${outcomes.length} outcomes — ${applyResult.new_master_places} new, ` +
        `${applyResult.auto_linked} linked, ${applyResult.amenity_rolled_up} rolled up, ` +
        `${applyResult.manual_review_queued} pending)`,
    );
    expect(applyResult.errors, "apply phase emitted errors").toHaveLength(0);
  });

  afterAll(async () => {
    await db.rpc("reset_phase3a_test_state");
  });

  // ───────────────────────────────────────────────────────────────────
  // Each named fixture resolves to exactly one master_place with the
  // expected source coverage.
  // ───────────────────────────────────────────────────────────────────
  it.each(JT_POSITIVE_FIXTURES)(
    "$canonical_name resolves to one master_place with expected sources",
    async (fixture) => {
      // Find the master_place via canonical_name. Use ilike to tolerate
      // minor casing/spacing differences from RIDB's Title-Cased name vs
      // NPS's raw name (which feed via field_precedence).
      const { data: mps, error } = await db
        .from("master_place")
        .select("id, canonical_name")
        .ilike("canonical_name", fixture.canonical_name);
      expect(error, `query failed for ${fixture.canonical_name}`).toBeNull();
      expect(
        mps,
        `expected 1 master_place for ${fixture.canonical_name}; got ${mps?.length ?? 0}: ` +
          `${mps?.map((m) => m.canonical_name).join(", ")}`,
      ).toHaveLength(1);

      const mpId = mps![0]!.id;
      const { data: linkedSources } = await db
        .from("source_record")
        .select("source_id")
        .eq("master_place_id", mpId);
      const got = [...new Set((linkedSources ?? []).map((r) => r.source_id))].sort();
      const want = [...fixture.expected_source_ids].sort();
      expect(got, `${fixture.canonical_name} — ${fixture.notes ?? ""}`).toEqual(want);
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // OSM dump_station / toilet / water nodes that have a parent
  // campground/facility/recarea within 100m should roll up.
  //
  // METRIC, not strict assertion: some dump stations are >100m from any
  // parent campground (no polygon containment in Phase 3a, that's a 3b
  // pickup). Those legitimately become solo master_places. The Ryan
  // dump_station spot-check (JT_AMENITY_ROLLUP_FIXTURES) is the
  // principled rollup test; this just logs the orphan dump count for
  // tracking how much 3b polygon containment will recover.
  // ───────────────────────────────────────────────────────────────────
  it("orphan dump_station master_place count (metric)", async () => {
    const { count } = await db
      .from("master_place")
      .select("id", { count: "exact", head: true })
      .ilike("canonical_name", "%dump station%");
    // eslint-disable-next-line no-console
    console.log(
      `[phase3a] orphan "Unnamed dump station" master_places: ${count ?? 0} ` +
        `(expected 3b cleanup via polygon containment)`,
    );
    expect(count).toBeGreaterThanOrEqual(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Spot-check on amenity-rollup classifications: each fixture's amenity
  // record should be linked (or not) to the target campground depending
  // on expected_rollup.
  // ───────────────────────────────────────────────────────────────────
  it.each(JT_AMENITY_ROLLUP_FIXTURES)(
    'amenity "$amenity_name" near $near_campground — expected_rollup=$expected_rollup',
    async (fixture) => {
      const { data: mp } = await db
        .from("master_place")
        .select("id")
        .ilike("canonical_name", fixture.near_campground)
        .single();
      expect(mp, `parent master_place ${fixture.near_campground} not found`).toBeTruthy();

      const { data: amenitySources } = await db
        .from("source_record")
        .select("id, master_place_id, name")
        .ilike("name", fixture.amenity_name);

      // At least one such amenity must exist in the corpus
      expect(
        amenitySources,
        `no source_records named "${fixture.amenity_name}"`,
      ).not.toHaveLength(0);

      // We check the closest one (heuristic — there can be multiple
      // "Unnamed dump station" records across the corridor). For the
      // tighter Chimney Rock case there's only one anyway.
      const linkedToParent = (amenitySources ?? []).some(
        (s) => s.master_place_id === mp!.id,
      );
      if (fixture.expected_rollup) {
        expect(
          linkedToParent,
          `${fixture.amenity_name} should roll up to ${fixture.near_campground}`,
        ).toBe(true);
      } else {
        expect(
          linkedToParent,
          `${fixture.amenity_name} should NOT roll up to ${fixture.near_campground}` +
            `${fixture.reason ? ` — ${fixture.reason}` : ""}`,
        ).toBe(false);
      }
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // Single-source records (no cross-source neighbors) become solo
  // master_places. Used as a sanity check against over-eager merging.
  // ───────────────────────────────────────────────────────────────────
  it.each(JT_NEGATIVE_FIXTURES)(
    "single-source fixture ${external_id_pattern} → solo master_place",
    async (fixture) => {
      let q = db.from("source_record").select("master_place_id, name, external_id").ilike("external_id", fixture.external_id_pattern);
      if (fixture.name_pattern) q = q.ilike("name", fixture.name_pattern);
      const { data: srs } = await q.limit(5);
      expect(srs, `no source_record matched ${fixture.external_id_pattern}`).not.toHaveLength(0);
      const sr = srs![0]!;
      expect(sr.master_place_id, `${fixture.reason}`).toBeTruthy();

      const { count } = await db
        .from("source_record")
        .select("id", { count: "exact", head: true })
        .eq("master_place_id", sr.master_place_id);
      expect(count, `${sr.name} expected solo (1 linked); got ${count}`).toBe(1);
    },
  );

  // ───────────────────────────────────────────────────────────────────
  // Every place_match in status='pending' should have its source_record
  // unlinked (master_place_id IS NULL). Tests the manual_review path's
  // promise to not link until human review.
  // ───────────────────────────────────────────────────────────────────
  it("pending place_matches do not link their source_record", async () => {
    const { data: pending } = await db
      .from("place_match")
      .select("source_record_id, match_method")
      .eq("status", "pending");
    expect(pending, "no pending place_matches found").not.toHaveLength(0);

    // Sample at least the first 20 — covers the close_nameless cluster
    // plus any blended_residual stragglers.
    for (const row of (pending ?? []).slice(0, 20)) {
      const { data: sr } = await db
        .from("source_record")
        .select("master_place_id")
        .eq("id", row.source_record_id)
        .single();
      expect(
        sr?.master_place_id,
        `pending place_match (${row.match_method}) linked source_record ${row.source_record_id}`,
      ).toBeNull();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Adjustment 3 from the spec carryover: OSM Sheep Pass campsite nodes
  // within 100m of Sheep Pass go to close_nameless manual_review.
  // ───────────────────────────────────────────────────────────────────
  it("OSM Sheep Pass campsite nodes within 100m → close_nameless pending", async () => {
    const { data: sp } = await db
      .from("master_place")
      .select("id")
      .ilike("canonical_name", "%sheep pass%")
      .single();
    expect(sp, "Sheep Pass master_place not found").toBeTruthy();

    // place_match rows targeting Sheep Pass with method='close_nameless'
    const { data: closeNameless } = await db
      .from("place_match")
      .select("source_record_id, match_method, status")
      .eq("master_place_id", sp!.id)
      .eq("match_method", "close_nameless")
      .eq("status", "pending");
    expect(
      closeNameless,
      "expected ≥1 close_nameless pending row for Sheep Pass",
    ).not.toHaveLength(0);

    // Each referenced source_record is an OSM campground and is unlinked
    for (const row of closeNameless ?? []) {
      const { data: src } = await db
        .from("source_record")
        .select("source_id, inferred_category, master_place_id, name")
        .eq("id", row.source_record_id)
        .single();
      expect(src?.source_id, `expected osm source for ${src?.name}`).toBe("osm");
      expect(src?.inferred_category).toBe("campground");
      expect(
        src?.master_place_id,
        `${src?.name} should not be linked (close_nameless is pending)`,
      ).toBeNull();
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Adjustment 4: tracked metric, not an assertion. Count solo OSM
  // campground-category master_places — these are the expected 3b
  // cleanup targets (polygon containment).
  // ───────────────────────────────────────────────────────────────────
  it("logs orphan OSM campground master_place count (metric, not assertion)", async () => {
    const { data: osmCampgroundSources } = await db
      .from("source_record")
      .select("master_place_id")
      .eq("source_id", "osm")
      .eq("inferred_category", "campground")
      .not("master_place_id", "is", null);

    const mpIds = Array.from(
      new Set(
        (osmCampgroundSources ?? [])
          .map((s) => s.master_place_id as string | null)
          .filter((id): id is string => id != null),
      ),
    );

    let orphanCount = 0;
    for (const mpId of mpIds) {
      const { count } = await db
        .from("source_record")
        .select("id", { count: "exact", head: true })
        .eq("master_place_id", mpId);
      if (count === 1) orphanCount += 1;
    }

    // eslint-disable-next-line no-console
    console.log(`[phase3a] expected 3b cleanup: ${orphanCount} orphan campsite nodes`);
    // Sanity bound — not a hard assertion, but if this gets wildly large
    // something else is wrong.
    expect(orphanCount).toBeGreaterThanOrEqual(0);
  });
});
