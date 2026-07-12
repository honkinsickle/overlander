"use client";

import { useSearchParams } from "next/navigation";
import { DayDetailCorridorColumn } from "@/components/trip/day-detail-corridor-column";
import type { Trip } from "@/lib/trips/types";

/**
 * Full-page (`/trip/[id]`) center column. Thin client wrapper that reads
 * the selected day from the `?day=` URL param and renders the SAME
 * corridor renderer the slideup uses (`DayDetailCorridorColumn`) — one
 * day-column renderer across both surfaces (enforced by the drift-guard
 * test `day-column-renderer-drift.test.ts`).
 *
 * `?day=` is the shared source of truth between this column, the layout's
 * day rail (`FullPageDayRail`), and `MapColumn`; all three read it via
 * `useSearchParams`, which Next's App Router keeps in sync with the
 * `history.replaceState` writes the rail makes on selection — no RSC
 * refetch, no event bus. Absent/invalid `?day=` → Overview state (null),
 * matching the slideup's default.
 */
export function FullPageDayDetail({ trip }: { trip: Trip }) {
  const searchParams = useSearchParams();
  const queried = searchParams.get("day");
  const selectedDayId =
    queried && trip.days.some((d) => d.id === queried) ? queried : null;

  return <DayDetailCorridorColumn trip={trip} selectedDayId={selectedDayId} />;
}
