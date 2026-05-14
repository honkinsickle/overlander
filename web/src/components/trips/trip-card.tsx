import Link from "next/link";
import type { UserTripSummary } from "@/lib/trips/list-user-trips";

const STATE_LABELS: Record<UserTripSummary["state"], string> = {
  draft: "Draft",
  active: "Active",
  logged: "Logged",
};

const STATE_COLORS: Record<UserTripSummary["state"], string> = {
  draft: "bg-bg-nav-btn text-text-secondary",
  active: "bg-amber/20 text-amber",
  logged: "bg-bg-nav-btn text-text-primary",
};

export function TripCard({ trip }: { trip: UserTripSummary }) {
  return (
    <Link
      href={`/trip/${trip.id}`}
      className="group flex gap-4 p-4 rounded-lg bg-bg-panel border border-border-subtle hover:border-amber/60 transition-colors"
    >
      <div
        className="w-32 h-24 rounded shrink-0 bg-cover bg-center bg-bg-nav-btn"
        style={
          trip.heroImage ? { backgroundImage: `url(${trip.heroImage})` } : undefined
        }
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg leading-tight truncate text-text-primary group-hover:text-amber transition-colors">
            {trip.title}
          </h3>
          <span
            className={`font-mono text-[10px] tracking-[0.14em] uppercase px-2 py-0.5 rounded shrink-0 ${STATE_COLORS[trip.state]}`}
          >
            {STATE_LABELS[trip.state]}
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
    </Link>
  );
}

function formatDateRange(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  return `${fmt(start)} – ${fmt(end)}`;
}
