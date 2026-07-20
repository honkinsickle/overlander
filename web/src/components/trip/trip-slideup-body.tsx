"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { routeBetween } from "@/lib/routing/route-between";
import { reorderDays, applyRecompute } from "@/lib/trips/reorder-days";
import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetailCorridorColumn } from "@/components/trip/day-detail-corridor-column";
import { FindNearbyPanel } from "@/components/trip/find-nearby-panel";
import { MakeItMineCta } from "@/components/trip/make-it-mine-cta";
import { MapColumn } from "@/components/trip/map-column";
import { MapDetailOverlay } from "@/components/trip/map-detail-overlay";
import { RightEdgeToolbar } from "@/components/trip/right-edge-toolbar";
import { TopBar } from "@/components/trip/top-bar";
import { ChangeTripComposer } from "@/components/trip/change-trip-composer";
import { Sparkles } from "lucide-react";
import type { Day, Trip } from "@/lib/trips/types";

const METERS_PER_MILE = 1609.34;

const LIVING_PLAN_ON = process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT === "1";

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
  // Manual-edit mode (gated). Widens the day rail to fit each card's drag
  // handle and shifts the corridor column to make room. Toggled by a
  // TEMPORARY floating button at the bottom of the rail — the real "Edit
  // Trip" entry is a later piece.
  const [editMode, setEditMode] = useState(false);
  // Local (unpersisted) reordered day array — null until the user drags a day
  // card in the rail. Feeds the rail, corridor column, and map so the whole
  // slideup reads one order. Discarded on refresh; never written to the DB.
  const [localDays, setLocalDays] = useState<Day[] | null>(null);
  // Day ids whose miles/driveHours are being re-routed after a drop (dims
  // their card meta + blocks a second drag until settled).
  const [recomputing, setRecomputing] = useState<Set<string>>(new Set());
  const days = localDays ?? trip.days;
  const effectiveTrip = useMemo(
    () => (localDays ? { ...trip, days: localDays } : trip),
    [trip, localDays],
  );

  // Drop handler: reorder + renumber + redate (pure), then re-route the
  // endpoints that moved in parallel and merge the miles back. Local only.
  const handleReorderDay = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const current = localDays ?? trip.days;
      const { reordered, toRecompute } = reorderDays(
        current,
        from,
        to,
        trip.startDate,
        trip.startCoords ?? null,
      );
      setLocalDays(reordered); // order/number/date correct; miles still stale
      if (toRecompute.length === 0) return;
      setRecomputing(new Set(toRecompute.map((r) => r.id)));
      const results = await Promise.all(
        toRecompute.map(async (r) => {
          try {
            const rt = await routeBetween([r.start, r.end]);
            return {
              id: r.id,
              miles: Math.round(rt.distanceM / METERS_PER_MILE),
              driveHours: Math.round((rt.durationS / 3600) * 10) / 10,
            };
          } catch {
            return { id: r.id }; // leave the stale numbers on a routing failure
          }
        }),
      );
      setLocalDays((prev) => applyRecompute(prev ?? reordered, results));
      setRecomputing(new Set());
    },
    [localDays, trip.days, trip.startDate, trip.startCoords],
  );
  // Single-day selection (Phase 1 corridor integration): null = Overview
  // state, otherwise the day shown in the corridor column. The ?day= URL
  // param is the SINGLE SOURCE OF TRUTH — selection is derived from
  // useSearchParams every render, never copied into state. (The previous
  // one-shot useState seed went stale whenever the param changed under
  // the mounted segment — back/forward, tab-restore, bfcache traversals —
  // splitting the surfaces: the map followed the URL while the rail and
  // column froze. task_3e4b32c9.)
  const searchParams = useSearchParams();
  const queriedDay = searchParams.get("day");
  const selectedDayId =
    queriedDay && trip.days.some((d) => d.id === queriedDay)
      ? queriedDay
      : null;
  // Writes go through replaceState (NOT pushState — day switching must
  // not spam history). Next patches replaceState, so useSearchParams
  // re-renders every ?day= consumer (this component + MapColumn) from
  // the same URL change. `trip:activeDay` stays for the event listeners
  // that tracked the old scroll-spy (FindNearbyPanel).
  const selectDay = useCallback((dayId: string | null) => {
    const url = new URL(window.location.href);
    if (dayId) url.searchParams.set("day", dayId);
    else url.searchParams.delete("day");
    window.history.replaceState(null, "", url.toString());
    if (dayId) {
      window.dispatchEvent(
        new CustomEvent("trip:activeDay", {
          detail: { id: dayId, source: "column" },
        }),
      );
    }
  }, []);
  // Rail Guides / Places to Visit → ensure the Overview state, then ask
  // the column to scroll to that section. selectDay(null) + the bumped
  // scrollRequest batch into one commit, so the section is mounted by
  // the time the column's scroll effect fires. The nonce re-triggers the
  // scroll when the same section is tapped twice.
  const [scrollRequest, setScrollRequest] = useState<{
    anchor: "overview" | "guides" | "places";
    nonce: number;
  } | null>(null);
  // Scroll-spy: which Overview section is topmost (written by the column's
  // IntersectionObserver, read by the rail to highlight the nav item).
  // Meaningful only in Overview state; ignored while a day is selected.
  const [activeSection, setActiveSection] = useState<
    "overview" | "guides" | "places"
  >("overview");
  const selectSection = useCallback(
    (anchor: "overview" | "guides" | "places") => {
      selectDay(null);
      setScrollRequest((prev) => ({ anchor, nonce: (prev?.nonce ?? 0) + 1 }));
    },
    [selectDay],
  );
  // True while the Add-Waypoints panel (CategoryBrowsePanel) is open. When
  // it is, the top-bar search drives THAT panel's search mode, so the
  // standalone Find Nearby zero-state must not also mount (it would peek
  // out to the right of the narrower 2-up browse panel).
  const [browseOpen, setBrowseOpen] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
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
          days={days}
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

      {/* Top Bar — floating chrome (docks bottom in Collapsed). Reads the
       *  effective (reordered) trip so its total miles stay consistent with
       *  the rail/corridor after a drag. */}
      <TopBar
        trip={effectiveTrip}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        searchActive={searchActive}
        onOpenSearch={() => setSearchActive(true)}
        onCloseSearch={() => setSearchActive(false)}
        editMode={editMode}
      />

      {/* Find Nearby panel — Search Active state. Overlays the day column +
       *  day detail area below the Top Bar (per Paper frame 5WK-0).
       *  Suppressed while the Add-Waypoints panel is open — there the
       *  top-bar search drives the panel's in-place <PlaceSearch>. */}
      {searchActive && !browseOpen && (
        <div
          className="absolute top-[72px] bottom-[10px] left-[10px] w-[660px] z-30 overflow-hidden rounded-b-[14px]"
          style={{ border: "1px solid var(--border-subtle)" }}
        >
          <FindNearbyPanel
            trip={trip}
            getViewportBbox={() => viewportBboxRef.current}
          />
        </div>
      )}

      {/* Body overlays — hidden in Collapsed (fullscreen-map mode).
       *  Corridor layout (Phase 1): 660 total = 182 rail + 478 day
       *  column (--rail-column-w — v4 is tuned to it; the slot fits v4,
       *  not the reverse). */}
      {!collapsed && (
        <>
          {/* Day Column Planner — translucent overlay (#0C0D0F @ 59%),
           *  wired as the day-selector for the corridor column. */}
          <div
            className={`absolute top-[72px] bottom-[10px] left-[10px] ${
              editMode ? "w-[229px]" : "w-[182px]"
            } z-20 overflow-hidden rounded-bl-[14px]`}
            style={{
              background: "rgba(12,13,15,0.59)",
              borderRight: "0.5px solid rgba(74,72,72,0.83)",
            }}
          >
            <DayColumnPlanner
              tripId={trip.id}
              days={days}
              overlay
              editMode={editMode}
              activeDayId={selectedDayId}
              activeSection={selectedDayId === null ? activeSection : null}
              onSelectDay={(id) => selectDay(id)}
              onScrollTo={selectSection}
              onReorderDay={handleReorderDay}
              recomputingIds={recomputing}
              busy={recomputing.size > 0}
            />
            {/* TEMPORARY edit-mode toggle — floats at the bottom of the day
             *  column so the drag handles are viewable before the real "Edit
             *  Trip" entry exists. Gated + remove when the entry lands. */}
            {LIVING_PLAN_ON && (
              <button
                type="button"
                onClick={() => setEditMode((e) => !e)}
                className="absolute bottom-3 right-3 z-30 font-sans rounded-full border shadow-lg transition-colors"
                style={{
                  padding: "8px 16px",
                  fontSize: 13,
                  color: editMode ? "var(--bg-base)" : "var(--amber-light)",
                  backgroundColor: editMode
                    ? "var(--amber-light)"
                    : "var(--bg-card)",
                  borderColor: "var(--amber-light)",
                }}
              >
                {editMode ? "Done" : "Edit"}
              </button>
            )}
          </div>

          {/* Day Detail column — single-day corridor view (v4) or the
           *  Overview state; translucent overlay matched to Day Column. */}
          <div
            className={`absolute top-[72px] bottom-[10px] ${
              editMode ? "left-[239px] w-[511px]" : "left-[192px] w-[478px]"
            } z-20 overflow-hidden rounded-br-[15px]`}
            style={{
              background: "color-mix(in srgb, var(--bg-card) 59%, transparent)",
              borderRight: "1px solid var(--border-subtle)",
            }}
          >
            <DayDetailCorridorColumn
              trip={effectiveTrip}
              selectedDayId={selectedDayId}
              scrollRequest={scrollRequest}
              onActiveSection={setActiveSection}
              editMode={editMode}
            />
          </div>
        </>
      )}

      {/* Right-Edge Toolbar */}
      <RightEdgeToolbar />

      {/* Living-plan CHANGE-TRIP box (dev-gated) — a dedicated command surface,
       *  separate from search. Floating trigger → centered composer. */}
      {LIVING_PLAN_ON && (
        <>
          {!changeOpen && (
            <button
              type="button"
              onClick={() => setChangeOpen(true)}
              className="absolute z-40 flex items-center"
              style={{
                bottom: 24,
                left: "50%",
                transform: "translateX(-50%)",
                gap: 8,
                padding: "10px 18px",
                borderRadius: 999,
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--amber-dark)",
                color: "var(--amber)",
                fontFamily: "var(--ff-display)",
                fontSize: 12,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}
            >
              <Sparkles className="w-4 h-4" />
              Change this trip
            </button>
          )}
          {changeOpen && (
            <div
              className="absolute inset-0 z-40 flex items-center justify-center"
              style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
              onClick={() => setChangeOpen(false)}
            >
              <div onClick={(e) => e.stopPropagation()}>
                <ChangeTripComposer tripId={trip.id} onClose={() => setChangeOpen(false)} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

