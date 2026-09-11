import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { setPhotoOverride } from "./photo-override.ts";

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
