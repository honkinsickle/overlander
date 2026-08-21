/**
 * RIDB imagery (Route A): mirrors nps.test.ts. Pure — no DB, no network.
 *
 * The RIDB list endpoints (/facilities, /recareas) do NOT return media inline;
 * media lives at /facilities/{id}/media and /recareas/{id}/media as RECDATA[].
 * The ingester calls fetchEntityMedia and passes the RECDATA into
 * ridbPhotoFromMedia; the normalized_payload.photo shape matches NpsPhoto so
 * pois_along_corridor's photo lateral can source either interchangeably.
 */

import { describe, expect, it } from "vitest";
import {
  normalizeFacility,
  normalizeRecArea,
  ridbPhotoFromMedia,
} from "./ridb.ts";

const IMG = {
  URL: "https://cdn.recreation.gov/public/2020/06/28/22/47/aspen.jpg",
  MediaType: "Image",
  Title: "Aspen Campground overlook",
  Credits: "USDA Forest Service",
  IsPrimary: true,
  EntityMediaID: 12345,
};

describe("ridbPhotoFromMedia", () => {
  it("promotes an Image entry with URL + Title + Credits", () => {
    expect(ridbPhotoFromMedia([IMG])).toEqual({
      url: IMG.URL,
      altText: IMG.Title,
      credit: IMG.Credits,
    });
  });

  it("carries Title/Credits as null when absent, keeping the URL", () => {
    expect(ridbPhotoFromMedia([{ URL: IMG.URL, MediaType: "Image" }])).toEqual({
      url: IMG.URL,
      altText: null,
      credit: null,
    });
  });

  it("returns null for no media / empty / URL-less entries", () => {
    expect(ridbPhotoFromMedia(undefined)).toBeNull();
    expect(ridbPhotoFromMedia(null)).toBeNull();
    expect(ridbPhotoFromMedia([])).toBeNull();
    expect(ridbPhotoFromMedia([{ MediaType: "Image", Title: "no url" }])).toBeNull();
    expect(ridbPhotoFromMedia([{ URL: "", MediaType: "Image" }])).toBeNull();
  });

  it("skips non-Image MediaTypes (Map / Video / PDF)", () => {
    expect(
      ridbPhotoFromMedia([
        { URL: "https://x/m.pdf", MediaType: "PDF" },
        { URL: "https://x/v.mp4", MediaType: "Video" },
        { URL: "https://x/map.png", MediaType: "Map" },
      ]),
    ).toBeNull();
  });

  it("matches MediaType case-insensitively (image / IMAGE / Image)", () => {
    expect(ridbPhotoFromMedia([{ URL: "https://a", MediaType: "image" }])?.url).toBe(
      "https://a",
    );
    expect(ridbPhotoFromMedia([{ URL: "https://b", MediaType: "IMAGE" }])?.url).toBe(
      "https://b",
    );
  });

  it("prefers IsPrimary === true even when non-primary Images come first", () => {
    const primary = { ...IMG, URL: "https://primary.jpg", IsPrimary: true };
    const other = { ...IMG, URL: "https://other.jpg", IsPrimary: false };
    expect(ridbPhotoFromMedia([other, primary])?.url).toBe("https://primary.jpg");
  });

  it("accepts IsPrimary as the string 'true' (RIDB has emitted both shapes)", () => {
    const primary = { ...IMG, URL: "https://a", IsPrimary: "true" as unknown as boolean };
    const other = { ...IMG, URL: "https://b", IsPrimary: false };
    expect(ridbPhotoFromMedia([other, primary])?.url).toBe("https://a");
  });

  it("falls back to the first Image when nothing is IsPrimary", () => {
    const a = { URL: "https://a.jpg", MediaType: "Image" };
    const b = { URL: "https://b.jpg", MediaType: "Image" };
    expect(ridbPhotoFromMedia([a, b])?.url).toBe("https://a.jpg");
  });
});

describe("normalizeFacility", () => {
  const facility = {
    FacilityID: "234",
    FacilityName: "Aspen Campground",
    FacilityDescription: "A description",
    FacilityLatitude: 40.1,
    FacilityLongitude: -105.5,
    ParentOrgID: 131,
  } as Parameters<typeof normalizeFacility>[0];

  it("writes photo when supplied", () => {
    const out = normalizeFacility(facility, "Aspen Campground", {
      url: IMG.URL,
      altText: IMG.Title,
      credit: IMG.Credits,
    });
    expect(out.photo).toEqual({ url: IMG.URL, altText: IMG.Title, credit: IMG.Credits });
  });

  it("photo defaults to null (backwards-compatible signature)", () => {
    const out = normalizeFacility(facility, "Aspen Campground");
    expect(out.photo).toBeNull();
  });

  it("photo is null when explicitly passed null", () => {
    const out = normalizeFacility(facility, "Aspen Campground", null);
    expect(out.photo).toBeNull();
  });

  it("directions is null when FacilityDirections absent", () => {
    const out = normalizeFacility(facility, "Aspen Campground");
    expect(out.directions).toBeNull();
  });

  it("directions strips HTML wrapping from FacilityDirections (real RIDB shape)", () => {
    const withDirections = {
      ...facility,
      FacilityDirections:
        "<p>Riley Springs Trailhead is located approximately 15 miles northeast of Loa, Utah.</p>",
    } as Parameters<typeof normalizeFacility>[0];
    const out = normalizeFacility(withDirections, "Aspen Campground");
    expect(out.directions).toBe(
      "Riley Springs Trailhead is located approximately 15 miles northeast of Loa, Utah.",
    );
  });

  it("directions is null for an empty-string FacilityDirections", () => {
    const withDirections = { ...facility, FacilityDirections: "" } as Parameters<typeof normalizeFacility>[0];
    expect(normalizeFacility(withDirections, "Aspen Campground").directions).toBeNull();
  });
});

describe("normalizeRecArea", () => {
  const rec = {
    RecAreaID: 987,
    RecAreaName: "Mount Rose Recreation Area",
    RecAreaDescription: null,
    RecAreaLatitude: 39.3,
    RecAreaLongitude: -119.9,
    ParentOrgID: 131,
  } as Parameters<typeof normalizeRecArea>[0];

  it("writes photo when supplied", () => {
    const out = normalizeRecArea(rec, "Mount Rose Recreation Area", {
      url: IMG.URL,
      altText: null,
      credit: null,
    });
    expect(out.photo).toEqual({ url: IMG.URL, altText: null, credit: null });
  });

  it("photo defaults to null when not supplied", () => {
    const out = normalizeRecArea(rec, "Mount Rose Recreation Area");
    expect(out.photo).toBeNull();
  });
});
