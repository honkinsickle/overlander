"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useSearchParams } from "next/navigation";
import {
  DetailCard,
  DetailStats,
  DetailTip,
} from "@/components/primitives/detail-card";
import {
  DetailCardSkeleton,
  DetailCardErrorState,
} from "@/components/primitives/detail-card-skeleton";
import { useWaypointDetail } from "@/lib/trips/use-waypoint-detail";
import { CATEGORY_ACCENT } from "@/components/demo/category-planning-slide";
import type { Day, Waypoint } from "@/lib/trips/types";
import { decodePolyline } from "@/lib/routing/point-to-polyline";
import { UserLocationLayer } from "./user-location-layer";
import { DirectionsButton } from "./directions-button";
import { DirectionsPanel } from "./directions-panel";
import { NavGoButton } from "./nav-go-button";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

/** Build a DOM marker showing the active day's leg endpoint label
 *  ("Lake Louise", "Jasper, AB"). `anchor` controls which side of the
 *  point the label sits — pass "right" for the start (label to the
 *  right of the dot) and "left" for the end. */
function makeLegEndpointMarker(
  label: string,
  side: "left" | "right",
): mapboxgl.Marker {
  const chip = document.createElement("div");
  chip.textContent = label;
  chip.style.cssText =
    `padding:3px 8px;background:rgba(26,24,22,0.92);color:#F4EBE1;` +
    `font-family:var(--ff-mono),monospace;font-size:11px;` +
    `letter-spacing:0.04em;border-radius:3px;white-space:nowrap;` +
    `border:1px solid rgba(110,177,255,0.4);`;
  // Anchor on the side of the chip that touches the pin, then offset
  // 18px outward so it sits beside the pin (not under its body).
  const anchor: mapboxgl.Anchor = side === "right" ? "left" : "right";
  const offset: [number, number] =
    side === "right" ? [18, 0] : [-18, 0];
  return new mapboxgl.Marker({ element: chip, anchor, offset });
}

/** Browse-panel + suggested-stops dot marker chrome. Module-scoped so
 *  both the trip:browseResults handler and the trip:suggestedResults
 *  handler render identical dots from the same v2 icon vocabulary —
 *  values mirror browseCardPalette so the map reads as a legend for
 *  the filter chips above. Changing these here propagates to both. */
type DotBadge = { bg: string; border: string; svg: string };

const DOT_BASE_SIZE = 30;
const DOT_BASE_ZOOM = 13;
const DOT_MIN_SIZE = DOT_BASE_SIZE * 0.4;
function dotSize(zoom: number): number {
  return Math.max(DOT_MIN_SIZE, (DOT_BASE_SIZE * zoom) / DOT_BASE_ZOOM);
}
function resizeDots(markers: mapboxgl.Marker[], size: number): void {
  for (const m of markers) {
    const wrapper = m.getElement();
    const dot = wrapper.children[0] as HTMLElement | undefined;
    const label = wrapper.children[1] as HTMLElement | undefined;
    if (!dot) continue;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    if (label) label.style.left = `${size + 6}px`;
  }
}

const CAMPING_V2 =
  '<path d="M11 4L3 18h16z" fill="#D4B66E"/>' +
  '<path d="M11 9l2.5 9h-5z" fill="#1F1A0A"/>' +
  '<path d="M2 18h18v1H2z" fill="#5C3A20"/>' +
  '<path d="M10.7 1.5h0.6v3h-0.6z" fill="#1F1A0A"/>' +
  '<path d="M11 1l4 1l-4 1.5z" fill="#C24837"/>';
const SCENIC_V2 =
  '<path d="M13 9l8 10H5z" fill="#5C8474"/>' +
  '<path d="M8 5L1 19h14z" fill="#7AA38C"/>' +
  '<path d="M8 5l3 6H5z" fill="#E8F2EA"/>' +
  '<circle cx="17.5" cy="5" r="2.3" fill="#F5C04F"/>';
const FOOD_V2 =
  '<path d="M2 15.5h18v1.5q0 2 -2 2H4q-2 0 -2 -2z" fill="#D6905A"/>' +
  '<path d="M2 14.5h18v1q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0q-2 1.5 -4 0z" fill="#7DB35D"/>' +
  '<path d="M2 12.5h18v2H2z" fill="#5C3520"/>' +
  '<path d="M2 11h18v1.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5l-3 0.5l-3 -0.5z" fill="#F4C95D"/>' +
  '<path d="M2 11q0 -7 9 -7q9 0 9 7z" fill="#E5A85A"/>' +
  '<ellipse cx="7" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5"/>' +
  '<ellipse cx="11" cy="6.5" rx="0.7" ry="0.5" fill="#F5E4B5"/>' +
  '<ellipse cx="15" cy="8" rx="0.7" ry="0.5" fill="#F5E4B5"/>';
const FUEL_V2 =
  '<path d="M3 5q0 -1.5 1.5 -1.5h6q1.5 0 1.5 1.5v15H3z" fill="#C84A3E"/>' +
  '<path d="M3 19.5h9v1.5H3z" fill="#7A2A1F"/>' +
  '<rect x="4" y="6" width="7" height="3.5" rx="0.4" fill="#F4DB8E"/>' +
  '<rect x="4.5" y="7.5" width="6" height="0.8" fill="#3A1410"/>' +
  '<path d="M12 8q3 0 3 3v7q0 1.5 -1.5 1.5q-1.5 0 -1.5 -1.5v-5q0 -1.5 -1.5 -1.5z" fill="#A93A2E"/>' +
  '<rect x="13" y="13.5" width="2" height="4" rx="0.3" fill="#5C1F18"/>';
const HOTEL_V2 =
  '<rect x="4" y="9" width="5" height="2" fill="#DDDDDD"/>' +
  '<rect x="4" y="15" width="14" height="2" rx="0.3" fill="#8B5E34"/>' +
  '<rect x="4" y="14" width="6" height="1" rx="0.3" fill="#8B5E34"/>' +
  '<rect x="4" y="11" width="6" height="3" fill="#C2D4E5"/>' +
  '<rect x="2" y="5" width="2" height="13" rx="0.3" fill="#8B5E34"/>' +
  '<rect x="18" y="9" width="2" height="9" rx="0.3" fill="#8B5E34"/>' +
  '<rect x="11" y="11" width="7" height="4" rx="0.3" fill="#92BDE3"/>' +
  '<rect x="10" y="14" width="1" height="1" rx="0.3" fill="#8B5E34"/>' +
  '<rect x="10" y="11" width="1" height="4" fill="#79A7D0"/>';
const ODDITY_V2 =
  '<path d="M1.5 11q4.5 -6 9.5 -6q5 0 9.5 6q-4.5 6 -9.5 6q-5 0 -9.5 -6z" fill="#E8D8F4"/>' +
  '<circle cx="11" cy="11" r="3.7" fill="#5E3A8E"/>' +
  '<circle cx="11" cy="11" r="1.6" fill="#1A1028"/>' +
  '<circle cx="9.5" cy="9.7" r="0.9" fill="#FFE4A0"/>';
const DOT_BADGE_BY_CATEGORY: Record<string, DotBadge> = {
  oddity: { bg: "#2A1A3E", border: "#B589F0", svg: ODDITY_V2 },
  food: { bg: "#773D2C", border: "#F38666", svg: FOOD_V2 },
  scenic: { bg: "#24354F", border: "#A6C9F9", svg: SCENIC_V2 },
  camping: { bg: "#0F2E1F", border: "#4D9A6E", svg: CAMPING_V2 },
  overnight: { bg: "#304C4B", border: "#6ECECE", svg: HOTEL_V2 },
  fuel: { bg: "#2E1414", border: "#E26F6F", svg: FUEL_V2 },
};
const DOT_BADGE_DEFAULT: DotBadge = {
  bg: "#26292B",
  border: "var(--amber)",
  svg: "",
};

/** Builds a Mapbox marker for one browse/suggested dot (category-colored
 *  square badge with the v2 icon, hover-revealed label, click flies the
 *  map). Caller is responsible for adding it to a map and pushing it
 *  onto whichever array tracks it for cleanup/resize. */
/** Transient amber ring-glow on a dot — the active-POI highlight shown when a
 *  marker and its card are linked (area search). Reverts after ~1.4s. */
function pulseDot(dot: HTMLElement): void {
  dot.style.transition = "box-shadow 150ms ease";
  dot.style.boxShadow =
    "0 0 0 2px var(--amber), 0 0 14px 3px color-mix(in srgb, var(--amber) 70%, transparent), 0 2px 6px rgba(0,0,0,0.45)";
  window.setTimeout(() => {
    dot.style.boxShadow = "0 2px 6px rgba(0,0,0,0.45)";
  }, 1400);
}

function buildDotMarker(
  p: { coords: [number, number]; title: string; category?: string; id?: string },
  initialSize: number,
  /** "fly" (default, in-day browse + suggested): click flies the camera.
   *  "link" (area search): click links to the card instead — a fly would
   *  moveEnd → re-query → collapse the result set. */
  interact: "fly" | "link" = "fly",
): mapboxgl.Marker {
  const badge =
    (p.category && DOT_BADGE_BY_CATEGORY[p.category]) || DOT_BADGE_DEFAULT;
  const wrapper = document.createElement("div");
  // No `position` set — mapboxgl applies position:absolute, which also
  // serves as the containing block for the label's position:absolute.
  // Setting position:relative here breaks the marker's transform-based
  // positioning and dots stack in document flow instead of plotting at
  // their lat/lng.
  wrapper.style.cssText = `display:flex;align-items:center;cursor:pointer;`;
  if (p.id) wrapper.dataset.placeId = p.id;
  const dot = document.createElement("div");
  dot.style.cssText =
    `width:${initialSize}px;height:${initialSize}px;` +
    `border-radius:22%;background:${badge.bg};` +
    `border:1px solid ${badge.border};flex:0 0 auto;` +
    `display:flex;align-items:center;justify-content:center;` +
    `box-shadow:0 2px 6px rgba(0,0,0,0.45);`;
  if (badge.svg) {
    // SVG sized as % of the dot so resizeDots() automatically scales the
    // icon when the dot resizes on zoom.
    dot.innerHTML =
      `<svg width="78%" height="78%" viewBox="0 0 22 22" ` +
      `xmlns="http://www.w3.org/2000/svg" aria-hidden="true" ` +
      `style="display:block">${badge.svg}</svg>`;
  }
  const label = document.createElement("div");
  label.textContent = p.title;
  label.style.cssText =
    `position:absolute;left:${initialSize + 6}px;top:50%;` +
    `transform:translateY(-50%);white-space:nowrap;padding:3px 8px;` +
    `background:rgba(26,24,22,0.92);color:#F4EBE1;` +
    `font-family:var(--ff-mono),monospace;font-size:11px;` +
    `letter-spacing:0.04em;border-radius:3px;opacity:0;` +
    `pointer-events:none;transition:opacity 120ms ease;` +
    `border:1px solid ${badge.border}66;`;
  wrapper.appendChild(dot);
  wrapper.appendChild(label);
  wrapper.addEventListener("mouseenter", () => {
    label.style.opacity = "1";
    wrapper.parentElement!.style.zIndex = "10";
  });
  wrapper.addEventListener("mouseleave", () => {
    // A pinned marker (the current flyTo target) keeps its label
    // visible regardless of hover — trip:flyTo from a card click sets
    // data-pinned so the destination stays labelled after the camera
    // animation. Cleared when a new flyTo lands on a different marker.
    if (wrapper.dataset.pinned === "true") return;
    label.style.opacity = "0";
    wrapper.parentElement!.style.zIndex = "";
  });
  wrapper.addEventListener("click", () => {
    if (interact === "link") {
      // Area search: pulse this dot and tell the panel to highlight + scroll
      // the matching card. No camera move, so no moveEnd → re-query collapse.
      pulseDot(dot);
      window.dispatchEvent(
        new CustomEvent("trip:areaResultFocus", { detail: { id: p.id } }),
      );
      return;
    }
    window.dispatchEvent(
      new CustomEvent("trip:flyTo", {
        detail: { coords: p.coords, name: p.title },
      }),
    );
  });
  return new mapboxgl.Marker({ element: wrapper }).setLngLat(p.coords);
}

/** Closest-vertex search via squared planar distance in [lng, lat]
 *  space. Good enough for slicing a road-following polyline at day
 *  endpoints — both coords sit ON the polyline by construction, so the
 *  nearest vertex is the right one without any haversine cost. */
function nearestIndex(
  path: [number, number][],
  target: [number, number],
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const dx = path[i][0] - target[0];
    const dy = path[i][1] - target[1];
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Right-side map column. Persists across center-column nav.
 *
 * The map flies to `day.coords` whenever `?day=<id>` changes. DayDetail's
 * scroll-spy keeps that param in sync with the user's position in the
 * centre scroll, so scrolling through days animates the map.
 *
 * URL contract (waypoint detail overlay):
 *   ?panel=waypoint&id=<slug> → fetches /api/trips/:id/waypoints/:slug
 */
export function MapColumn({
  tripId,
  days,
  startCoords,
  routePolyline,
  onMoveEnd,
}: {
  tripId: string;
  days: Day[];
  startCoords?: [number, number];
  /** Pre-baked road-following geometry encoded as a polyline (precision
   *  5). When present, MapColumn decodes and draws this directly instead
   *  of calling the Mapbox Directions API. */
  routePolyline?: string;
  /** Fires on map load and after every pan/zoom with the current viewport
   *  bbox `[west, south, east, north]`. Lets a sibling (the top-level
   *  search) bound its query to what's on screen — "search this area". */
  onMoveEnd?: (bbox: [number, number, number, number]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  /** Latest onMoveEnd from props, read inside the []-dep init effect so the
   *  handler never goes stale without re-running map setup. */
  const onMoveEndRef = useRef(onMoveEnd);
  useEffect(() => {
    onMoveEndRef.current = onMoveEnd;
  }, [onMoveEnd]);
  /** Trip-day pins, shared across the marker-init and browse-results
   *  effects so the latter can hide/show them when the panel toggles. */
  const tripDayMarkersRef = useRef<mapboxgl.Marker[]>([]);
  /** Merged road-following polyline coords. Set once the route loads;
   *  used by the active-day-leg highlight to slice the segment that
   *  corresponds to the currently-viewed day. */
  const routePathRef = useRef<[number, number][] | null>(null);
  /** Endpoint labels for the active day's leg ("Lake Louise", "Jasper,
   *  AB"). Tracked on a ref so the effect can swap them when ?day=
   *  changes without leaving stale labels behind. */
  const legEndpointMarkersRef = useRef<mapboxgl.Marker[]>([]);
  /** Trip-day pins indexed by `Day.id` so the active-leg effect can
   *  find the right pin to recolor (Day 5's end = Day 6's start). The
   *  trip-start pin (no day) is keyed under "_start". */
  const dayPinsByIdRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  /** Coords map for the same pins so we can recreate at the same point
   *  when swapping color. */
  const dayPinCoordsByIdRef = useRef<Map<string, [number, number]>>(
    new Map(),
  );
  /** Which pin keys are currently rendered as blue (active leg
   *  endpoints). Used by `setTripPinsVisible` to exempt them from the
   *  hide-all-pins behavior during browse. */
  const activeLegPinKeysRef = useRef<Set<string>>(new Set());
  /** Whether the browse panel is currently displaying results (and
   *  therefore the non-endpoint trip pins should stay hidden). Set by
   *  the browse-results handler; read by `swapPinColor` so a revert-
   *  to-gold pin recreated during an active browse session lands
   *  hidden, matching the rest of the trip pins. */
  const browseOpenRef = useRef(false);
  /** Markers from the additive Suggested-Stops layer (rendered when the
   *  active day's SuggestedSection dispatches trip:suggestedResults).
   *  Tracked on a ref so the browse-results handler can hide them while
   *  the browse panel is open without going through the suggested-
   *  results effect again. */
  const suggestedMarkersRef = useRef<mapboxgl.Marker[]>([]);
  /** Browse-panel dot markers. Lifted to a ref so the trip:flyTo handler
   *  can pin the destination marker's label across the union of browse
   *  + suggested dots. */
  const browseMarkersRef = useRef<mapboxgl.Marker[]>([]);
  /** State copy of the map instance so child components can mount
   *  against it without reading mapRef.current during render. Set
   *  alongside mapRef once the Map is constructed. */
  const [mapInstance, setMapInstance] = useState<mapboxgl.Map | null>(null);

  const searchParams = useSearchParams();
  const queriedDay = searchParams.get("day");
  const simulateParam = searchParams.get("simulate");
  const simulate =
    simulateParam === "error" || simulateParam === "timeout"
      ? simulateParam
      : null;

  // Waypoint panel is driven by history.replaceState + custom events
  // (see WaypointCard) — NOT by Next's router, because a soft nav to
  // the same path activates the @modal intercept and opens the slideup.
  const [panelSlug, setPanelSlug] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const p = new URL(window.location.href).searchParams;
    return p.get("panel") === "waypoint" ? p.get("id") : null;
  });
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (
        e as CustomEvent<{ panel: string | null; id: string | null }>
      ).detail;
      if (detail?.panel === "waypoint") setPanelSlug(detail.id);
      else setPanelSlug(null);
    };
    window.addEventListener("trip:panel", onOpen);
    return () => window.removeEventListener("trip:panel", onOpen);
  }, []);
  const slug = panelSlug;

  const activeDay = useMemo(
    () =>
      (queriedDay && days.find((d) => d.id === queriedDay)) || days[0] || null,
    [days, queriedDay],
  );

  const state = useWaypointDetail(tripId, slug, { simulate });
  const dismiss = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("panel");
    url.searchParams.delete("id");
    window.history.replaceState(null, "", url);
    window.dispatchEvent(
      new CustomEvent("trip:panel", { detail: { panel: null, id: null } }),
    );
  };

  // Initialise the map once. Markers for every day with coords.
  // A ResizeObserver keeps the canvas in sync with the column's layout
  // (important because mapbox-gl.css forces `position: relative` on its
  // container, so we rely on the parent's flex sizing for height).
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;
    // Open on Day 1's start (the place the trip begins), matching the
    // fly-to-active-day effect's default target. Same fallback chain it
    // uses so trips finalized before `startCoord` existed still center
    // sensibly. Without this, the map briefly renders at Day 1's
    // overnight (`coords`) at zoom 6, which can hide the origin city
    // entirely before flyTo lands.
    const day1 = days[0];
    const initialCenter =
      day1?.startCoord ??
      (day1?.dayNumber === 1 ? startCoords : undefined) ??
      day1?.coords ??
      [-121.5, 45];
    const map = new mapboxgl.Map({
      container: el,
      style: "mapbox://styles/honkingsickle/cmolte3b7003e01so7msf20d3",
      center: initialCenter,
      zoom: 8,
      attributionControl: false,
    });
    mapRef.current = map;
    setMapInstance(map);

    // Publish the viewport bbox on load + after every move so the top-level
    // search can bound a query to what's on screen. `getBounds()` is
    // [west,south,east,north] in lng/lat.
    const emitBounds = () => {
      const b = map.getBounds();
      if (!b) return;
      onMoveEndRef.current?.([
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]);
    };
    map.on("load", emitBounds);
    map.on("moveend", emitBounds);

    const dayCoords = days
      .map((d) => d.coords)
      .filter((c): c is [number, number] => !!c);
    // Each day's coords is the day's *end*, so the route line would
    // start at Day 1's destination instead of the trip origin. Prepend
    // the trip's startCoords (when provided) so the line begins at the
    // origin city.
    const routeCoords = startCoords ? [startCoords, ...dayCoords] : dayCoords;

    // Trip day pins (orange Mapbox defaults). Kept on a ref so the
    // browse-results handler in the sibling effect can hide them while
    // the browse panel is open — otherwise 66 pins compete with browse
    // dots for visual attention on a Day-1 zoom.
    const tripDayMarkers: mapboxgl.Marker[] = [];
    const dayPinsById = new Map<string, mapboxgl.Marker>();
    const dayPinCoordsById = new Map<string, [number, number]>();
    if (startCoords) {
      const m = new mapboxgl.Marker({ color: "#c8a96e" })
        .setLngLat(startCoords)
        .addTo(map);
      tripDayMarkers.push(m);
      dayPinsById.set("_start", m);
      dayPinCoordsById.set("_start", startCoords);
    }
    days.forEach((d) => {
      if (!d.coords) return;
      const m = new mapboxgl.Marker({ color: "#c8a96e" })
        .setLngLat(d.coords)
        .addTo(map);
      tripDayMarkers.push(m);
      dayPinsById.set(d.id, m);
      dayPinCoordsById.set(d.id, d.coords);
    });
    dayPinsByIdRef.current = dayPinsById;
    dayPinCoordsByIdRef.current = dayPinCoordsById;

    // Per-waypoint pins — category-colored circle head with a stroked SVG
    // category icon and a downward tail. Mapbox anchor:"bottom" lands the
    // tip on the coord. Paths come from category-icons.tsx (24×24 viewBox,
    // stroke-only) so they render crisply at any zoom and stay on-brand.
    // Pushed onto the same ref as trip-day markers so they hide together
    // when the browse panel opens (otherwise they compete with browse dots).
    const CAT_SVG: Record<string, string> = {
      fuel:
        '<rect x="4" y="3" width="10" height="18" rx="1"/><line x1="6" y1="7" x2="12" y2="7"/><path d="M14 9 h4 v9 a2 2 0 0 1 -2 2 a2 2 0 0 1 -2 -2 V9z"/><path d="M16 4 v3"/>',
      camping:
        '<path d="M3 20 L12 4 L21 20 Z"/><path d="M10 20 L12 14 L14 20"/>',
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
    };
    days.forEach((d) => {
      for (const wp of d.waypoints) {
        if (!wp.coords) continue;
        const iconPaths = CAT_SVG[wp.category] ?? CAT_SVG.interest;
        const el = document.createElement("div");
        el.setAttribute("aria-label", wp.title);
        el.style.cssText =
          "position:relative;width:32px;height:42px;cursor:pointer;";

        const head = document.createElement("div");
        head.style.cssText =
          "position:absolute;top:0;left:0;width:32px;height:32px;" +
          `background:var(--cat-${wp.category}-title);` +
          "border:2px solid #1A1A1A;border-radius:50%;" +
          "display:flex;align-items:center;justify-content:center;" +
          "box-shadow:0 2px 6px rgba(0,0,0,0.5);";
        head.innerHTML =
          `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ` +
          `stroke="#1A1A1A" stroke-width="2" stroke-linecap="round" ` +
          `stroke-linejoin="round" aria-hidden="true">${iconPaths}</svg>`;

        const tip = document.createElement("div");
        tip.style.cssText =
          "position:absolute;top:28px;left:11px;width:0;height:0;" +
          "border-left:5px solid transparent;border-right:5px solid transparent;" +
          `border-top:10px solid var(--cat-${wp.category}-title);` +
          "filter:drop-shadow(0 1px 0 #1A1A1A);";

        el.appendChild(head);
        el.appendChild(tip);

        el.addEventListener("click", () => {
          window.dispatchEvent(
            new CustomEvent("trip:flyTo", {
              detail: { coords: wp.coords, name: wp.title },
            }),
          );
          window.dispatchEvent(
            new CustomEvent("trip:openDetail", {
              detail: {
                place: {
                  id: wp.id,
                  title: wp.title,
                  photoUrl: wp.photoUrl,
                  description: wp.description,
                  dayNumber: d.dayNumber,
                  waypoint: wp,
                },
              },
            }),
          );
        });

        tripDayMarkers.push(
          new mapboxgl.Marker({ element: el, anchor: "bottom" })
            .setLngLat(wp.coords)
            .addTo(map),
        );
      }
    });

    tripDayMarkersRef.current = tripDayMarkers;

    if (routeCoords.length >= 2) {
      const controller = new AbortController();
      map.on("load", async () => {
        let merged: [number, number][];
        if (routePolyline && routePolyline.length > 0) {
          // Pre-baked path: decode the committed polyline and draw it
          // directly. See scripts/prebake-routes.mjs for the encoder.
          merged = decodePolyline(routePolyline);
        } else {
          // Live path — same chunk + dedupe + recursive-split pipeline
          // used to bake the geometry. Runs when a trip has no pre-baked
          // routeGeometry, or after a mutation invalidates it.
          //  • Driving profile caps at 25 coords/request → chunk with overlap.
          //  • Mapbox 422s on consecutive duplicate coords (rest days repeat
          //    the prior day's coord), so dedupe first.
          //  • A 200 with empty `routes` ("NoRoute") means at least one coord
          //    in the chunk is unroutable (e.g. Brooks Falls — floatplane
          //    only). Recursively split such chunks in half so the failure
          //    is isolated to a single unroutable pair rather than killing
          //    the whole 25-coord segment.
          const CHUNK_LIMIT = 25;

          const deduped: [number, number][] = [];
          for (const c of routeCoords) {
            const prev = deduped[deduped.length - 1];
            if (!prev || prev[0] !== c[0] || prev[1] !== c[1]) deduped.push(c);
          }

          const fetchRoute = async (
            coords: [number, number][],
          ): Promise<[number, number][]> => {
            if (coords.length < 2) return coords;
            const path = coords.map((c) => `${c[0]},${c[1]}`).join(";");
            const url =
              `https://api.mapbox.com/directions/v5/mapbox/driving/${path}` +
              `?geometries=geojson&overview=full` +
              `&access_token=${mapboxgl.accessToken}`;
            try {
              const res = await fetch(url, { signal: controller.signal });
              if (res.ok) {
                const json = (await res.json()) as {
                  routes?: {
                    geometry?: { coordinates?: [number, number][] };
                  }[];
                };
                const geo = json.routes?.[0]?.geometry?.coordinates;
                if (geo && geo.length > 0) return geo;
                // 200 + empty routes → split and retry sub-segments
              } else {
                console.warn(
                  `[map] Directions ${coords.length}-coord HTTP ${res.status}`,
                );
              }
            } catch (err) {
              if ((err as Error)?.name === "AbortError") return coords;
              console.warn("[map] Directions error:", err);
              return coords;
            }

            if (coords.length === 2) return coords; // unroutable pair → line
            const mid = Math.floor(coords.length / 2);
            const left = await fetchRoute(coords.slice(0, mid + 1));
            const right = await fetchRoute(coords.slice(mid));
            return [...left, ...right.slice(1)];
          };

          const chunks: [number, number][][] = [];
          for (let i = 0; i < deduped.length; i += CHUNK_LIMIT - 1) {
            chunks.push(deduped.slice(i, i + CHUNK_LIMIT));
            if (i + CHUNK_LIMIT >= deduped.length) break;
          }
          const chunkResults = await Promise.all(chunks.map(fetchRoute));
          // Drop the first coord of every chunk after the first to avoid
          // duplicating the overlap point.
          merged = chunkResults.flatMap((c, i) =>
            i === 0 ? c : c.slice(1),
          );
        }

        if (!mapRef.current) return; // unmounted mid-fetch
        routePathRef.current = merged;
        map.addSource("trip-route", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: merged },
          },
        });
        map.addLayer({
          id: "trip-route-line",
          type: "line",
          source: "trip-route",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#c8a96e",
            "line-width": 3,
            "line-opacity": 0.9,
          },
        });
        // Empty active-day-leg layer drawn above the gold trip line.
        // The activeDay effect populates the source per day change.
        map.addSource("active-day-leg", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates: [] },
          },
        });
        map.addLayer({
          id: "active-day-leg-line",
          type: "line",
          source: "active-day-leg",
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-color": "#6EB1FF",
            "line-width": 4,
            "line-opacity": 0.95,
          },
        });
        // Trigger the active-day effect once the source is ready by
        // emitting a render event — the effect listens on activeDay
        // changes and updates the source if the map is loaded.
        window.dispatchEvent(new CustomEvent("trip:routeReady"));

        // Intentionally NOT fitBounds-ing the whole route here. The
        // map's initial center + the active-day effect frame Day 1's
        // start, which matches the highlighted day card and the day's
        // hero image. A whole-trip "Overview" view belongs to a future
        // sidebar mode, not the default first-paint.
      });
    }

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
    // Days is a stable server-provided array within a render — re-running
    // this effect only makes sense if the trip itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fly to the active day whenever ?day= changes. Prefer the day's
  // *start* coord — `coords` is the end-of-day overnight, so without
  // this Day 1 lands at the first night's stop instead of the origin
  // city. Backfill for trips finalized before `startCoord` existed:
  // Day 1 → trip.startCoords, other days → `coords` (the prior day's
  // end is also this day's start in segment chains).
  useEffect(() => {
    const map = mapRef.current;
    if (!activeDay) return;
    const flyCoord =
      activeDay.startCoord ??
      (activeDay.dayNumber === 1 ? startCoords : undefined) ??
      activeDay.coords;
    if (!map || !flyCoord) return;
    map.flyTo({
      center: flyCoord,
      zoom: 8,
      duration: 1500,
      essential: true,
    });
  }, [activeDay, startCoords]);

  // Highlight the active day's leg (sliced from the road-following
  // polyline) in blue, layered above the gold trip line. Waits for
  // the route to be ready before updating the source.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeDay) return;

    const dayIndex = days.findIndex((d) => d.id === activeDay.id);
    if (dayIndex < 0) return;

    const prev = dayIndex > 0 ? days[dayIndex - 1] : undefined;
    const legStart =
      activeDay.startCoord ??
      prev?.coords ??
      (activeDay.dayNumber === 1 ? startCoords : undefined);
    const legEnd = activeDay.coords;
    if (!legStart || !legEnd) return;

    const apply = () => {
      const path = routePathRef.current;
      if (!path || path.length < 2) return;
      const startIdx = nearestIndex(path, legStart);
      const endIdx = nearestIndex(path, legEnd);
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const slice =
        hi > lo ? path.slice(lo, hi + 1) : [path[lo], path[lo]];
      const src = map.getSource("active-day-leg") as
        | mapboxgl.GeoJSONSource
        | undefined;
      if (!src) return;
      src.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: slice },
      });
      // Swap the two trip-day pins at the leg's endpoints to blue.
      // Previous blue pins (from the prior active day) revert to gold.
      // Done via destroy + recreate since mapbox's default-marker color
      // is set at construction; the map of dayId→Marker keeps the swap
      // localized so the rest of the trip's gold pins stay untouched.
      const swapPinColor = (
        key: string,
        coord: [number, number],
        color: string,
      ) => {
        const prevMarker = dayPinsByIdRef.current.get(key);
        if (prevMarker) prevMarker.remove();
        const m = new mapboxgl.Marker({ color }).setLngLat(coord).addTo(map);
        // If browse is open, gold pins (non-active leg) should stay
        // hidden — sibling effect's setTripPinsVisible(false) hid all
        // pins, and this newly-created gold pin would otherwise pop
        // into view.
        if (browseOpenRef.current && color === "#c8a96e") {
          m.getElement().style.display = "none";
        }
        dayPinsByIdRef.current.set(key, m);
      };
      const previousKeys = new Set(activeLegPinKeysRef.current);
      // Identify the two endpoint pin keys. Start-key = previous day's
      // id (its end coord = today's start), OR "_start" for Day 1.
      const startKey =
        dayIndex > 0 ? days[dayIndex - 1].id : "_start";
      const endKey = activeDay.id;
      const startCoord = dayPinCoordsByIdRef.current.get(startKey);
      const endCoord = dayPinCoordsByIdRef.current.get(endKey);
      // Revert any previously-blue pins that aren't part of the new leg.
      for (const k of previousKeys) {
        if (k === startKey || k === endKey) continue;
        const coord = dayPinCoordsByIdRef.current.get(k);
        if (coord) swapPinColor(k, coord, "#c8a96e");
      }
      activeLegPinKeysRef.current = new Set();
      if (startCoord) {
        swapPinColor(startKey, startCoord, "#6EB1FF");
        activeLegPinKeysRef.current.add(startKey);
      }
      if (endCoord && endKey !== startKey) {
        swapPinColor(endKey, endCoord, "#6EB1FF");
        activeLegPinKeysRef.current.add(endKey);
      }
      // Ensure the active blue pins are visible even if the browse
      // panel is currently open (its setTripPinsVisible(false) hides
      // pins by default; we re-show the leg endpoints here).
      for (const k of activeLegPinKeysRef.current) {
        const m = dayPinsByIdRef.current.get(k);
        if (m) m.getElement().style.display = "";
      }

      // Clear old endpoint labels then re-place at the new leg's ends.
      // Labels come from the day's label string ("Start — ... — End"),
      // split on em-dash. Single-segment labels (rest days etc.) reuse
      // the same label for both ends.
      for (const m of legEndpointMarkersRef.current) m.remove();
      legEndpointMarkersRef.current = [];
      const parts = (activeDay.label ?? "")
        .split(/—|→|·/)
        .map((s) => s.trim())
        .filter(Boolean);
      const startLabel = parts[0] ?? "";
      const endLabel = parts[parts.length - 1] ?? "";
      if (startLabel) {
        legEndpointMarkersRef.current.push(
          makeLegEndpointMarker(startLabel, "right").setLngLat(legStart).addTo(map),
        );
      }
      if (endLabel && endLabel !== startLabel) {
        legEndpointMarkersRef.current.push(
          makeLegEndpointMarker(endLabel, "left").setLngLat(legEnd).addTo(map),
        );
      }
    };

    // The active-day source is created inside the map.on("load",...)
    // route handler — if that hasn't fired yet, wait for the ready
    // event before applying.
    if (map.getSource("active-day-leg")) {
      apply();
    } else {
      const onReady = () => apply();
      window.addEventListener("trip:routeReady", onReady, { once: true });
      return () => window.removeEventListener("trip:routeReady", onReady);
    }
  }, [activeDay, days, startCoords]);

  // Fly to a specific place when the browse panel or a Suggested Stops
  // card emits trip:flyTo. Also "pins" the destination marker's label
  // so it stays visible after the camera animation — otherwise the dot
  // is just an unlabelled glyph and the user has to hover to confirm
  // which place they just clicked. Only one marker is pinned at a time;
  // the next flyTo clears prior pins.
  useEffect(() => {
    const COORD_EPS = 1e-9;
    const onFlyTo = (e: Event) => {
      const detail = (
        e as CustomEvent<{
          coords: [number, number];
          name?: string;
          zoom?: number;
        }>
      ).detail;
      const map = mapRef.current;
      if (!map || !detail?.coords) return;
      map.flyTo({
        center: detail.coords,
        // Default tight zoom matches the waypoint-pin "show me this stop"
        // use case. Directions step clicks pass a wider zoom (~14) so
        // surrounding road context is visible.
        zoom: detail.zoom ?? 17,
        duration: 1500,
        essential: true,
      });
      const [lng, lat] = detail.coords;
      const all = [
        ...browseMarkersRef.current,
        ...suggestedMarkersRef.current,
      ];
      for (const m of all) {
        const wrapper = m.getElement();
        const label = wrapper.children[1] as HTMLElement | undefined;
        if (!label) continue;
        const ll = m.getLngLat();
        const isTarget =
          Math.abs(ll.lng - lng) < COORD_EPS &&
          Math.abs(ll.lat - lat) < COORD_EPS;
        if (isTarget) {
          wrapper.dataset.pinned = "true";
          label.style.opacity = "1";
          if (wrapper.parentElement) {
            wrapper.parentElement.style.zIndex = "10";
          }
        } else if (wrapper.dataset.pinned === "true") {
          delete wrapper.dataset.pinned;
          label.style.opacity = "0";
          if (wrapper.parentElement) {
            wrapper.parentElement.style.zIndex = "";
          }
        }
      }
    };
    window.addEventListener("trip:flyTo", onFlyTo);
    return () => window.removeEventListener("trip:flyTo", onFlyTo);
  }, []);

  // Drop a small dot per browse-panel result. The panel emits a
  // results event with the current category + places when it loads,
  // and an empty event on close — we mirror exactly that into the map
  // so panel and map can never get out of sync.
  //
  // Dots scale with the map zoom: 30px at zoom 13 (city view), shrinks
  // linearly with zoom, hard-floored at 12px (40% of base) when zoomed
  // way out so they never disappear entirely.
  useEffect(() => {
    const applyDotSize = () => {
      const map = mapRef.current;
      if (!map) return;
      resizeDots(browseMarkersRef.current, dotSize(map.getZoom()));
    };

    const clear = () => {
      mapRef.current?.off("zoom", applyDotSize);
      for (const m of browseMarkersRef.current) m.remove();
      browseMarkersRef.current = [];
    };

    const setSuggestedVisible = (visible: boolean) => {
      for (const m of suggestedMarkersRef.current) {
        m.getElement().style.display = visible ? "" : "none";
      }
    };

    const setTripPinsVisible = (visible: boolean) => {
      // Active-leg pins (blue) are exempt — they should stay visible
      // even when the rest of the trip pins are hidden behind the
      // browse panel's dots.
      const exempt = new Set<mapboxgl.Marker>();
      for (const k of activeLegPinKeysRef.current) {
        const m = dayPinsByIdRef.current.get(k);
        if (m) exempt.add(m);
      }
      for (const m of tripDayMarkersRef.current) {
        if (exempt.has(m)) {
          m.getElement().style.display = "";
          continue;
        }
        m.getElement().style.display = visible ? "" : "none";
      }
      // Also handle the recreated active-leg pins that aren't in
      // tripDayMarkersRef (since we destroy+recreate during swap).
      for (const m of exempt) m.getElement().style.display = "";
    };

    const onResults = (e: Event) => {
      clear();
      const map = mapRef.current;
      if (!map) return;
      const detail = (
        e as CustomEvent<{
          category: keyof typeof CATEGORY_ACCENT | null;
          places: Array<{
            coords: [number, number];
            title: string;
            id: string;
            category?: string;
          }>;
          /** "link" = area-search markers link to their card on click
           *  instead of flying the camera. Absent = in-day browse (fly). */
          interact?: "fly" | "link";
        }>
      ).detail;
      browseOpenRef.current = !!detail?.places?.length;
      // Browse panel closing (or arriving with no results) → restore the
      // trip-day pins AND the additive Suggested-Stops dots so the user
      // has both trip context and the active day's suggestions again.
      if (!detail?.places?.length) {
        setTripPinsVisible(true);
        setSuggestedVisible(true);
        return;
      }
      // Browse open with results → hide the trip pins AND the
      // suggested-stops dots so the browse dots can dominate the canvas
      // without competing for attention.
      setTripPinsVisible(false);
      setSuggestedVisible(false);
      const interact = detail.interact === "link" ? "link" : "fly";
      const initialSize = dotSize(map.getZoom());
      for (const p of detail.places) {
        const marker = buildDotMarker(p, initialSize, interact).addTo(map);
        browseMarkersRef.current.push(marker);
      }
      map.on("zoom", applyDotSize);
    };
    // Card → marker: pulse the result marker whose card was tapped (area
    // search). Matches by the data-place-id set in buildDotMarker.
    const onCardFocus = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      for (const m of browseMarkersRef.current) {
        const el = m.getElement();
        if (el.dataset.placeId === id) {
          const dot = el.children[0] as HTMLElement | undefined;
          if (dot) pulseDot(dot);
          break;
        }
      }
    };
    window.addEventListener("trip:browseResults", onResults);
    window.addEventListener("trip:areaCardFocus", onCardFocus);
    return () => {
      window.removeEventListener("trip:browseResults", onResults);
      window.removeEventListener("trip:areaCardFocus", onCardFocus);
      clear();
    };
  }, []);

  // Additive Suggested-Stops dot layer. The active day's SuggestedSection
  // dispatches trip:suggestedResults with the union of its top picks
  // across all categories (food/scenic/oddity/camping); we render dots in
  // the same v2 vocabulary as the browse panel. Coexists with trip-day
  // pins (additive). Hidden while the browse panel is open — the
  // browse-results handler above flips visibility via the shared
  // suggestedMarkersRef.
  useEffect(() => {
    const applySuggestedDotSize = () => {
      const map = mapRef.current;
      if (!map) return;
      resizeDots(suggestedMarkersRef.current, dotSize(map.getZoom()));
    };

    const clear = () => {
      mapRef.current?.off("zoom", applySuggestedDotSize);
      for (const m of suggestedMarkersRef.current) m.remove();
      suggestedMarkersRef.current = [];
    };

    const onSuggestedResults = (e: Event) => {
      clear();
      const map = mapRef.current;
      if (!map) return;
      const detail = (
        e as CustomEvent<{
          places: Array<{
            coords: [number, number];
            title: string;
            id: string;
            category?: string;
          }>;
        }>
      ).detail;
      if (!detail?.places?.length) return;
      const initialSize = dotSize(map.getZoom());
      for (const p of detail.places) {
        const marker = buildDotMarker(p, initialSize).addTo(map);
        // Start hidden if browse is currently dominating — browse close
        // will flip them back via setSuggestedVisible(true).
        if (browseOpenRef.current) {
          marker.getElement().style.display = "none";
        }
        suggestedMarkersRef.current.push(marker);
      }
      map.on("zoom", applySuggestedDotSize);
    };
    window.addEventListener("trip:suggestedResults", onSuggestedResults);
    return () => {
      window.removeEventListener(
        "trip:suggestedResults",
        onSuggestedResults,
      );
      clear();
    };
  }, []);

  // Active-leg endpoints for the DirectionsPanel — mirrors the same
  // fallback chain used by the active-day-leg-line effect so directions
  // and the highlighted blue leg always describe the same drive.
  const { legStart, legEnd } = useMemo(() => {
    if (!activeDay) return { legStart: null, legEnd: null };
    const dayIndex = days.findIndex((d) => d.id === activeDay.id);
    const prev = dayIndex > 0 ? days[dayIndex - 1] : undefined;
    const start =
      activeDay.startCoord ??
      prev?.coords ??
      (activeDay.dayNumber === 1 ? startCoords : undefined);
    return {
      legStart: start ?? null,
      legEnd: activeDay.coords ?? null,
    };
  }, [activeDay, days, startCoords]);

  return (
    <div className="relative w-full h-full bg-bg-map">
      <div ref={containerRef} className="w-full h-full" />

      {mapInstance && (
        <UserLocationLayer
          map={mapInstance}
          routePathRef={routePathRef}
        />
      )}

      <DirectionsButton />

      <NavGoButton />

      <DirectionsPanel
        legStart={legStart}
        legEnd={legEnd}
        legLabel={activeDay?.label}
        dayNumber={activeDay?.dayNumber}
      />


      {slug && (
        <div className="absolute inset-x-4 bottom-5 pointer-events-auto">
          {state.status === "loading" && <DetailCardSkeleton />}
          {state.status === "success" && (
            <WaypointDetail
              tripId={tripId}
              waypoint={state.data}
              onClose={dismiss}
            />
          )}
          {state.status === "not-found" && (
            <DetailCardErrorState
              title="Waypoint not found"
              message={`No waypoint matched "${slug}" on this trip. It may have been removed.`}
              onDismiss={dismiss}
            />
          )}
          {state.status === "error" && (
            <DetailCardErrorState
              title="Couldn't load waypoint"
              message={state.message}
              onRetry={state.refetch}
              onDismiss={dismiss}
            />
          )}
        </div>
      )}
    </div>
  );
}

function WaypointDetail({
  waypoint,
  onClose,
}: {
  tripId: string;
  waypoint: Waypoint;
  onClose: () => void;
}) {
  return (
    <DetailCard
      category={waypoint.category}
      title={waypoint.title}
      subtitle={waypoint.subtitle}
      onClose={onClose}
    >
      <p className="text-sm leading-5 text-text-muted">
        {waypoint.description}
      </p>
      {waypoint.tip && <DetailTip>{waypoint.tip}</DetailTip>}
      <DetailStats items={waypoint.stats} />
    </DetailCard>
  );
}
