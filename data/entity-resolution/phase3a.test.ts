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

import { randomUUID } from "node:crypto";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, upsertSourceRecord } from "../ingestion/lib/db.ts";
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

// Phase 2.5 Part B Option 3 — destructive-reset TS guard.
//
// This suite calls reset_phase3a_test_state(), which deletes every row
// from master_place + place_match. It MUST point at an isolated test
// project (Phase 2.5 Option 1, currently deferred). Until that exists,
// the suite refuses to run by default.
//
// Belt-and-suspenders: the SQL function itself also refuses unless a
// row exists in public.test_marker (see
// 20260528000000_phase2_5_guard_destructive_reset.sql). Either layer is
// sufficient; both layers ensure that bypassing one doesn't suffice to
// clobber real data.
//
// To run the suite once Option 1 ships, the test target must:
//   - have a row in public.test_marker (insert it as part of test setup)
//   - and the runner must set ALLOW_DESTRUCTIVE_TEST_RESET=true
const ALLOW = process.env.ALLOW_DESTRUCTIVE_TEST_RESET === "true";

if (!ALLOW) {
  // eslint-disable-next-line no-console
  console.warn(
    "[phase3a] suite skipped: ALLOW_DESTRUCTIVE_TEST_RESET is not 'true'. " +
      "This suite is destructive and must run against an isolated Supabase " +
      "project. See docs/phase-2.5-durable-materialize-spec.md Part B.",
  );
}

const describeIfAllowed = ALLOW ? describe : describe.skip;

describeIfAllowed("Phase 3a — entity resolution over JT corpus", () => {
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

// ────────────────────────────────────────────────────────────────────────
// Phase 1.5 / Parks Canada — field_precedence priority resolution.
//
// Validates the migration-20260530000000 claim: when parks_canada and
// google source_records co-link to the same master_place, the
// resolve_field tie-break picks parks_canada's canonical_name because
// parks_canada is priority 1 (above google's priority 2) for that field.
//
// Independent of the JT corpus suite above — its own reset + cleanup.
// Synthetic source_records use the `test:precedence:*` external_id
// namespace and are explicitly deleted in afterAll so they don't
// pollute the JT D4 corpus across runs (reset_phase3a_test_state clears
// master_place + place_match + unlinks source_record but does NOT
// delete source_record rows).
// ────────────────────────────────────────────────────────────────────────

describeIfAllowed(
  "Phase 1.5 — parks_canada wins canonical_name vs google (P2 field_precedence)",
  () => {
    // Banff-area coords. Far from JT (lat ~34, lng ~-116) so any
    // accidental matchAll over the seeded JT corpus wouldn't federate
    // these into JT master_places.
    const COORDS: [number, number] = [-115.5, 51.2];
    const PARKS_CANADA_EXT = "test:precedence:parks_canada:1";
    const GOOGLE_EXT = "test:precedence:google:1";
    const PARKS_CANADA_NAME = "Tunnel Mountain Campground";
    const GOOGLE_NAME = "Tunnel Mountain Camp";
    const masterPlaceId = randomUUID();

    beforeAll(async () => {
      await db.rpc("reset_phase3a_test_state");

      // Seed two source_records at identical coords with different
      // canonical_names in their normalized_payload.
      await upsertSourceRecord({
        sourceId: "parks_canada",
        externalId: PARKS_CANADA_EXT,
        name: PARKS_CANADA_NAME,
        inferredCategory: "campground",
        point: COORDS,
        rawPayload: { synthetic: true, source: "parks_canada" },
        normalizedPayload: {
          canonical_name: PARKS_CANADA_NAME,
          description: null,
          overlander_tags: ["federal_land", "parks_canada"],
          contact: null,
          access: null,
          amenities: null,
          hours: null,
        },
        sourceQualityScore: 0.95,
      });
      await upsertSourceRecord({
        sourceId: "google",
        externalId: GOOGLE_EXT,
        name: GOOGLE_NAME,
        inferredCategory: "campground",
        point: COORDS,
        rawPayload: { synthetic: true, source: "google" },
        normalizedPayload: {
          canonical_name: GOOGLE_NAME,
          description: null,
          overlander_tags: [],
          contact: null,
          access: null,
          amenities: null,
          hours: null,
        },
        sourceQualityScore: 0.85,
      });

      // Look up the freshly-seeded source_record ids by external_id.
      const { data: srRows, error: srErr } = await db
        .from("source_record")
        .select("id, external_id")
        .in("external_id", [PARKS_CANADA_EXT, GOOGLE_EXT]);
      expect(srErr).toBeNull();
      expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
      const byExt = new Map(
        (srRows ?? []).map((r) => [r.external_id, r.id as string]),
      );
      const parksCanadaSrId = byExt.get(PARKS_CANADA_EXT)!;
      const googleSrId = byExt.get(GOOGLE_EXT)!;

      // Apply two outcomes via the prod RPC: new_master_place anchors
      // the master_place with parks_canada as the seed (so the seeded
      // canonical_name is initially parks_canada's), then auto_link
      // attaches google. Both trigger recompute_master_place at the
      // end of apply_match_outcomes.
      const outcomes = [
        {
          kind: "new_master_place",
          source_record_id: parksCanadaSrId,
          target: masterPlaceId,
          seed_category: "campground",
          seed_geometry: COORDS,
          seed_name: PARKS_CANADA_NAME,
        },
        {
          kind: "auto_link",
          source_record_id: googleSrId,
          target: masterPlaceId,
          confidence: 0.95,
          method: "name_dominant",
          score: {
            distance_meters: 0,
            name_similarity: 0.95,
            category_compatibility: 1.0,
            combined_confidence: 0.95,
          },
        },
      ];
      const { error: applyErr } = await db.rpc("apply_match_outcomes", {
        p_outcomes: outcomes,
      });
      expect(applyErr).toBeNull();
    });

    afterAll(async () => {
      // Clear master_place + place_match + unlink source_record.
      await db.rpc("reset_phase3a_test_state");
      // Then explicitly delete the synthetic source_records so the JT D4
      // run that follows doesn't see them in source_record.
      await db
        .from("source_record")
        .delete()
        .in("external_id", [PARKS_CANADA_EXT, GOOGLE_EXT]);
    });

    it("master_place.canonical_name resolves to the parks_canada value", async () => {
      const { data: mp, error } = await db
        .from("master_place")
        .select("id, canonical_name, attribution")
        .eq("id", masterPlaceId)
        .single();
      expect(error, "master_place lookup failed").toBeNull();
      expect(mp, "master_place row should exist").not.toBeNull();

      // Headline assertion: resolve_field walks field_precedence by
      // priority ASC and picks the linked source_record with the lowest
      // priority that has a non-null value for the field. parks_canada
      // is priority 1 for canonical_name (migration 20260530000000);
      // google is priority 2. parks_canada wins.
      expect(
        mp!.canonical_name,
        "field_precedence resolved canonical_name to the wrong source — " +
          "check that migration 20260530000000 applied (parks_canada=1 vs google=2)",
      ).toBe(PARKS_CANADA_NAME);

      // Sanity: attribution should record parks_canada as the source for
      // canonical_name. recompute_master_place writes it from the same
      // resolve_field result.
      const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
      expect(attribution.canonical_name).toBe("parks_canada");
    });
  },
);

// ────────────────────────────────────────────────────────────────────────
// Phase 1.5 / BC Parks — cross-jurisdiction non-overlap + name_dominant
// federation. Validates migration 20260531000000 + locked decision #4's
// precedence rules for bc_parks.
//
// Two independent synthetic scenarios, each with its own reset + cleanup.
// Synthetic source_records use the `test:federation:*` external_id
// namespace and are explicitly deleted in afterAll (reset_phase3a_test_state
// unlinks + clears master_place/place_match but does NOT delete
// source_record rows). Coordinates are in BC/Alberta (lat ~53), far from
// the JT corpus (lat ~34), so a stray match could never federate these
// into JT master_places.
// ────────────────────────────────────────────────────────────────────────

describeIfAllowed(
  "Phase 1.5 — BC Parks federation (cross-jurisdiction + name_dominant)",
  () => {
    // (a) BC Parks ↔ Parks Canada must NOT merge across the shared BC/AB
    // border. Two park_boundary records ~20 km apart — one in Mount Robson
    // Provincial Park (BC), one in Jasper National Park (federal) — run
    // through the REAL matcher. They are far beyond the 500 m candidate
    // radius, so the matcher must emit two new_master_place outcomes, never
    // a federation. Guards against a regression where same-category
    // park_boundary records merge regardless of distance/jurisdiction.
    describe("(a) cross-jurisdiction non-overlap — BC Parks ↔ Parks Canada", () => {
      const BC_COORDS: [number, number] = [-118.7, 52.9]; // Mount Robson PP interior, near AB border
      const PC_COORDS: [number, number] = [-118.4, 52.85]; // Jasper NP interior, ~20 km E across the border
      const BC_EXT = "test:federation:bc_parks:mtrobson";
      const PC_EXT = "test:federation:parks_canada:jasper";
      const BC_NAME = "Mount Robson Provincial Park";
      const PC_NAME = "Jasper National Park";

      beforeAll(async () => {
        await db.rpc("reset_phase3a_test_state");

        await upsertSourceRecord({
          sourceId: "bc_parks",
          externalId: BC_EXT,
          name: BC_NAME,
          inferredCategory: "park_boundary",
          point: BC_COORDS,
          rawPayload: { synthetic: true, source: "bc_parks" },
          normalizedPayload: {
            canonical_name: BC_NAME,
            description: null,
            overlander_tags: ["provincial_land", "bc_parks"],
            contact: null,
            access: null,
            amenities: null,
            hours: null,
          },
          sourceQualityScore: 0.9,
        });
        await upsertSourceRecord({
          sourceId: "parks_canada",
          externalId: PC_EXT,
          name: PC_NAME,
          inferredCategory: "park_boundary",
          point: PC_COORDS,
          rawPayload: { synthetic: true, source: "parks_canada" },
          normalizedPayload: {
            canonical_name: PC_NAME,
            description: null,
            overlander_tags: ["federal_land", "parks_canada"],
            contact: null,
            access: null,
            amenities: null,
            hours: null,
          },
          sourceQualityScore: 0.95,
        });

        const { data: srRows, error: srErr } = await db
          .from("source_record")
          .select("id, external_id")
          .in("external_id", [BC_EXT, PC_EXT]);
        expect(srErr).toBeNull();
        expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
        const byExt = new Map(
          (srRows ?? []).map((r) => [r.external_id, r.id as string]),
        );

        // Run the REAL matcher over exactly these two records. master_place
        // is empty post-reset, so any candidate could only come from the
        // other planned record — and at ~20 km they are far outside the
        // 500 m candidate radius.
        const outcomes = await matchAll([byExt.get(BC_EXT)!, byExt.get(PC_EXT)!]);
        const applyRes = await applyMatches(outcomes);
        expect(applyRes.errors, "apply phase emitted errors").toHaveLength(0);
      });

      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db.from("source_record").delete().in("external_id", [BC_EXT, PC_EXT]);
      });

      it("resolves to two separate master_places, not one merged", async () => {
        const { data: rows, error } = await db
          .from("source_record")
          .select("external_id, master_place_id")
          .in("external_id", [BC_EXT, PC_EXT]);
        expect(error, "source_record lookup failed").toBeNull();
        expect(rows, "both synthetic records present").toHaveLength(2);

        const byExt = new Map(
          (rows ?? []).map((r) => [r.external_id, r.master_place_id as string | null]),
        );
        const bcMp = byExt.get(BC_EXT);
        const pcMp = byExt.get(PC_EXT);

        // Both link to a master_place (each its own new_master_place)...
        expect(bcMp, "BC Parks record should link to a master_place").toBeTruthy();
        expect(pcMp, "Parks Canada record should link to a master_place").toBeTruthy();
        // ...and those master_places must be DISTINCT — no cross-jurisdiction merge.
        expect(
          bcMp,
          "BC Parks (Mount Robson) and Parks Canada (Jasper) must NOT federate — " +
            "different jurisdictions ~20 km apart across the BC/AB border",
        ).not.toBe(pcMp);
      });
    });

    // (b) BC Parks × Google name_dominant — mirror of the parks_canada
    // synthetic above. bc_parks is priority 1 for canonical_name (migration
    // 20260531000000), google is priority 2; when both co-link to one
    // master_place, bc_parks must win. The attribution assertion is the
    // strong one: it proves resolve_field actually picked bc_parks, not
    // that the value coincidentally matched.
    describe("(b) name_dominant federation — bc_parks wins canonical_name vs google", () => {
      const COORDS: [number, number] = [-119.36, 53.05]; // Mount Robson Park representative point
      const BC_EXT = "test:federation:bc_parks:nd";
      const GOOGLE_EXT = "test:federation:google:nd";
      const BC_NAME = "Mount Robson Provincial Park";
      const GOOGLE_NAME = "Mount Robson Park";
      const masterPlaceId = randomUUID();

      beforeAll(async () => {
        await db.rpc("reset_phase3a_test_state");

        await upsertSourceRecord({
          sourceId: "bc_parks",
          externalId: BC_EXT,
          name: BC_NAME,
          inferredCategory: "park_boundary",
          point: COORDS,
          rawPayload: { synthetic: true, source: "bc_parks" },
          normalizedPayload: {
            canonical_name: BC_NAME,
            description: null,
            overlander_tags: ["provincial_land", "bc_parks"],
            contact: null,
            access: null,
            amenities: null,
            hours: null,
          },
          sourceQualityScore: 0.9,
        });
        await upsertSourceRecord({
          sourceId: "google",
          externalId: GOOGLE_EXT,
          name: GOOGLE_NAME,
          inferredCategory: "park_boundary",
          point: COORDS,
          rawPayload: { synthetic: true, source: "google" },
          normalizedPayload: {
            canonical_name: GOOGLE_NAME,
            description: null,
            overlander_tags: [],
            contact: null,
            access: null,
            amenities: null,
            hours: null,
          },
          sourceQualityScore: 0.85,
        });

        const { data: srRows, error: srErr } = await db
          .from("source_record")
          .select("id, external_id")
          .in("external_id", [BC_EXT, GOOGLE_EXT]);
        expect(srErr).toBeNull();
        expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
        const byExt = new Map(
          (srRows ?? []).map((r) => [r.external_id, r.id as string]),
        );

        // new_master_place seeds the MP with bc_parks; auto_link attaches
        // google. apply_match_outcomes triggers recompute_master_place,
        // which runs resolve_field over the field_precedence table.
        const outcomes = [
          {
            kind: "new_master_place",
            source_record_id: byExt.get(BC_EXT)!,
            target: masterPlaceId,
            seed_category: "park_boundary",
            seed_geometry: COORDS,
            seed_name: BC_NAME,
          },
          {
            kind: "auto_link",
            source_record_id: byExt.get(GOOGLE_EXT)!,
            target: masterPlaceId,
            confidence: 0.95,
            method: "name_dominant",
            score: {
              distance_meters: 0,
              name_similarity: 0.9,
              category_compatibility: 1.0,
              combined_confidence: 0.95,
            },
          },
        ];
        const { error: applyErr } = await db.rpc("apply_match_outcomes", {
          p_outcomes: outcomes,
        });
        expect(applyErr).toBeNull();
      });

      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db
          .from("source_record")
          .delete()
          .in("external_id", [BC_EXT, GOOGLE_EXT]);
      });

      it("master_place.canonical_name + attribution resolve to bc_parks", async () => {
        const { data: mp, error } = await db
          .from("master_place")
          .select("id, canonical_name, attribution")
          .eq("id", masterPlaceId)
          .single();
        expect(error, "master_place lookup failed").toBeNull();
        expect(mp, "master_place row should exist").not.toBeNull();

        // Value won by bc_parks (priority 1 for canonical_name vs google=2).
        expect(
          mp!.canonical_name,
          "field_precedence resolved canonical_name to the wrong source — " +
            "check migration 20260531000000 applied (bc_parks=1 vs google=2)",
        ).toBe(BC_NAME);

        // Stronger assertion: attribution proves resolve_field picked bc_parks.
        const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
        expect(attribution.canonical_name).toBe("bc_parks");
      });
    });
  },
);
