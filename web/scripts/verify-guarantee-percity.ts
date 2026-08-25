/**
 * Verify the interest-category GUARANTEE (decision D-B, per-city) against the
 * REAL TEST corpus — drives `preComputeFacts` + `auditItinerary`, the actual
 * shipped code path, no LLM and no mocks.
 *
 * WHAT IT PROVES on real data:
 *   - a user-selected pool-side category (e.g. `scenic`) gets a `guaranteed`
 *     pick from the corpus pool at a corridor city when the day covers it
 *     nowhere near that anchor;
 *   - PER-CITY density: the SAME category can be guaranteed at MORE THAN ONE
 *     city on a day (up to the shared per-day cap) — the D-B behaviour, vs
 *     per-day which would satisfy a category once and stop;
 *   - the guarantee shares ONE cap with the #274/#275/#276 opener and wins it
 *     first (Option A);
 *   - control run (no guaranteedCategories) yields opener-only picks.
 *
 * The itinerary is SYNTHETIC (one drive day, empty keyStops so every guaranteed
 * category is missing at every anchor) — this isolates the guarantee mechanism
 * from the LLM. READ-ONLY: `preComputeFacts` reads the corpus, `auditItinerary`
 * calls Mapbox `routeBetween`; nothing writes. No corpus mutation → no cleanup.
 *
 * RUN (TEST Supabase + borrowed Mapbox token, per web/CLAUDE.md RUNBOOK):
 *   cd web
 *   export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
 *   npx tsx --env-file=.env.development.local scripts/verify-guarantee-percity.ts
 *
 * Optional: pass a corridor as `START|END`, e.g.
 *   ... scripts/verify-guarantee-percity.ts "Sacramento, California|Reno, Nevada"
 */
import { preComputeFacts, type GenerationInput } from "../src/lib/itinerary/facts";
import { auditItinerary } from "../src/lib/itinerary/audit";
import type { ItineraryOutput, DayPlan } from "../src/lib/itinerary/schema";

const KNOWN_PROJECTS: Record<string, string> = {
  nqzeywzcowujzyegxbsr: "PROD",
  znldzjdatkogdktymtvi: "TEST",
};

function assertTest(): void {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const ref = url.replace("https://", "").replace(".supabase.co", "").split(".")[0];
  const project = KNOWN_PROJECTS[ref] ?? "UNKNOWN";
  console.log(`Supabase target: ${project} (${ref})`);
  if (project !== "TEST") {
    console.error(`REFUSING: this verify writes nothing but reads the corpus — run it against TEST, not ${project}.`);
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    console.error("NEXT_PUBLIC_MAPBOX_TOKEN not set — routeBetween would Haversine-fallback. Inject the token (see the header).");
    process.exit(1);
  }
}

function input(start: string, end: string, guaranteedCategories: string[]): GenerationInput {
  return {
    anchors: [
      { place: start, role: "start", datePin: "fixed", date: "2026-09-01", dwell: 0, note: null },
      { place: end, role: "end", datePin: "fixed", date: "2026-09-02", dwell: 0, note: null },
    ],
    params: {
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      budget: "mid",
      maxDailyDriveMi: 600, // one drive day covers the whole corridor
      bufferDays: 0,
      avoid: [],
      returnRouting: "shortest",
    },
    rig: {
      vehicle: "4Runner",
      build: [],
      fuelRangeMi: 300,
      capability: "moderate",
      groupSize: "2",
      skill: "intermediate",
      preferences: [],
    },
    guaranteedCategories,
  };
}

/** One synthetic drive day, start→end, NO keyStops (so every guaranteed
 *  category is missing at every anchor), overnight desc-only (no live-resolve). */
function oneDrivedayOutput(start: string, end: string): ItineraryOutput {
  const day: DayPlan = {
    n: 1,
    date: "2026-09-01",
    startPlace: start,
    endPlace: end,
    type: "drive",
    distanceMi: 500,
    driveHours: 8,
    weather: "clear",
    rationale: "synthetic verify day",
    keyStops: [],
    overnight: { name: null, desc: "informal boondock", type: "camp", rationale: "verify" },
    logistics: "",
    obligations: [],
  };
  return {
    routeSummary: "verify",
    foodThread: "",
    anchorsHonored: [start, end],
    phases: [],
    days: [day],
    fuelGaps: [],
    variants: [],
    permits: [],
    borders: [],
  };
}

async function run(start: string, end: string, guaranteedCategories: string[]): Promise<void> {
  const label = guaranteedCategories.length ? `guarantee [${guaranteedCategories.join(", ")}]` : "control (no guarantee)";
  console.log(`\n──────────────────────────────────────────────────────────────`);
  console.log(`${start}  →  ${end}   ·   ${label}`);
  const facts = await preComputeFacts(input(start, end, guaranteedCategories));
  console.log(`facts: ${facts.poolPOIs.length} pool POIs · ${facts.corridorCities.length} corridor cities`);
  const poolByCat = new Map<string, number>();
  for (const p of facts.poolPOIs) poolByCat.set(p.category ?? "∅", (poolByCat.get(p.category ?? "∅") ?? 0) + 1);
  console.log(`pool by category: ${[...poolByCat.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join("  ")}`);

  const out = await auditItinerary(
    input(start, end, guaranteedCategories),
    facts,
    oneDrivedayOutput(start, end),
  );
  const backfills = out.report.anchorBackfills;
  const guaranteed = backfills.filter((b) => b.guaranteed);
  const openers = backfills.filter((b) => !b.guaranteed);
  console.log(`picks: ${backfills.length} total · ${guaranteed.length} guaranteed · ${openers.length} opener`);
  for (const b of backfills) {
    const tag = b.guaranteed ? `GUARANTEE(${b.category})` : "opener";
    console.log(`  • ${tag}  "${b.name}"  @ ${b.anchor}`);
  }
  if (guaranteed.length) {
    const cities = new Set(guaranteed.map((b) => b.anchor));
    const cats = new Set(guaranteed.map((b) => b.category));
    console.log(`per-city check: ${guaranteed.length} guaranteed pick(s) across ${cities.size} distinct anchor(s), categories {${[...cats].join(", ")}}`);
    if (cities.size > 1) console.log(`  ✓ D-B per-city density observed: a guarantee fired at MORE THAN ONE city on the day`);
  }
}

async function main(): Promise<void> {
  assertTest();
  const [corridorArg] = process.argv.slice(2);
  const [start, end] = corridorArg
    ? corridorArg.split("|").map((s) => s.trim())
    : ["San Diego, California", "San Francisco, California"];

  // Control, then a single-category guarantee (per-city density is clearest
  // with one category — 2 slots both go to that category at 2 cities), then a
  // two-category guarantee.
  await run(start, end, []);
  await run(start, end, ["scenic"]);
  await run(start, end, ["scenic", "food"]);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
