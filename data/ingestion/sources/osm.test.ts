/**
 * Unit tests for osm.ts pure helpers — focused on the Phase 2 (PR-B)
 * dispersed-camping classification split. No network/DB.
 */

import { describe, expect, it } from "vitest";

import { _internals, ALL_FAMILIES, DEFAULT_FAMILIES, parseFamilies, type TagFamily } from "./osm.ts";

const { inferCategory, normalizeOsm, buildOverpassQuery, bboxScope, areaScope } = _internals;

describe("inferCategory — dispersed-camping split (PR-B)", () => {
  it("camp_site + backcountry=yes → dispersed_camping", () => {
    expect(inferCategory({ tourism: "camp_site", backcountry: "yes" })).toBe("dispersed_camping");
  });
  it("camp_site + informal=yes → dispersed_camping", () => {
    expect(inferCategory({ tourism: "camp_site", informal: "yes" })).toBe("dispersed_camping");
  });
  it("plain camp_site → campground (unchanged)", () => {
    expect(inferCategory({ tourism: "camp_site" })).toBe("campground");
    expect(inferCategory({ tourism: "camp_site", backcountry: "no" })).toBe("campground");
  });
  it("caravan_site stays campground even with backcountry=yes (RV-oriented, not dispersed)", () => {
    expect(inferCategory({ tourism: "caravan_site", backcountry: "yes" })).toBe("campground");
  });
  it("non-camping tags are unaffected by the split", () => {
    expect(inferCategory({ tourism: "viewpoint" })).toBe("viewpoint");
    expect(inferCategory({ natural: "peak", backcountry: "yes" })).toBe("peak");
    expect(inferCategory({ natural: "spring" })).toBe("spring");
  });
});

describe("inferCategory — retired fuel family (fuel/charging_station/bbq/fire_pit)", () => {
  // Google Places covers gas + EV charging live; fire_pit has zero six-state
  // nodes; bbq is amenity noise. These tags were dropped from TAG_TO_CATEGORY
  // (natural/fuel audit, 2026-08-11), so they no longer categorize.
  it("amenity=fuel is no longer mapped", () => {
    expect(inferCategory({ amenity: "fuel" })).toBeNull();
  });
  it("amenity=charging_station is no longer mapped", () => {
    expect(inferCategory({ amenity: "charging_station" })).toBeNull();
  });
  it("amenity=bbq / amenity=fire_pit are no longer mapped", () => {
    expect(inferCategory({ amenity: "bbq" })).toBeNull();
    expect(inferCategory({ amenity: "fire_pit" })).toBeNull();
  });
});

describe("inferCategory — dump_station tag correction", () => {
  it("amenity=sanitary_dump_station → dump_station (RV sanitary dumps, the intended target)", () => {
    expect(inferCategory({ amenity: "sanitary_dump_station" })).toBe("dump_station");
  });
  it("amenity=waste_disposal → NOT categorized as dump_station (municipal trash bin, not RV)", () => {
    // waste_disposal was previously mis-mapped to dump_station and produced
    // 1,723 false-positive rows on PROD. It's no longer in the mapping.
    expect(inferCategory({ amenity: "waste_disposal" })).toBeNull();
  });
});

describe("normalizeOsm — dump_station amenity boolean tracks sanitary_dump_station only", () => {
  it("sanitary_dump_station node lights the dump_station amenity flag", () => {
    const n = normalizeOsm({ amenity: "sanitary_dump_station" }, "Unnamed dump station", "dump_station");
    expect((n.amenities as Record<string, unknown> | null)?.dump_station).toBe(true);
  });
  it("waste_disposal node does NOT light the dump_station amenity flag", () => {
    const n = normalizeOsm({ amenity: "waste_disposal" }, "Unnamed waste_disposal", null);
    // With waste_disposal removed from the mapping, its category is null and
    // the amenity flag is not set either — the row wouldn't even ingest via
    // persistElement's category-null guard, but the pure normalizer should
    // still refuse to falsely flag it as a dump_station.
    expect(n.amenities).toBeNull();
  });
});

describe("buildOverpassQuery — tag-family flag", () => {
  const bbox = bboxScope([-114.05, 37.00, -109.04, 42.00]); // UT

  // Sentinels — one distinctive predicate substring per family, chosen so a
  // match unambiguously identifies its family in the emitted query text.
  const SIGIL: Record<TagFamily, string> = {
    camping: '"tourism"~"^(camp_site|caravan_site)$"',
    tourism_misc: '"tourism"~"^(picnic_site|viewpoint',
    water_san: '"man_made"~"^(water_well|water_tap)$"',
    trailheads: '"highway"~"^(services|rest_area|trailhead)$"',
    shops: '"shop"~"^(supermarket|convenience|outdoor|hardware)$"',
    spring: '"natural"="spring"',
    peak: '"natural"="peak"',
    beach: '"natural"="beach"',
    leisure: '"leisure"~"^(park|nature_reserve)$"',
  };

  it("default (no opts) emits every DEFAULT family's predicates and OMITS shops", () => {
    const q = buildOverpassQuery(bbox);
    for (const family of DEFAULT_FAMILIES) {
      expect(q, `family ${family} must be present in default query`).toContain(SIGIL[family]);
    }
    // shops is defined but OFF by default (retail-quality rationale in osm.ts).
    expect(q, "shops must NOT appear in default").not.toContain(SIGIL.shops);
    // Camping's variant clauses always ship with the camping family.
    expect(q).toContain('"backcountry"="yes"');
    expect(q).toContain('"informal"="yes"');
    // waste_disposal must NOT appear (removed in tag correction).
    expect(q).not.toContain("waste_disposal");
    // dump_station is present as sanitary_dump_station.
    expect(q).toContain("sanitary_dump_station");
  });

  it("shops is still available via explicit --families (opt-in), and only shops appears", () => {
    const q = buildOverpassQuery(bbox, { families: ["shops"] });
    expect(q).toContain(SIGIL.shops);
    for (const other of ALL_FAMILIES) {
      if (other === "shops") continue;
      expect(q, `family ${other} must NOT appear when only shops is selected`).not.toContain(SIGIL[other]);
    }
  });

  it("DEFAULT_FAMILIES excludes shops but ALL_FAMILIES includes it", () => {
    expect(DEFAULT_FAMILIES).not.toContain("shops");
    expect(ALL_FAMILIES).toContain("shops");
    // Every other family should be in the default.
    for (const f of ALL_FAMILIES) {
      if (f === "shops") continue;
      expect(DEFAULT_FAMILIES).toContain(f);
    }
  });

  it("families: ['camping'] emits camping predicates and OMITS every other family", () => {
    const q = buildOverpassQuery(bbox, { families: ["camping"] });
    expect(q).toContain(SIGIL.camping);
    expect(q).toContain('"backcountry"="yes"');
    expect(q).toContain('"informal"="yes"');
    for (const other of ALL_FAMILIES) {
      if (other === "camping") continue;
      expect(q, `family ${other} must NOT appear when only camping is selected`).not.toContain(SIGIL[other]);
    }
  });

  it("families: ['water_san'] emits both water predicates and OMITS other families", () => {
    const q = buildOverpassQuery(bbox, { families: ["water_san"] });
    // water_san has two predicates — amenity subset AND man_made subset
    expect(q).toContain('"amenity"~"^(drinking_water|toilets|shower|sanitary_dump_station)$"');
    expect(q).toContain(SIGIL.water_san);
    for (const other of ALL_FAMILIES) {
      if (other === "water_san") continue;
      expect(q, `family ${other} must NOT appear`).not.toContain(SIGIL[other]);
    }
    // The camping variant clauses (backcountry/informal) belong to camping,
    // not water_san — must not leak in.
    expect(q).not.toContain('"backcountry"="yes"');
    expect(q).not.toContain('"informal"="yes"');
  });

  for (const fam of ["spring", "peak", "beach"] as const) {
    it(`families: ['${fam}'] emits ONLY its own natural=${fam} predicate`, () => {
      const q = buildOverpassQuery(bbox, { families: [fam] });
      expect(q).toContain(`node["natural"="${fam}"]`);
      // The other two natural families must not leak in — the bundle is split.
      for (const other of ["spring", "peak", "beach"] as const) {
        if (other === fam) continue;
        expect(q, `natural=${other} must not appear`).not.toContain(`"natural"="${other}"`);
      }
      for (const other of ALL_FAMILIES) {
        if (other === fam) continue;
        expect(q, `family ${other} must NOT appear`).not.toContain(SIGIL[other]);
      }
    });
  }

  it("the retired fuel bundle emits nothing — no fuel/charging_station/bbq/fire_pit tags in any query", () => {
    // Full default query and the all-families query must both be clean.
    for (const q of [buildOverpassQuery(bbox), buildOverpassQuery(bbox, { families: [...ALL_FAMILIES] })]) {
      expect(q).not.toContain('"amenity"="fuel"');
      expect(q).not.toContain('"amenity"~"^(fuel');
      expect(q).not.toContain("charging_station");
      expect(q).not.toContain("bbq");
      expect(q).not.toContain("fire_pit");
    }
  });

  it("the coarse 'natural' and 'fuel' family names are retired (parseFamilies rejects them)", () => {
    expect(() => parseFamilies("natural")).toThrow(/Unknown tag families: natural/);
    expect(() => parseFamilies("fuel")).toThrow(/Unknown tag families: fuel/);
  });

  it("bbox scope emits the (s,w,n,e) predicate and no area binding", () => {
    const q = buildOverpassQuery(bbox);
    // Overpass bbox order is (south,west,north,east).
    expect(q).toContain("(37,-114.05,42,-109.04)");
    expect(q).not.toContain('area["ISO3166-2"');
    expect(q).not.toContain("area.sa");
  });

  it("--iso (area scope) emits area binding + (area.sa) predicates, no bbox coordinates", () => {
    const q = buildOverpassQuery(areaScope("US-UT"));
    expect(q).toContain('area["ISO3166-2"="US-UT"]->.sa;');
    expect(q).toContain("(area.sa)");
    // The bbox coordinate tuple should not appear in area mode.
    expect(q).not.toContain("(37,-114.05,42,-109.04)");
    // Area timeout should be substantially longer than the bbox default (60s).
    expect(q).toMatch(/\[timeout:900\]/);
  });

  it("area + families composes cleanly — only camping predicates, all scoped to (area.sa)", () => {
    const q = buildOverpassQuery(areaScope("US-UT"), { families: ["camping"] });
    expect(q).toContain('area["ISO3166-2"="US-UT"]->.sa;');
    expect(q.match(/\(area\.sa\)/g)?.length).toBe(3); // 3 camping predicates
    for (const other of ALL_FAMILIES) {
      if (other === "camping") continue;
      expect(q).not.toContain(SIGIL[other]);
    }
  });
});

describe("parseFamilies", () => {
  it("accepts a single known family", () => {
    expect(parseFamilies("camping")).toEqual(["camping"]);
  });
  it("accepts multiple families, trims whitespace, drops empties", () => {
    expect(parseFamilies("camping, water_san , spring")).toEqual(["camping", "water_san", "spring"]);
    expect(parseFamilies("camping,,spring,")).toEqual(["camping", "spring"]);
  });
  it("throws on unknown family (fails loudly, not silently)", () => {
    expect(() => parseFamilies("camping,typo")).toThrow(/Unknown tag families: typo/);
    expect(() => parseFamilies("bogus")).toThrow(/Unknown tag families: bogus/);
  });
});

describe("normalizeOsm — dispersed advisory payload", () => {
  it("sets likely_allowed + verify_locally + mvum stub for dispersed_camping", () => {
    const n = normalizeOsm(
      { tourism: "camp_site", backcountry: "yes", name: "Coon Creek" },
      "Coon Creek",
      "dispersed_camping",
    );
    expect(n.dispersed_camping).toBe("likely_allowed");
    expect(n.verify_locally).toBe(true);
    expect(n.mvum_corridor).toBeNull();
    expect(n.canonical_name).toBe("Coon Creek");
  });
  it("does NOT set the advisory for a developed campground", () => {
    const n = normalizeOsm({ tourism: "camp_site", name: "Belle" }, "Belle", "campground");
    expect(n.dispersed_camping).toBeUndefined();
    expect(n.verify_locally).toBeUndefined();
    expect(n.mvum_corridor).toBeUndefined();
  });
});
