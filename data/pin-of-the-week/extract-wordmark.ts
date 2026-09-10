/**
 * One-time tool: isolate the white "yoTrippin!" wordmark from the branding
 * banner into a clean transparent PNG for the composite.
 *
 * The banner was provided at assets/socailmedia/branding.png (note: the folder
 * is misspelled "socailmedia", NOT the "social media" originally referenced).
 * A copy is bundled here as brand/branding-source.png so this extractor and the
 * composite are reproducible without the top-level asset.
 *
 * The source has a BLACK background with a speckled halo around the wordmark's
 * blob (not transparent). We isolate the wordmark by:
 *   1. searching the upper-right region (avoids the diagonal yellow/red stripes),
 *   2. keeping only near-white pixels (drops black bg, stripes, and dark blob),
 *   3. dropping small connected components (kills the halo speckle),
 *   4. cropping tight to what remains.
 *
 * Output: brand/yotrippin-wordmark.png (committed; composite.ts loads that, not
 * the source, so rendering is reproducible without the raw banner).
 *
 * Run: npx tsx data/pin-of-the-week/extract-wordmark.ts
 */

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(HERE, "brand", "branding-source.png");
const OUT = join(HERE, "brand", "yotrippin-wordmark.png");

// Near-white test — the wordmark is white; stripes (yellow/red) have a low
// channel, so requiring all three high excludes them.
const WHITE_MIN = 205;
// Search box (fractions of the banner) — the wordmark blob is upper-right.
const REGION = { x0: 0.52, x1: 1.0, y0: 0.0, y1: 0.72 };
// Speckle filter: drop connected white blobs smaller than this many pixels.
const MIN_COMPONENT = 120;

function isWhite(d: Uint8ClampedArray, i: number): boolean {
  return d[i] >= WHITE_MIN && d[i + 1] >= WHITE_MIN && d[i + 2] >= WHITE_MIN && d[i + 3] > 128;
}

async function main(): Promise<void> {
  const img = await loadImage(SOURCE);
  const W = img.width;
  const H = img.height;
  const src = createCanvas(W, H);
  const sctx = src.getContext("2d");
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, W, H).data;

  const x0 = Math.floor(REGION.x0 * W);
  const x1 = Math.floor(REGION.x1 * W);
  const y0 = Math.floor(REGION.y0 * H);
  const y1 = Math.floor(REGION.y1 * H);

  // Binary mask of near-white pixels inside the search region.
  const mask = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (isWhite(data, (y * W + x) * 4)) mask[y * W + x] = 1;
    }
  }

  // Connected components (4-neighbour flood fill); zero out ones below MIN.
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  let kept = 0;
  let dropped = 0;
  for (let p = 0; p < W * H; p++) {
    if (mask[p] !== 1 || seen[p]) continue;
    const comp: number[] = [];
    stack.push(p);
    seen[p] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      comp.push(q);
      const qx = q % W;
      const qy = (q - qx) / W;
      const nbrs = [
        qx > 0 ? q - 1 : -1,
        qx < W - 1 ? q + 1 : -1,
        qy > 0 ? q - W : -1,
        qy < H - 1 ? q + W : -1,
      ];
      for (const n of nbrs) {
        if (n >= 0 && mask[n] === 1 && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    if (comp.length < MIN_COMPONENT) {
      for (const q of comp) mask[q] = 0;
      dropped += comp.length;
    } else {
      kept += comp.length;
    }
  }

  // Tight bbox of surviving mask.
  let minX = W;
  let minY = H;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (mask[y * W + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(W - 1, maxX + pad);
  maxY = Math.min(H - 1, maxY + pad);
  const ow = maxX - minX + 1;
  const oh = maxY - minY + 1;

  // Paint surviving white pixels onto a transparent canvas.
  const out = createCanvas(ow, oh);
  const octx = out.getContext("2d");
  const outImg = octx.createImageData(ow, oh);
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const srcP = (y + minY) * W + (x + minX);
      const o = (y * ow + x) * 4;
      if (mask[srcP]) {
        outImg.data[o] = 255;
        outImg.data[o + 1] = 255;
        outImg.data[o + 2] = 255;
        outImg.data[o + 3] = 255;
      }
    }
  }
  octx.putImageData(outImg, 0, 0);
  await writeFile(OUT, out.toBuffer("image/png"));

  console.log(`source ${W}x${H} → wordmark ${ow}x${oh}`);
  console.log(`kept ${kept}px, dropped ${dropped}px as speckle (<${MIN_COMPONENT}px components)`);
  console.log(`wrote ${OUT}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
