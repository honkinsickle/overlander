/**
 * NPS imagery (Route A): the ingester must promote a photo object from the
 * `images` array the API already returns, onto normalized_payload.photo, with
 * altText + credit carried through. Pure — no DB, no network.
 */

import { describe, expect, it } from "vitest";
import { npsPhotoFromImages, normalizePlace, coerceCampgroundAmenities } from "./nps.ts";

const IMG = {
  url: "https://www.nps.gov/common/uploads/cropped_image/D207.jpg",
  altText: "Three statues from native legend",
  credit: '"River Spirits" by brx0 is licensed under CC BY-SA 2.0',
};

describe("npsPhotoFromImages", () => {
  it("promotes the first usable image with url + altText + credit", () => {
    expect(npsPhotoFromImages([IMG])).toEqual({
      url: IMG.url,
      altText: IMG.altText,
      credit: IMG.credit,
    });
  });

  it("carries altText/credit as null when absent, keeping the url", () => {
    expect(npsPhotoFromImages([{ url: IMG.url }])).toEqual({
      url: IMG.url,
      altText: null,
      credit: null,
    });
  });

  it("returns null for no images / empty / urlless entries", () => {
    expect(npsPhotoFromImages(undefined)).toBeNull();
    expect(npsPhotoFromImages([])).toBeNull();
    expect(npsPhotoFromImages([{ altText: "x" }])).toBeNull();
    expect(npsPhotoFromImages([{ url: "" }])).toBeNull();
  });

  it("skips a leading urlless entry and uses the first with a url", () => {
    expect(npsPhotoFromImages([{ credit: "c" }, IMG])?.url).toBe(IMG.url);
  });
});

describe("normalizePlace", () => {
  it("puts the photo object on normalized_payload.photo", () => {
    const out = normalizePlace({ id: "1", title: "T", images: [IMG] });
    expect(out.photo).toEqual({
      url: IMG.url,
      altText: IMG.altText,
      credit: IMG.credit,
    });
  });

  it("photo is null when the place has no image (structurally photoless)", () => {
    const out = normalizePlace({ id: "1", title: "T" });
    expect(out.photo).toBeNull();
  });
});

// coerceCampgroundAmenities — NPS's raw 14-key campground amenities shape
// (verified against 221 real TEST records, see "NPS amenities gap — scoping
// report") → the canonical shape normalizeOsm() produces. All fixtures below
// use real observed values, not invented ones.

/** All 14 keys blank/negative — the baseline every test overrides from. */
const BLANK_AMENITIES = {
  laundry: "",
  campStore: "",
  cellPhoneReception: "",
  dumpStation: "",
  firewoodForSale: "",
  foodStorageLockers: "",
  iceAvailableForSale: "",
  internetConnectivity: "",
  potableWater: [] as string[],
  showers: [] as string[],
  staffOrVolunteerHostOnsite: "",
  toilets: [] as string[],
  trashRecyclingCollection: "",
  amphitheater: "",
};

describe("coerceCampgroundAmenities", () => {
  it("all 14 keys blank (the 19-of-221 'NPS gave no answer' case) → null", () => {
    expect(coerceCampgroundAmenities(BLANK_AMENITIES)).toBeNull();
  });

  describe("scalar keys (dumpStation is the one mapped to a canonical category)", () => {
    it('"No" → absent', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, dumpStation: "No" })).toBeNull();
    });
    it('"" (blank) → absent', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, dumpStation: "" })).toBeNull();
    });
    it('"Yes - seasonal" → present, seasonal qualifier', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, dumpStation: "Yes - seasonal" })).toEqual({
        dump_station: true,
        dump_station_qualifier: "seasonal",
      });
    });
    it('"Yes - year round" → present, NO qualifier (the unmarked/default case)', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, dumpStation: "Yes - year round" })).toEqual({
        dump_station: true,
      });
    });
  });

  describe("array-key negative packaging — non-emptiness is NOT a presence signal", () => {
    it('showers: ["None"] → absent, not a false-positive "present"', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, showers: ["None"] })).toBeNull();
    });
    it('toilets: ["No Toilets"] → absent', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, toilets: ["No Toilets"] })).toBeNull();
    });
    it('potableWater: ["No water"] → absent', () => {
      expect(coerceCampgroundAmenities({ ...BLANK_AMENITIES, potableWater: ["No water"] })).toBeNull();
    });
  });

  describe("array-key real values", () => {
    it('toilets: ["Vault Toilets - year round"] → present, no qualifier', () => {
      expect(
        coerceCampgroundAmenities({ ...BLANK_AMENITIES, toilets: ["Vault Toilets - year round"] }),
      ).toEqual({ toilet: true });
    });
    it('showers: ["Hot - Seasonal","Coin-Operated - Seasonal"] → present, seasonal qualifier', () => {
      expect(
        coerceCampgroundAmenities({
          ...BLANK_AMENITIES,
          showers: ["Hot - Seasonal", "Coin-Operated - Seasonal"],
        }),
      ).toEqual({ shower: true, shower_qualifier: "seasonal" });
    });
    it("mixed seasonal + year-round entries on the same key → year-round wins the tie", () => {
      // Real observed combination (14 of 221 records).
      expect(
        coerceCampgroundAmenities({
          ...BLANK_AMENITIES,
          toilets: ["Flush Toilets - seasonal", "Vault Toilets - year round"],
        }),
      ).toEqual({ toilet: true });
    });
  });

  it("contradictory co-occurrence: a real facility-type string wins over a co-occurring negative marker", () => {
    // The one observed record of this shape: toilets carries BOTH a real
    // entry and the negative marker.
    expect(
      coerceCampgroundAmenities({
        ...BLANK_AMENITIES,
        toilets: ["Vault Toilets - year round", "No Toilets"],
      }),
    ).toEqual({ toilet: true });
  });

  it('upstream split-sentence artifact: potableWater: ["Water"," but not potable"] → present, non_potable qualifier (not dropped)', () => {
    // NPS's own API splits "Water, but not potable" into two array entries
    // on 5 of 221 records — not something our code produced. Water IS
    // physically present, so present=true, flagged with a caveat.
    expect(
      coerceCampgroundAmenities({ ...BLANK_AMENITIES, potableWater: ["Water", " but not potable"] }),
    ).toEqual({ water: true, water_qualifier: "non_potable" });
  });

  it("keys with no OSM-derived equivalent are dropped, not fabricated into categories", () => {
    const out = coerceCampgroundAmenities({
      ...BLANK_AMENITIES,
      campStore: "Yes - year round",
      laundry: "Yes - seasonal",
      cellPhoneReception: "Yes - year round",
      internetConnectivity: "Yes - year round",
      iceAvailableForSale: "Yes - year round",
      staffOrVolunteerHostOnsite: "Yes - seasonal",
      amphitheater: "Yes - year round",
      foodStorageLockers: "Yes - year round",
      firewoodForSale: "Yes - seasonal",
      trashRecyclingCollection: "Yes - year round",
    });
    expect(out).toBeNull();
  });

  it("a real full record (verbatim shape from a TEST sample) produces all 4 mapped categories", () => {
    const out = coerceCampgroundAmenities({
      laundry: "No",
      showers: ["None"],
      toilets: ["Flush Toilets - seasonal", "Vault Toilets - year round"],
      campStore: "No",
      dumpStation: "Yes - seasonal",
      amphitheater: "Yes - year round",
      potableWater: ["Yes - seasonal"],
      firewoodForSale: "Yes - seasonal",
      cellPhoneReception: "Yes - year round",
      foodStorageLockers: "No",
      iceAvailableForSale: "No",
      internetConnectivity: "No",
      trashRecyclingCollection: "Yes - year round",
      staffOrVolunteerHostOnsite: "Yes - seasonal",
    });
    expect(out).toEqual({
      dump_station: true,
      dump_station_qualifier: "seasonal",
      // showers: ["None"] → absent, correctly omitted.
      toilet: true, // mixed seasonal+year-round → year-round wins, no qualifier
      water: true,
      water_qualifier: "seasonal",
    });
  });
});
