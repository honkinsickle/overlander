/**
 * Pin of the Week — brand + image style guide.
 *
 * There is no pre-existing Instagram style guide in this repo (verified). These
 * constants are lifted from the app's design system (DESIGN.md / globals.css /
 * CLAUDE.md "Design tokens") so a generated post reads as the same brand:
 *
 *   Base #0a0b0c · Amber accent #c8a96e · dark theme only
 *   Type: Space Mono (data), Barlow (body), Barlow Condensed (titles)
 *
 * Used by image-prompt.ts to compose the Nano Banana render brief.
 */

export const BRAND = {
  name: "Yo Trippin",
  handle: "@yotrippin",
  // Instagram feed portrait — maximises feed real estate.
  aspectRatio: "4:5",
  dimensions: { width: 1080, height: 1350 },
  colors: {
    baseBackground: "#0a0b0c", // grounds-950 — canvas
    panel: "#111214", // grounds-900
    card: "#161819", // grounds-850
    amber: "#c8a96e", // amber-300 — brand accent (data/labels/active only)
    amberLight: "#e8c98e", // amber-100
    amberDark: "#c77429", // amber-500
    forest: "#7ACEA1", // forest-300 — success / verified
    textPrimary: "#eceae4", // type-100
    textMuted: "#888888", // type-500
  },
  fonts: {
    title: "Barlow Condensed", // 700, place titles
    body: "Barlow",
    data: "Space Mono", // labels, coordinates
  },
  // The brand header is the REAL asset composited from brand/header.png (yellow
  // + coral bands + "yoTrippin!" wordmark) — see composite.ts drawHeader. No
  // colors/font are recreated here, so there is nothing to approximate.
} as const;

/**
 * PHOTO TREATMENT ONLY. The model renders the graded hero photo — NO text.
 *
 * All text (kicker, title, subline, verified mark) is composited
 * deterministically afterward (see composite.ts) so the place name is spelled
 * exactly and the typography is the real DESIGN.md fonts. Image models garble
 * long text and can't hit exact fonts (verified in PR #407: "Cameground"),
 * which is why text is deliberately kept OUT of the prompt.
 */
export const PHOTO_TREATMENT_BRIEF = [
  `Lightly enhance the provided reference photo of a real place for a social post.`,
  `Portrait ${BRAND.aspectRatio} (${BRAND.dimensions.width}x${BRAND.dimensions.height}).`,
  `Keep it BRIGHT and NATURAL: preserve the true daylight exposure and real colors,`,
  `with clean contrast and a crisp, vibrant look. Do NOT darken, dim, add vignettes,`,
  `or apply a moody/cinematic grade — the whole frame, and especially the top half,`,
  `must read at full, natural brightness. (Legibility of the bottom caption is`,
  `handled separately by an overlay, so do not darken the photo for it.)`,
  `Keep the real place clearly recognizable — do not change its content or geography.`,
  `ABSOLUTELY NO text, letters, words, numbers, logos, watermarks, badges, captions,`,
  `frames, or graphic overlays of any kind. No people added. No lens flare, no stock-photo look.`,
  `Output the photograph only.`,
].join(" ");
