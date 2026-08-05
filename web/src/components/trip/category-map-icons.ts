import type { BrowseCardCategory } from "@/lib/trip-browse/palette";

/**
 * Category icon INNER-SVG strings for the map's symbol layers (the two-layer
 * category place map). Mapbox `addImage` rasterizes from an <img>, so it needs
 * SVG *strings*, not the React icon components — this module is that string home.
 *
 * Two existing icon sets are reused verbatim; NO third set is invented:
 *
 * - `PIN_STROKE_SVG` — the 24×24 stroke set the waypoint pins render
 *   (`map-column.tsx` imports this for its pin builder, so pins and the
 *   PROMINENT map layer share one source). 9 keys.
 * - `POOL_FILL_SVG` — the 22×22 filled "CategoryIconV2" art (the browse-dot
 *   glyphs). Kept as strings here because the raster path can't render the React
 *   component; byte-identical to `components/icons/category-icons-v2.tsx`. The
 *   browse-dot DOM builder in `map-column.tsx` keeps its own inline copies
 *   (left untouched to keep that path zero-risk); this is the map-layer copy.
 *
 * COLORS are NOT here — they live in the canonical `--cat-{name}-{title,
 * badge-bg,badge-border}` tokens (globals.css) and are read at register time.
 */

/** Stroke-only category glyphs, 24×24 viewBox (fill:none; stroke set by caller).
 *  The exact paths the waypoint pins draw. */
export const PIN_STROKE_SVG: Record<BrowseCardCategory, string> = {
  fuel:
    '<rect x="4" y="3" width="10" height="18" rx="1"/><line x1="6" y1="7" x2="12" y2="7"/><path d="M14 9 h4 v9 a2 2 0 0 1 -2 2 a2 2 0 0 1 -2 -2 V9z"/><path d="M16 4 v3"/>',
  camping: '<path d="M3 20 L12 4 L21 20 Z"/><path d="M10 20 L12 14 L14 20"/>',
  scenic:
    '<polygon points="3 20 9 9 13 15 16 11 21 20"/><circle cx="17" cy="6" r="1.5"/>',
  urban:
    '<rect x="3" y="3" width="7" height="18"/><rect x="14" y="8" width="7" height="13"/><line x1="6" y1="7" x2="7" y2="7"/><line x1="6" y1="11" x2="7" y2="11"/><line x1="6" y1="15" x2="7" y2="15"/><line x1="17" y1="12" x2="18" y2="12"/><line x1="17" y1="16" x2="18" y2="16"/>',
  food:
    '<path d="M17 8h1a3 3 0 0 1 0 6h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z"/><line x1="6" y1="2" x2="6" y2="5"/><line x1="10" y1="2" x2="10" y2="5"/><line x1="14" y1="2" x2="14" y2="5"/>',
  oddity:
    '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  attraction:
    '<polygon points="12 2 14.39 8.26 21 8.27 15.45 12.14 17.82 18.4 12 14.77 6.18 18.4 8.55 12.14 3 8.27 9.61 8.26"/>',
  interest: '<circle cx="12" cy="12" r="5"/>',
  hotel:
    '<path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/>',
};

/** Filled multi-color category glyphs, 22×22 viewBox. Mirror of
 *  `components/icons/category-icons-v2.tsx` (the browse-dot art). */
export const POOL_FILL_SVG: Record<BrowseCardCategory, string> = {
  camping:
    '<path d="M11 4L3 18h16z" fill="#D4B66E"/><path d="M11 9l2.5 9h-5z" fill="#1F1A0A"/><path d="M2 18h18v1H2z" fill="#5C3A20"/><path d="M10.7 1.5h0.6v3h-0.6z" fill="#1F1A0A"/><path d="M11 1l4 1l-4 1.5z" fill="#C24837"/>',
  urban:
    '<path d="M3 5h6v14H3z" fill="#F2D77A"/><path d="M11 9h8v10h-8z" fill="#C99837"/><path d="M4.5 7.5h1.8v1.8H4.5zM6.5 7.5h1.8v1.8H6.5zM4.5 11h1.8v1.8H4.5zM6.5 11h1.8v1.8H6.5zM12.5 11.5h2v2h-2zM15 11.5h2v2h-2zM12.5 14.5h2v2h-2zM15 14.5h2v2h-2z" fill="#1A1408"/><path d="M5.7 2h0.6v3h-0.6z" fill="#1A1408"/><path d="M6 1.5l3 1L6 4z" fill="#C24837"/>',
  scenic:
    '<path d="M13 9l8 10H5z" fill="#5C8474"/><path d="M8 5L1 19h14z" fill="#7AA38C"/><path d="M8 5l3 6H5z" fill="#E8F2EA"/><circle cx="17.5" cy="5" r="2.3" fill="#F5C04F"/>',
  food:
    '<path d="M2 15.5h18v1.5q0 2 -2 2H4q-2 0 -2 -2z" fill="#D6905A"/><path d="M2 14.5h18v1q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0z" fill="#7DB35D"/><path d="M2 12.5h18v2H2z" fill="#5C3520"/><path d="M2 11h18v1.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5z" fill="#F4C95D"/><path d="M2 11q0 -7 9 -7q9 0 9 7z" fill="#E5A85A"/><ellipse cx="7" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5"/><ellipse cx="11" cy="6.5" rx="0.7" ry="0.5" fill="#F5E4B5"/><ellipse cx="15" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5"/>',
  fuel:
    '<path d="M3 5q0 -1.5 1.5 -1.5h6q1.5 0 1.5 1.5v15H3z" fill="#C84A3E"/><path d="M3 19.5h9v1.5H3z" fill="#7A2A1F"/><rect x="4" y="6" width="7" height="3.5" rx="0.4" fill="#F4DB8E"/><rect x="4.5" y="7.5" width="6" height="0.8" fill="#3A1410"/><path d="M12 8q3 0 3 3v7q0 1.5 -1.5 1.5q-1.5 0 -1.5 -1.5v-5q0 -1.5 -1.5 -1.5z" fill="#A93A2E"/><rect x="13" y="13.5" width="2" height="4" rx="0.3" fill="#5C1F18"/>',
  hotel:
    '<rect x="4" y="9" width="5" height="2" fill="#DDDDDD"/><rect x="4" y="15" width="14" height="2" rx="0.3" fill="#8B5E34"/><rect x="4" y="14" width="6" height="1" rx="0.3" fill="#8B5E34"/><rect x="4" y="11" width="6" height="3" fill="#C2D4E5"/><rect x="2" y="5" width="2" height="13" rx="0.3" fill="#8B5E34"/><rect x="18" y="9" width="2" height="9" rx="0.3" fill="#8B5E34"/><rect x="11" y="11" width="7" height="4" rx="0.3" fill="#92BDE3"/><rect x="10" y="14" width="1" height="1" rx="0.3" fill="#8B5E34"/><rect x="10" y="11" width="1" height="4" fill="#79A7D0"/>',
  oddity:
    '<path d="M1.5 11q4.5 -6 9.5 -6q5 0 9.5 6q-4.5 6 -9.5 6q-5 0 -9.5 -6z" fill="#E8D8F4"/><circle cx="11" cy="11" r="3.7" fill="#5E3A8E"/><circle cx="11" cy="11" r="1.6" fill="#1A1028"/><circle cx="9.5" cy="9.7" r="0.9" fill="#FFE4A0"/>',
  attraction:
    '<polygon points="11 2 13.2 8 19.5 8.2 14.6 12 16.4 18 11 14.4 5.6 18 7.4 12 2.5 8.2 8.8 8" fill="#E6B422"/><polygon points="11 5.2 12.3 8.7 16 9 13.1 11.3 14 15 11 12.9 8 15 8.9 11.3 6 9 9.7 8.7" fill="#FFD966"/>',
  interest:
    '<path d="M11 3l7.6 8-7.6 8-7.6-8z" fill="#CBBE9C"/><path d="M11 6.4l4.4 4.6-4.4 4.6-4.4-4.6z" fill="#3A3324"/><circle cx="11" cy="11" r="2" fill="#CBBE9C"/>',
};
