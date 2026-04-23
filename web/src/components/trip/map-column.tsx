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
import type { Day, Waypoint } from "@/lib/trips/types";

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
}: {
  tripId: string;
  days: Day[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

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
    const firstWithCoords = days.find((d) => d.coords);
    const center = firstWithCoords?.coords ?? [-121.5, 45];
    const map = new mapboxgl.Map({
      container: el,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom: 6,
      attributionControl: false,
    });
    mapRef.current = map;

    const routeCoords = days
      .map((d) => d.coords)
      .filter((c): c is [number, number] => !!c);

    days.forEach((d) => {
      if (!d.coords) return;
      new mapboxgl.Marker({ color: "#c8a96e" })
        .setLngLat(d.coords)
        .addTo(map);
    });

    if (routeCoords.length >= 2) {
      const controller = new AbortController();
      map.on("load", async () => {
        // Road-following route via Mapbox Directions API.
        // Falls back to straight lines if the API fails.
        const coordsPath = routeCoords
          .map((c) => `${c[0]},${c[1]}`)
          .join(";");
        const url =
          `https://api.mapbox.com/directions/v5/mapbox/driving/${coordsPath}` +
          `?geometries=geojson&overview=full` +
          `&access_token=${mapboxgl.accessToken}`;

        let geometry: GeoJSON.Geometry = {
          type: "LineString",
          coordinates: routeCoords,
        };
        try {
          const res = await fetch(url, { signal: controller.signal });
          if (res.ok) {
            const json = (await res.json()) as {
              routes?: { geometry: GeoJSON.Geometry }[];
            };
            if (json.routes?.[0]?.geometry) geometry = json.routes[0].geometry;
          }
        } catch {
          /* keep straight-line fallback */
        }

        if (!mapRef.current) return; // unmounted mid-fetch
        map.addSource("trip-route", {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry },
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

  // Fly to the active day whenever ?day= changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !activeDay?.coords) return;
    map.flyTo({
      center: activeDay.coords,
      zoom: 8,
      duration: 1500,
      essential: true,
    });
  }, [activeDay?.id, activeDay?.coords]);

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
