/**
 * Stage-1 end-to-end runner: anchors + params → engine facts → LLM master
 * prompt → structured Section-C itinerary.
 *
 * The FACT pre-compute (route + corridor + POI pool) runs with only the
 * Mapbox + Supabase creds already in web/.env.local. The GENERATION step
 * runs only when ANTHROPIC_API_KEY is present (see run instructions below).
 *
 *   Facts only (works today):
 *     tsx --env-file=.env.local scripts/generate-itinerary.ts
 *
 *   Full end-to-end (after adding the key + SDK):
 *     npm install -w web @anthropic-ai/sdk
 *     # add ANTHROPIC_API_KEY=... to web/.env.local
 *     tsx --env-file=.env.local scripts/generate-itinerary.ts
 *
 * Writes engine-facts.json and (when generated) itinerary-output.json to the
 * repo's scratch dir so the results can be inspected / rendered.
 */

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { preComputeFacts, type GenerationInput } from "../src/lib/itinerary/facts";
import {
  generateItinerary,
  isAnthropicConfigured,
  ItineraryGenerationError,
} from "../src/lib/itinerary/generate";
import { itineraryToTrip } from "../src/lib/itinerary/to-trip";
import type { ItineraryOutput } from "../src/lib/itinerary/schema";

const PERSIST = process.argv.includes("--persist");
const DEMO_TRIP_ID = "yotrippin-demo";
const KNOWN_PROJECTS: Record<string, string> = {
  nqzeywzcowujzyegxbsr: "PROD",
  znldzjdatkogdktymtvi: "TEST",
};

// The reference-doc trip: Chicken, AK → Vancouver, BC, Jul 9–27 2026, with
// Dawson City pinned FIXED to 7/10 and Vancouver pinned to 7/27 (spec §8.1).
const DEMO: GenerationInput = {
  anchors: [
    {
      place: "Chicken, Alaska",
      role: "start",
      datePin: "fixed",
      date: "2026-07-09",
      dwell: 0,
      note: "Trip start — the Top of the World highway kicks off here",
    },
    {
      place: "Dawson City, Yukon",
      role: "waypoint",
      datePin: "fixed",
      date: "2026-07-10",
      dwell: 1,
      note: "Gold-rush town; ferry + Dome sunset",
    },
    {
      place: "Watson Lake, Yukon",
      role: "waypoint",
      datePin: "flexible",
      date: null,
      dwell: 0,
      note: "Sign Post Forest; gateway to the Cassiar",
    },
    {
      place: "Vancouver, British Columbia",
      role: "end",
      datePin: "fixed",
      date: "2026-07-27",
      dwell: 0,
      note: "Trip end",
    },
  ],
  params: {
    startDate: "2026-07-09",
    endDate: "2026-07-27",
    budget: "mid",
    maxDailyDriveMi: 350,
    bufferDays: 0,
    avoid: ["hardcore rock-crawling", "toll roads", "rushed fixed-date legs"],
    returnRouting: "shortest",
  },
  rig: {
    vehicle: "2004 Lexus GX 470",
    build: ["lift", "tires", "armor", "winch", "fridge", "dual battery", "solar", "RTT"],
    fuelRangeMi: 400,
    capability: "moderate",
    groupSize: "1–2 travelers",
    skill: "intermediate",
    preferences: ["solitude", "scenic routes", "photography", "simple camp", "local food"],
  },
};

const SCRATCH =
  "/private/tmp/claude-501/-Users-adamwagner/414eac7e-5fb8-40f0-9c1f-17f6c4a5ac38/scratchpad";

async function main() {
  console.log("[gen] pre-computing engine facts…");
  const facts = await preComputeFacts(DEMO);

  console.log(
    `[gen] route: ${facts.route.totalMi.toFixed(0)} mi · ` +
      `${facts.route.totalDriveHours.toFixed(1)} drive-hrs · ` +
      `baseline ${facts.route.baselineDriveDays} driving days`,
  );
  console.log(
    `[gen] corridor spine: ${facts.corridorCities.length} cities · ` +
      `POI pool: ${facts.poolPOIs.length} places`,
  );
  const byCat = new Map<string, number>();
  for (const p of facts.poolPOIs) {
    const k = p.category ?? "uncategorized";
    byCat.set(k, (byCat.get(k) ?? 0) + 1);
  }
  console.log(
    "[gen] pool by category:",
    [...byCat.entries()].map(([k, n]) => `${k}:${n}`).join(" "),
  );
  writeFileSync(`${SCRATCH}/engine-facts.json`, JSON.stringify(facts, null, 2));
  console.log(`[gen] wrote ${SCRATCH}/engine-facts.json`);

  if (!isAnthropicConfigured()) {
    console.log(
      "\n[gen] ANTHROPIC_API_KEY not set — facts ready, generation skipped.\n" +
        "      Add the key to web/.env.local + `npm install -w web @anthropic-ai/sdk`,\n" +
        "      then re-run to produce the itinerary.",
    );
    return;
  }

  console.log("\n[gen] generating itinerary (master prompt → structured Section-C)…");
  try {
    const { itinerary, usage } = await generateItinerary(DEMO, facts);
    console.log(
      `[gen] done · ${usage.inputTokens} in / ${usage.outputTokens} out tokens · ` +
        `${itinerary.days.length} days`,
    );
    writeFileSync(
      `${SCRATCH}/itinerary-output.json`,
      JSON.stringify(itinerary, null, 2),
    );
    console.log(`[gen] wrote ${SCRATCH}/itinerary-output.json`);

    console.log(`\n─── ${itinerary.routeSummary}\n`);
    for (const d of itinerary.days) {
      console.log(
        `Day ${d.n} (${d.date}) ${d.startPlace} → ${d.endPlace} · ` +
          `${d.distanceMi.toFixed(0)}mi/${d.driveHours.toFixed(1)}h [${d.type}]`,
      );
      console.log(`  ${d.rationale}`);
      console.log(
        `  overnight: ${d.overnight.poiId ?? d.overnight.desc} — ${d.overnight.rationale}`,
      );
      if (d.logistics) console.log(`  logistics: ${d.logistics}`);
    }

    if (PERSIST) await persist(itinerary, facts);
  } catch (err) {
    if (err instanceof ItineraryGenerationError) {
      console.error(`[gen] generation failed (${err.code}): ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

/**
 * Persist the generated itinerary as a reference trip so it opens in the
 * slideup at /trips/yotrippin-demo. DELIBERATE DB WRITE — prints the target
 * project ref for eyes-on confirmation, matching the repo's prod-write
 * discipline (bake-reference.ts). Writes to whatever web/.env.local points at.
 */
async function persist(
  itinerary: ItineraryOutput,
  facts: Awaited<ReturnType<typeof preComputeFacts>>,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "[gen] --persist needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exitCode = 1;
    return;
  }
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  const label = KNOWN_PROJECTS[ref] ?? "UNKNOWN";
  console.log(`\n[gen] --persist → project ref ${ref} [${label}]`);
  if (label !== "TEST") {
    console.log(
      `[gen] refusing to auto-write to a non-TEST project (${label}). ` +
        "Point web/.env.local at TEST to persist the demo, or persist manually.",
    );
    process.exitCode = 1;
    return;
  }

  const trip = itineraryToTrip(DEMO_TRIP_ID, DEMO, facts, itinerary);
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.from("reference_trips").upsert({
    id: DEMO_TRIP_ID,
    title: trip.title,
    payload: trip,
    source_version: `yotrippin-gen@${new Date().toISOString().slice(0, 10)}`,
  });
  if (error) {
    console.error("[gen] persist failed:", error.message);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[gen] persisted → open the slideup at /trips/${DEMO_TRIP_ID} to view it in Day Detail`,
  );
}

main().catch((err) => {
  console.error("[gen] fatal:", err);
  process.exit(1);
});
