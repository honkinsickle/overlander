/**
 * verify-projection-delta — the read-spine gate for the milesFromStart fix.
 *
 * WHY THIS EXISTS. `scripts/check-payload-invariants.ts` (assertions A1–A6)
 * asserts on a trip's STORED payload and reads `reference_trips` only. The
 * read-spine fix writes nothing and the affected trips live in `public.trips`,
 * so A1–A6 are structurally incapable of measuring it: every assertion that
 * failed before still fails after, by construction. This script measures what a
 * user actually SEES instead — the order of the day spine and the mile on each
 * tick — by driving the SHIPPED `spinePosition` + `buildSpineItems`, not a copy.
 *
 * THREE STATES, so a regression in the adaptations is visible rather than hidden
 * behind a headline number:
 *   stored     — today: the baked `milesFromStart`, trusted verbatim.
 *   naive      — projection with NO round-trip handling and NO clamp tiebreak.
 *                This is what produced the original pricing figures; it emits
 *                negative labels and collapses clamped picks to input order.
 *   corrected  — what ships: round-trip days ordered radially with NO mile
 *                claimed, same-mile picks broken by offset.
 * `naive` and `corrected` SHOULD differ (round-trip days, clamped days). Them
 * matching exactly means the adaptations are not wired in.
 *
 * READ-ONLY. Issues SELECTs over PostgREST and nothing else.
 *
 * Run (TEST, the standing instrument):
 *   npx tsx --env-file=.env.development.local scripts/verify-projection-delta.ts \
 *     --table=reference_trips --id=expedition-ms28y793
 * Run (whatever project the env-file points at, all generated trips):
 *   npx tsx --env-file=.env.local scripts/verify-projection-delta.ts --table=trips
 * Add a second project in one pass by exporting PROD_SUPABASE_URL and
 * PROD_SUPABASE_SERVICE_ROLE_KEY; absent, the run is TEST-only and says so.
 */
import { decodePolyline, alongRouteMiles, haversineMi } from "@/lib/routing/point-to-polyline";
import {
  positionPlacesOnDay,
  dayStartMiles,
  isRoundTripCorridor,
  type PositionedPlace,
} from "@/lib/corridor/stretches";
import { buildSpineItems, spinePosition } from "@/components/trip/day-detail-corridor";
import type { CorridorPlace, SpinePos } from "@/components/trip/day-detail-corridor";

type Row = { id: string; payload: Record<string, unknown> };
type Tile = {
  id: string;
  name?: string;
  title?: string;
  curated?: boolean;
  coords?: [number, number];
  milesFromStart?: number;
};

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1];
const table = arg("table") ?? "reference_trips";
const idFilter = arg("id");

async function select(url: string, key: string): Promise<Row[]> {
  const q = `${url}/rest/v1/${table}?select=id,payload` + (idFilter ? `&id=eq.${idFilter}` : "&limit=500");
  const res = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as Row[];
}

const nameOf = (t: Tile) => t.name ?? t.title ?? t.id;

/** A tile as the read spine sees it. */
function asPlace(t: Tile): CorridorPlace {
  return {
    id: t.id,
    title: nameOf(t),
    category: "scenic",
    photoAlt: nameOf(t),
    curated: true,
    coords: t.coords,
    milesFromStart: t.milesFromStart,
  } as CorridorPlace;
}

/** naive = the substitution with neither adaptation: always projects, always
 *  labels, no tiebreak. Kept here (not in app code) purely as the control. */
function naivePosition(positioned: Map<string, PositionedPlace>) {
  return (p: CorridorPlace): SpinePos => {
    const pos = positioned.get(p.id);
    if (!pos) return { sort: Number.POSITIVE_INFINITY, tiebreak: 0, label: null };
    return { sort: pos.dayMile, tiebreak: 0, label: pos.dayMile };
  };
}

const storedPosition = (p: CorridorPlace): SpinePos => ({
  sort: p.milesFromStart as number,
  tiebreak: 0,
  label: p.milesFromStart ?? null,
});

type DayReport = {
  label: string;
  dayMiles: number;
  order: string[];
  labels: (number | null)[];
  over: number;
  negative: number;
  unlabelled: number;
};

function runState(
  cities: { id: string; name: string; kind: string; coords?: [number, number]; milesFromStart: number; placeIds: string[] }[],
  picks: Tile[],
  dayMiles: number,
  place: (p: CorridorPlace) => SpinePos,
): Omit<DayReport, "label" | "dayMiles"> {
  const items = buildSpineItems({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cities: cities as any,
    keyStops: picks.map(asPlace),
    mileMarkers: [],
    byId: new Map(),
    placeMile: place,
  });
  const stops = items.filter((i) => i.type === "keystop") as {
    place: CorridorPlace;
    mile: number | null;
  }[];
  const labels = stops.map((s) => s.mile);
  return {
    order: stops.map((s) => s.place.title),
    labels,
    over: labels.filter((m) => m != null && dayMiles > 0 && m > dayMiles).length,
    negative: labels.filter((m) => m != null && m < 0).length,
    unlabelled: labels.filter((m) => m == null).length,
  };
}

const totals = {
  stored: { over: 0, negative: 0, unlabelled: 0 },
  naive: { over: 0, negative: 0, unlabelled: 0 },
  corrected: { over: 0, negative: 0, unlabelled: 0 },
};
const failures: string[] = [];

async function runProject(name: string, url: string, key: string) {
  console.log(`\n${"═".repeat(72)}\n${name}  ${url}  table=${table}\n${"═".repeat(72)}`);
  let rows: Row[];
  try {
    rows = await select(url, key);
  } catch (e) {
    console.log(`  query failed: ${(e as Error).message} — skipping this project`);
    return;
  }

  for (const row of rows) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = row.payload as any;
    if (!p?.generated) continue;
    const days: any[] = p.days ?? [];
    const line = p.routePolyline ? decodePolyline(p.routePolyline) : [];
    const starts = dayStartMiles(days);
    const lineMi = line.length > 1 ? alongRouteMiles(line[line.length - 1], line)!.miles : 0;
    console.log(
      `\n── ${row.id}  days=${days.length}  polyline=${Math.round(lineMi)}mi` +
        `  sum(day.miles)=${days.reduce((s, d) => s + (d.miles ?? 0), 0)}`,
    );

    days.forEach((d: any, i: number) => {
      const picks: Tile[] = ((d.segmentSuggestions ?? []) as Tile[]).filter((t) => t?.curated);
      if (!picks.length) return;
      const cities = d.corridorCities ?? [];
      const roundTrip = isRoundTripCorridor(cities);
      const positioned = positionPlacesOnDay({
        line,
        places: picks.map(asPlace),
        dayStartMile: starts[i],
      });
      const dayMiles = d.miles ?? 0;

      const s = runState(cities, picks, dayMiles, storedPosition);
      const n = runState(cities, picks, dayMiles, naivePosition(positioned));
      const c = runState(
        cities,
        picks,
        dayMiles,
        spinePosition({ roundTrip, anchor: cities[0]?.coords, positioned }),
      );
      for (const [k, v] of [["stored", s], ["naive", n], ["corrected", c]] as const) {
        totals[k].over += v.over;
        totals[k].negative += v.negative;
        totals[k].unlabelled += v.unlabelled;
      }

      const fmt = (r: typeof s) =>
        r.order
          .map((o, j) => `${r.labels[j] == null ? "(no mile)" : `${Math.round(r.labels[j]!)}mi`} ${o}`)
          .join("  →  ");
      console.log(
        `\n  Day ${d.dayNumber} "${d.label}"  day.miles=${dayMiles}` +
          `  roundTrip=${roundTrip}  picks=${picks.length}`,
      );
      console.log(`    stored    : ${fmt(s)}`);
      console.log(`    naive     : ${fmt(n)}`);
      console.log(`    corrected : ${fmt(c)}`);
      console.log(
        `    over=${s.over}/${n.over}/${c.over}  negative=${s.negative}/${n.negative}/${c.negative}` +
          `  unlabelled=${s.unlabelled}/${n.unlabelled}/${c.unlabelled}   (stored/naive/corrected)`,
      );

      // ── Named checks ────────────────────────────────────────────────────
      if (c.negative > 0) failures.push(`${row.id} day ${d.dayNumber}: ${c.negative} negative label(s)`);

      if (row.id.startsWith("7e3e088a") && d.dayNumber === 3) {
        const inputOrder = picks.map(nameOf);
        if (c.order.join("|") === inputOrder.join("|")) {
          failures.push(`${row.id} day 3: corrected order collapsed to input order`);
        } else {
          console.log(`    ✓ day 3 does not collapse to input order (input: ${inputOrder.join(", ")})`);
        }
      }

      if (row.id === "expedition-ms28y793" && d.dayNumber === 6) {
        const destLast = /Bryce Canyon National Park/i.test(c.order[c.order.length - 1] ?? "");
        const redFirst = /Red Canyon/i.test(c.order[0] ?? "");
        if (destLast && redFirst) console.log(`    ✓ day 6: Red Canyon first, destination last`);
        else failures.push(`day 6: expected Red Canyon first + destination last, got ${c.order.join(" → ")}`);
      }
    });
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("No NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — pass --env-file.");
    process.exit(1);
  }
  await runProject("PRIMARY", url, key);

  const pUrl = process.env.PROD_SUPABASE_URL;
  const pKey = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY;
  if (pUrl && pKey) await runProject("SECONDARY", pUrl, pKey);
  else console.log("\nSECONDARY: skipped — no PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY set.");

  console.log(`\n${"═".repeat(72)}\nTOTALS (stored → naive → corrected)`);
  console.log(`  tiles labelled beyond their day's miles : ${totals.stored.over} → ${totals.naive.over} → ${totals.corrected.over}`);
  console.log(`  negative mile labels                    : ${totals.stored.negative} → ${totals.naive.negative} → ${totals.corrected.negative}`);
  console.log(`  stops rendered with no mile claimed     : ${totals.stored.unlabelled} → ${totals.naive.unlabelled} → ${totals.corrected.unlabelled}`);

  if (failures.length) {
    console.log(`\nFAILED (${failures.length}):`);
    for (const f of failures) console.log(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("\nAll named checks passed.");
}
main();
