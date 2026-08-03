/**
 * Add-a-rest-day (layover insert) — the PURE core. Insert a zero-drive layover
 * day AFTER day X, sitting at day X's overnight stop so that `start === end`. No
 * Mapbox, no DB — the repository wrapper (`insertRestDay`) fetches corpus
 * suggestions and does the single guarded write around this.
 *
 * A layover is NOT routed. `recomputeDay` REFUSES a `start === end` day: its stop
 * dedup collapses the two identical coords to length 1, tripping the `< 2` guard
 * and returning null before any Mapbox call (measured 2026-08-03). So the derived
 * values are set DIRECTLY, and honestly:
 *   - `miles: 0`          — you did not drive.
 *   - `driveHours: 0`     — zero hours driving is a TRUE claim (ruling 2026-08-03),
 *                           distinct from the unroutable fallback's `null`, which
 *                           means "we cannot honestly say".
 *   - `corridorCities: undefined` — no line → no spine; clients fall back to the
 *                           two-node corridor (degenerate-but-harmless for one stop).
 *
 * SPARSE by construction, exactly like a split's half B: no description, weather,
 * notes, overnight, or heroImage — none has a non-LLM producer, and absent is
 * honest where invented is not. `segmentSuggestions` ARE populated (by the wrapper,
 * from the corridor corpus, distance-ranked here) — a rest day showing nothing to
 * do is a worse artifact than one showing prominent-nearby.
 *
 * RENUMBER + REDATE mirror the split: the tail shifts `day-N → day-N+1` and
 * `date + 1`, the layover slots into the vacated `N+1`, the anchor day keeps its
 * id/number/date. Positional ids only — no uuid minting (the unbuilt dayAssignment
 * work). This op DELIBERATELY makes zero route calls and leaves `routePolyline`
 * untouched: a layover contributes no driving geometry (rebuildRoutePolyline skips
 * `start === end` days), so the stored line stays byte-correct.
 */
import type { Trip, Day } from "./types";
import { haversineMi } from "@/lib/routing/point-to-polyline";
import { addDaysISO } from "./reorder-days";
import type { BrowsePlace } from "@/lib/trip-browse/places";

type LngLat = [number, number];

export type RestDayStructure = { trip: Trip; restDayId: string };

/** The end place name from a "Start — End" day label — the stop the layover sits
 *  at. Falls back to the whole label when it has no " — " separator. */
function labelEndName(label: string): string {
  const parts = label.split(" — ");
  return parts.length > 1 ? parts[parts.length - 1] : label;
}

/** Layover label. UNLIKE every other day, this is NOT endpoint-derived: both
 *  endpoints are the SAME stop, and a literal "X — X" span reads as a bug, so the
 *  first half is the fixed word "Rest day", not a place (ruling 2026-08-03).
 *
 *  ⚠️ CONSEQUENCE for anything that parses `day.label` on " — ": `recomputeDay`
 *  does exactly this to name the corridor spine, taking the first half as the
 *  START name. It never runs on a pure layover (start === end → it returns null
 *  at the `< 2` dedup guard), but were a waypoint ever added — turning the layover
 *  into a real excursion — the spine's start node would be named "Rest day", not a
 *  city. Out of scope now; flagged so it isn't a silent surprise later. */
function restDayLabel(stopName: string): string {
  return `Rest day — ${stopName}`;
}

/**
 * Build the post-insert day structure: a sparse layover at day `dayId`'s overnight
 * stop, inserted at `N+1`, with the tail renumbered/redated. Derived values are set
 * directly (miles 0, driveHours 0, no spine). `segmentSuggestions` is left EMPTY —
 * the wrapper fills it from the corpus query (IO). Returns null if the day isn't
 * found or has no end coord to sit the layover at. Pure.
 */
export function buildRestDayStructure(
  trip: Trip,
  dayId: string,
): RestDayStructure | null {
  const next = structuredClone(trip);
  const idx = next.days.findIndex((d) => d.id === dayId);
  if (idx === -1) return null;
  const anchor = next.days[idx];
  const stop = anchor.coords; // the layover sits at the anchor day's overnight
  if (!stop) return null; // can't lay over at a day with no end coord

  const restDay: Day = {
    id: `day-${anchor.dayNumber + 1}`,
    dayNumber: anchor.dayNumber + 1,
    date: addDaysISO(anchor.date, 1),
    label: restDayLabel(labelEndName(anchor.label)),
    startCoord: stop,
    coords: stop, // start === end — the layover invariant
    miles: 0, // honest: no driving
    driveHours: 0, // honest: zero hours driving (ruling 2026-08-03)
    corridorCities: undefined, // no line → no spine
    waypoints: [],
    segmentSuggestions: [], // filled by the wrapper from the corpus query
  };

  // Shift the existing tail (day-N → day-N+1, date +1) BEFORE inserting, so the
  // layover slots cleanly into the vacated number. Anchor keeps its id/number/date.
  for (let i = idx + 1; i < next.days.length; i++) {
    next.days[i].dayNumber += 1;
    next.days[i].id = `day-${next.days[i].dayNumber}`;
    next.days[i].date = addDaysISO(next.days[i].date, 1);
  }
  next.days.splice(idx + 1, 0, restDay);

  return { trip: next, restDayId: restDay.id };
}

/** A layover/rest day: start and end are the SAME stop and the day has no driving
 *  miles or spine. A round-trip EXCURSION (start === end but miles > 0) is NOT one —
 *  it drove. The corridor view keys its inline "Nearby" block on this: a layover has
 *  no curated key stops and no corridorCities to bucket its suggestions under, so
 *  without a dedicated block its stored `segmentSuggestions` render nowhere. */
export function isRestDay(day: Day): boolean {
  const s = day.startCoord;
  const e = day.coords;
  return (
    !!s && !!e && s[0] === e[0] && s[1] === e[1] &&
    (day.miles ?? 0) === 0 &&
    (day.corridorCities?.length ?? 0) === 0
  );
}

/** Default nearby-suggestion cap. Chosen from the 2026-08-03 corridor probes: at
 *  dense stops the nearest 10 are tightly clustered (LA: 15 rows within 1 km), and
 *  at sparse destination stops 10 keeps essentially the whole set (Moab: 12 rows,
 *  all 5–14 km) — enough to browse, not overwhelming. */
export const REST_DAY_SUGGESTION_CAP = 10;

/**
 * Distance-rank corridor rows nearest-first and keep the closest `n`. The corridor
 * RPC (`pois_along_corridor`) returns rows ordered by PROMINENCE with no distance
 * sort and no limit — right for a corridor, wrong for "what's near this one stop".
 * We re-rank by exact great-circle distance (`haversineMi`) and cap.
 *
 * Coord-less rows can't be ranked and are dropped (a suggestion with no location is
 * useless on a "nearby" list). Stable: distance ties keep the input (prominence)
 * order.
 *
 * HONEST FRAMING for any copy/doc built on this: these are prominent POIs within
 * the 16 km corridor buffer, ranked nearest-first — "prominent within ~10 miles",
 * NOT "walkable from camp". Do NOT narrow the buffer to fake proximity: at Moab the
 * relevant POIs are Arches at 5–14 km and a 5 km buffer returns 1 row
 * (measured 2026-08-03).
 */
export function rankNearbySuggestions(
  stop: LngLat,
  places: BrowsePlace[],
  n: number = REST_DAY_SUGGESTION_CAP,
): BrowsePlace[] {
  return places
    .map((p, i) => ({
      p,
      i,
      d: p.coords ? haversineMi(stop, p.coords) : Infinity,
    }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d || a.i - b.i) // nearest first; ties keep input order
    .slice(0, n)
    .map((x) => x.p);
}
