import { describe, it, expect } from "vitest";
import { composeCaption, excerptDescription, payoffLine } from "./caption.ts";
import { evaluate, type CandidateRow } from "./eligibility.ts";

function candidate(overrides: Partial<CandidateRow> = {}) {
  return evaluate({
    id: "00000000-0000-0000-0000-000000000001",
    canonical_name: "Gold Bluffs Beach Campground",
    primary_category: "campground",
    secondary_categories: null,
    state: "CA",
    description:
      "Experience the wild Pacific coastline and grazing Roosevelt elk. Located within Prairie Creek Redwoods State Park. Access is via a narrow dirt road.",
    photo_url: "https://example.com/p.jpg",
    rating: null,
    review_count: null,
    prominence_score: 11,
    source_count: 4,
    attribution: { description: "nps", access: "ridb" },
    operational_status: null,
    is_searchable: true,
    ...overrides,
  });
}

describe("excerptDescription", () => {
  it("keeps whole sentences within the length budget", () => {
    const out = excerptDescription("One sentence here. Two sentence here. Three is too long.", 25);
    expect(out).toBe("One sentence here.");
  });
  it("hard-truncates a single over-long sentence with an ellipsis", () => {
    const out = excerptDescription("a".repeat(50), 20);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
  });
});

describe("payoffLine", () => {
  it("uses official sources when present", () => {
    const { line, basis } = payoffLine(candidate());
    expect(line).toContain("National Park Service");
    expect(line).toContain("Recreation.gov");
    expect(basis).toContain("nps");
  });
  it("falls back to prominence when no official source", () => {
    const { line, basis } = payoffLine(candidate({ attribution: { description: "osm" }, prominence_score: 6 }));
    expect(line).toContain("prominence");
    expect(basis).toContain("6");
  });
  it("never fabricates a numeric star rating", () => {
    expect(payoffLine(candidate()).line).not.toMatch(/\b[0-5](\.\d)?\s*(stars?|★|\/\s*5)/i);
  });
});

describe("composeCaption", () => {
  it("orders hook → body → payoff → cta → hashtags", () => {
    const cap = candidate();
    const c = composeCaption(cap);
    const idx = (s: string) => c.text.indexOf(s);
    expect(idx(c.hook)).toBeGreaterThanOrEqual(0);
    expect(idx(c.hook)).toBeLessThan(idx(c.body));
    expect(idx(c.body)).toBeLessThan(idx(c.payoff));
    expect(idx(c.payoff)).toBeLessThan(idx(c.cta));
    expect(idx(c.cta)).toBeLessThan(idx(c.hashtags.join(" ")));
  });
  it("body is drawn verbatim from the real description (no invented facts)", () => {
    const cap = candidate();
    expect(cap.description).toContain(composeCaption(cap).body.replace(/…$/, "").trim().split(".")[0]);
  });
  it("includes category and state hashtags", () => {
    const c = composeCaption(candidate());
    expect(c.hashtags).toContain("#camping");
    expect(c.hashtags).toContain("#california");
  });
});
