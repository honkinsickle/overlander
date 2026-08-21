/**
 * Unit tests for the Atlas Obscura oddities adapter. Pure — no DB, no
 * network. Covers the CSV parser, the field normalizers, and the
 * coordinate-correction assertion for "The Great Chamber". Fixtures use
 * real CSV excerpts (verified against `.context/ao-*-anchors.csv`).
 */

import { describe, expect, it } from "vitest";
import {
  COORDINATE_CORRECTIONS,
  PROPOSED_INFERRED_CATEGORY,
  filterCampaignTags,
  normalizeOddities,
  parseCoordinates,
  parseCsv,
  splitCategories,
  stripAddressNoneToken,
  stripUtm,
  toOverlanderTags,
} from "./atlas-oddities.ts";

const HEADER =
  "name,latitude,longitude,address,categories,ao_url,external_id,website";

describe("parseCsv", () => {
  it("parses a simple two-row block with quoted address containing commas", () => {
    const text = [
      HEADER,
      // Real row from ao-utah-anchors.csv, verbatim (address is quoted, categories delimited).
      'Nine Mile Canyon,39.776213,-110.496353,"9 Mile Canyon Rd, Carbon County, UT 84542",Ancient; Native Americans; Art; Old West; Desert Art; Deserts; Ghost Towns,https://www.atlasobscura.com/places/nine-mile-canyon,atlasobscura:nine-mile-canyon,http://www.blm.gov/ut/st/en/fo/price/recreation/9mile/inthecanyon.html',
      "",
    ].join("\n");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Nine Mile Canyon");
    expect(rows[0].address).toBe("9 Mile Canyon Rd, Carbon County, UT 84542");
    expect(rows[0].external_id).toBe("atlasobscura:nine-mile-canyon");
  });

  it("handles embedded escaped quotes in names", () => {
    const text = [
      HEADER,
      // Real UT row shape: `Hole N" the Rock` has an embedded quote; in CSV
      // that field is fully quoted and the interior `"` is escaped as `""`.
      '"Hole N"" the Rock",38.5,-109.6,"11037 US-191, Moab, UT 84532",Holes; Taxidermy,https://www.atlasobscura.com/places/hole-rock,atlasobscura:hole-rock,',
      "",
    ].join("\n");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Hole N" the Rock');
  });

  it("skips the malformed row and continues (defensive, not observed in the six files)", () => {
    const text = [
      HEADER,
      "onlyone",
      'The Wave,36.99,-112.02,"House Rock Road, Marble Canyon, AZ 86036",Martian Landscapes; Geology,https://www.atlasobscura.com/places/wave-rock,atlasobscura:wave-rock,',
    ].join("\n");
    const rows = parseCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe("atlasobscura:wave-rock");
  });

  it("throws on header mismatch (fail-loud — do not guess column order)", () => {
    const text = "name,lat,lng\nfoo,1,2";
    expect(() => parseCsv(text)).toThrow(/CSV header mismatch/);
  });
});

describe("splitCategories", () => {
  it("splits on `; ` and trims", () => {
    expect(splitCategories("Architecture; Museums; Art")).toEqual([
      "Architecture",
      "Museums",
      "Art",
    ]);
  });

  it("returns [] for empty / whitespace-only input (the 52 empty-categories rows)", () => {
    expect(splitCategories("")).toEqual([]);
    expect(splitCategories("   ")).toEqual([]);
  });

  it("preserves multi-word tokens verbatim", () => {
    expect(splitCategories("Roadside Attractions; Ghost Towns")).toEqual([
      "Roadside Attractions",
      "Ghost Towns",
    ]);
  });
});

describe("filterCampaignTags", () => {
  it("drops the six known campaign tokens", () => {
    const input = [
      "Geology",
      "Travelnevada",
      "Nature",
      "Day Of Rivals",
      "Aletrail",
      "Ao Loves Halloween",
      "Obscura Day 2016",
      "Obscura Day Locations",
    ];
    expect(filterCampaignTags(input)).toEqual(["Geology", "Nature"]);
  });
});

describe("stripUtm", () => {
  it("removes utm_* params, keeps everything else", () => {
    expect(
      stripUtm(
        "https://example.com/x?utm_source=AtlasObscura&utm_campaign=Spring2019&keep=1",
      ),
    ).toBe("https://example.com/x?keep=1");
  });

  it("is a no-op on a URL without UTM", () => {
    expect(stripUtm("https://example.com/x?keep=1")).toBe(
      "https://example.com/x?keep=1",
    );
  });

  it("is a no-op on a malformed URL (defensive)", () => {
    expect(stripUtm("not a url")).toBe("not a url");
  });
});

describe("stripAddressNoneToken", () => {
  it("removes the `, None,` scraper artifact", () => {
    expect(
      stripAddressNoneToken("881 Innes Avenue, None, San Francisco, CA 94124"),
    ).toBe("881 Innes Avenue, San Francisco, CA 94124");
  });

  it("is a no-op on a clean address", () => {
    expect(stripAddressNoneToken("770 Las Vegas Boulevard North, Las Vegas, NV 89101"))
      .toBe("770 Las Vegas Boulevard North, Las Vegas, NV 89101");
  });
});

describe("toOverlanderTags", () => {
  it("prepends `atlas_obscura` and drops campaign tokens", () => {
    expect(toOverlanderTags("Geology; Travelnevada; Nature")).toEqual([
      "atlas_obscura",
      "Geology",
      "Nature",
    ]);
  });

  it("for an empty categories row (52 observed) returns just the source marker", () => {
    expect(toOverlanderTags("")).toEqual(["atlas_obscura"]);
  });
});

describe("parseCoordinates — coordinate corrections", () => {
  it("applies the documented sign fix for The Great Chamber (UT)", () => {
    const row = {
      name: "The Great Chamber",
      latitude: "37.1875",
      longitude: "112.4566",
      address: "Cutler Point, Kanab, UT 84741 ",
      categories: "Stone; Geological Oddities",
      ao_url: "https://www.atlasobscura.com/places/the-great-chamber",
      external_id: "atlasobscura:the-great-chamber",
      website: "",
    };
    expect(parseCoordinates(row)).toEqual([-112.4566, 37.1875]);
    // Sanity: the correction is documented in the exported map.
    expect(COORDINATE_CORRECTIONS["atlasobscura:the-great-chamber"].corrected.lng).toBe(-112.4566);
  });

  it("throws if the CSV has been fixed upstream (assert-expected guard)", () => {
    const row = {
      name: "The Great Chamber",
      latitude: "37.1875",
      // AO fixed it upstream — we want to notice and update the map, not
      // silently double-correct.
      longitude: "-112.4566",
      address: "",
      categories: "",
      ao_url: "",
      external_id: "atlasobscura:the-great-chamber",
      website: "",
    };
    expect(() => parseCoordinates(row)).toThrow(/coord correction.*expected/);
  });

  it("passes through uncorrected rows unchanged; returns [lng, lat]", () => {
    const row = {
      name: "The Wave",
      latitude: "36.9959",
      longitude: "-112.0060",
      address: "",
      categories: "",
      ao_url: "",
      external_id: "atlasobscura:wave-rock",
      website: "",
    };
    expect(parseCoordinates(row)).toEqual([-112.006, 36.9959]);
  });

  it("returns null on NaN or the (0,0) placeholder", () => {
    const base = {
      name: "x", address: "", categories: "", ao_url: "",
      external_id: "atlasobscura:x", website: "",
    };
    expect(parseCoordinates({ ...base, latitude: "abc", longitude: "-1" })).toBeNull();
    expect(parseCoordinates({ ...base, latitude: "0", longitude: "0" })).toBeNull();
  });
});

describe("normalizeOddities", () => {
  const base = {
    name: "The Wave Organ",
    latitude: "37.8064",
    longitude: "-122.4419",
    address: "83 Marina Green Dr, San Francisco, CA 94123",
    categories: "Outsider Art; Music; Sea Organ; Sounds; Art",
    ao_url: "https://www.atlasobscura.com/places/wave-organ",
    external_id: "atlasobscura:wave-organ",
    website: "https://example.com/organ?utm_source=AtlasObscura&keep=1",
  };

  it("writes canonical_name from the CSV name, description null (no source column)", () => {
    const out = normalizeOddities(base);
    expect(out.canonical_name).toBe("The Wave Organ");
    expect(out.description).toBeNull();
  });

  it("builds overlander_tags with source marker + filtered tokens", () => {
    const out = normalizeOddities(base);
    expect(out.overlander_tags).toEqual([
      "atlas_obscura", "Outsider Art", "Music", "Sea Organ", "Sounds", "Art",
    ]);
  });

  it("strips UTM from website; keeps the rest", () => {
    const out = normalizeOddities(base);
    expect(out.contact).toEqual({ website: "https://example.com/organ?keep=1" });
  });

  it("null contact when website is empty (~41% of AO rows)", () => {
    const out = normalizeOddities({ ...base, website: "" });
    expect(out.contact).toBeNull();
  });

  it("empty categories row normalizes without error (52 case)", () => {
    const out = normalizeOddities({ ...base, categories: "" });
    // Row still ingests; overlander_tags carries just the source marker,
    // and inferred_category (assigned at persist time) is the proposal
    // value regardless.
    expect(out.overlander_tags).toEqual(["atlas_obscura"]);
    expect(PROPOSED_INFERRED_CATEGORY).toBe("oddity");
  });

  it("preserves ao_url + categories_raw for downstream inspection", () => {
    const out = normalizeOddities(base);
    expect(out.ao_url).toBe(base.ao_url);
    expect(out.categories_raw).toBe(base.categories);
  });

  it("strips the `, None,` address token", () => {
    const out = normalizeOddities({
      ...base,
      address: "881 Innes Avenue, None, San Francisco, CA 94124",
    });
    expect(out.address).toBe("881 Innes Avenue, San Francisco, CA 94124");
  });
});
