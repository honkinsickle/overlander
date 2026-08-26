/**
 * Wikipedia Geosearch photo matching — pure scoring tests. No network.
 */

import { describe, expect, it } from "vitest";
import {
  extractTokens,
  tokenOverlap,
  substringMatch,
  classifyConfidence,
  toNormalizedPhoto,
  type WikiMatch,
} from "./wikipedia.ts";

describe("extractTokens", () => {
  it("lowercases and strips punctuation", () => {
    expect(extractTokens("Chantry Flat Picnic Site")).toEqual([
      "chantry", "flat", "picnic",
    ]);
  });

  it("drops stop words", () => {
    expect(extractTokens("The Crosses of Lafayette")).toEqual([
      "crosses", "lafayette",
    ]);
  });

  it("drops short tokens", () => {
    expect(extractTokens("A B CD EFG")).toEqual(["cd", "efg"]);
  });
});

describe("tokenOverlap", () => {
  it("returns 1.0 for identical after normalization", () => {
    expect(tokenOverlap("Red Box", "Red Box")).toBe(1.0);
  });

  it("scores partial overlap", () => {
    expect(tokenOverlap("Chantry Flat Picnic Site", "Chantry Flat")).toBeCloseTo(0.67, 1);
  });

  it("returns 0 for no overlap", () => {
    expect(tokenOverlap("Sawmill Campground", "Mount Disappointment")).toBe(0);
  });

  it("ignores stop words in both inputs", () => {
    expect(tokenOverlap("The Crucible", "The Crucible (art school)")).toBeCloseTo(0.33, 1);
  });

  it("returns 0 when either input is only stop words", () => {
    expect(tokenOverlap("The", "A Park")).toBe(0);
  });
});

describe("substringMatch", () => {
  it("detects POI name inside wiki title", () => {
    expect(substringMatch("The Crucible", "The Crucible (art school)")).toBe(true);
  });

  it("detects wiki title inside POI name", () => {
    expect(substringMatch("Chantry Flat Picnic Site", "Chantry Flat")).toBe(true);
  });

  it("rejects unrelated names", () => {
    expect(substringMatch("Music Box Steps", "Micheltorena Steps")).toBe(false);
  });
});

describe("classifyConfidence", () => {
  it("high: strong name + close", () => {
    expect(classifyConfidence(0.67, 91, false)).toBe("high");
  });

  it("high: substring match + close", () => {
    expect(classifyConfidence(0.33, 23, true)).toBe("high");
  });

  it("medium: decent name + moderate distance", () => {
    expect(classifyConfidence(0.67, 553, false)).toBe("medium");
  });

  it("none: score below 0.45 threshold (the Mar Vista false-positive case)", () => {
    expect(classifyConfidence(0.40, 253, false)).toBe("none");
  });

  it("none: no name overlap even when very close", () => {
    expect(classifyConfidence(0.0, 15, false)).toBe("none");
  });

  it("none: good score but too far", () => {
    expect(classifyConfidence(0.67, 1500, false)).toBe("none");
  });
});

describe("toNormalizedPhoto", () => {
  const ccMatch: WikiMatch = {
    confidence: "high",
    wikiTitle: "Red Box, California",
    distM: 60,
    nameScore: 0.67,
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/6/63/Red_Box.jpg",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
      artist: "John Doe",
    },
  };

  const pdMatch: WikiMatch = {
    confidence: "high",
    wikiTitle: "Chantry Flat",
    distM: 91,
    nameScore: 0.67,
    image: {
      url: "https://upload.wikimedia.org/wikipedia/commons/2/21/Sign.jpg",
      license: "Public domain",
      licenseUrl: null,
      artist: null,
    },
  };

  it("builds credit for CC-licensed images", () => {
    const photo = toNormalizedPhoto(ccMatch);
    expect(photo.credit).toBe("John Doe / CC BY-SA 4.0");
    expect(photo.license).toBe("CC BY-SA 4.0");
    expect(photo.licenseUrl).toBe("https://creativecommons.org/licenses/by-sa/4.0");
  });

  it("sets credit to null for public-domain images", () => {
    const photo = toNormalizedPhoto(pdMatch);
    expect(photo.credit).toBeNull();
    expect(photo.license).toBe("Public domain");
  });

  it("uses wikiTitle as altText", () => {
    expect(toNormalizedPhoto(ccMatch).altText).toBe("Red Box, California");
  });

  it("passes through the image URL", () => {
    expect(toNormalizedPhoto(ccMatch).url).toBe(ccMatch.image.url);
  });
});
