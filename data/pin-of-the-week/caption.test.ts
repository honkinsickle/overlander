import { describe, it, expect } from "vitest";
import {
  CAPTION_TEMPLATES,
  TEMPLATE_COUNT,
  buildCaption,
  interpolate,
  pickLruTemplate,
} from "./caption.ts";
import { evaluate, type CandidateRow } from "./eligibility.ts";

function candidate(overrides: Partial<CandidateRow> = {}) {
  return evaluate({
    id: "00000000-0000-0000-0000-000000000001",
    canonical_name: "Boulder Basin",
    primary_category: "campground",
    secondary_categories: null,
    state: "CA",
    description: "Real description.",
    photo_url: "https://example.com/p.jpg",
    rating: null,
    review_count: null,
    prominence_score: 7,
    source_count: 2,
    attribution: { description: "ridb" },
    operational_status: null,
    is_searchable: true,
    ...overrides,
  });
}

describe("templates", () => {
  it("there are exactly 8", () => {
    expect(TEMPLATE_COUNT).toBe(8);
    expect(CAPTION_TEMPLATES).toHaveLength(8);
  });
});

describe("interpolate", () => {
  it("replaces every {place}/{category}/{state} occurrence and nothing else", () => {
    const out = interpolate("{place} is a {category} in {state}. {place}!", {
      place: "X",
      category: "Campground",
      state: "CA",
    });
    expect(out).toBe("X is a Campground in CA. X!");
  });
});

describe("buildCaption", () => {
  it("uses the humanized category label", () => {
    const c = buildCaption(candidate({ primary_category: "park_feature" }), 4);
    expect(c.text).toContain("Park Feature"); // not "park_feature"
    expect(c.text).not.toContain("park_feature");
  });

  it("template 4 interpolates place/category/state exactly", () => {
    const c = buildCaption(candidate(), 4);
    expect(c.templateNumber).toBe(4);
    expect(c.text).toBe(
      "This week's verified stop: Boulder Basin. Campground, CA. We're building a list of every spot we've verified — sign up at the link in bio to get it as it grows.",
    );
  });

  it("rejects out-of-range template numbers", () => {
    expect(() => buildCaption(candidate(), 0)).toThrow(/1-8/);
    expect(() => buildCaption(candidate(), 9)).toThrow(/1-8/);
  });
});

describe("pickLruTemplate", () => {
  it("picks template 1 when there is no history", () => {
    expect(pickLruTemplate([])).toBe(1);
  });
  it("never repeats the most recent template", () => {
    for (let last = 1; last <= 8; last++) {
      expect(pickLruTemplate([last])).not.toBe(last);
    }
  });
  it("round-robins through all 8 then cycles (LRU)", () => {
    const history: number[] = []; // most-recent first
    const order: number[] = [];
    for (let i = 0; i < 8; i++) {
      const t = pickLruTemplate(history);
      order.push(t);
      history.unshift(t);
    }
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    // next pick is the least-recently-used again → 1
    expect(pickLruTemplate(history)).toBe(1);
  });
});
