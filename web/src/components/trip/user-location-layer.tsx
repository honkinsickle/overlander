"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { Locate, LocateFixed } from "lucide-react";
import { useUserLocation } from "@/lib/location/use-user-location";
import { snapToRoute } from "@/lib/location/snap-to-route";

/** Distance from the planned route (mi) within which the user-location
 *  marker is snapped onto the polyline. Beyond this, raw GPS is shown.
 *  Chosen empirically: typical highway GPS noise is <0.1mi, so 0.25mi
 *  swallows jitter while not falsely snapping when the user actually
 *  detours onto a side road. */
const SNAP_THRESHOLD_MI = 0.25;

/** Nav-style zoom for camera-follow. Tight enough to see road labels
 *  and the next maneuver, wide enough to keep some context. */
const FOLLOW_ZOOM = 16;

/** Mapbox flyTo/easeTo wrapper that subtracts the directions panel's
 *  occluded area from the map's effective viewport via the `padding`
 *  option. Without this the dot flies to the geometric map center —
 *  which sits behind the panel — and the user's surroundings end up
 *  off-screen. When the panel is closed (or absent), padding is zero
 *  so the dot lands at the true center. */
function panelAwareFly(
  map: mapboxgl.Map,
  coord: [number, number],
  zoom: number,
  duration: number,
  mode: "fly" | "ease",
): void {
  // setTimeout(0) defers past React's commit phase so the panel's
  // open-state data attribute is in the DOM before we read it. rAF
  // wasn't enough in practice.
  setTimeout(() => {
    const panel = document.querySelector(
      '[data-directions-panel="open"]',
    ) as HTMLElement | null;
    // Use offsetHeight (intrinsic) not getBoundingClientRect.height —
    // the panel slides up over 300ms, so mid-transition the rect would
    // give a partial height. offsetHeight is transform-independent.
    const bottomPad = panel?.offsetHeight ?? 0;
    const opts = {
      center: coord,
      zoom,
      duration,
      essential: true,
      padding: { top: 0, right: 0, bottom: bottomPad, left: 0 },
    };
    if (mode === "ease") map.easeTo(opts);
    else map.flyTo(opts);
  }, 0);
}

/** Build the DOM element for the user-location marker — a blue dot with
 *  a heading cone that points in the direction of travel when heading
 *  is known. Returns the marker plus a helper to update the cone. */
function makeUserLocationMarker(): {
  marker: mapboxgl.Marker;
  setHeading: (deg: number | null) => void;
} {
  const wrapper = document.createElement("div");
  // No `position` set — mapboxgl applies position:absolute itself and
  // uses transforms for placement. Adding our own `position:relative`
  // breaks that and pushes the marker into document flow (off-canvas).
  // Children with position:absolute still anchor to this wrapper since
  // mapbox's position:absolute makes it a containing block.
  wrapper.style.cssText = "width:18px;height:18px;";

  // Heading cone — base sits at the dot center, tip extends 24px outward
  // in the heading direction. Hidden when heading is unknown (stationary
  // or device lacks compass). transform-origin = base midpoint so the
  // cone pivots cleanly around the dot.
  const cone = document.createElement("div");
  cone.style.cssText =
    "position:absolute;left:-1px;top:-15px;width:0;height:0;display:none;" +
    "border-left:10px solid transparent;" +
    "border-right:10px solid transparent;" +
    "border-bottom:24px solid rgba(66,133,244,0.55);" +
    "transform-origin:10px 24px;transform:rotate(0deg);";

  const dot = document.createElement("div");
  dot.style.cssText =
    "position:absolute;top:2px;left:2px;width:14px;height:14px;" +
    "border-radius:50%;background:#4285F4;border:2px solid #fff;" +
    "box-shadow:0 0 0 1px rgba(0,0,0,0.18), 0 2px 4px rgba(0,0,0,0.3);";

  wrapper.appendChild(cone);
  wrapper.appendChild(dot);

  const marker = new mapboxgl.Marker({ element: wrapper });
  return {
    marker,
    setHeading: (deg) => {
      if (deg == null || Number.isNaN(deg)) {
        cone.style.display = "none";
      } else {
        cone.style.display = "block";
        cone.style.transform = `rotate(${deg}deg)`;
      }
    },
  };
}

/** User-location marker + follow-toggle button. Auto-mounts a blue dot
 *  when the browser already has geolocation permission granted; the
 *  button doubles as the opt-in trigger when permission is still in
 *  `prompt` state. Camera-follow centers the map on every position
 *  update and auto-disengages on user pan/zoom. */
export function UserLocationLayer({
  map,
  routePathRef,
}: {
  map: mapboxgl.Map;
  routePathRef: { current: [number, number][] | null };
}) {
  const { status, position, heading, request } = useUserLocation();
  const [following, setFollowing] = useState(false);
  const markerRef = useRef<ReturnType<typeof makeUserLocationMarker> | null>(
    null,
  );

  // Single effect handles mount, position updates, heading updates, and
  // follow-mode camera pan. Marker is created the first time we have a
  // position (mapbox `addTo` reads the marker's internal lngLat, so we
  // can't add a marker without a position to anchor it to). When status
  // drops out of "watching", the marker is torn down so a re-grant
  // remounts it fresh.
  useEffect(() => {
    if (status !== "watching" || !position) {
      if (markerRef.current) {
        markerRef.current.marker.remove();
        markerRef.current = null;
      }
      return;
    }
    const snap = snapToRoute(
      position,
      routePathRef.current,
      SNAP_THRESHOLD_MI,
    );
    if (!markerRef.current) {
      const m = makeUserLocationMarker();
      m.marker.setLngLat(snap.coord).addTo(map);
      markerRef.current = m;
    } else {
      markerRef.current.marker.setLngLat(snap.coord);
    }
    // Mapbox forces `pointer-events: auto` on marker wrappers, which
    // makes the dot eat scroll-wheel/pinch events and breaks map zoom
    // when the cursor is over it. Override on every update so the dot
    // stays purely decorative — cheap and idempotent.
    markerRef.current.marker
      .getElement()
      .style.setProperty("pointer-events", "none", "important");
    markerRef.current.setHeading(heading);
    if (following) {
      panelAwareFly(map, snap.coord, map.getZoom(), 500, "ease");
    }
    // routePathRef is a ref — stable identity, doesn't need to be in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, position, heading, following, map]);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (markerRef.current) {
        markerRef.current.marker.remove();
        markerRef.current = null;
      }
    };
  }, []);

  // Auto-disable follow when the user drags or zooms the map manually.
  // Programmatic flyTo/easeTo doesn't carry an originalEvent, so the
  // self-initiated camera move that follow itself triggers is filtered
  // out cleanly.
  useEffect(() => {
    if (!following) return;
    const onUserMove = (e: unknown) => {
      // `zoomstart`/`dragstart` carry an `originalEvent` only when the
      // user kicked them off; programmatic flyTo/easeTo omits it.
      if ((e as { originalEvent?: Event }).originalEvent) {
        setFollowing(false);
      }
    };
    map.on("dragstart", onUserMove);
    map.on("zoomstart", onUserMove);
    return () => {
      map.off("dragstart", onUserMove);
      map.off("zoomstart", onUserMove);
    };
  }, [following, map]);

  // External control: the nav-go button dispatches `trip:setFollow`
  // when entering/leaving nav mode. We need request() to fire if the
  // user is still in 'prompt' state, so go-button also doubles as a
  // permission trigger.
  useEffect(() => {
    const onSetFollow = (e: Event) => {
      const detail = (e as CustomEvent<{ follow: boolean }>).detail;
      if (!detail) return;
      if (detail.follow) {
        // Always call request(): idempotent on watching/unsupported, retries
        // watchPosition on denied so a user who clears the URL-bar denial
        // mid-session can re-engage without a reload.
        request();
        if (position) {
          const snap = snapToRoute(
            position,
            routePathRef.current,
            SNAP_THRESHOLD_MI,
          );
          panelAwareFly(
            map,
            snap.coord,
            Math.max(map.getZoom(), FOLLOW_ZOOM),
            700,
            "fly",
          );
        }
        setFollowing(true);
      } else {
        setFollowing(false);
      }
    };
    window.addEventListener("trip:setFollow", onSetFollow);
    return () => window.removeEventListener("trip:setFollow", onSetFollow);
    // routePathRef is a ref — stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, position, map, request]);

  if (status === "unsupported" || status === "denied") return null;

  const onFollowClick = () => {
    if (status === "idle") {
      // First-time opt-in: trigger the browser prompt. Once granted, the
      // watchPosition callback flips status → "watching" and the marker
      // mounts. User taps again to engage camera-follow.
      request();
      return;
    }
    if (status !== "watching") return;
    if (following) {
      setFollowing(false);
      return;
    }
    if (position) {
      const snap = snapToRoute(
        position,
        routePathRef.current,
        SNAP_THRESHOLD_MI,
      );
      panelAwareFly(
        map,
        snap.coord,
        Math.max(map.getZoom(), FOLLOW_ZOOM),
        700,
        "fly",
      );
    }
    setFollowing(true);
  };

  const Icon = following ? LocateFixed : Locate;
  const label =
    status === "idle"
      ? "Enable location"
      : following
        ? "Stop following location"
        : "Follow my location";

  return (
    <div className="absolute top-4 right-4 z-10 pointer-events-auto">
      <button
        type="button"
        onClick={onFollowClick}
        aria-label={label}
        title={label}
        className={`w-10 h-10 rounded-full flex items-center justify-center shadow-md transition-colors ${
          following
            ? "bg-[#4285F4] text-white border border-[#4285F4]"
            : "bg-bg-nav-btn/90 border border-button-primary-border text-input-border-focus hover:text-text-main"
        }`}
      >
        <Icon className="w-5 h-5" />
      </button>
    </div>
  );
}
