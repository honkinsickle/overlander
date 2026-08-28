/**
 * Live verification that a manually-entered (coordinate-only, no `place_id`,
 * no Mapbox `region_code`) start and end anchor flows through the REAL
 * pipeline exactly like an autocomplete-picked one — real Mapbox routing,
 * real Claude generation, real `public.trips` insert under the seeded
 * owner's RLS session. Mirrors `generateExpeditionTripAction`
 * (`src/lib/plan/expedition-actions.ts`) function-for-function, minus the
 * corpus write-back (`enqueueResolvedPlaces`) — that call writes to the
 * shared `source_record` table and is orthogonal to whether coordinate-only
 * anchors route and generate correctly, which is what this script proves.
 *
 * Needs NEXT_PUBLIC_MAPBOX_TOKEN and ANTHROPIC_API_KEY, neither of which is
 * in .env.development.local (same gap as the existing Mapbox-token RUNBOOK
 * gotcha). Borrow both from .env.local without touching PROD Supabase:
 *
 *   export NEXT_PUBLIC_MAPBOX_TOKEN=$(grep '^NEXT_PUBLIC_MAPBOX_TOKEN=' .env.local | cut -d= -f2-)
 *   export ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' .env.local | cut -d= -f2-)
 *   cd web && npx tsx --env-file=.env.development.local scripts/verify-manual-coordinate-anchor.ts
 *
 * Costs one real Claude generation call and takes on the order of a minute.
 * Inserts one row into TEST `public.trips` and deletes it before exiting
 * (even on failure), so it leaves no residue — no snapshot/restore dance
 * needed since this is a single fresh insert with no corpus side effects.
 */
import { createClient } from "@supabase/supabase-js";
import {
  expeditionToGenerationInput,
  validateExpeditionForm,
  type ExpeditionForm,
} from "../src/lib/plan/expedition";
import { preComputeFacts } from "../src/lib/itinerary/facts";
import { generateAndAudit, ItineraryGenerationError } from "../src/lib/itinerary/generate";
import { bakeGeneratedDays } from "../src/lib/itinerary/bake";
import { itineraryToTrip } from "../src/lib/itinerary/to-trip";
import { attachHeroPhotos } from "../src/lib/imagery/destination-photo";
import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import type { Trip } from "../src/lib/trips/types";

const TEST_REF = "znldzjdatkogdktymtvi";
const OWNER = "seed-owner@overlander.test";
const PW = "seed-pw-manual-edit-8471";

function assertTest(url: string) {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "?";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}`);
}

let pass = 0,
  fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function main() {
  if (!process.env.NEXT_PUBLIC_MAPBOX_TOKEN) {
    throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN not set — see this file's docstring");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not set — see this file's docstring");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  assertTest(url);
  const anonClient = createClient(url, anon, { auth: { persistSession: false } });
  const { data: sess, error: sErr } = await anonClient.auth.signInWithPassword({
    email: OWNER,
    password: PW,
  });
  if (sErr || !sess.session) throw new Error(`signIn failed: ${sErr?.message}`);
  const authClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
  });

  // A two-destination form: START is a manually-entered coordinate near
  // Barstow, CA (no region, manualCoords true); END is what an
  // autocomplete pick for "Bishop, CA" looks like (has a region, the normal
  // path) — so the run exercises BOTH the new exemption and the untouched
  // baseline in one generation, and any regression in the normal path would
  // also show up here.
  const form: ExpeditionForm = {
    destinations: [
      {
        place: "Custom Point (34.8958, -117.0173)",
        coords: [-117.0173, 34.8958],
        region: null,
        manualCoords: true,
        datePin: "flexible",
        date: null,
        dwell: 0,
        note: null,
      },
      {
        place: "Bishop, CA",
        coords: [-118.4009, 37.3639],
        region: "CA",
        manualCoords: false,
        datePin: "flexible",
        date: null,
        dwell: 0,
        note: null,
      },
    ],
    startDate: "2026-09-10",
    endDate: "2026-09-12",
    objective: "manual coordinate anchor verification — short 2-day run",
    budget: "mid",
    maxDailyDriveMi: 350,
    bufferDays: 0,
    avoid: [],
    returnRouting: "shortest",
    vehicleId: "v1",
    vehicleTitle: "Truck",
    rig: {
      build: [],
      fuelRangeMi: 400,
      capability: "mild",
      groupSize: "1-2 travelers",
      skill: "novice",
      preferences: [],
    },
  };

  check(
    "validateExpeditionForm accepts a manualCoords start with no region",
    validateExpeditionForm(form) === null,
    String(validateExpeditionForm(form)),
  );

  const input = expeditionToGenerationInput(form);
  check(
    "expeditionToGenerationInput carries coords onto the start anchor without needing place_id",
    Array.isArray(input.anchors[0].coords) &&
      input.anchors[0].coords![0] === -117.0173 &&
      input.anchors[0].coords![1] === 34.8958,
  );

  let tripId: string | null = null;
  try {
    const facts = await preComputeFacts(input);
    check(
      "preComputeFacts (real Mapbox routing) resolves a route from the manual coordinate — nonzero miles",
      facts.route.totalMi > 0,
      `totalMi=${facts.route.totalMi}`,
    );

    const { audited, dayRoutes, unresolved } = await generateAndAudit(input, facts);
    check(
      "generateAndAudit (real Claude call) returns at least one day",
      audited.days.length > 0,
      `days=${audited.days.length}`,
    );

    const supabase = createSupabaseServiceClient();
    const baked = await bakeGeneratedDays(audited, input, supabase, dayRoutes);
    const trip = await attachHeroPhotos(itineraryToTrip("", input, facts, audited, baked, dayRoutes));

    check(
      "the persisted trip's startLocation reflects the manual point, not a crash or empty string",
      typeof trip.startLocation === "string" && trip.startLocation.length > 0,
      trip.startLocation,
    );
    check("the trip has at least one day with routing data", trip.days.some((d) => d.coords != null));

    const { data: inserted, error } = await authClient
      .from("trips")
      .insert({
        owner_id: sess.user!.id,
        reference_id: null,
        title: trip.title,
        state: "active",
        payload: trip,
      })
      .select("id")
      .single();
    check("insert into public.trips (real RLS-scoped write) succeeds", !error && !!inserted, error?.message);
    tripId = (inserted as { id: string } | null)?.id ?? null;

    if (tripId) {
      const { data: readBack, error: readErr } = await authClient
        .from("trips")
        .select("payload")
        .eq("id", tripId)
        .single();
      const readTrip = (readBack as { payload: Trip } | null)?.payload;
      check(
        "reading the persisted row back shows the same start location and day count",
        !readErr &&
          readTrip?.startLocation === trip.startLocation &&
          readTrip?.days.length === trip.days.length,
        readErr?.message,
      );
    }

    if (unresolved) console.log("note: generateAndAudit reported unresolved anchors — see output above");
  } catch (err) {
    if (err instanceof ItineraryGenerationError) {
      check("pipeline run", false, `ItineraryGenerationError(${err.code}): ${err.message}`);
    } else {
      check("pipeline run", false, err instanceof Error ? err.stack ?? err.message : String(err));
    }
  } finally {
    if (tripId) {
      const { error: delErr } = await authClient.from("trips").delete().eq("id", tripId);
      check("cleanup — temp trip deleted", !delErr, delErr?.message);
    }
  }

  console.log(`\n${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
