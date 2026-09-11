import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validatePostInput,
  recordPost,
  archiveDirName,
  postFieldsFromArtifacts,
  buildManifest,
  type PostInput,
} from "./post-history.ts";

// A stub client that fails the test if any DB call is attempted — proves the
// input guards reject BEFORE touching the database (same pattern as
// photo-override.test.ts).
const noDb = {
  from() {
    throw new Error("db should not be called when input is invalid");
  },
} as unknown as SupabaseClient;

const valid: PostInput = {
  masterPlaceId: "9002d676-c0f2-4426-854c-84036310e63a",
  canonicalName: "Point Bonita",
  captionText: "Point Bonita — a coastal gem.",
  templateNumber: 3,
  photoSource: "corpus",
  photoRef: "https://example.com/photo.jpg",
  archiveDir: "pin-of-the-week/posts/2026-09-11-point-bonita",
};

describe("validatePostInput guards", () => {
  it("accepts a fully valid input", () => {
    expect(() => validatePostInput(valid)).not.toThrow();
  });

  it("rejects empty canonicalName", () => {
    expect(() => validatePostInput({ ...valid, canonicalName: "" })).toThrow(/canonicalName/);
  });

  it("rejects empty captionText", () => {
    expect(() => validatePostInput({ ...valid, captionText: "" })).toThrow(/captionText/);
  });

  it("rejects a templateNumber outside 1-8", () => {
    expect(() => validatePostInput({ ...valid, templateNumber: 0 })).toThrow(/templateNumber/);
    expect(() => validatePostInput({ ...valid, templateNumber: 9 })).toThrow(/templateNumber/);
    expect(() => validatePostInput({ ...valid, templateNumber: 2.5 })).toThrow(/templateNumber/);
  });

  it("rejects an unknown photoSource", () => {
    expect(() => validatePostInput({ ...valid, photoSource: "bogus" as PostInput["photoSource"] })).toThrow(
      /photoSource/,
    );
  });

  it("rejects an empty archiveDir", () => {
    expect(() => validatePostInput({ ...valid, archiveDir: "" })).toThrow(/archiveDir/);
  });
});

describe("recordPost guards before any DB call", () => {
  it("throws on invalid input without touching the db", async () => {
    await expect(recordPost(noDb, { ...valid, templateNumber: 99 })).rejects.toThrow(/templateNumber/);
  });
});

describe("archiveDirName", () => {
  it("composes <date>-<slug>", () => {
    expect(archiveDirName("2026-09-11", "point-bonita")).toBe("2026-09-11-point-bonita");
  });
});

describe("postFieldsFromArtifacts", () => {
  const place = {
    id: "9002d676-c0f2-4426-854c-84036310e63a",
    canonical_name: "Point Bonita",
    photo_source: "corpus" as const,
    photo_url: "https://example.com/photo.jpg",
  };
  const caption = { templateNumber: 3, text: "Point Bonita — a coastal gem." };

  it("maps generator artifacts to post fields", () => {
    const fields = postFieldsFromArtifacts(place, caption);
    expect(fields).toEqual({
      masterPlaceId: "9002d676-c0f2-4426-854c-84036310e63a",
      canonicalName: "Point Bonita",
      captionText: "Point Bonita — a coastal gem.",
      templateNumber: 3,
      photoSource: "corpus",
      photoRef: "https://example.com/photo.jpg",
    });
  });

  it("carries the marker URL through as photo_ref for a file override", () => {
    const fields = postFieldsFromArtifacts(
      { ...place, photo_source: "override:file", photo_url: "manual-override://image/jpeg" },
      caption,
    );
    expect(fields.photoSource).toBe("override:file");
    expect(fields.photoRef).toBe("manual-override://image/jpeg");
  });

  it("tolerates a null photo_url", () => {
    const fields = postFieldsFromArtifacts({ ...place, photo_url: null }, caption);
    expect(fields.photoRef).toBeNull();
  });
});

describe("buildManifest", () => {
  it("produces a self-contained manifest including created_at and status", () => {
    const manifest = buildManifest(valid, "2026-09-11T00:00:00.000Z", 42);
    expect(manifest).toEqual({
      id: 42,
      master_place_id: valid.masterPlaceId,
      canonical_name: valid.canonicalName,
      caption_text: valid.captionText,
      template_number: valid.templateNumber,
      photo_source: valid.photoSource,
      photo_ref: valid.photoRef,
      archive_dir: valid.archiveDir,
      status: "created",
      created_at: "2026-09-11T00:00:00.000Z",
    });
  });
});
