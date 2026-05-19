"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useSearchParams } from "next/navigation";
import { Navigation } from "lucide-react";
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

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

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
}: {
  tripId: string;
  days: Day[];
  startCoords?: [number, number];
  /** Pre-baked road-following geometry encoded as a polyline (precision
   *  5). When present, MapColumn decodes and draws this directly instead
   *  of calling the Mapbox Directions API. */
  routePolyline?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  /** Trip-day pins, shared across the marker-init and browse-results
   *  effects so the latter can hide/show them when the panel toggles. */
  const tripDayMarkersRef = useRef<mapboxgl.Marker[]>([]);

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
    if (startCoords) {
      tripDayMarkers.push(
        new mapboxgl.Marker({ color: "#c8a96e" })
          .setLngLat(startCoords)
          .addTo(map),
      );
    }
    days.forEach((d) => {
      if (!d.coords) return;
      tripDayMarkers.push(
        new mapboxgl.Marker({ color: "#c8a96e" })
          .setLngLat(d.coords)
          .addTo(map),
      );
    });

    // Per-waypoint pins — category-colored circle head with an emoji icon
    // and a downward tail. Mapbox anchor:"bottom" lands the tip on the coord.
    // Pushed onto the same ref as trip-day markers so they hide together
    // when the browse panel opens (otherwise they compete with browse dots).
    const CAT_EMOJI: Record<string, string> = {
      fuel: "⛽",
      camping: "⛺",
      mountain: "🏔",
      urban: "🏙",
      food: "🍔",
      oddity: "👁",
      attraction: "⭐",
      neutral: "📍",
    };
    days.forEach((d) => {
      for (const wp of d.waypoints) {
        if (!wp.coords) continue;
        const emoji = CAT_EMOJI[wp.category] ?? "📍";
        const el = document.createElement("div");
        el.setAttribute("aria-label", wp.title);
        el.style.cssText =
          "position:relative;width:32px;height:42px;cursor:pointer;";

        const head = document.createElement("div");
        head.style.cssText =
          "position:absolute;top:0;left:0;width:32px;height:32px;" +
          `background:var(--cat-${wp.category});` +
          "border:2px solid #1A1A1A;border-radius:50%;" +
          "display:flex;align-items:center;justify-content:center;" +
          "font-size:16px;line-height:1;" +
          "box-shadow:0 2px 6px rgba(0,0,0,0.5);";
        head.textContent = emoji;

        const tip = document.createElement("div");
        tip.style.cssText =
          "position:absolute;top:28px;left:11px;width:0;height:0;" +
          "border-left:5px solid transparent;border-right:5px solid transparent;" +
          `border-top:10px solid var(--cat-${wp.category});` +
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

  // Fly to a specific place when the browse panel emits trip:flyTo. Used by
  // the CategoryBrowsePanel cards: tap a slide → map zooms to that location.
  useEffect(() => {
    const onFlyTo = (e: Event) => {
      const detail = (
        e as CustomEvent<{ coords: [number, number]; name?: string }>
      ).detail;
      const map = mapRef.current;
      if (!map || !detail?.coords) return;
      map.flyTo({
        center: detail.coords,
        zoom: 13,
        duration: 1500,
        essential: true,
      });
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
    const markers: mapboxgl.Marker[] = [];
    const BASE_SIZE = 30;
    const BASE_ZOOM = 13;
    const MIN_SIZE = BASE_SIZE * 0.4;
    const dotSize = (zoom: number) =>
      Math.max(MIN_SIZE, (BASE_SIZE * zoom) / BASE_ZOOM);

    const applyDotSize = () => {
      const map = mapRef.current;
      if (!map) return;
      const size = dotSize(map.getZoom());
      for (const m of markers) {
        const wrapper = m.getElement();
        const dot = wrapper.children[0] as HTMLElement | undefined;
        const label = wrapper.children[1] as HTMLElement | undefined;
        if (!dot) continue;
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        if (label) label.style.left = `${size + 6}px`;
      }
    };

    const clear = () => {
      mapRef.current?.off("zoom", applyDotSize);
      for (const m of markers) m.remove();
      markers.length = 0;
    };

    const setTripPinsVisible = (visible: boolean) => {
      for (const m of tripDayMarkersRef.current) {
        m.getElement().style.display = visible ? "" : "none";
      }
    };

    const onResults = (e: Event) => {
      clear();
      const map = mapRef.current;
      if (!map) return;
      const detail = (
        e as CustomEvent<{
          category: keyof typeof CATEGORY_ACCENT | null;
          places: Array<{ coords: [number, number]; title: string; id: string }>;
        }>
      ).detail;
      // Browse panel closing (or arriving with no results) → restore the
      // trip-day pins so the user has trip context again.
      if (!detail?.places?.length) {
        setTripPinsVisible(true);
        return;
      }
      // Browse open with results → hide the 66 trip pins so the browse
      // dots can read clearly without competing for attention.
      setTripPinsVisible(false);
      const color =
        (detail.category && CATEGORY_ACCENT[detail.category]) || "#c8a96e";
      const initialSize = dotSize(map.getZoom());
      for (const p of detail.places) {
        const wrapper = document.createElement("div");
        wrapper.style.cssText =
          `position:relative;display:flex;align-items:center;cursor:pointer;`;
        const dot = document.createElement("div");
        dot.style.cssText =
          `width:${initialSize}px;height:${initialSize}px;border-radius:50%;` +
          `background:${color};border:2px solid #1a1816;` +
          `box-shadow:0 0 0 1px ${color}55;flex:0 0 auto;`;
        const label = document.createElement("div");
        label.textContent = p.title;
        label.style.cssText =
          `position:absolute;left:${initialSize + 6}px;top:50%;` +
          `transform:translateY(-50%);white-space:nowrap;padding:3px 8px;` +
          `background:rgba(26,24,22,0.92);color:#F4EBE1;` +
          `font-family:var(--ff-mono),monospace;font-size:11px;` +
          `letter-spacing:0.04em;border-radius:3px;opacity:0;` +
          `pointer-events:none;transition:opacity 120ms ease;` +
          `border:1px solid ${color}66;`;
        wrapper.appendChild(dot);
        wrapper.appendChild(label);
        wrapper.addEventListener("mouseenter", () => {
          label.style.opacity = "1";
          // Lift the hovered marker so its label sits above neighbours.
          wrapper.parentElement!.style.zIndex = "10";
        });
        wrapper.addEventListener("mouseleave", () => {
          label.style.opacity = "0";
          wrapper.parentElement!.style.zIndex = "";
        });
        wrapper.addEventListener("click", () => {
          window.dispatchEvent(
            new CustomEvent("trip:flyTo", {
              detail: { coords: p.coords, name: p.title },
            }),
          );
        });
        const marker = new mapboxgl.Marker({ element: wrapper })
          .setLngLat(p.coords)
          .addTo(map);
        markers.push(marker);
      }
      map.on("zoom", applyDotSize);
    };
    window.addEventListener("trip:browseResults", onResults);
    return () => {
      window.removeEventListener("trip:browseResults", onResults);
      clear();
    };
  }, []);

  return (
    <div className="relative w-full h-full bg-bg-map">
      <div ref={containerRef} className="w-full h-full" />

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
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 flex items-center justify-center gap-1.5 h-10 rounded bg-bg-nav-btn border border-button-primary-border text-input-border-focus"
        >
          <Navigation className="w-3.5 h-3.5" />
          <span className="font-sans text-sm font-semibold">Directions</span>
        </button>
      </div>
    </DetailCard>
  );
}
