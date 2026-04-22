"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
import type { Waypoint } from "@/lib/trips/types";

/**
 * Right-side map column. Persists across center-column nav.
 *
 * URL contract:
 *   ?panel=waypoint&id=<slug> → fetches /api/trips/:id/waypoints/:slug
 *     - loading → DetailCardSkeleton
 *     - 404     → inline "not found" state (less disruptive than page 404)
 *     - 5xx/net → inline error state with Retry + Dismiss
 *     - success → DetailCard
 *
 * Dev-only debug:
 *   &simulate=error   → API returns 500 (tests error state)
 *   &simulate=timeout → API sleeps 5s then returns 504
 */
export function MapColumn({ tripId }: { tripId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const panel = searchParams.get("panel");
  const slug = panel === "waypoint" ? searchParams.get("id") : null;
  const simulateParam = searchParams.get("simulate");
  const simulate =
    simulateParam === "error" || simulateParam === "timeout"
      ? simulateParam
      : null;

  const state = useWaypointDetail(tripId, slug, { simulate });

  const closeHref = `/trip/${tripId}`;
  const dismiss = () => router.push(closeHref, { scroll: false });

  return (
    <div className="relative w-full h-full bg-bg-map">
      <div className="absolute inset-0 flex items-center justify-center text-text-muted section-label text-sm">
        Map column
      </div>

      {slug && (
        <div className="absolute inset-x-4 bottom-5 pointer-events-auto">
          {state.status === "loading" && <DetailCardSkeleton />}
          {state.status === "success" && (
            <WaypointDetail
              tripId={tripId}
              waypoint={state.data}
              closeHref={closeHref}
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
  closeHref,
}: {
  tripId: string;
  waypoint: Waypoint;
  closeHref: string;
}) {
  return (
    <DetailCard
      category={waypoint.category}
      title={waypoint.title}
      subtitle={waypoint.subtitle}
      closeHref={closeHref}
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
