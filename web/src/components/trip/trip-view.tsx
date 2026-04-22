"use client";

import Link from "next/link";
import { DayHeader } from "@/components/trip/day-header";
import { WaypointCard } from "@/components/trip/waypoint-card";
import { OvernightSection } from "@/components/trip/overnight-section";
import type { Trip } from "@/lib/trips/types";

export function TripView({ trip }: { trip: Trip }) {
  const totalStops = trip.days.reduce((n, d) => n + d.waypoints.length, 0);

  return (
    <div className="flex flex-col h-full">
      <header className="h-[60px] flex items-center px-5 border-b border-border-subtle">
        <span className="section-label text-sm">{trip.title}</span>
      </header>

      <div className="flex-1 flex flex-col gap-5 p-5 overflow-y-auto">
        <section className="flex flex-col gap-3">
          <div className="section-label">Explore</div>
          <input
            type="text"
            placeholder="Ask about anything"
            className="form-field w-full"
          />
        </section>

        <section className="flex flex-col gap-3">
          <div className="section-label">Itinerary</div>
          {trip.days.map((day) => (
            <div key={day.id} className="flex flex-col gap-3">
              <DayHeader tripId={trip.id} day={day} />
              {day.waypoints.map((wp) => (
                <WaypointCard key={wp.id} tripId={trip.id} waypoint={wp} />
              ))}
              <OvernightSection tripId={trip.id} day={day} />
            </div>
          ))}
        </section>
      </div>

      <footer className="h-[75px] flex items-center justify-between px-5 border-t border-border-subtle">
        <span className="text-text-muted font-mono text-xs">
          {totalStops} stops
        </span>
        <Link
          href={`/trip/${trip.id}/ask`}
          className="px-4 py-2 rounded text-text-primary bg-button-primary hover:bg-button-primary-hover border border-button-primary-border"
        >
          Open Ask →
        </Link>
      </footer>
    </div>
  );
}
