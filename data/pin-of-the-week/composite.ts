/**
 * Pin of the Week — deterministic header + caption-bar compositor.
 *
 * Step 2 of the two-step image pipeline. Nano Banana produces the graded hero
 * photo with NO text (see style-guide PHOTO_TREATMENT_BRIEF); this module draws
 * the brand chrome on top with @napi-rs/canvas, using the REAL place name from
 * the SELECT row and the actual DESIGN.md fonts + amber palette. Because the
 * text is drawn by us (not the model), the place name is always spelled exactly
 * and the typography is exact — the fix for PR #407's garbled text.
 *
 * Layout (top → bottom):
 *   - striped brand header: yellow strip + coral band with the "yoTrippin!"
 *     wordmark (built from scratch as solid bands to match the reference mockup)
 *   - the photo treatment (unchanged)
 *   - the black caption bar: title + "Category · State" + amber "Verified"
 *
 * Fonts are bundled under ./fonts (all OFL) and registered from those paths so
 * rendering is identical on any machine (no reliance on system fonts).
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { BRAND } from "./style-guide.ts";
import type { ImagePromptSpec } from "./image-prompt.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(MODULE_DIR, "fonts");
// The REAL brand asset, bundled from assets/socialmedia/branding.png. As of the
// 2026-09-11 asset swap this is a FULL-FRAME 1080x1348 template (opaque header +
// transparent body + a baked-in footer), not the old 1080x148 header strip; see
// drawHeader for placement.
const HEADER_PATH = join(MODULE_DIR, "brand", "header.png");

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(join(FONT_DIR, "BarlowCondensed-Bold.ttf"), "Barlow Condensed");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-Regular.ttf"), "Barlow");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-SemiBold.ttf"), "Barlow SemiBold");
  fontsRegistered = true;
}

/** Greedy word-wrap against the current ctx.font, to a max pixel width. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const trial = line ? `${line} ${w}` : w;
    if (ctx.measureText(trial).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = trial;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Cover-fit source dimensions into a target box; returns draw rect. */
export function coverRect(sw: number, sh: number, tw: number, th: number) {
  const scale = Math.max(tw / sw, th / sh);
  const w = sw * scale;
  const h = sh * scale;
  return { x: (tw - w) / 2, y: (th - h) / 2, w, h };
}

export interface CompositeOptions {
  baseImage: Buffer;
  overlayText: ImagePromptSpec["overlayText"];
  dimensions: { width: number; height: number };
}

export async function compositePost(opts: CompositeOptions): Promise<Buffer> {
  registerFonts();
  const { width: W, height: H } = opts.dimensions;
  const PAD = Math.round(W * 0.06); // 64 @ 1080
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");

  // 1. Base photo, cover-fit (fallback to base color if it fails to decode).
  try {
    const img = await loadImage(opts.baseImage);
    const r = coverRect(img.width, img.height, W, H);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } catch {
    ctx.fillStyle = BRAND.colors.baseBackground;
    ctx.fillRect(0, 0, W, H);
  }

  const { colors } = BRAND;

  // 2. The full-frame brand asset (branding.png), composited over the photo.
  // As of the 2026-09-11 full-frame swap the ASSET owns all the chrome — header,
  // the bottom scrim, the category label + divider, and the route decoration —
  // so the code no longer draws its own scrim or category subline. Code supplies
  // only the photo (above) and the place name (below).
  await drawFrame(ctx, W);

  // 3. Place name (title) — drawn in the asset's name slot below the divider,
  // bottom-anchored. Same Barlow Condensed styling as before; the subline
  // (category) is intentionally gone (the frame carries the category label).
  const titleSize = Math.round(W * 0.066);
  const titleLine = Math.round(titleSize * 1.04);
  const bottomPad = Math.round(H * 0.055);
  const maxTextWidth = W - PAD * 2;

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `700 ${titleSize}px "Barlow Condensed"`;
  const titleLines = wrapText(ctx, opts.overlayText.title, maxTextWidth);

  const blockH = titleLines.length * titleLine;
  let y = H - bottomPad - blockH;

  ctx.fillStyle = colors.textPrimary;
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y);
    y += titleLine;
  }

  return canvas.toBuffer("image/png");
}

/**
 * Draw the REAL full-frame brand asset (brand/header.png = branding.png — the
 * yoTrippin! header band + transparent body + baked scrim, category label,
 * divider and route decoration) full-width from the top, preserving its aspect
 * ratio (a 1080x1348 asset covers ~the whole 1080x1350 canvas). Uses the true
 * brand art, not a recreation. Skipped gracefully if the asset is missing.
 */
async function drawFrame(ctx: SKRSContext2D, W: number): Promise<void> {
  try {
    const frame = await loadImage(HEADER_PATH);
    const h = Math.round(frame.height * (W / frame.width));
    ctx.drawImage(frame, 0, 0, W, h);
  } catch {
    // brand asset absent — leave the composite without the frame
  }
}
