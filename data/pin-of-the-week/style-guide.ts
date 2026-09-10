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
    data: "Space Mono", // labels, coordinates, the "PIN OF THE WEEK" kicker
  },
} as const;

/**
 * The reusable framing instruction for every Pin of the Week image. Kept
 * separate from the per-place prompt so the brand system stays consistent
 * across posts. Amber is accent-only (per DESIGN.md: "never links or pins").
 */
export const IMAGE_STYLE_BRIEF = [
  `A branded Instagram post for the overlanding brand "${BRAND.name}".`,
  `Portrait ${BRAND.aspectRatio} (${BRAND.dimensions.width}x${BRAND.dimensions.height}).`,
  `Dark, cinematic, moody outdoor aesthetic on a near-black base (${BRAND.colors.baseBackground}).`,
  `The provided reference photo of the real place is the hero image, filling the upper ~two-thirds`,
  `edge to edge, with a subtle dark gradient scrim along the bottom for text legibility.`,
  `A small top-left kicker label reads "PIN OF THE WEEK" in an uppercase monospace typeface`,
  `(${BRAND.fonts.data}), tinted warm amber (${BRAND.colors.amber}), with generous letter-spacing.`,
  `Lower third is a clean dark caption bar: the place name as a bold condensed sans headline`,
  `(${BRAND.fonts.title}) in off-white (${BRAND.colors.textPrimary}), a smaller muted subline`,
  `(${BRAND.fonts.body}) for category and state.`,
  `Amber is an ACCENT ONLY — kicker, a thin rule, and the verified mark; never large fills.`,
  `Do NOT invent text, ratings, logos, or details beyond what the caption bar specifies.`,
  `No people, no watermark, no stock-photo look, no lens flare.`,
].join(" ");
