import { DayColumnPlanner } from "@/components/trip/day-column-planner";
import { DayDetail } from "@/components/trip/day-detail";
import { MakeItMineCta } from "@/components/trip/make-it-mine-cta";
import { MapColumn } from "@/components/trip/map-column";
import { MapDetailOverlay } from "@/components/trip/map-detail-overlay";
import { RightEdgeToolbar } from "@/components/trip/right-edge-toolbar";
import { TopBar } from "@/components/trip/top-bar";
import type { Trip } from "@/lib/trips/types";

/**
 * Map-as-background slideup body. Per v2 spec
 * (docs/design/slideup-overlay-states-v2.md — Default state).
 *
 * Layout:
 *   - MapColumn fills the slideup viewport as canvas
 *   - DayColumnPlanner: translucent overlay at (10, 72), 217w × bottom-10
 *   - DayDetail:        translucent overlay at (227, 72), 445w × bottom-10
 *   - TopBar:           floating chrome top-left
 *   - RightEdgeToolbar: floating chrome right edge
 *   - TripActionFab:    floating chrome bottom-right
 *
 * Server-pure: no Supabase imports, no async work. The wizard-finalize
 * caller is a client component, so anything this module imports ends
 * up in the client bundle. `isReference` and `isAuthed` are decided at
 * the call site and passed in.
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
  return (
    <div className="relative w-full h-full">
      {/* Map canvas — fills the slideup */}
      <div className="absolute inset-0" aria-label="Map">
        <MapColumn
          tripId={trip.id}
          days={trip.days}
          startCoords={trip.startCoords}
          routePolyline={trip.routePolyline}
          trip={trip}
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

      {/* Top Bar — floating chrome */}
      <TopBar trip={trip} />

      {/* Day Column Planner — translucent overlay (#0C0D0F @ 59%) */}
      <div
        className="absolute top-[72px] bottom-[10px] left-[10px] w-[217px] z-20 overflow-hidden rounded-bl-[14px]"
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
          background: "rgba(22,24,25,0.59)",
          borderRight: "1px solid rgba(255,255,255,0.07)",
        }}
      >
        <DayDetail trip={trip} />
      </div>

      {/* Right-Edge Toolbar */}
      <RightEdgeToolbar />
    </div>
  );
}
