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

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { preComputeFacts, type GenerationInput } from "../src/lib/itinerary/facts";
import {
  generateItinerary,
  generateAndAudit,
  isAnthropicConfigured,
  ItineraryGenerationError,
} from "../src/lib/itinerary/generate";
import { auditItinerary } from "../src/lib/itinerary/audit";
import { bakeGeneratedDays, type BakedDay } from "../src/lib/itinerary/bake";
import { itineraryToTrip } from "../src/lib/itinerary/to-trip";
import { attachHeroPhotos } from "../src/lib/imagery/destination-photo";
import type { ItineraryOutput } from "../src/lib/itinerary/schema";

/** Service-role Supabase client from env (Mapbox + corpus reads for the bake). */
function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Bake corridors onto the audited days, log spine/tile stats, save the
 *  baked artifacts to scratchpad, and return them. */
async function bakeAndReport(
  audited: ItineraryOutput,
  dayRoutes: import("../src/lib/itinerary/audit").DayRoute[],
): Promise<BakedDay[] | undefined> {
  const sb = serviceClient();
  if (!sb) {
    console.log("[bake] no supabase client — skipping corridor bake");
    return undefined;
  }
  console.log("\n[bake] baking corridors onto generated days…");
  const baked = await bakeGeneratedDays(audited, DEMO, sb, dayRoutes);
  const withSpine = baked.filter((b) => (b.corridorCities?.length ?? 0) > 2).length;
  const tiles = baked.reduce((s, b) => s + b.segmentSuggestions.length, 0);
  const bucketed = baked.reduce(
    (s, b) => s + (b.corridorCities?.reduce((n, c) => n + (c.placeIds?.length ?? 0), 0) ?? 0),
    0,
  );
  console.log(
    `[bake] ${withSpine}/${baked.length} days with a full spine (>2 nodes) · ` +
      `${tiles} tiles · ${bucketed} bucketed under nodes`,
  );
  for (const b of baked.slice(0, 4)) {
    const nodes = (b.corridorCities ?? []).map((c) => c.name.split(",")[0]).join(" → ");
    console.log(`  day ${b.n}: ${b.corridorCities?.length ?? 0} nodes [${nodes}] · ${b.segmentSuggestions.length} tiles`);
  }
  const SC = "/private/tmp/claude-501/-Users-adamwagner/414eac7e-5fb8-40f0-9c1f-17f6c4a5ac38/scratchpad";
  writeFileSync(`${SC}/baked-days.json`, JSON.stringify(baked, null, 2));
  console.log(`[bake] wrote ${SC}/baked-days.json`);
  return baked;
}

const PERSIST = process.argv.includes("--persist");
// Persist the ALREADY-generated itinerary (from scratchpad) without a fresh
// LLM call — so the exact reviewed plan is what renders, and no ANTHROPIC key
// is needed (safe to run against the TEST env file).
const PERSIST_SAVED = process.argv.includes("--persist-saved");
// Run the Stage-2 audit against the saved itinerary-output.json (known-answer
// proof) and print the report. Add --persist to store the AUDITED version.
const AUDIT_SAVED = process.argv.includes("--audit-saved");
// Generate raw (no audit) and save it — decoupled from the audit so each
// phase is observable. Proves the prompt contract (LLM emits NAMES, not ids).
const GENERATE_ONLY = process.argv.includes("--generate-only");
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
  if (AUDIT_SAVED) {
    console.log("[audit] loading saved facts + itinerary for known-answer audit…");
    const facts = JSON.parse(
      readFileSync(`${SCRATCH}/engine-facts.json`, "utf8"),
    ) as Awaited<ReturnType<typeof preComputeFacts>>;
    const raw = JSON.parse(
      readFileSync(`${SCRATCH}/itinerary-output.json`, "utf8"),
    ) as ItineraryOutput;

    const { audited, report, structural, dayRoutes } = await auditItinerary(
      DEMO,
      facts,
      raw,
    );

    console.log(`\n[audit] ${report.summary}\n`);

    console.log("── TIER 2 · dropped fabricated POIs ──");
    if (report.droppedPois.length === 0) console.log("  (none)");
    for (const d of report.droppedPois) {
      console.log(`  day ${d.day}: ${d.where} ${d.poiId} — NOT in corpus pool → DROPPED`);
    }

    console.log("\n── TIER 1 · distance re-measurement (stated → measured) ──");
    console.log(
      `  trip total: ${Math.round(report.totalStatedMi)} mi stated → ${Math.round(report.totalMeasuredMi)} mi measured`,
    );
    for (const s of report.distanceSnaps.filter((x) => x.snapped).slice(0, 8)) {
      console.log(
        `  day ${s.day}: ${s.statedMi} mi → ${s.measuredMi} mi  (${s.statedHrs}h → ${s.measuredHrs}h)  [snapped]`,
      );
    }

    console.log("\n── TIER 1 · fuel gaps (computed from real fuel POIs) ──");
    console.log(
      `  LLM's flagged gaps corroborated by computation: ${report.fuel.claimedGapsCorroborated ? "YES" : "no"}`,
    );
    for (const g of report.fuel.computed) {
      console.log(
        `  ${g.exceedsRange ? "‼" : "⚠"} ${g.gapMi} mi · ${g.segment}`,
      );
    }

    console.log("\n── TIER 3 · structural issues (→ bounded regen) ──");
    if (structural.length === 0) console.log("  (none — no regen needed)");
    for (const s of structural) console.log(`  ${JSON.stringify(s)}`);

    // Day-by-day after-audit view for the day(s) that had a dropped POI.
    const affectedDays = new Set(report.droppedPois.map((d) => d.day));
    for (const n of affectedDays) {
      const day = audited.days.find((d) => d.n === n)!;
      console.log(`\n── AFTER AUDIT · Day ${n} (${day.date}) ${day.startPlace} → ${day.endPlace} ──`);
      console.log(`  distance: ${day.distanceMi} mi / ${day.driveHours} h [${day.audit?.distanceConfidence}]`);
      console.log(`  keyStops: ${day.keyStops.length ? day.keyStops.map((k) => `${k.name}${k.note ? ` (${k.note})` : ""}`).join(", ") : "(none survived)"}`);
      console.log(
        `  overnight: ${day.overnight.name ?? day.overnight.desc ?? "(none)"} — ${day.overnight.rationale}`,
      );
      for (const f of day.audit?.flags ?? []) {
        console.log(`  flag [${f.severity}/${f.kind}]: ${f.message}`);
      }
    }

    writeFileSync(
      `${SCRATCH}/itinerary-audited.json`,
      JSON.stringify(audited, null, 2),
    );
    console.log(`\n[audit] wrote ${SCRATCH}/itinerary-audited.json`);

    const baked = await bakeAndReport(audited, dayRoutes);
    if (PERSIST) await persist(audited, facts, baked);
    return;
  }

  if (PERSIST_SAVED) {
    console.log("[gen] --persist-saved: loading the reviewed itinerary from scratchpad…");
    const facts = JSON.parse(
      readFileSync(`${SCRATCH}/engine-facts.json`, "utf8"),
    ) as Awaited<ReturnType<typeof preComputeFacts>>;
    // Prefer the AUDITED itinerary — the audit runs before persist/render, so
    // what we store must be the audited version, never the raw LLM output.
    const auditedPath = `${SCRATCH}/itinerary-audited.json`;
    const rawPath = `${SCRATCH}/itinerary-output.json`;
    const useAudited = existsSync(auditedPath);
    const itinerary = JSON.parse(
      readFileSync(useAudited ? auditedPath : rawPath, "utf8"),
    ) as ItineraryOutput;
    // Load the baked corridors computed by --audit-saved (if present), so the
    // persisted trip carries full spines + bucketed tiles.
    const bakedPath = `${SCRATCH}/baked-days.json`;
    const baked = existsSync(bakedPath)
      ? (JSON.parse(readFileSync(bakedPath, "utf8")) as BakedDay[])
      : undefined;
    console.log(
      `[gen] loaded ${useAudited ? "AUDITED" : "raw"} ${itinerary.days.length}-day itinerary + ${facts.poolPOIs.length}-POI facts${baked ? ` + ${baked.length} baked days` : " (no bake)"}`,
    );
    await persist(itinerary, facts, baked);
    return;
  }

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

  if (GENERATE_ONLY) {
    console.log("\n[gen] generating RAW (no audit)…");
    const { itinerary, usage } = await generateItinerary(DEMO, facts);
    console.log(`[gen] done · ${usage.inputTokens} in / ${usage.outputTokens} out · ${itinerary.days.length} days`);
    writeFileSync(`${SCRATCH}/itinerary-output.json`, JSON.stringify(itinerary, null, 2));
    console.log(`[gen] wrote itinerary-output.json (RAW)`);
    // Prove the always-names contract: every ref is a plain NAME; id-like
    // refs (a leftover "mp:" token) should be ZERO — there's no id field.
    const idLike: string[] = [], nameRefs: string[] = [];
    for (const d of itinerary.days) {
      for (const k of d.keyStops) (k.name.startsWith("mp:") ? idLike : nameRefs).push(`d${d.n}:${k.name}`);
      if (d.overnight.name) nameRefs.push(`d${d.n}:overnight="${d.overnight.name}"`);
    }
    console.log(`\n[contract] plain-NAME refs: ${nameRefs.length} · id-like refs (should be 0): ${idLike.length}`);
    console.log("[contract] NAMES the LLM emitted (→ audit will resolve+guard):");
    for (const n of nameRefs) console.log(`  ${n}`);
    return;
  }

  console.log("\n[gen] generating + auditing (master prompt → Section-C → Stage-2 audit)…");
  try {
    const { audited, report, regenAttempts, unresolved, dayRoutes } =
      await generateAndAudit(DEMO, facts);
    console.log(
      `[gen] ${report.summary} · regen attempts: ${regenAttempts}` +
        (unresolved ? ` · UNRESOLVED: ${JSON.stringify(unresolved)}` : ""),
    );
    writeFileSync(
      `${SCRATCH}/itinerary-output.json`,
      JSON.stringify(audited, null, 2),
    );
    console.log(`[gen] wrote ${SCRATCH}/itinerary-output.json (audited)`);

    console.log(`\n── TIER 2 · names resolved live + on-corridor (→ ingest) ──`);
    if (report.resolved.length === 0) console.log("  (none)");
    for (const r of report.resolved) {
      const rp = audited.days
        .find((d) => d.n === r.day)
        ?.audit?.resolvedPlaces.find((x) => x.name === r.name && x.where === r.where);
      console.log(
        `  day ${r.day} ${r.where}: "${r.name}" → ${rp?.displayName} | ${rp?.placeId} | [${rp?.coords.map((c) => c.toFixed(3)).join(",")}]`,
      );
    }
    console.log(`\n── TIER 3 · dropped (fabricated id / unresolvable / off-corridor) ──`);
    if (report.droppedPois.length === 0) console.log("  (none)");
    for (const d of report.droppedPois) {
      console.log(`  day ${d.day} ${d.where}: "${d.poiId}" — ${d.reason}`);
    }

    console.log(`\n─── ${audited.routeSummary}\n`);
    for (const d of audited.days) {
      console.log(
        `Day ${d.n} (${d.date}) ${d.startPlace} → ${d.endPlace} · ` +
          `${d.distanceMi.toFixed(0)}mi/${d.driveHours.toFixed(1)}h [${d.type}] ` +
          `[${d.audit?.distanceConfidence}]`,
      );
      for (const f of d.audit?.flags ?? []) {
        console.log(`  ${f.severity === "critical" ? "‼" : f.severity === "warning" ? "⚠" : "ℹ"} ${f.message}`);
      }
    }

    const baked = await bakeAndReport(audited, dayRoutes);
    if (PERSIST) await persist(audited, facts, baked);
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
  bakedDays?: BakedDay[],
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

  const trip = await attachHeroPhotos(
    itineraryToTrip(DEMO_TRIP_ID, DEMO, facts, itinerary, bakedDays),
  );
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
