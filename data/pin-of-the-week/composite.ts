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

let fontsRegistered = false;
function registerFonts(): void {
  if (fontsRegistered) return;
  GlobalFonts.registerFromPath(join(FONT_DIR, "SpaceMono-Regular.ttf"), "Space Mono");
  GlobalFonts.registerFromPath(join(FONT_DIR, "BarlowCondensed-Bold.ttf"), "Barlow Condensed");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-Regular.ttf"), "Barlow");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Barlow-SemiBold.ttf"), "Barlow SemiBold");
  GlobalFonts.registerFromPath(join(FONT_DIR, "Baloo2-VF.ttf"), "Baloo 2");
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

  // 2. Bottom scrim for the caption bar (existing dark styling — unchanged).
  const bottom = ctx.createLinearGradient(0, H * 0.4, 0, H);
  bottom.addColorStop(0, "rgba(10,11,12,0)");
  bottom.addColorStop(0.55, "rgba(10,11,12,0.72)");
  bottom.addColorStop(1, "rgba(10,11,12,0.95)");
  ctx.fillStyle = bottom;
  ctx.fillRect(0, H * 0.4, W, H * 0.6);

  const { colors } = BRAND;

  // 3. Striped brand header (replaces the old kicker + top-right logo).
  drawHeader(ctx, W, H, PAD);

  // 4. Caption block — bottom-anchored: wrapped title, subline + verified.
  const titleSize = Math.round(W * 0.066);
  const titleLine = Math.round(titleSize * 1.04);
  const subSize = Math.round(W * 0.028);
  const gapSub = Math.round(H * 0.014);
  const bottomPad = Math.round(H * 0.055);
  const maxTextWidth = W - PAD * 2;

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.font = `700 ${titleSize}px "Barlow Condensed"`;
  const titleLines = wrapText(ctx, opts.overlayText.title, maxTextWidth);

  const blockH = titleLines.length * titleLine + gapSub + subSize;
  let y = H - bottomPad - blockH;

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

/**
 * Striped brand header: full-width yellow strip + coral band (with the
 * "yoTrippin!" wordmark) + a thin dark divider, drawn opaque over the top of
 * the photo. Built from scratch as solid rectangles to match the reference
 * mockup. Band colors are approximate (see style-guide BRAND.header).
 */
function drawHeader(ctx: SKRSContext2D, W: number, H: number, pad: number): void {
  const { header, fonts } = BRAND;
  const yellowH = Math.round(H * 0.026);
  const coralH = Math.round(H * 0.058);
  const dividerH = Math.round(H * 0.009);

  ctx.fillStyle = header.yellow;
  ctx.fillRect(0, 0, W, yellowH);
  ctx.fillStyle = header.coral;
  ctx.fillRect(0, yellowH, W, coralH);
  ctx.fillStyle = header.divider;
  ctx.fillRect(0, yellowH + coralH, W, dividerH);

  // Wordmark — left-aligned, vertically centered in the coral band. Baloo 2 is
  // an approximation of the custom face; a light stroke fakes the heavier weight.
  const size = Math.round(coralH * 0.62);
  const cy = yellowH + coralH / 2;
  ctx.save();
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `400 ${size}px "${fonts.wordmark}"`;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(1, size * 0.045);
  ctx.strokeText(header.wordmarkText, pad, cy);
  ctx.fillText(header.wordmarkText, pad, cy);
  ctx.restore();
}

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
