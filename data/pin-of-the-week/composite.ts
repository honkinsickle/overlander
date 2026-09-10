/**
 * Pin of the Week — deterministic caption-bar compositor.
 *
 * Step 2 of the two-step image pipeline. Nano Banana produces the graded hero
 * photo with NO text (see style-guide PHOTO_TREATMENT_BRIEF); this module draws
 * the brand caption bar on top with @napi-rs/canvas, using the REAL place name
 * from the SELECT row and the actual DESIGN.md fonts + amber palette. Because
 * the text is drawn by us (not the model), the place name is always spelled
 * exactly and the typography is exact — the fix for PR #407's garbled text.
 *
 * Fonts are bundled under ./fonts (Space Mono — OFL, Barlow / Barlow Condensed
 * — OFL) and registered from those paths so rendering is identical on any
 * machine (no reliance on system fonts).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import { BRAND } from "./style-guide.ts";
import type { ImagePromptSpec } from "./image-prompt.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const FONT_DIR = join(MODULE_DIR, "fonts");
// Pre-extracted transparent "yoTrippin!" wordmark (see extract-wordmark.ts).
const WORDMARK_PATH = join(MODULE_DIR, "brand", "yotrippin-wordmark.png");

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(join(FONT_DIR, "SpaceMono-Regular.ttf"), "Space Mono");
  GlobalFonts.registerFromPath(join(FONT_DIR, "BarlowCondensed-Bold.ttf"), "Barlow Condensed");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-Regular.ttf"), "Barlow");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-SemiBold.ttf"), "Barlow SemiBold");
  fontsRegistered = true;
}

/** Draw text with manual per-character tracking (letter-spacing). Returns end x. */
function drawTracked(ctx: SKRSContext2D, text: string, x: number, y: number, tracking: number): number {
  let cx = x;
  for (const ch of text) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + tracking;
  }
  return cx - tracking;
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

  // 2. Scrims: bottom (for the caption bar) + a light top one (for the kicker).
  const bottom = ctx.createLinearGradient(0, H * 0.4, 0, H);
  bottom.addColorStop(0, "rgba(10,11,12,0)");
  bottom.addColorStop(0.55, "rgba(10,11,12,0.72)");
  bottom.addColorStop(1, "rgba(10,11,12,0.95)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);

  const top = ctx.createLinearGradient(0, 0, 0, H * 0.2);
  top.addColorStop(0, "rgba(10,11,12,0.5)");
  top.addColorStop(1, "rgba(10,11,12,0)");
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, W, H * 0.2);

  const { colors } = BRAND;

  // 3. Kicker — top-left, Space Mono, uppercase, amber, tracked.
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = colors.amber;
  const kickerSize = Math.round(W * 0.024);
  ctx.font = `400 ${kickerSize}px "Space Mono"`;
  drawTracked(ctx, opts.overlayText.kicker.toUpperCase(), PAD, PAD, Math.round(W * 0.006));

  // 3b. Brand wordmark — small watermark-scale mark, top-right (balances the
  // kicker; top-right stays clear of the long wrapped title in the bottom bar).
  // Separate brand asset from the DESIGN.md dark/amber system — added on top,
  // nothing else changes. Skipped gracefully if the asset is missing.
  try {
    const mark = await loadImage(WORDMARK_PATH);
    const markW = Math.round(W * 0.17);
    const markH = Math.round(markW * (mark.height / mark.width));
    // Vertically center the mark on the kicker's cap height.
    const markY = PAD + Math.round((kickerSize - markH) / 2);
    ctx.drawImage(mark, W - PAD - markW, markY, markW, markH);
  } catch {
    // asset absent — leave the composite unchanged
  }

  // 4. Caption block — bottom-anchored: brand, wrapped title, subline + verified.
  const brandSize = Math.round(W * 0.028);
  const titleSize = Math.round(W * 0.066);
  const titleLine = Math.round(titleSize * 1.04);
  const subSize = Math.round(W * 0.028);
  const gapBrand = Math.round(H * 0.008);
  const gapSub = Math.round(H * 0.014);
  const bottomPad = Math.round(H * 0.055);
  const maxTextWidth = W - PAD * 2;

  ctx.font = `700 ${titleSize}px "Barlow Condensed"`;
  const titleLines = wrapText(ctx, opts.overlayText.title, maxTextWidth);

  const blockH = brandSize + gapBrand + titleLines.length * titleLine + gapSub + subSize;
  let y = H - bottomPad - blockH;

  // brand
  ctx.fillStyle = colors.textPrimary;
  ctx.font = `600 ${brandSize}px "Barlow SemiBold"`;
  ctx.fillText(opts.overlayText.brand, PAD, y);
  y += brandSize + gapBrand;

  // title
  ctx.fillStyle = colors.textPrimary;
  ctx.font = `700 ${titleSize}px "Barlow Condensed"`;
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y);
    y += titleLine;
  }
  y += gapSub - (titleLine - titleSize);

  // subline: muted "Category · ST", then amber check + "Yo Trippin Verified"
  ctx.font = `400 ${subSize}px "Barlow"`;
  ctx.fillStyle = colors.textMuted;
  ctx.fillText(opts.overlayText.subline, PAD, y);
  const subW = ctx.measureText(opts.overlayText.subline).width;

  const markX = PAD + subW + Math.round(W * 0.02);
  drawCheck(ctx, markX, y + subSize * 0.55, subSize * 0.5, colors.amber);
  ctx.fillStyle = colors.amber;
  ctx.font = `600 ${subSize}px "Barlow SemiBold"`;
  ctx.fillText(opts.overlayText.verified.replace(/^✓\s*/, ""), markX + subSize * 0.75, y);

  return canvas.toBuffer("image/png");
}

// (context type imported from @napi-rs/canvas as SKRSContext2D)

/** Small vector checkmark (avoids missing-glyph boxes for ✓). */
function drawCheck(ctx: SKRSContext2D, x: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x, cy);
  ctx.lineTo(x + size * 0.38, cy + size * 0.42);
  ctx.lineTo(x + size, cy - size * 0.5);
  ctx.stroke();
  ctx.restore();
}
