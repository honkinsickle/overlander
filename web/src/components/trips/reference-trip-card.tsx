import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReferenceTripSummary } from "@/lib/trips/list-reference-trips";

/** Pinned card at the top of /trips for a reference trip the user
 *  hasn't forked yet (or wants to revisit the canonical version of).
 *  Same visual rhythm as TripCard — 128×96 hero, title, locations,
 *  date range, day count — but no state pill, no kebab. Tapping
 *  navigates to /trip/<slug>. */
export function ReferenceTripCard({ trip }: { trip: ReferenceTripSummary }) {
  return (
    <Link
      href={`/trip/${trip.id}`}
      className="relative flex gap-4 p-4 rounded-lg bg-bg-panel border border-border-subtle hover:border-amber/60 transition-colors group"
    >
      <div
        className="w-32 h-24 rounded shrink-0 bg-cover bg-center bg-bg-nav-btn"
        style={
          trip.heroImage
            ? { backgroundImage: `url(${trip.heroImage})` }
            : undefined
        }
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <span className="font-display text-lg leading-tight truncate text-text-primary group-hover:text-amber transition-colors">
            {trip.title}
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] uppercase text-amber px-2 py-0.5 rounded bg-amber/10 border border-amber/30 whitespace-nowrap">
            Reference
          </span>
        </div>
        <p className="font-sans text-sm text-text-secondary truncate">
          {trip.startLocation} → {trip.endLocation}
        </p>
        <p className="font-mono text-[11px] tracking-[0.12em] text-text-secondary/80">
          {formatDateRange(trip.startDate, trip.endDate)} · {trip.dayCount}{" "}
          {trip.dayCount === 1 ? "day" : "days"}
        </p>
      </div>
      <ArrowRight
        className="w-4 h-4 self-center shrink-0 text-text-secondary group-hover:text-amber transition-colors"
        strokeWidth={1.75}
      />
    </Link>
  );
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(s)} – ${fmt(e)}`;
}
