import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { compositePost, coverRect, padStoryForWeb, WEB_STORY_DIMENSIONS, wrapText } from "./composite.ts";
import { BRAND } from "./style-guide.ts";

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

describe("padStoryForWeb", () => {
  /**
   * WHY THIS EXISTS — measured against the live composer 2026-09-16.
   * Instagram's WEB story composer sizes the image to the BROWSER WINDOW and
   * bakes that shape into what it publishes. A 1080x1920 (9:16) story is
   * therefore side-cropped on every window Instagram will accept: the published
   * asset came back 786x1704 with the yoTrippin! header gone, "Boulder Basin"
   * truncated to "oulder Basin" and the region line missing entirely.
   * Padding to a phone-shaped canvas removes the thing it would crop.
   */
  const RED = "#ff0000";
  const solid = (w: number, h: number, color: string) => {
    const c = createCanvas(w, h);
    const ctx = c.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    return c.toBuffer("image/png");
  };
  const pixelAt = async (png: Buffer, x: number, y: number) => {
    const img = await loadImage(png);
    const c = createCanvas(img.width, img.height);
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  };

  it("returns the phone-shaped canvas, not 9:16", async () => {
    const out = await padStoryForWeb(solid(1080, 1920, RED));
    expect(out.readUInt32BE(16)).toBe(WEB_STORY_DIMENSIONS.width);
    expect(out.readUInt32BE(20)).toBe(WEB_STORY_DIMENSIONS.height);
    expect(WEB_STORY_DIMENSIONS.height).toBeGreaterThan(1920);
  });

  it("centers the artwork, so equal bands sit above and below", async () => {
    const out = await padStoryForWeb(solid(1080, 1920, RED));
    const inset = (WEB_STORY_DIMENSIONS.height - 1920) / 2;
    // just inside the art, top and bottom
    expect(await pixelAt(out, 540, inset + 5)).toBe(RED);
    expect(await pixelAt(out, 540, WEB_STORY_DIMENSIONS.height - inset - 5)).toBe(RED);
    // just outside it, top and bottom
    expect(await pixelAt(out, 540, inset - 5)).not.toBe(RED);
    expect(await pixelAt(out, 540, WEB_STORY_DIMENSIONS.height - inset + 5)).not.toBe(RED);
  });

  it("fills the bands with the brand base, not white or transparent", async () => {
    const out = await padStoryForWeb(solid(1080, 1920, RED));
    expect(await pixelAt(out, 540, 10)).toBe(BRAND.colors.baseBackground.toLowerCase());
  });

  it("does not scale the artwork — every edge pixel survives", async () => {
    // The whole point: nothing may be cropped or resized, or the logo and the
    // place name lose their edges exactly as they did when published.
    const out = await padStoryForWeb(solid(1080, 1920, RED));
    const inset = (WEB_STORY_DIMENSIONS.height - 1920) / 2;
    expect(await pixelAt(out, 0, inset)).toBe(RED);                                   // top-left
    expect(await pixelAt(out, 1079, inset)).toBe(RED);                                // top-right
    expect(await pixelAt(out, 0, inset + 1919)).toBe(RED);                            // bottom-left
    expect(await pixelAt(out, 1079, inset + 1919)).toBe(RED);                         // bottom-right
  });

  it("throws on input it cannot decode rather than emitting a blank canvas", async () => {
    // A silent blank would publish an unbranded story — the same failure mode
    // drawFrame already refuses for a caller-supplied overlay.
    await expect(padStoryForWeb(Buffer.from("not an image"))).rejects.toThrow();
  });
});
