/**
 * Unit tests for dryrun-report.ts.
 *
 * Split in two:
 *   1. Pure helpers (deltas accumulator, prefix / coord heuristics) —
 *      trivial input/output assertions.
 *   2. buildReport end-to-end via fixture SR/MP maps + synthetic
 *      MatchOutcome[] — no DB, no matcher. This is the semantics-of-
 *      record for the report; every flag rule is exercised.
 *
 * The DB-touching writeDryRunReport is not exercised here — it's just
 * batchedFetch + buildReport + file I/O; the interesting logic is all
 * in buildReport.
 */

import { describe, expect, it } from "vitest";

import type { MatchOutcome } from "../entity-resolution/matcher.ts";
import {
  buildReport,
  computeProjectedDeltas,
  looksCoordDominantBug1,
  looksPrefixDrivenBug2,
  sharedPrefixLength,
  type DryRunReportRow,
  type MpContext,
  type SrContext,
} from "./dryrun-report.ts";

// ── Outcome factories ──────────────────────────────────────────────────

function autoLink(srId: string, target: string, opts: Partial<{
  confidence: number;
  method: "deterministic" | "fed_exact" | "name_dominant";
  score: {
    distance_meters: number;
    name_similarity: number;
    category_compatibility: number;
    combined_confidence: number;
  } | null;
}> = {}): MatchOutcome {
  return {
    kind: "auto_link",
    source_record_id: srId,
    target,
    confidence: opts.confidence ?? 0.95,
    method: opts.method ?? "name_dominant",
    score: opts.score ?? null,
  };
}
function amenityRollup(srId: string, target: string): MatchOutcome {
  return { kind: "amenity_rollup", source_record_id: srId, target };
}
function manualReview(srId: string, target: string, opts: Partial<{
  confidence: number;
  method: "close_nameless" | "blended_residual";
  score: {
    distance_meters: number;
    name_similarity: number;
    category_compatibility: number;
    combined_confidence: number;
  };
}> = {}): MatchOutcome {
  return {
    kind: "manual_review",
    source_record_id: srId,
    target,
    confidence: opts.confidence ?? 0.65,
    score: opts.score ?? { distance_meters: 200, name_similarity: 0.7, category_compatibility: 1, combined_confidence: 0.65 },
    method: opts.method ?? "blended_residual",
  };
}
function newMp(srId: string, target: string, seedName = "New Place"): MatchOutcome {
  return {
    kind: "new_master_place",
    source_record_id: srId,
    target,
    seed_category: "trailhead",
    seed_geometry: [-111, 39],
    seed_name: seedName,
  };
}

// ── Fixture builders ───────────────────────────────────────────────────

function sr(id: string, over: Partial<SrContext> = {}): SrContext {
  return {
    id,
    external_id: `osm:${id}`,
    name: `SR ${id}`,
    inferred_category: "trailhead",
    geometry: { type: "Point", coordinates: [-111, 39] },
    ...over,
  };
}
function mp(id: string, over: Partial<MpContext> = {}): MpContext {
  return {
    id,
    canonical_name: `MP ${id}`,
    primary_category: "trailhead",
    source_count: 1,
    ...over,
  };
}

// ── computeProjectedDeltas ─────────────────────────────────────────────

describe("computeProjectedDeltas", () => {
  it("accumulates deltas from auto_link and amenity_rollup only", () => {
    const outcomes: MatchOutcome[] = [
      autoLink("sr1", "mpA"),
      autoLink("sr2", "mpA"),
      amenityRollup("sr3", "mpA"),
      autoLink("sr4", "mpB"),
      manualReview("sr5", "mpB"),
      newMp("sr6", "mpC"),
    ];
    const d = computeProjectedDeltas(outcomes);
    expect(d.get("mpA")).toBe(3);
    expect(d.get("mpB")).toBe(1);
    expect(d.has("mpC")).toBe(false);
  });
  it("returns empty map for empty outcomes", () => {
    expect(computeProjectedDeltas([])).toEqual(new Map());
  });
  it("returns empty map when only manual_review + new_master_place outcomes", () => {
    const outcomes: MatchOutcome[] = [manualReview("sr1", "mp1"), newMp("sr2", "mp2")];
    expect(computeProjectedDeltas(outcomes)).toEqual(new Map());
  });
});

// ── sharedPrefixLength ─────────────────────────────────────────────────

describe("sharedPrefixLength", () => {
  it("case-insensitive shared prefix", () => {
    expect(sharedPrefixLength("Boulder Creek Trailhead", "BOULDER Creek Loop")).toBe(14);
  });
  it("no shared prefix", () => {
    expect(sharedPrefixLength("Alpha", "Zulu")).toBe(0);
  });
  it("full identity", () => {
    expect(sharedPrefixLength("Same", "Same")).toBe(4);
  });
  it("empty strings", () => {
    expect(sharedPrefixLength("", "anything")).toBe(0);
    expect(sharedPrefixLength("", "")).toBe(0);
  });
});

// ── looksPrefixDrivenBug2 ──────────────────────────────────────────────

describe("looksPrefixDrivenBug2 (matcher Bug 2 shape)", () => {
  it("flags 'Buckhorn Draw Campsite 10' vs 'Buckhorn Dino Track' (the documented BACKLOG case)", () => {
    expect(looksPrefixDrivenBug2("Buckhorn Draw Campsite 10", "Buckhorn Dino Track", 0.6)).toBe(true);
  });
  it("does NOT flag identical names (that's name_dominant working as intended)", () => {
    expect(looksPrefixDrivenBug2("Kelsey Creek", "Kelsey Creek", 0.86)).toBe(false);
  });
  it("does NOT flag when the prefix accounts for >= half the longer name", () => {
    expect(looksPrefixDrivenBug2("Boulder", "Boulders", 0.85)).toBe(false);
  });
  it("does NOT flag when overall name similarity is high (>= 0.9)", () => {
    expect(looksPrefixDrivenBug2("Riverside Campground", "Riverside Campgrounds", 0.95)).toBe(false);
  });
  it("does NOT flag when either name is too short (< 6 chars)", () => {
    expect(looksPrefixDrivenBug2("Elk", "Elk Meadow", 0.5)).toBe(false);
    expect(looksPrefixDrivenBug2("Elk Meadow", "Elk", 0.5)).toBe(false);
  });
  it("does NOT flag null/undefined names", () => {
    expect(looksPrefixDrivenBug2(null, "anything", 0.5)).toBe(false);
    expect(looksPrefixDrivenBug2("anything", undefined, 0.5)).toBe(false);
  });
  it("flags when prefix < half the longer name AND similarity moderate", () => {
    expect(looksPrefixDrivenBug2("Sheep Pass Trail", "Sheep Pass Group Campground", 0.75)).toBe(true);
  });
});

// ── looksCoordDominantBug1 ─────────────────────────────────────────────

describe("looksCoordDominantBug1 (matcher Bug 1 shape)", () => {
  function row(over: Partial<DryRunReportRow>): DryRunReportRow {
    return {
      outcome: "auto_link",
      source_record_id: "sr", source_external_id: null, source_name: null, source_lng: null, source_lat: null, source_inferred_category: null,
      match_method: null, combined_confidence: null, distance_meters: null, name_similarity: null, category_compatibility: null,
      target_mp_id: null, target_mp_name: null, target_mp_category: null, target_mp_source_count_current: null, target_mp_source_count_projected: null,
      flags: [],
      ...over,
    };
  }
  it("flags 0m distance + low name similarity", () => {
    expect(looksCoordDominantBug1(row({ distance_meters: 0, name_similarity: 0.6 }))).toBe(true);
  });
  it("flags 40m + weak name similarity", () => {
    expect(looksCoordDominantBug1(row({ distance_meters: 40, name_similarity: 0.5 }))).toBe(true);
  });
  it("does NOT flag > 50m distance", () => {
    expect(looksCoordDominantBug1(row({ distance_meters: 100, name_similarity: 0.5 }))).toBe(false);
  });
  it("does NOT flag when name similarity >= 0.7", () => {
    expect(looksCoordDominantBug1(row({ distance_meters: 0, name_similarity: 0.75 }))).toBe(false);
  });
  it("does NOT flag non-auto_link outcomes", () => {
    expect(looksCoordDominantBug1(row({ outcome: "manual_review", distance_meters: 0, name_similarity: 0.6 }))).toBe(false);
    expect(looksCoordDominantBug1(row({ outcome: "new_master_place", distance_meters: 0, name_similarity: 0.6 }))).toBe(false);
  });
  it("does NOT flag when distance is null", () => {
    expect(looksCoordDominantBug1(row({ distance_meters: null, name_similarity: 0.5 }))).toBe(false);
  });
});

// ── buildReport — the semantics of record ──────────────────────────────

describe("buildReport", () => {
  it("bug fix #1 — `mp_receiving_gt_3_new_srs` is a DELTA flag, not a projected-total flag", () => {
    // Two MPs both projected > 3, but only one is RECEIVING > 3 new SRs
    // in this run. The delta flag must distinguish them.
    const outcomes: MatchOutcome[] = [
      // MP-1: receives 4 new SRs → delta=4 → flag fires
      autoLink("sr1", "mp-receiving-many"),
      autoLink("sr2", "mp-receiving-many"),
      autoLink("sr3", "mp-receiving-many"),
      amenityRollup("sr4", "mp-receiving-many"),
      // MP-2: already large (source_count=8), receives 1 SR → delta=1 → flag does NOT fire
      autoLink("sr5", "mp-already-large"),
    ];
    const srMap = new Map<string, SrContext>([
      ["sr1", sr("sr1")], ["sr2", sr("sr2")], ["sr3", sr("sr3")],
      ["sr4", sr("sr4")], ["sr5", sr("sr5")],
    ]);
    const mpMap = new Map<string, MpContext>([
      ["mp-receiving-many", mp("mp-receiving-many", { source_count: 1 })],
      ["mp-already-large",  mp("mp-already-large",  { source_count: 8 })],
    ]);
    const { rows, summary } = buildReport(outcomes, srMap, mpMap);

    // Delta = 4 for MP-1, so all 4 rows targeting it get the flag.
    const flagged = rows.filter((r) => r.flags.includes("mp_receiving_gt_3_new_srs"));
    expect(flagged.length).toBe(4);
    expect(new Set(flagged.map((r) => r.target_mp_id))).toEqual(new Set(["mp-receiving-many"]));

    // Distinct-MPs summary count: 1 (not 4).
    expect(summary.flagged.mp_receiving_gt_3_new_srs.length).toBe(4);
    const distinct = new Set(summary.flagged.mp_receiving_gt_3_new_srs.map((r) => r.target_mp_id));
    expect(distinct.size).toBe(1);

    // The large-but-only-+1 MP does NOT get flagged, even though projected is 9.
    const largeMpRow = rows.find((r) => r.target_mp_id === "mp-already-large");
    expect(largeMpRow?.target_mp_source_count_current).toBe(8);
    expect(largeMpRow?.target_mp_source_count_projected).toBe(9);
    expect(largeMpRow?.flags.includes("mp_receiving_gt_3_new_srs")).toBe(false);
  });

  it("bug fix #2 — manual_review projected reflects current + delta from other outcomes on the same MP", () => {
    // MP X has source_count=5. In this run: 3 auto_link + 1 manual_review target it.
    // All 4 rows should report projected=8 (5 + 3 delta), including the manual_review.
    const outcomes: MatchOutcome[] = [
      autoLink("sr1", "mpX"),
      autoLink("sr2", "mpX"),
      autoLink("sr3", "mpX"),
      manualReview("sr4", "mpX"),
    ];
    const srMap = new Map<string, SrContext>([
      ["sr1", sr("sr1")], ["sr2", sr("sr2")], ["sr3", sr("sr3")], ["sr4", sr("sr4")],
    ]);
    const mpMap = new Map<string, MpContext>([["mpX", mp("mpX", { source_count: 5 })]]);
    const { rows } = buildReport(outcomes, srMap, mpMap);
    const projections = rows.map((r) => r.target_mp_source_count_projected);
    expect(projections).toEqual([8, 8, 8, 8]);
    // And the auto_link rows AND the manual_review row are consistent.
    const mr = rows.find((r) => r.outcome === "manual_review");
    expect(mr?.target_mp_source_count_current).toBe(5);
    expect(mr?.target_mp_source_count_projected).toBe(8);
  });

  it("bug fix #3 — `hasTarget` was removed; every outcome kind still lands its target correctly", () => {
    // Regression guard: after deleting the dead `hasTarget` guard, the row
    // for each variant still carries the expected target_mp_id.
    const outcomes: MatchOutcome[] = [
      autoLink("sr1", "mp-auto"),
      amenityRollup("sr2", "mp-roll"),
      manualReview("sr3", "mp-review"),
      newMp("sr4", "mp-planned", "New Place"),
    ];
    const srMap = new Map<string, SrContext>([
      ["sr1", sr("sr1")], ["sr2", sr("sr2")], ["sr3", sr("sr3")], ["sr4", sr("sr4")],
    ]);
    const mpMap = new Map<string, MpContext>([
      ["mp-auto",   mp("mp-auto",   { canonical_name: "Auto MP" })],
      ["mp-roll",   mp("mp-roll",   { canonical_name: "Roll MP" })],
      ["mp-review", mp("mp-review", { canonical_name: "Review MP" })],
      // mp-planned NOT in mpMap — it's a within-run new_master_place UUID
    ]);
    const { rows } = buildReport(outcomes, srMap, mpMap);
    const byKind = new Map(rows.map((r) => [r.outcome, r]));
    expect(byKind.get("auto_link")?.target_mp_id).toBe("mp-auto");
    expect(byKind.get("auto_link")?.target_mp_name).toBe("Auto MP");
    expect(byKind.get("amenity_rollup")?.target_mp_id).toBe("mp-roll");
    expect(byKind.get("manual_review")?.target_mp_id).toBe("mp-review");
    // new_master_place: target IS set (the planned UUID), name comes from seed_name.
    expect(byKind.get("new_master_place")?.target_mp_id).toBe("mp-planned");
    expect(byKind.get("new_master_place")?.target_mp_name).toBe("New Place");
    expect(byKind.get("new_master_place")?.target_mp_source_count_current).toBeNull();
    expect(byKind.get("new_master_place")?.target_mp_source_count_projected).toBe(1);
  });

  it("`projected_source_count_gt_20` — VERIFIED by fixture: flag fires when final MP total > 20", () => {
    // MP X starts at source_count=19, receives 2 new SRs → projected=21 → flag fires.
    // MP Y starts at source_count=20, receives 0 new SRs (only manual_review) → projected=20 → flag does NOT fire.
    // MP Z starts at source_count=1, receives 25 new SRs → projected=26 → flag fires (and delta flag too).
    const zAutos: MatchOutcome[] = Array.from({ length: 25 }, (_, i) => autoLink(`sr-z-${i}`, "mpZ"));
    const outcomes: MatchOutcome[] = [
      autoLink("sr-x1", "mpX"),
      autoLink("sr-x2", "mpX"),
      manualReview("sr-y1", "mpY"),
      ...zAutos,
    ];
    const srMap = new Map<string, SrContext>();
    for (const o of outcomes) srMap.set(o.source_record_id, sr(o.source_record_id));
    const mpMap = new Map<string, MpContext>([
      ["mpX", mp("mpX", { source_count: 19 })],
      ["mpY", mp("mpY", { source_count: 20 })],
      ["mpZ", mp("mpZ", { source_count: 1 })],
    ]);
    const { rows, summary } = buildReport(outcomes, srMap, mpMap);

    // X: both rows projected=21, both flagged gt_20
    const xRows = rows.filter((r) => r.target_mp_id === "mpX");
    expect(xRows.length).toBe(2);
    for (const r of xRows) {
      expect(r.target_mp_source_count_projected).toBe(21);
      expect(r.flags.includes("projected_source_count_gt_20")).toBe(true);
    }

    // Y: 1 row projected=20 (manual_review, no delta), NOT flagged gt_20 (20 is not > 20)
    const yRow = rows.find((r) => r.target_mp_id === "mpY");
    expect(yRow?.target_mp_source_count_projected).toBe(20);
    expect(yRow?.flags.includes("projected_source_count_gt_20")).toBe(false);

    // Z: 25 rows projected=26, all flagged both gt_20 AND the delta flag
    const zRows = rows.filter((r) => r.target_mp_id === "mpZ");
    expect(zRows.length).toBe(25);
    for (const r of zRows) {
      expect(r.target_mp_source_count_projected).toBe(26);
      expect(r.flags.includes("projected_source_count_gt_20")).toBe(true);
      expect(r.flags.includes("mp_receiving_gt_3_new_srs")).toBe(true);
    }

    // Summary — distinct MPs affected: X + Z = 2 for gt_20; Z = 1 for delta flag
    const distinct = (rowsSubset: DryRunReportRow[]) =>
      new Set(rowsSubset.map((r) => r.target_mp_id).filter((x): x is string => Boolean(x))).size;
    expect(distinct(summary.flagged.projected_source_count_gt_20)).toBe(2);
    expect(distinct(summary.flagged.mp_receiving_gt_3_new_srs)).toBe(1);
  });

  it("gt_20 threshold is STRICTLY greater than 20 (21 fires, 20 does not)", () => {
    const outcomes: MatchOutcome[] = [
      autoLink("sr1", "mp-at-20"),      // 19 + 1 = 20 (NOT flagged)
      autoLink("sr2", "mp-at-21"),      // 20 + 1 = 21 (flagged)
    ];
    const srMap = new Map<string, SrContext>([
      ["sr1", sr("sr1")], ["sr2", sr("sr2")],
    ]);
    const mpMap = new Map<string, MpContext>([
      ["mp-at-20", mp("mp-at-20", { source_count: 19 })],
      ["mp-at-21", mp("mp-at-21", { source_count: 20 })],
    ]);
    const { rows } = buildReport(outcomes, srMap, mpMap);
    expect(rows.find((r) => r.target_mp_id === "mp-at-20")?.flags.includes("projected_source_count_gt_20")).toBe(false);
    expect(rows.find((r) => r.target_mp_id === "mp-at-21")?.flags.includes("projected_source_count_gt_20")).toBe(true);
  });

  it("delta flag threshold is STRICTLY greater than 3 (delta=4 fires, delta=3 does not)", () => {
    const outcomes: MatchOutcome[] = [
      autoLink("s1", "mp-3"), autoLink("s2", "mp-3"), autoLink("s3", "mp-3"),   // delta=3, NOT flagged
      autoLink("s4", "mp-4"), autoLink("s5", "mp-4"), autoLink("s6", "mp-4"), autoLink("s7", "mp-4"), // delta=4, flagged
    ];
    const srMap = new Map<string, SrContext>();
    for (const o of outcomes) srMap.set(o.source_record_id, sr(o.source_record_id));
    const mpMap = new Map<string, MpContext>([
      ["mp-3", mp("mp-3")],
      ["mp-4", mp("mp-4")],
    ]);
    const { rows } = buildReport(outcomes, srMap, mpMap);
    const mp3Rows = rows.filter((r) => r.target_mp_id === "mp-3");
    const mp4Rows = rows.filter((r) => r.target_mp_id === "mp-4");
    for (const r of mp3Rows) expect(r.flags.includes("mp_receiving_gt_3_new_srs")).toBe(false);
    for (const r of mp4Rows) expect(r.flags.includes("mp_receiving_gt_3_new_srs")).toBe(true);
  });

  it("bug-shape flags remain auto_link-only (regression from the picnic-1-run defect)", () => {
    // A prefix-shape SR/MP name pair delivered as manual_review must NOT flag bug2.
    const outcomes: MatchOutcome[] = [
      manualReview("sr1", "mp-shared-prefix", {
        score: { distance_meters: 200, name_similarity: 0.75, category_compatibility: 1, combined_confidence: 0.7 },
      }),
    ];
    const srMap = new Map<string, SrContext>([
      ["sr1", sr("sr1", { name: "Buckhorn Draw Campsite 10" })],
    ]);
    const mpMap = new Map<string, MpContext>([
      ["mp-shared-prefix", mp("mp-shared-prefix", { canonical_name: "Buckhorn Dino Track" })],
    ]);
    const { rows } = buildReport(outcomes, srMap, mpMap);
    // Row exists but no bug-shape flags (they're auto_link-only).
    expect(rows.length).toBe(1);
    expect(rows[0].flags).toEqual([]); // no bug2, no low_conf, no bug1
  });

  it("aggregate counts (by_outcome) match the outcomes array — matcher observability contract", () => {
    const outcomes: MatchOutcome[] = [
      autoLink("s1", "m1"), autoLink("s2", "m1"),
      amenityRollup("s3", "m2"),
      manualReview("s4", "m3"),
      newMp("s5", "m4"), newMp("s6", "m5"),
    ];
    const srMap = new Map<string, SrContext>();
    for (const o of outcomes) srMap.set(o.source_record_id, sr(o.source_record_id));
    const mpMap = new Map<string, MpContext>([
      ["m1", mp("m1")], ["m2", mp("m2")], ["m3", mp("m3")],
    ]);
    const { summary } = buildReport(outcomes, srMap, mpMap);
    expect(summary.total_outcomes).toBe(6);
    expect(summary.by_outcome).toEqual({
      auto_link: 2, amenity_rollup: 1, manual_review: 1, new_master_place: 2,
    });
  });
});
