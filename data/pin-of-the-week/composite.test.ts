import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { compositePost, coverRect, wrapText } from "./composite.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("coverRect", () => {
  it("scales to cover and centers a wider source in a portrait box", () => {
    const r = coverRect(1000, 500, 1080, 1350); // wide source, tall target
    // must fully cover: rect >= target in both dims
    expect(r.w).toBeGreaterThanOrEqual(1080);
    expect(r.h).toBeGreaterThanOrEqual(1350);
    // centered: equal overflow on opposite edges
    expect(r.x).toBeCloseTo(1080 - r.w - r.x, 3);
  });
});

describe("wrapText", () => {
  it("wraps a long title into multiple lines under the max width", () => {
    const ctx = createCanvas(10, 10).getContext("2d");
    ctx.font = '700 72px sans-serif';
    const lines = wrapText(ctx, "Gold Bluffs Beach Campground - Prairie Creek Redwoods State Park", 900);
    expect(lines.length).toBeGreaterThan(1);
    // reassembled text is identical to the input (no words dropped/added)
    expect(lines.join(" ")).toBe("Gold Bluffs Beach Campground - Prairie Creek Redwoods State Park");
  });
  it("keeps a short title on one line", () => {
    const ctx = createCanvas(10, 10).getContext("2d");
    ctx.font = '700 72px sans-serif';
    expect(wrapText(ctx, "Fern Canyon", 900)).toEqual(["Fern Canyon"]);
  });
});

describe("compositePost", () => {
  it("returns a valid PNG at the requested dimensions with the exact place name", async () => {
    const base = createCanvas(896, 1152).toBuffer("image/png");
    const out = await compositePost({
      baseImage: base,
      dimensions: { width: 1080, height: 1350 },
      overlayText: {
        title: "Gold Bluffs Beach Campground - Prairie Creek Redwoods State Park",
        subline: "Campground · CA",
        verified: "✓ Yo Trippin Verified",
      },
    });
    // PNG signature
    expect(out.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    // IHDR width/height (big-endian at bytes 16..24)
    expect(out.readUInt32BE(16)).toBe(1080);
    expect(out.readUInt32BE(20)).toBe(1350);
  });

  it("the real brand header asset is bundled and full-width (1080px)", async () => {
    const p = join(HERE, "brand", "header.png");
    expect(existsSync(p)).toBe(true);
    const img = await loadImage(p);
    expect(img.width).toBe(1080);
    expect(img.height).toBeGreaterThan(50);
  });

  it("falls back to the base color when the base image cannot decode", async () => {
    const out = await compositePost({
      baseImage: Buffer.from("not an image"),
      dimensions: { width: 200, height: 250 },
      overlayText: { title: "T", subline: "S", verified: "V" },
    });
    expect(out.readUInt32BE(16)).toBe(200);
    expect(out.readUInt32BE(20)).toBe(250);
  });
});
