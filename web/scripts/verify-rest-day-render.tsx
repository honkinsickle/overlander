/**
 * CARRIED ITEM 1 (observed, not implied): does a LAYOVER day's mp: corpus
 * segmentSuggestions actually surface in the view-mode corridor render?
 *
 * The render is a pure function of the day's data, so no browser/auth is needed:
 * pull REAL mp: tiles from the TEST corpus at an LA point (where the LA-only reseed
 * has coverage), attach them to the real layover shape insertRestDay produces
 * (corridorCities undefined, start === end), derive props via the column's OWN
 * helpers (fallbackCorridor / placePool), renderToString the REAL DayDetailCorridor,
 * and count how many suggestion titles appear in the output HTML.
 *
 *   cd web && npx tsx --env-file=.env.development.local scripts/verify-rest-day-render.tsx
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createClient } from "@supabase/supabase-js";
import { fetchCorpusForSegment } from "@/lib/trips/bake-corridors";
import { rankNearbySuggestions, isRestDay } from "@/lib/trips/rest-day";
import {
  fallbackCorridor,
  placePool,
} from "@/components/trip/day-detail-corridor-column";
import { DayDetailCorridor } from "@/components/trip/day-detail-corridor";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import type { Day, Trip } from "@/lib/trips/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(url, key, { auth: { persistSession: false } });

const LA: [number, number] = [-118.2437, 34.0522];

function renderDay(day: Day): string {
  return renderToString(
    createElement(DayDetailCorridor, {
      dayLabel: `Day ${day.dayNumber}`,
      dayNumber: day.dayNumber,
      routeLabel: day.label,
      cities: day.corridorCities ?? fallbackCorridor(day),
      places: placePool(day),
      editMode: false,
      restDay: isRestDay(day),
    }),
  );
}

/** APPARATUS CONTROL: does a NORMAL generated day render its own segmentSuggestion
 *  titles? If it also shows 0, "suggestions don't render" is a general corridor-view
 *  property (empty placeIds → no tiles), not something specific to a layover. */
async function control() {
  const { data } = await client
    .from("reference_trips")
    .select("payload")
    .eq("id", "expedition-ms28y793")
    .single();
  const trip = (data as { payload: Trip }).payload;
  const day = trip.days.find(
    (d) => (d.corridorCities?.length ?? 0) > 0 && (d.segmentSuggestions?.length ?? 0) > 0,
  );
  if (!day) {
    console.log("CONTROL: no normal day with both corridorCities + segmentSuggestions found");
    return;
  }
  const titles = (day.segmentSuggestions ?? []).map((s) => s.title);
  const html = renderDay(day);
  const shown = titles.filter((t) => t && html.includes(t));
  console.log(
    `CONTROL (normal day-${day.dayNumber}, ${day.corridorCities?.length} nodes, ${titles.length} tiles): ${shown.length}/${titles.length} tile titles rendered\n`,
  );
}

async function main() {
  await control();

  // Real corpus tiles at an LA stop, ranked exactly as insertRestDay does.
  let tiles = await fetchCorpusForSegment(LA, LA, client as Parameters<typeof fetchCorpusForSegment>[2]);
  console.log(`TEST corpus at LA returned ${tiles.length} tiles`);
  if (tiles.length === 0) {
    // Coverage gap — fall back to synthetic mp: tiles so the RENDER question is
    // still answered (render is data-driven; provenance is irrelevant to it).
    console.log("→ no TEST coverage; using synthetic mp: tiles for the render probe");
    tiles = [
      { id: "mp:syn-1", title: "Griffith Observatory", coords: [-118.3004, 34.1184], photoAlt: "", category: "interest" },
      { id: "mp:syn-2", title: "The Broad Museum", coords: [-118.2506, 34.0546], photoAlt: "", category: "interest" },
      { id: "mp:syn-3", title: "Grand Central Market", coords: [-118.2487, 34.0505], photoAlt: "", category: "food" },
    ] as unknown as BrowsePlace[];
  }
  const ranked = rankNearbySuggestions(LA, tiles);
  const titles = ranked.map((t) => t.title);
  console.log(`ranked → ${ranked.length} suggestions: ${titles.slice(0, 5).join(" | ")}${titles.length > 5 ? " …" : ""}`);

  // The real layover shape insertRestDay writes.
  const layover: Day = {
    id: "day-2",
    dayNumber: 2,
    date: "2026-08-05",
    label: "Rest day — Los Angeles, CA",
    startCoord: LA,
    coords: LA,
    miles: 0,
    driveHours: 0,
    corridorCities: undefined,
    waypoints: [],
    segmentSuggestions: ranked,
  };

  // Props derived exactly as renderViewDay derives them.
  const cities = fallbackCorridor(layover);
  const places = placePool(layover);
  console.log(`fallbackCorridor(layover) → ${cities.length} node(s): ${cities.map((c) => `${c.kind}:${c.name}`).join(", ")}`);
  console.log(`placePool(layover) → ${places.length} tiles enter the pool`);

  const html = renderToString(
    createElement(DayDetailCorridor, {
      dayLabel: "Day 2 — Tue, Aug 5th",
      dayNumber: 2,
      routeLabel: layover.label,
      cities,
      places,
      editMode: false,
      restDay: isRestDay(layover),
    }),
  );
  console.log(`isRestDay(layover) = ${isRestDay(layover)}; HTML has "Nearby" heading = ${html.includes(">Nearby<")}`);

  const shown = titles.filter((t) => html.includes(t));
  console.log(`\nrendered HTML: ${html.length} chars`);
  console.log(`suggestion titles present in the rendered output: ${shown.length}/${titles.length}`);
  if (shown.length) console.log(`  shown: ${shown.slice(0, 5).join(" | ")}`);
  const missing = titles.filter((t) => !html.includes(t));
  if (missing.length) console.log(`  MISSING: ${missing.slice(0, 5).join(" | ")}`);

  console.log(
    `\nVERDICT: a layover's mp: suggestions ${shown.length > 0 ? "DO render" : "do NOT render"} in the view-mode corridor.`,
  );
}

main().catch((e) => {
  console.error("RENDER PROBE ERROR:", e);
  process.exit(1);
});
