import { describe, it, expect } from "vitest";
import {
  buildTemplatedDescription,
  hasConsumableTag,
  isTemplatedCategory,
} from "./osm-description-templates.ts";

/**
 * Every tag set below is a REAL row observed on TEST via
 * `data/scripts/measure-template-categories.ts` — not invented fixtures.
 */

describe("threshold — a bare row produces NO description", () => {
  // One per category, as required: a genuinely bare row must yield null rather
  // than a fabricated sentence.
  it("toilet: bare amenity=toilets -> null", () => {
    expect(buildTemplatedDescription("toilet", { amenity: "toilets" })).toBeNull();
  });

  it("water: bare amenity=drinking_water -> null", () => {
    expect(buildTemplatedDescription("water", { amenity: "drinking_water" })).toBeNull();
  });

  it("water: bare man_made=water_tap -> null", () => {
    expect(buildTemplatedDescription("water", { man_made: "water_tap" })).toBeNull();
  });

  it("dump_station: bare amenity=sanitary_dump_station -> null", () => {
    // osm:node:12410159151 and 9 others on TEST.
    expect(buildTemplatedDescription("dump_station", { amenity: "sanitary_dump_station" })).toBeNull();
  });

  it("dump_station: sanitary_dump_station=yes only restates the category -> null", () => {
    // osm:node:3929606072 — the redundant self-tag is not consumable.
    expect(
      buildTemplatedDescription("dump_station", {
        amenity: "sanitary_dump_station",
        sanitary_dump_station: "yes",
      }),
    ).toBeNull();
  });

  it("provenance-only tags do not trip the threshold", () => {
    expect(
      buildTemplatedDescription("toilet", {
        amenity: "toilets",
        check_date: "2024-08-27",
        source: "bing",
        level: "0",
        "addr:city": "Phoenix",
      }),
    ).toBeNull();
  });

  it("hasConsumableTag agrees with the emit decision", () => {
    expect(hasConsumableTag("toilet", { amenity: "toilets" })).toBe(false);
    expect(hasConsumableTag("toilet", { amenity: "toilets", fee: "no" })).toBe(true);
  });

  it("an empty-string tag value is not consumable", () => {
    expect(buildTemplatedDescription("toilet", { amenity: "toilets", access: "  " })).toBeNull();
  });
});

describe("non-templated categories are untouched", () => {
  it("returns null for categories outside the three", () => {
    expect(isTemplatedCategory("campground")).toBe(false);
    expect(buildTemplatedDescription("campground", { tourism: "camp_site", fee: "no" })).toBeNull();
    expect(buildTemplatedDescription(null, { fee: "no" })).toBeNull();
    expect(buildTemplatedDescription("viewpoint", { tourism: "viewpoint", direction: "265" })).toBeNull();
  });
});

describe("toilet templates", () => {
  it("flush + wheelchair + free + public access", () => {
    // Real shape: {"fee":"no","access":"yes","amenity":"toilets",
    //              "wheelchair":"limited","toilets:disposal":"flush"}
    expect(
      buildTemplatedDescription("toilet", {
        amenity: "toilets",
        "toilets:disposal": "flush",
        wheelchair: "yes",
        fee: "no",
        access: "yes",
      }),
    ).toBe("Flush toilets, wheelchair accessible, free, public access.");
  });

  it("pit latrine with unisex + no handwashing", () => {
    // Real shape: osm pitlatrine row with unisex/changing_table/handwashing.
    expect(
      buildTemplatedDescription("toilet", {
        amenity: "toilets",
        access: "yes",
        unisex: "yes",
        changing_table: "no",
        "toilets:disposal": "pitlatrine",
        "toilets:handwashing": "no",
      }),
    ).toBe("Pit latrine, unisex, no handwashing, public access.");
  });

  it("men's and women's", () => {
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", male: "yes", female: "yes" }),
    ).toBe("Toilets, men's and women's.");
  });

  it("falls back to the plain noun when disposal is untagged", () => {
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", wheelchair: "yes" }),
    ).toBe("Toilets, wheelchair accessible.");
  });

  it("a SPECIALIZED lead stands alone — disposal is real content", () => {
    // 173 TEST toilet rows carry toilets:disposal, but most also carry other
    // consumable tags and would emit a multi-clause sentence regardless. The
    // rows this rule actually rescues are the 59 whose description renders as a
    // LONE lead — 55 of them led by toilets:disposal `[measured TEST
    // 2026-08-18]`. Without it those 59 return null and lose their only
    // meaningful fact.
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", "toilets:disposal": "flush" }),
    ).toBe("Flush toilets.");
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", "toilets:disposal": "pitlatrine" }),
    ).toBe("Pit latrine.");
  });

  it("portable-only row leads with the portable noun and stands alone", () => {
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", portable: "yes" }),
    ).toBe("Portable toilet.");
  });

  it("a GENERIC lead alone is suppressed", () => {
    // Nothing consumable rendered a second clause, and "Toilets." only restates
    // the category — so no description at all.
    expect(buildTemplatedDescription("toilet", { amenity: "toilets", fee: "destination" })).toBeNull();
  });

  it("negative wheelchair is stated honestly, not omitted", () => {
    expect(
      buildTemplatedDescription("toilet", { amenity: "toilets", wheelchair: "no" }),
    ).toBe("Toilets, not wheelchair accessible.");
  });
});

describe("water templates", () => {
  it("SAFETY: drinking_water=no outranks amenity=drinking_water", () => {
    const out = buildTemplatedDescription("water", {
      amenity: "drinking_water",
      drinking_water: "no",
      access: "yes",
    });
    expect(out).toBe("Non-potable water, public access.");
    expect(out).not.toContain("Drinking water");
  });

  it("SAFETY: a non-potable row stands alone even with no other tag", () => {
    expect(
      buildTemplatedDescription("water", { man_made: "water_well", drinking_water: "no" }),
    ).toBe("Non-potable water.");
  });

  it("SAFETY: a well with drinking_water=no is never called potable", () => {
    // Real shape: {"man_made":"water_well","description":...,"drinking_water":"no"}
    const out = buildTemplatedDescription("water", {
      man_made: "water_well",
      drinking_water: "no",
      operator: "Salt River Project",
    });
    expect(out).toBe("Non-potable water, operated by Salt River Project.");
  });

  it("an untagged well claims nothing about potability", () => {
    // Real shape: {"man_made":"water_well","operator":"City of San Bernardino"}
    const out = buildTemplatedDescription("water", {
      man_made: "water_well",
      operator: "City of San Bernardino",
    });
    expect(out).toBe("Water well, operated by City of San Bernardino.");
    expect(out).not.toContain("Drinking water");
    expect(out).not.toContain("Non-potable");
  });

  it("bubbler fountain with bottle filling, free", () => {
    expect(
      buildTemplatedDescription("water", {
        amenity: "drinking_water",
        fountain: "bubbler",
        bottle: "yes",
        fee: "no",
      }),
    ).toBe("Drinking water, drinking fountain, bottle filling, free.");
  });

  it("powered pump and a non-numeric charge passes through verbatim", () => {
    expect(
      buildTemplatedDescription("water", {
        amenity: "drinking_water",
        pump: "powered",
        charge: "0.25 usd",
      }),
    ).toBe("Drinking water, powered pump, fee (0.25 usd).");
  });
});

describe("dump_station templates", () => {
  it("full row: fee, access, water, operator, payment", () => {
    // osm:node:11517529561 minus its real description (which would win upstream)
    expect(
      buildTemplatedDescription("dump_station", {
        fee: "yes",
        access: "customers",
        charge: "20",
        amenity: "sanitary_dump_station",
        operator: "Mac Gavins Queen Valley RV Resort",
        water_point: "yes",
        "payment:cash": "yes",
      }),
    ).toBe(
      "RV dump station, potable water available, $20 fee, customers only, cash accepted, operated by Mac Gavins Queen Valley RV Resort.",
    );
  });

  it("round drain, free, customers only", () => {
    // osm:node:4714399365
    expect(
      buildTemplatedDescription("dump_station", {
        fee: "no",
        access: "customers",
        amenity: "sanitary_dump_station",
        "sanitary_dump_station:round_drain": "yes",
      }),
    ).toBe("RV dump station, round drain, free, customers only.");
  });

  it("no pump-out is stated honestly", () => {
    // osm:node:1698196788 (name "RV Pit Stop")
    expect(
      buildTemplatedDescription("dump_station", {
        fee: "yes",
        amenity: "sanitary_dump_station",
        "sanitary_dump_station:pump-out": "no",
        "sanitary_dump_station:round_drain": "yes",
      }),
    ).toBe("RV dump station, round drain, no pump-out, fee required.");
  });

  it("permit-only row", () => {
    // osm:node:11712515933 / 11712515934 / 11712515935
    expect(
      buildTemplatedDescription("dump_station", {
        access: "permit",
        amenity: "sanitary_dump_station",
      }),
    ).toBe("RV dump station, permit required.");
  });

  it("water_point=no is surfaced, not dropped", () => {
    // osm:node:11737805259 ("Portable Dry Dump")
    expect(
      buildTemplatedDescription("dump_station", {
        name: "Portable Dry Dump",
        amenity: "sanitary_dump_station",
        water_point: "no",
      }),
    ).toBe("RV dump station, no water.");
  });

  it("multiple payment methods combine", () => {
    expect(
      buildTemplatedDescription("dump_station", {
        amenity: "sanitary_dump_station",
        "payment:cash": "yes",
        "payment:debit_cards": "yes",
        "payment:credit_cards": "yes",
      }),
    ).toBe("RV dump station, cash/debit/credit accepted.");
  });
});
