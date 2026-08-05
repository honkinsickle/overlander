import type mapboxgl from "mapbox-gl";
import { BROWSE_CARD_CATEGORIES } from "@/lib/trip-browse/palette";
import { PIN_STROKE_SVG, POOL_FILL_SVG } from "./category-map-icons";

/**
 * Image pipeline for the two-layer category place map. Mapbox symbol layers draw
 * `icon-image`s that must be registered up-front via `addImage`; nothing in the
 * repo did this before. Here we rasterize two SVG variants per category (18
 * images) and register them at map load.
 *
 * - POOL variant   → the browse-dot language: dark rounded-square badge
 *   (`--cat-*-badge-bg`/`-border`) + filled `POOL_FILL_SVG` glyph.
 * - PROMINENT variant → the waypoint-pin language: light disc
 *   (`--cat-*-title`) + 2px #1A1A1A ring + dark-stroke `PIN_STROKE_SVG` glyph +
 *   teardrop tail. Registered with the tip at image-bottom so the layer's
 *   `icon-anchor: "bottom"` lands the tip on the coordinate, matching
 *   `Marker({ anchor: "bottom" })`.
 *
 * Colors are read from the canonical `--cat-*` tokens (globals.css) at register
 * time — no raw hex here. Sizes: both variants sit in the ~30px category-icon
 * tier (POOL 30px badge; PROMINENT 32px head + 10px tail), fixed — the images are
 * authored at 2× and registered `{ pixelRatio: 2 }`, so they do not scale with
 * zoom (matching the fixed-size waypoint pins).
 */

const DARK = "#1A1A1A"; // the pin ring + glyph stroke — a fixed map-ink, not a theme color (AGENTS: raw hex OK for map imagery)
const SCALE = 2; // pixelRatio; images authored at 2× the CSS size

export const poolImageName = (cat: string) => `place-${cat}-pool`;
export const promImageName = (cat: string) => `place-${cat}-prom`;

type CatColors = { title: string; badgeBg: string; badgeBorder: string };

function readCatColors(cat: string): CatColors {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    title: v(`--cat-${cat}-title`),
    badgeBg: v(`--cat-${cat}-badge-bg`),
    badgeBorder: v(`--cat-${cat}-badge-border`),
  };
}

/** POOL badge: 30×30 rounded square (rx 22%) + centered 22-viewBox filled glyph. */
function poolSvg(cat: string, c: CatColors): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${30 * SCALE}" height="${30 * SCALE}" viewBox="0 0 30 30">` +
    `<rect x="1.25" y="1.25" width="27.5" height="27.5" rx="6.6" fill="${c.badgeBg}" stroke="${c.badgeBorder}" stroke-width="1.25"/>` +
    `<svg x="3.5" y="3.5" width="23" height="23" viewBox="0 0 22 22">${POOL_FILL_SVG[cat as keyof typeof POOL_FILL_SVG]}</svg>` +
    `</svg>`
  );
}

/** PROMINENT teardrop: 32px head (light disc + dark ring) + dark-stroke glyph +
 *  10px tail whose tip is at the image bottom (icon-anchor: bottom). */
function promSvg(cat: string, c: CatColors): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${32 * SCALE}" height="${42 * SCALE}" viewBox="0 0 32 42">` +
    // tail first (behind the head), tip at bottom-center (16, 42)
    `<path d="M10 29 L22 29 L16 42 Z" fill="${c.title}" stroke="${DARK}" stroke-width="1"/>` +
    // head: 32px disc with a 2px dark ring
    `<circle cx="16" cy="16" r="15" fill="${c.title}" stroke="${DARK}" stroke-width="2"/>` +
    // glyph: 18px, 24-viewBox stroke icon centered in the head
    `<svg x="7" y="7" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${DARK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PIN_STROKE_SVG[cat as keyof typeof PIN_STROKE_SVG]}</svg>` +
    `</svg>`
  );
}

function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/**
 * Register all 18 category icons on `map`. Idempotent (skips images already
 * present), so it is safe to call on every `style.load`. Resolves once every
 * image is decoded and added.
 */
export async function registerPlaceLayerIcons(
  map: mapboxgl.Map,
): Promise<void> {
  await Promise.all(
    BROWSE_CARD_CATEGORIES.flatMap((cat) => {
      const colors = readCatColors(cat);
      const jobs: Promise<void>[] = [];
      const add = (name: string, svg: string) => {
        if (map.hasImage(name)) return;
        jobs.push(
          svgToImage(svg).then((img) => {
            // A concurrent style.load may have added it while we decoded.
            if (!map.hasImage(name)) {
              map.addImage(name, img, { pixelRatio: SCALE });
            }
          }),
        );
      };
      add(poolImageName(cat), poolSvg(cat, colors));
      add(promImageName(cat), promSvg(cat, colors));
      return jobs;
    }),
  );
}
