import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPhotoOverride, setPhotoOverride, type PhotoOverride } from "./photo-override.ts";
import { evaluate, type CandidateRow } from "./eligibility.ts";

// A stub client that fails the test if any DB call is attempted — proves the
// input guards reject BEFORE touching the database.
const noDb = {
  from() {
    throw new Error("db should not be called when input is invalid");
  },
} as unknown as SupabaseClient;

describe("setPhotoOverride input guards", () => {
  it("rejects when neither image source is provided", async () => {
    await expect(
      setPhotoOverride(noDb, { masterPlaceId: "p", source: "s", license: "l" }),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects when both image sources are provided", async () => {
    await expect(
      setPhotoOverride(noDb, { masterPlaceId: "p", imageUrl: "u", imageData: "d", source: "s", license: "l" }),
    ).rejects.toThrow(/exactly one/);
  });

  it("rejects when source or license is missing (provenance discipline)", async () => {
    await expect(
      setPhotoOverride(noDb, { masterPlaceId: "p", imageUrl: "u", source: "", license: "l" }),
    ).rejects.toThrow(/source and license/);
    await expect(
      setPhotoOverride(noDb, { masterPlaceId: "p", imageUrl: "u", source: "s", license: "" }),
    ).rejects.toThrow(/source and license/);
  });
});

// A place eligible on EVERY axis except the corpus photo — the exact case an
// override is meant to rescue (mirrors Cape Blanco State Park on TEST).
const noPhotoRow: CandidateRow = {
  id: "9415fd49-c96d-458e-b599-f8cb1df3aded",
  canonical_name: "Cape Blanco State Park",
  primary_category: "recreation_area",
  secondary_categories: null,
  state: "OR",
  description: "A real, source-derived description of the park.",
  photo_url: null,
  rating: null,
  review_count: null,
  prominence_score: 10,
  source_count: 2,
  attribution: { description: "oregon_state_parks", name: "nps" },
  operational_status: null,
  is_searchable: true,
};

/** A chainable Supabase stub whose override lookup resolves to `row` (or none). */
function dbWithOverride(row: PhotoOverride | null): SupabaseClient {
  const result = Promise.resolve({ data: row ? [row] : [], error: null });
  const chain = { select: () => chain, eq: () => chain, limit: () => result };
  return { from: () => chain } as unknown as SupabaseClient;
}

describe("applyPhotoOverride re-evaluates eligibility", () => {
  it("baseline: the fixture is ineligible ONLY for the missing photo", () => {
    const base = evaluate(noPhotoRow);
    expect(base.eligible).toBe(false);
    expect(base.rejections).toEqual(["no resolved photo"]);
  });

  it("makes an override-rescued place eligible (url override)", async () => {
    const override: PhotoOverride = {
      master_place_id: noPhotoRow.id,
      image_url: "https://example.com/cape.jpg",
      image_data: null,
      mime_type: null,
      source: "Adam's own photo",
      license: "owned",
      attribution: null,
      updated_at: "2026-09-11T00:00:00Z",
    };
    const { candidate, override: got } = await applyPhotoOverride(dbWithOverride(override), evaluate(noPhotoRow));
    expect(candidate.eligible).toBe(true);
    expect(candidate.photo_url).toBe("https://example.com/cape.jpg");
    expect(got).toBe(override);
  });

  it("makes an override-rescued place eligible (inline file override → marker url)", async () => {
    const override: PhotoOverride = {
      master_place_id: noPhotoRow.id,
      image_url: null,
      image_data: "AAAA",
      mime_type: "image/png",
      source: "Adam's own photo",
      license: "owned",
      attribution: null,
      updated_at: "2026-09-11T00:00:00Z",
    };
    const { candidate } = await applyPhotoOverride(dbWithOverride(override), evaluate(noPhotoRow));
    expect(candidate.eligible).toBe(true);
    expect(candidate.photo_url).toBe("manual-override://image/png");
  });

  it("leaves the candidate unchanged when no override exists", async () => {
    const base = evaluate(noPhotoRow);
    const { candidate, override } = await applyPhotoOverride(dbWithOverride(null), base);
    expect(override).toBeNull();
    expect(candidate).toBe(base);
    expect(candidate.eligible).toBe(false);
  });
});
