"use client";

import { useEffect, useRef, useState } from "react";
import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetail } from "@/components/trip/day-detail";
import { FindNearbyPanel } from "@/components/trip/find-nearby-panel";
import { MakeItMineCta } from "@/components/trip/make-it-mine-cta";
import { MapColumn } from "@/components/trip/map-column";
import { MapDetailOverlay } from "@/components/trip/map-detail-overlay";
import { RightEdgeToolbar } from "@/components/trip/right-edge-toolbar";
import { TopBar } from "@/components/trip/top-bar";
import type { Trip } from "@/lib/trips/types";

/**
 * Map-as-background slideup body. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md — Default + Collapsed states).
 *
 * Two states wired here:
 *   - Default:   Map canvas + DayColumn/DayDetail translucent overlays +
 *                top-anchored Top Bar + Right-Edge Toolbar
 *   - Collapsed: Map canvas + bottom-anchored Top Bar + Right-Edge Toolbar.
 *                Overlays hidden. Toggled by the Top Bar chevron.
 */
export function TripSlideupBody({
  trip,
  isReference,
  isAuthed,
}: {
  trip: Trip;
  isReference: boolean;
  isAuthed: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  // True while the Add-Waypoints panel (CategoryBrowsePanel) is open. When
  // it is, the top-bar search drives THAT panel's search mode, so the
  // standalone Find Nearby zero-state must not also mount (it would peek
  // out to the right of the narrower 2-up browse panel).
  const [browseOpen, setBrowseOpen] = useState(false);
  const toggleCollapsed = () => setCollapsed((c) => !c);

  // Latest map viewport bbox [W,S,E,N], updated on every pan/zoom via the
  // MapColumn callback. Held in a ref so map moves don't re-render the body;
  // the top-level search reads it at query time ("search this area").
  const viewportBboxRef = useRef<[number, number, number, number] | null>(null);

  useEffect(() => {
    if (!searchActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSearchActive(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchActive]);

  useEffect(() => {
    const onBrowseOpen = (e: Event) => {
      const open = (e as CustomEvent<{ open: boolean }>).detail?.open;
      if (typeof open === "boolean") setBrowseOpen(open);
    };
    window.addEventListener("trip:browseOpen", onBrowseOpen);
    return () => window.removeEventListener("trip:browseOpen", onBrowseOpen);
  }, []);

  return (
    <div className="relative w-full h-full">
      {/* Map canvas — fills the slideup */}
      <div className="absolute inset-0" aria-label="Map">
        <MapColumn
          tripId={trip.id}
          days={trip.days}
          startCoords={trip.startCoords}
          routePolyline={trip.routePolyline}
          onMoveEnd={(bbox) => {
            viewportBboxRef.current = bbox;
            // Let the top-level search refresh against the new viewport. Only
            // the search results consume this; the idle palette ignores it.
            window.dispatchEvent(new CustomEvent("trip:viewportMoved"));
          }}
        />
        <MapDetailOverlay />
        {isReference && (
          <MakeItMineCta
            referenceId={trip.id}
            isAuthed={isAuthed}
            returnPath={`/trip/${trip.id}`}
          />
        )}
      </div>

      {/* Top Bar — floating chrome (docks bottom in Collapsed) */}
      <TopBar
        trip={trip}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        searchActive={searchActive}
        onOpenSearch={() => setSearchActive(true)}
        onCloseSearch={() => setSearchActive(false)}
      />

      {/* Find Nearby panel — Search Active state. Overlays the day column +
       *  day detail area below the Top Bar (per Paper frame 5WK-0).
       *  Suppressed while the Add-Waypoints panel is open — there the
       *  top-bar search drives the panel's in-place <PlaceSearch>. */}
      {searchActive && !browseOpen && (
        <div
          className="absolute top-[72px] bottom-[10px] left-[10px] w-[662px] z-30 overflow-hidden rounded-b-[14px]"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <FindNearbyPanel
            trip={trip}
            getViewportBbox={() => viewportBboxRef.current}
          />
        </div>
      )}

      {/* Body overlays — hidden in Collapsed (fullscreen-map mode) */}
      {!collapsed && (
        <>
          {/* Day Column Planner — translucent overlay (#0C0D0F @ 59%) */}
          <div
            className="absolute top-[72px] bottom-[10px] left-[10px] w-[183px] z-20 overflow-hidden rounded-bl-[14px]"
            style={{
              background: "rgba(12,13,15,0.59)",
              borderRight: "0.5px solid rgba(74,72,72,0.83)",
            }}
          >
            <DayColumnPlanner tripId={trip.id} days={trip.days} overlay />
          </div>

          {/* Day Detail — translucent overlay matched to Day Column (#161819 @ 59%).
           *  Interior treatments per design:
           *    - Day headers (bg-bg-panel) stay opaque #111214 — no override
           *    - Waypoint cards (article.bg-bg-card) become #000000 @ 40% so the
           *      wrapper's translucency reads through behind them
           *    - "ITINERARY" label section (also bg-bg-card) inherits the same */}
          <div
            className="absolute top-[72px] bottom-[10px] left-[227px] w-[445px] z-20 overflow-hidden rounded-br-[15px] [&_.bg-bg-card]:!bg-black/40"
            style={{
              background: "color-mix(in srgb, var(--bg-card) 59%, transparent)",
              borderRight: "1px solid var(--border-subtle)",
            }}
          >
            <DayDetail trip={trip} />
          </div>
        </>
      )}

      {/* Right-Edge Toolbar */}
      <RightEdgeToolbar />
    </div>
  );
}

