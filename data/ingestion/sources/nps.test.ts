/**
 * NPS imagery (Route A): the ingester must promote a photo object from the
 * `images` array the API already returns, onto normalized_payload.photo, with
 * altText + credit carried through. Pure — no DB, no network.
 */

import { describe, expect, it } from "vitest";
import { npsPhotoFromImages, normalizePlace } from "./nps.ts";

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
