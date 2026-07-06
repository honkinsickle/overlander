import { DayDetailCorridor } from "@/components/trip/day-detail-corridor";
import { deriveCorridorCities } from "@/lib/corridor/derive";
import gazetteer from "@/lib/corridor/data/cities-na.json";

/**
 * THROWAWAY scratch route — Day Detail v4 corridor view fed the REAL
 * deriveCorridorCities() output (actual gazetteer, sample LA→Santa Barbara
 * polyline) instead of hand-written dummy nodes. placeIds are empty until
 * place→node bucketing ships (spec §2.3, deferred), so the corridor renders
 * as a bare spine: city nodes + mileage, no tiles. Drop before merge.
 */

const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";
const HERO = `${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif`;

/** Rough US-101 LA→Santa Barbara polyline (same fixture as
 *  scripts/smoke-corridor-cities.ts's little sibling — enough vertices for
 *  a realistic projection, not a real Mapbox route). */
const LINE: [number, number][] = [
  [-118.24, 34.05],
  [-118.45, 34.03],
  [-118.7, 34.03],
  [-118.92, 34.08],
  [-119.1, 34.17],
  [-119.29, 34.28],
  [-119.48, 34.37],
  [-119.7, 34.42],
];

export default function DayDetailCorridorDemo() {
  const cities = deriveCorridorCities({
    line: LINE,
    start: { name: "Los Angeles, CA", coords: [-118.24, 34.05] },
    end: { name: "Santa Barbara, CA", coords: [-119.7, 34.42] },
    gazetteer,
  });

  return (
    <main className="flex min-h-screen" style={{ backgroundColor: "var(--bg-map)" }}>
      <DayDetailCorridor
        dayLabel="Day 1 — Sat, May 30th"
        dayNumber={1}
        routeLabel="Los Angeles, CA — Santa Barbara, CA"
        heroImageUrl={HERO}
        heroAlt="Los Angeles to Santa Barbara"
        cities={cities ?? []}
        places={[]}
      />
    </main>
  );
}
