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
  ER_POSITIVE_FIXTURES,
  ER_NEGATIVE_FIXTURES,
  ER_AMENITY_FIXTURES,
} from "./test-fixtures.ts";
import { ER_CORPUS } from "./fixtures/er-corpus.ts";

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

describeIfAllowed("Phase 3a — entity resolution over the pinned ER corpus", () => {
  beforeAll(async () => {
    // Sanity: the pinned fixture is fully seeded and unresolved. Exact, not a
    // floor — the corpus is a known size now (see fixtures/er-corpus.ts).
    await db.rpc("reset_phase3a_test_state");
    const { count } = await db
      .from("source_record")
      .select("id", { count: "exact", head: true });
    expect(count, `expected exactly ${ER_CORPUS.length} pinned source_records`).toBe(
      ER_CORPUS.length,
    );

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
  it.each(ER_POSITIVE_FIXTURES)(
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
  // Case 2 — amenity_rollup FALLS THROUGH. The lone OSM dump_station is
  // >100m from any parent campground, so it becomes its own solo
  // master_place. Exact (was a scale-tracking metric over the big corpus):
  // in the pinned fixture there is EXACTLY one "dump station" place, solo.
  // ───────────────────────────────────────────────────────────────────
  it("orphan dump_station (no parent within 100m) → exactly one solo master_place", async () => {
    const { data: mps } = await db
      .from("master_place")
      .select("id, canonical_name")
      .ilike("canonical_name", "%dump station%");
    expect(mps, "expected exactly one orphan dump station master_place").toHaveLength(1);

    const { count } = await db
      .from("source_record")
      .select("id", { count: "exact", head: true })
      .eq("master_place_id", mps![0]!.id);
    expect(count, "orphan dump station should be solo (1 linked source)").toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────
  // Spot-check on amenity-rollup classifications: each fixture's amenity
  // record should be linked (or not) to the target campground depending
  // on expected_rollup.
  // ───────────────────────────────────────────────────────────────────
  it.each(ER_AMENITY_FIXTURES)(
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
  it.each(ER_NEGATIVE_FIXTURES)(
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
  // The manual_review path leaves its source_record unlinked. With a
  // pinned corpus the pending set is KNOWN EXACTLY (was a slice(0,20)
  // sample): the Beta OSM numeric node (close_nameless) and the Kappa2
  // gas station (blended_residual, forced there by the same-source guard).
  // Both unlinked. Anything else pending is a regression.
  // ───────────────────────────────────────────────────────────────────
  it("pending place_matches are EXACTLY {close_nameless Beta, blended_residual Kappa2}, all unlinked", async () => {
    const { data: pending } = await db
      .from("place_match")
      .select("source_record_id, match_method")
      .eq("status", "pending");

    const ids = (pending ?? []).map((p) => p.source_record_id);
    const { data: srcs } = await db
      .from("source_record")
      .select("id, external_id, master_place_id")
      .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const byId = new Map((srcs ?? []).map((s) => [s.id, s]));

    const got = (pending ?? [])
      .map((p) => ({
        external_id: byId.get(p.source_record_id)?.external_id ?? "<unknown>",
        method: p.match_method,
        linked: byId.get(p.source_record_id)?.master_place_id ?? null,
      }))
      .sort((a, b) => a.external_id.localeCompare(b.external_id));

    expect(got).toEqual([
      { external_id: "er:beta:osm7", method: "close_nameless", linked: null },
      { external_id: "er:kappa2:osm", method: "blended_residual", linked: null },
    ]);
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 3 — close_nameless. Beta's OSM node is named "7" (a campsite
  // number, name_sim ~0), category campground, 40m from the nps-seeded
  // Beta campground. Beta has no osm link, so the same-source guard passes
  // and it routes to close_nameless manual_review (pending, unlinked).
  // ───────────────────────────────────────────────────────────────────
  it("Beta OSM numeric-name node within 100m → close_nameless pending, unlinked", async () => {
    const { data: beta } = await db
      .from("master_place")
      .select("id")
      .ilike("canonical_name", "%beta%")
      .single();
    expect(beta, "Beta master_place not found").toBeTruthy();

    const { data: closeNameless } = await db
      .from("place_match")
      .select("source_record_id, match_method, status")
      .eq("master_place_id", beta!.id)
      .eq("match_method", "close_nameless")
      .eq("status", "pending");
    expect(
      closeNameless,
      "expected ≥1 close_nameless pending row for Beta",
    ).not.toHaveLength(0);

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

  // Helper: master_place_id for a fixture source_record by external_id.
  async function mpIdFor(externalId: string): Promise<string | null> {
    const { data } = await db
      .from("source_record")
      .select("master_place_id")
      .eq("external_id", externalId)
      .single();
    return (data?.master_place_id as string | null) ?? null;
  }
  async function linkedCount(mpId: string): Promise<number> {
    const { count } = await db
      .from("source_record")
      .select("id", { count: "exact", head: true })
      .eq("master_place_id", mpId);
    return count ?? 0;
  }

  // ───────────────────────────────────────────────────────────────────
  // Case 4 — the false-merge guard. Gamma and Delta are same-category
  // campgrounds 150m apart with DIFFERENT names (name_sim ~0.47). The name
  // gate rejects the merge; they must resolve to two distinct places.
  // ───────────────────────────────────────────────────────────────────
  it("Gamma and Delta resolve to distinct master_places (name gate rejects)", async () => {
    const gamma = await mpIdFor("er:gamma:nps");
    const delta = await mpIdFor("er:delta:google");
    expect(gamma, "Gamma should link to a master_place").toBeTruthy();
    expect(delta, "Delta should link to a master_place").toBeTruthy();
    expect(
      gamma,
      "different-named campgrounds 150m apart must NOT merge",
    ).not.toBe(delta);
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 6 — the ER gate stays shut for a matrix-absent category. Zeta is
  // a Google 'restaurant' 50m from Gamma; restaurant↔campground has no
  // CATEGORY_COMPATIBILITY entry → 0 → cannot merge. Solo, not linked to
  // either campground neighbor.
  // ───────────────────────────────────────────────────────────────────
  it("Zeta restaurant (matrix-absent category) stays solo — ER gate shut", async () => {
    const zeta = await mpIdFor("er:zeta:google");
    expect(zeta, "Zeta should get its own master_place").toBeTruthy();
    expect(await linkedCount(zeta!), "Zeta should be solo").toBe(1);
    for (const ext of ["er:gamma:nps", "er:delta:google"]) {
      expect(await mpIdFor(ext), `Zeta must not merge into ${ext}`).not.toBe(zeta);
    }
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 7 — a record with NO category. lookupCompatibility pins to 0 for
  // a null category, so Eta cannot merge into its 50m campground neighbor.
  // Solo.
  // ───────────────────────────────────────────────────────────────────
  it("Eta (null category) stays solo — compatibility pins to 0", async () => {
    const eta = await mpIdFor("er:eta:google");
    expect(eta, "Eta should get its own master_place").toBeTruthy();
    expect(await linkedCount(eta!), "Eta should be solo").toBe(1);
    expect(await mpIdFor("er:delta:google"), "Eta must not merge into Delta").not.toBe(eta);
  });

  // ───────────────────────────────────────────────────────────────────
  // Same-source chain-business guard. Kappa1/Kappa2 are two OSM gas
  // stations with IDENTICAL name+category 120m apart. name_dominant would
  // auto-link them, but masterPlaceHasSource blocks it (Kappa1's place is
  // already osm-linked), so Kappa2 falls to blended → 0.6 → manual_review.
  // Kappa1 anchors its own place; Kappa2 stays unlinked (NOT auto-merged).
  // ───────────────────────────────────────────────────────────────────
  it("Kappa2 is NOT auto-linked to Kappa1 — same-source guard holds", async () => {
    expect(await mpIdFor("er:kappa1:osm"), "Kappa1 should anchor a master_place").toBeTruthy();
    expect(
      await mpIdFor("er:kappa2:osm"),
      "Kappa2 must stay unlinked (guard blocks the same-source auto-link)",
    ).toBeNull();
  });

  // ───────────────────────────────────────────────────────────────────
  // Case 5 — binational field_precedence. Epsilon merges parks_canada +
  // Google (name_dominant); resolve_field must pick the parks_canada
  // canonical_name (priority 1 > google priority 2). The attribution is
  // the strong assertion — it proves parks_canada won, not a coincidence.
  // ───────────────────────────────────────────────────────────────────
  it("Epsilon canonical_name + attribution resolve to parks_canada (binational)", async () => {
    const { data: mp } = await db
      .from("master_place")
      .select("canonical_name, attribution")
      .ilike("canonical_name", "%epsilon%")
      .single();
    expect(mp, "Epsilon master_place not found").toBeTruthy();
    expect(mp!.canonical_name).toBe("Epsilon Campground");
    const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
    expect(
      attribution.canonical_name,
      "parks_canada (priority 1) must win canonical_name over google (priority 2)",
    ).toBe("parks_canada");
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

// ────────────────────────────────────────────────────────────────────────
// Phase 1.5 / Alberta Parks — cross-jurisdiction non-overlap (×2) +
// name_dominant federation. Validates migration 20260601000000 + the
// alberta_parks precedence rules (canonical_name priority 1, geo-disjoint
// from nps/parks_canada/bc_parks; below google=1 only where Google is
// geographically present).
//
// Three independent synthetic scenarios, each with its own reset + cleanup.
// Synthetic source_records use the `test:federation:*` external_id
// namespace with alberta-specific suffixes (so they never collide with the
// BC Parks block's external_ids) and are explicitly deleted in afterAll.
// Coordinates are in Alberta/BC (lat ~50–54), far from the JT corpus
// (lat ~34), so a stray match could never federate these into JT.
// ────────────────────────────────────────────────────────────────────────

describeIfAllowed(
  "Phase 1.5 — Alberta Parks federation (cross-jurisdiction ×2 + name_dominant)",
  () => {
    // (a) Alberta Parks ↔ Parks Canada must NOT merge. Peter Lougheed
    // Provincial Park (Alberta provincial) sits in Kananaskis, adjacent to
    // Banff National Park (federal). Two park_boundary records ~57 km apart
    // through the REAL matcher: far beyond the 500 m candidate radius, so
    // two new_master_place outcomes, never a federation. Guards against
    // same-category park_boundary records merging regardless of
    // distance/jurisdiction.
    describe("(a) cross-jurisdiction non-overlap — Alberta Parks ↔ Parks Canada", () => {
      const AB_COORDS: [number, number] = [-115.13, 50.7]; // Peter Lougheed PP interior
      const PC_COORDS: [number, number] = [-115.57, 51.18]; // Banff NP interior, ~57 km NW
      const AB_EXT = "test:federation:alberta_parks:plougheed";
      const PC_EXT = "test:federation:parks_canada:banff";
      const AB_NAME = "Peter Lougheed Provincial Park";
      const PC_NAME = "Banff National Park";

      beforeAll(async () => {
        await db.rpc("reset_phase3a_test_state");

        await upsertSourceRecord({
          sourceId: "alberta_parks",
          externalId: AB_EXT,
          name: AB_NAME,
          inferredCategory: "park_boundary",
          point: AB_COORDS,
          rawPayload: { synthetic: true, source: "alberta_parks" },
          normalizedPayload: {
            canonical_name: AB_NAME,
            description: null,
            overlander_tags: ["provincial_land", "alberta_parks"],
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
          .in("external_id", [AB_EXT, PC_EXT]);
        expect(srErr).toBeNull();
        expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
        const byExt = new Map(
          (srRows ?? []).map((r) => [r.external_id, r.id as string]),
        );

        const outcomes = await matchAll([byExt.get(AB_EXT)!, byExt.get(PC_EXT)!]);
        const applyRes = await applyMatches(outcomes);
        expect(applyRes.errors, "apply phase emitted errors").toHaveLength(0);
      });

      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db.from("source_record").delete().in("external_id", [AB_EXT, PC_EXT]);
      });

      it("resolves to two separate master_places, not one merged", async () => {
        const { data: rows, error } = await db
          .from("source_record")
          .select("external_id, master_place_id")
          .in("external_id", [AB_EXT, PC_EXT]);
        expect(error, "source_record lookup failed").toBeNull();
        expect(rows, "both synthetic records present").toHaveLength(2);

        const byExt = new Map(
          (rows ?? []).map((r) => [r.external_id, r.master_place_id as string | null]),
        );
        const abMp = byExt.get(AB_EXT);
        const pcMp = byExt.get(PC_EXT);

        expect(abMp, "Alberta Parks record should link to a master_place").toBeTruthy();
        expect(pcMp, "Parks Canada record should link to a master_place").toBeTruthy();
        expect(
          abMp,
          "Alberta Parks (Peter Lougheed) and Parks Canada (Banff) must NOT federate — " +
            "provincial vs federal, ~57 km apart in Kananaskis",
        ).not.toBe(pcMp);
      });
    });

    // (b) Alberta Parks ↔ BC Parks must NOT merge across the shared BC/AB
    // border. Kakwa Wildland Provincial Park (Alberta) just east of the
    // 120°W boundary vs Kakwa Provincial Park (BC) just west — two
    // park_boundary records ~33 km apart through the REAL matcher. The
    // near-identical names make this the stronger guard: distance, not
    // name dissimilarity, is what keeps them apart.
    describe("(b) cross-jurisdiction non-overlap — Alberta Parks ↔ BC Parks", () => {
      const AB_COORDS: [number, number] = [-119.8, 54.0]; // Kakwa WPP (Alberta), E of border
      const BC_COORDS: [number, number] = [-120.3, 54.0]; // Kakwa PP (BC), ~33 km W across 120°W
      const AB_EXT = "test:federation:alberta_parks:kakwa";
      const BC_EXT = "test:federation:bc_parks:kakwa";
      const AB_NAME = "Kakwa Wildland Provincial Park";
      const BC_NAME = "Kakwa Provincial Park";

      beforeAll(async () => {
        await db.rpc("reset_phase3a_test_state");

        await upsertSourceRecord({
          sourceId: "alberta_parks",
          externalId: AB_EXT,
          name: AB_NAME,
          inferredCategory: "park_boundary",
          point: AB_COORDS,
          rawPayload: { synthetic: true, source: "alberta_parks" },
          normalizedPayload: {
            canonical_name: AB_NAME,
            description: null,
            overlander_tags: ["provincial_land", "alberta_parks"],
            contact: null,
            access: null,
            amenities: null,
            hours: null,
          },
          sourceQualityScore: 0.9,
        });
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

        const { data: srRows, error: srErr } = await db
          .from("source_record")
          .select("id, external_id")
          .in("external_id", [AB_EXT, BC_EXT]);
        expect(srErr).toBeNull();
        expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
        const byExt = new Map(
          (srRows ?? []).map((r) => [r.external_id, r.id as string]),
        );

        const outcomes = await matchAll([byExt.get(AB_EXT)!, byExt.get(BC_EXT)!]);
        const applyRes = await applyMatches(outcomes);
        expect(applyRes.errors, "apply phase emitted errors").toHaveLength(0);
      });

      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db.from("source_record").delete().in("external_id", [AB_EXT, BC_EXT]);
      });

      it("resolves to two separate master_places, not one merged", async () => {
        const { data: rows, error } = await db
          .from("source_record")
          .select("external_id, master_place_id")
          .in("external_id", [AB_EXT, BC_EXT]);
        expect(error, "source_record lookup failed").toBeNull();
        expect(rows, "both synthetic records present").toHaveLength(2);

        const byExt = new Map(
          (rows ?? []).map((r) => [r.external_id, r.master_place_id as string | null]),
        );
        const abMp = byExt.get(AB_EXT);
        const bcMp = byExt.get(BC_EXT);

        expect(abMp, "Alberta Parks record should link to a master_place").toBeTruthy();
        expect(bcMp, "BC Parks record should link to a master_place").toBeTruthy();
        expect(
          abMp,
          "Alberta Parks (Kakwa WPP) and BC Parks (Kakwa PP) must NOT federate — " +
            "different provinces ~33 km apart across the BC/AB border, despite near-identical names",
        ).not.toBe(bcMp);
      });
    });

    // (c) Alberta Parks × Google name_dominant — mirror of the bc_parks
    // synthetic above. alberta_parks is priority 1 for canonical_name
    // (migration 20260601000000), google is priority 2; when both co-link
    // to one master_place, alberta_parks must win. The attribution
    // assertion is the strong one: it proves resolve_field actually picked
    // alberta_parks, not that the value coincidentally matched.
    describe("(c) name_dominant federation — Alberta Parks wins canonical_name vs google", () => {
      const COORDS: [number, number] = [-115.13, 50.7]; // Peter Lougheed PP representative point
      const AB_EXT = "test:federation:alberta_parks:nd";
      const GOOGLE_EXT = "test:federation:google:nd_ab";
      const AB_NAME = "Peter Lougheed Provincial Park";
      const GOOGLE_NAME = "Peter Lougheed Park";
      const masterPlaceId = randomUUID();

      beforeAll(async () => {
        await db.rpc("reset_phase3a_test_state");

        await upsertSourceRecord({
          sourceId: "alberta_parks",
          externalId: AB_EXT,
          name: AB_NAME,
          inferredCategory: "park_boundary",
          point: COORDS,
          rawPayload: { synthetic: true, source: "alberta_parks" },
          normalizedPayload: {
            canonical_name: AB_NAME,
            description: null,
            overlander_tags: ["provincial_land", "alberta_parks"],
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
          .in("external_id", [AB_EXT, GOOGLE_EXT]);
        expect(srErr).toBeNull();
        expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
        const byExt = new Map(
          (srRows ?? []).map((r) => [r.external_id, r.id as string]),
        );

        const outcomes = [
          {
            kind: "new_master_place",
            source_record_id: byExt.get(AB_EXT)!,
            target: masterPlaceId,
            seed_category: "park_boundary",
            seed_geometry: COORDS,
            seed_name: AB_NAME,
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
          .in("external_id", [AB_EXT, GOOGLE_EXT]);
      });

      it("master_place.canonical_name + attribution resolve to alberta_parks", async () => {
        const { data: mp, error } = await db
          .from("master_place")
          .select("id, canonical_name, attribution")
          .eq("id", masterPlaceId)
          .single();
        expect(error, "master_place lookup failed").toBeNull();
        expect(mp, "master_place row should exist").not.toBeNull();

        // Value won by alberta_parks (priority 1 for canonical_name vs google=2).
        expect(
          mp!.canonical_name,
          "field_precedence resolved canonical_name to the wrong source — " +
            "check migration 20260601000000 applied (alberta_parks=1 vs google=2)",
        ).toBe(AB_NAME);

        // Stronger assertion: attribution proves resolve_field picked alberta_parks.
        const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
        expect(attribution.canonical_name).toBe("alberta_parks");
      });
    });
  },
);

// ────────────────────────────────────────────────────────────────────────
// Phase 3a / 4a — resolve_field determinism under tied priority.
//
// Validates migration 20260601010000's 3-key tie-breaker
// (ORDER BY priority ASC, source_quality_score DESC NULLS LAST, source_id ASC).
//
// nps and parks_canada both sit at canonical_name priority 1 — a real
// jurisdictional collision (the 4-way nps/parks_canada/bc_parks/alberta_parks
// tier). In production geographic disjointness keeps them from co-linking; here
// we force both onto one master_place via apply_match_outcomes so the
// tie-breaker is actually exercised. Two cases:
//   (a) different quality → higher quality wins (2-key behaviour)
//   (b) equal quality     → alphabetically-earlier source_id wins (the 3-key
//       tertiary, under the real nps==parks_canada==0.95 collision shape —
//       without it this case is non-deterministic and nothing would catch it)
//
// Coords are in Banff (lat ~51), far from the JT corpus (lat ~34). Synthetic
// records use the test:determinism:* external_id namespace and are deleted in
// afterAll (reset_phase3a_test_state unlinks but does not delete source_record
// rows), keeping the D4 baseline intact.
// ────────────────────────────────────────────────────────────────────────

describeIfAllowed(
  "Phase 3a / 4a — resolve_field determinism under tied priority",
  () => {
    const COORDS: [number, number] = [-115.55, 51.25];

    async function seedTiedPairAndApply(opts: {
      suffix: string;
      npsQuality: number;
      pcQuality: number;
      npsName: string;
      pcName: string;
    }): Promise<{ masterPlaceId: string; npsExt: string; pcExt: string }> {
      const npsExt = `test:determinism:${opts.suffix}:nps`;
      const pcExt = `test:determinism:${opts.suffix}:parks_canada`;
      const masterPlaceId = randomUUID();

      await db.rpc("reset_phase3a_test_state");

      // Both at the same coords, both priority 1 for canonical_name; only the
      // per-record source_quality_score and the canonical_name value differ.
      await upsertSourceRecord({
        sourceId: "nps",
        externalId: npsExt,
        name: opts.npsName,
        inferredCategory: "campground",
        point: COORDS,
        rawPayload: { synthetic: true, source: "nps" },
        normalizedPayload: { canonical_name: opts.npsName },
        sourceQualityScore: opts.npsQuality,
      });
      await upsertSourceRecord({
        sourceId: "parks_canada",
        externalId: pcExt,
        name: opts.pcName,
        inferredCategory: "campground",
        point: COORDS,
        rawPayload: { synthetic: true, source: "parks_canada" },
        normalizedPayload: { canonical_name: opts.pcName },
        sourceQualityScore: opts.pcQuality,
      });

      const { data: srRows, error: srErr } = await db
        .from("source_record")
        .select("id, external_id")
        .in("external_id", [npsExt, pcExt]);
      expect(srErr).toBeNull();
      expect(srRows, "synthetic source_records were upserted").toHaveLength(2);
      const byExt = new Map((srRows ?? []).map((r) => [r.external_id, r.id as string]));

      // Force both onto one master_place: nps seeds it, parks_canada links in.
      // apply_match_outcomes runs recompute_master_place → resolve_field.
      const outcomes = [
        {
          kind: "new_master_place",
          source_record_id: byExt.get(npsExt)!,
          target: masterPlaceId,
          seed_category: "campground",
          seed_geometry: COORDS,
          seed_name: opts.npsName,
        },
        {
          kind: "auto_link",
          source_record_id: byExt.get(pcExt)!,
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
      return { masterPlaceId, npsExt, pcExt };
    }

    // (a) Different quality at the same priority. parks_canada (0.95) must beat
    // nps (0.80) on the source_quality_score key — and crucially it wins
    // despite being the alphabetically *later* source_id, proving the quality
    // key is consulted before source_id.
    describe("(a) different quality, same priority → higher quality wins", () => {
      let ctx: { masterPlaceId: string; npsExt: string; pcExt: string };
      beforeAll(async () => {
        ctx = await seedTiedPairAndApply({
          suffix: "diffqual",
          npsQuality: 0.8,
          pcQuality: 0.95,
          npsName: "Determinism A — NPS",
          pcName: "Determinism A — Parks Canada",
        });
      });
      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db.from("source_record").delete().in("external_id", [ctx.npsExt, ctx.pcExt]);
      });

      it("resolves canonical_name to parks_canada (quality 0.95 > nps 0.80)", async () => {
        const { data: mp, error } = await db
          .from("master_place")
          .select("canonical_name, attribution")
          .eq("id", ctx.masterPlaceId)
          .single();
        expect(error, "master_place lookup failed").toBeNull();
        expect(mp!.canonical_name).toBe("Determinism A — Parks Canada");
        const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
        expect(
          attribution.canonical_name,
          "quality DESC must break the priority-1 tie before source_id is consulted",
        ).toBe("parks_canada");
      });
    });

    // (b) Equal quality at the same priority — the real collision shape
    // (nps == parks_canada == 0.95). source_id ASC is the only thing that makes
    // this deterministic: 'nps' < 'parks_canada', so nps wins every time.
    describe("(b) equal quality, same priority → alphabetically-earlier source_id wins", () => {
      let ctx: { masterPlaceId: string; npsExt: string; pcExt: string };
      beforeAll(async () => {
        ctx = await seedTiedPairAndApply({
          suffix: "eqqual",
          npsQuality: 0.95,
          pcQuality: 0.95,
          npsName: "Determinism B — NPS",
          pcName: "Determinism B — Parks Canada",
        });
      });
      afterAll(async () => {
        await db.rpc("reset_phase3a_test_state");
        await db.from("source_record").delete().in("external_id", [ctx.npsExt, ctx.pcExt]);
      });

      it("resolves canonical_name to nps ('nps' < 'parks_canada') under equal 0.95 quality", async () => {
        const { data: mp, error } = await db
          .from("master_place")
          .select("canonical_name, attribution")
          .eq("id", ctx.masterPlaceId)
          .single();
        expect(error, "master_place lookup failed").toBeNull();
        expect(mp!.canonical_name).toBe("Determinism B — NPS");
        const attribution = (mp!.attribution as Record<string, unknown>) ?? {};
        expect(
          attribution.canonical_name,
          "source_id ASC is the tertiary key that makes the equal-quality collision deterministic",
        ).toBe("nps");
      });
    });
  },
);
