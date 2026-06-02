/**
 * Unit tests for the materialize orchestrator's pure helpers.
 *
 * computeTrulyUnresolvedIds is the DB-free core of findTrulyUnresolvedIds —
 * the set-difference + fail-closed category allowlist that decides the
 * incremental ER delta. The DB wrapper is a thin fetch around it; the
 * logic lives here.
 */

import { describe, expect, it } from "vitest";

import { computeTrulyUnresolvedIds } from "./materialize.ts";

type SrRow = { id: string; inferred_category?: string | null };
type PmRow = { source_record_id: string };

describe("computeTrulyUnresolvedIds", () => {
  it("drops records that already have a place_match row", () => {
    const sr: SrRow[] = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const pm: PmRow[] = [{ source_record_id: "b" }];
    expect(computeTrulyUnresolvedIds(sr, pm)).toEqual(["a", "c"]);
  });

  it("with an empty allowlist, returns every unresolved id in input order", () => {
    const sr: SrRow[] = [
      { id: "a", inferred_category: "campground" },
      { id: "b", inferred_category: "viewpoint" },
      { id: "c", inferred_category: "park_boundary" },
    ];
    expect(computeTrulyUnresolvedIds(sr, [])).toEqual(["a", "b", "c"]);
  });

  it("keeps ONLY records whose inferred_category is in the allowlist", () => {
    const sr: SrRow[] = [
      { id: "camp1", inferred_category: "campground" },
      { id: "view1", inferred_category: "viewpoint" },
      { id: "nhs1", inferred_category: "national_historic_site" },
      { id: "camp2", inferred_category: "campground" },
      { id: "bound1", inferred_category: "park_boundary" },
    ];
    const allow = ["park_boundary", "viewpoint", "national_historic_site"];
    expect(computeTrulyUnresolvedIds(sr, [], allow)).toEqual(["view1", "nhs1", "bound1"]);
  });

  it("captures BC park records (inferred_category='park_boundary') via the allowlist", () => {
    // BC Parks emits inferred_category='park_boundary' (the source_id is
    // 'bc_parks', NOT a category). The allowlist names park_boundary, so BC
    // records are captured — guards against the silent under-ship trap.
    const sr: SrRow[] = [
      { id: "bc-robson", inferred_category: "park_boundary" },
      { id: "pc-banff", inferred_category: "park_boundary" },
      { id: "pc-campsite", inferred_category: "campground" },
    ];
    const allow = ["park_boundary", "park_feature", "viewpoint", "national_historic_site", "visitor_center"];
    expect(computeTrulyUnresolvedIds(sr, [], allow)).toEqual(["bc-robson", "pc-banff"]);
  });

  it("is fail-closed: a null/absent/unmapped category is held back when an allowlist is set", () => {
    const sr: SrRow[] = [
      { id: "nullcat", inferred_category: null },
      { id: "nocat" },
      { id: "unmapped", inferred_category: "some_new_category" },
      { id: "view", inferred_category: "viewpoint" },
    ];
    // Only the explicitly-named category survives; everything unmapped drops.
    expect(computeTrulyUnresolvedIds(sr, [], ["viewpoint"])).toEqual(["view"]);
  });

  it("applies place_match exclusion and the allowlist together", () => {
    const sr: SrRow[] = [
      { id: "camp1", inferred_category: "campground" }, // not in allowlist → dropped
      { id: "view1", inferred_category: "viewpoint" }, // already matched → dropped
      { id: "nhs1", inferred_category: "national_historic_site" }, // kept
    ];
    const pm: PmRow[] = [{ source_record_id: "view1" }];
    const allow = ["viewpoint", "national_historic_site"];
    expect(computeTrulyUnresolvedIds(sr, pm, allow)).toEqual(["nhs1"]);
  });
});
