import { describe, it, expect } from "vitest";
import { evaluate, descriptionSource, officialSourcesOf, type CandidateRow } from "./eligibility.ts";

function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    canonical_name: "Test Place",
    primary_category: "campground",
    secondary_categories: null,
    state: "CA",
    description: "A real, source-derived description of a great place to camp.",
    photo_url: "https://example.com/photo.jpg",
    rating: null,
    review_count: null,
    prominence_score: 5,
    source_count: 3,
    attribution: { description: "nps", geometry: "ridb" },
    operational_status: null,
    is_searchable: true,
    ...overrides,
  };
}

describe("descriptionSource", () => {
  it("classifies generated attributions as template / llm", () => {
    expect(descriptionSource(row({ attribution: { description: "generated_template" } }))).toBe("template");
    expect(descriptionSource(row({ attribution: { description: "generated_llm" } }))).toBe("llm");
  });
  it("classifies real source text as 'source'", () => {
    expect(descriptionSource(row({ attribution: { description: "nps" } }))).toBe("source");
  });
  it("returns null when there is no description", () => {
    expect(descriptionSource(row({ description: null, attribution: {} }))).toBeNull();
  });
});

describe("officialSourcesOf", () => {
  it("finds nps/ridb anywhere in attribution values", () => {
    expect(officialSourcesOf(row({ attribution: { description: "wikipedia", access: "ridb" } }))).toEqual(["ridb"]);
    expect(officialSourcesOf(row({ attribution: { description: "osm" } }))).toEqual([]);
  });
});

describe("evaluate", () => {
  it("accepts a fully-qualified candidate", () => {
    const e = evaluate(row());
    expect(e.eligible).toBe(true);
    expect(e.rejections).toEqual([]);
    expect(e.signals.hasOfficialSource).toBe(true);
  });

  it("rejects a missing photo", () => {
    expect(evaluate(row({ photo_url: null })).rejections).toContain("no resolved photo");
    expect(evaluate(row({ photo_url: "  " })).rejections).toContain("no resolved photo");
  });

  it("rejects a template/llm description as non-source", () => {
    const t = evaluate(row({ attribution: { description: "generated_template" } }));
    expect(t.eligible).toBe(false);
    expect(t.rejections.some((r) => r.startsWith("description not source-derived"))).toBe(true);
  });

  it("accepts prominence as the verification signal when no official source", () => {
    const e = evaluate(row({ attribution: { description: "osm" }, prominence_score: 4 }));
    expect(e.signals.hasOfficialSource).toBe(false);
    expect(e.eligible).toBe(true);
  });

  it("rejects when there is neither an official source nor prominence", () => {
    const e = evaluate(row({ attribution: { description: "osm" }, prominence_score: 0 }));
    expect(e.rejections).toContain("no verification signal (no official source and prominence_score = 0)");
  });

  it("rejects closed / land_status places", () => {
    expect(evaluate(row({ operational_status: "CLOSED" })).eligible).toBe(false);
    expect(evaluate(row({ is_searchable: false })).rejections).toContain("not searchable (land_status)");
  });

  it("never counts a numeric rating (corpus has none)", () => {
    expect(evaluate(row()).signals.hasNumericRating).toBe(false);
  });
});
