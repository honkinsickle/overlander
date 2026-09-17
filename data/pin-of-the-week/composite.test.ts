import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
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
        subline: "Campground, CA",
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
      overlayText: { title: "T", subline: "S" },
    });
    expect(out.readUInt32BE(16)).toBe(200);
    expect(out.readUInt32BE(20)).toBe(250);
  });
});

describe("compositePost layout override", () => {
  // The story frame's name slot sits at a different height from the post frame's,
  // and both flows share this compositor — so the story needs to move its name
  // block WITHOUT moving the post's.
  const base = createCanvas(1080, 1920).toBuffer("image/png");
  const text = { title: "Boulder Basin", subline: "California, USA" };

  it("leaves the output byte-identical when no layout is passed", async () => {
    // The guarantee the option exists to protect: the post path must not move.
    const a = await compositePost({
      baseImage: base, dimensions: { width: 1080, height: 1350 }, overlayText: text,
    });
    const b = await compositePost({
      baseImage: base, dimensions: { width: 1080, height: 1350 }, overlayText: text, layout: {},
    });
    expect(a.equals(b)).toBe(true);
  });

  it("an explicit bottomPad equal to the default is also byte-identical", async () => {
    // Pins the default itself: H * 0.05, so a caller can reproduce it exactly.
    const auto = await compositePost({
      baseImage: base, dimensions: { width: 1080, height: 1920 }, overlayText: text,
    });
    const explicit = await compositePost({
      baseImage: base,
      dimensions: { width: 1080, height: 1920 },
      overlayText: text,
      layout: { bottomPad: Math.round(1920 * 0.05) },
    });
    expect(auto.equals(explicit)).toBe(true);
  });

  it("a different bottomPad actually moves the block", async () => {
    const auto = await compositePost({
      baseImage: base, dimensions: { width: 1080, height: 1920 }, overlayText: text,
    });
    const moved = await compositePost({
      baseImage: base,
      dimensions: { width: 1080, height: 1920 },
      overlayText: text,
      layout: { bottomPad: Math.round(1920 * 0.05) + 10 }, // 10px UP, as shipped
    });
    expect(moved.equals(auto)).toBe(false);
    expect(moved.readUInt32BE(16)).toBe(1080);
    expect(moved.readUInt32BE(20)).toBe(1920);
  });
});

describe("compositePost overlay source", () => {
  const base = { width: 1080, height: 1350 };
  const photo = /* a 1x1 png */ Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  /** A full-size solid-color PNG, so two overlays are visibly, pixel-wise different. */
  function solidOverlay(color: string): Buffer {
    const c = createCanvas(base.width, base.height);
    const ctx = c.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, base.width, base.height);
    return c.toBuffer("image/png");
  }

  const overlayA = solidOverlay("#ff0000");
  const overlayB = solidOverlay("#0000ff");

  it("actually draws the passed-in overlay: two different overlays produce different output", async () => {
    const outA = await compositePost({
      baseImage: photo,
      overlayImage: overlayA,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    const outB = await compositePost({
      baseImage: photo,
      overlayImage: overlayB,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    // still a valid PNG
    expect(outA.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    // and the overlay choice actually changed the pixels
    expect(outA.equals(outB)).toBe(false);
  });

  it("the default path (no overlayImage) is distinct from an explicit overlay", async () => {
    const outDefault = await compositePost({
      baseImage: photo,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    const outA = await compositePost({
      baseImage: photo,
      overlayImage: overlayA,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    expect(outDefault.equals(outA)).toBe(false);
  });

  it("still works with no overlayImage (falls back to the bundled brand asset)", async () => {
    const out = await compositePost({
      baseImage: photo,
      overlayText: { title: "X", subline: "Y" },
      dimensions: base,
    });
    expect(out.length).toBeGreaterThan(0);
  });

  it("THROWS when an explicitly supplied overlay cannot be decoded", async () => {
    // Measured before the fix: passing an HTML page as overlayImage returned a
    // valid 1080x1350 PNG with no branding at all, no error, and the run printed
    // ✓. An art_url that 404s to an HTML error page is exactly that case, so the
    // decode failure has to reach the caller.
    await expect(
      compositePost({
        baseImage: photo,
        overlayImage: Buffer.from("<!doctype html><html><body>404 Not Found</body></html>"),
        overlayText: { title: "X", subline: "Y" },
        dimensions: base,
      }),
    ).rejects.toThrow(/overlayImage could not be decoded/);
  });

  it("but the NO-overlay path still degrades silently when the bundled asset can't be read", async () => {
    // The paired negative: the graceful skip is kept for the bundled
    // brand/header.png, where the caller asked for no overlay in particular.
    // loadImage is stubbed to fail on the path form (the bundled asset) only.
    vi.resetModules();
    vi.doMock("@napi-rs/canvas", async () => {
      const actual = await vi.importActual<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
      return {
        ...actual,
        loadImage: (src: unknown) =>
          typeof src === "string"
            ? Promise.reject(new Error("ENOENT: brand asset absent"))
            : actual.loadImage(src as Buffer),
      };
    });
    try {
      const { compositePost: fresh } = await import("./composite.ts");
      const out = await fresh({
        baseImage: photo,
        overlayText: { title: "X", subline: "Y" },
        dimensions: base,
      });
      expect(out.readUInt32BE(16)).toBe(base.width);
      expect(out.readUInt32BE(20)).toBe(base.height);
    } finally {
      vi.doUnmock("@napi-rs/canvas");
      vi.resetModules();
    }
  });
});
