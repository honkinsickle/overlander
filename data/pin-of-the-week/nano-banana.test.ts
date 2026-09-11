import { describe, it, expect } from "vitest";
import { sniffImageMime } from "./nano-banana.ts";

describe("sniffImageMime", () => {
  it("detects PNG by magic bytes", () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
    expect(sniffImageMime(png)).toBe("image/png");
  });

  it("detects JPEG by magic bytes", () => {
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
  });

  it("detects WEBP (RIFF....WEBP) — the recreation.gov case served as octet-stream", () => {
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0, 0, 0, 0]), // file size
      Buffer.from("WEBP", "ascii"),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  it("detects GIF", () => {
    expect(sniffImageMime(Buffer.from("GIF89a", "ascii"))).toBe("image/gif");
  });

  it("returns null for unknown / non-image bytes (caller falls back)", () => {
    expect(sniffImageMime(Buffer.from("not an image at all", "ascii"))).toBeNull();
    expect(sniffImageMime(Buffer.from([]))).toBeNull();
  });
});
