/**
 * Phase 0 falsification on real data: pin a POI to a node that DISAGREES with
 * geometry, via the real pinPlaceAction (seed-promotion included), then measure
 * the served result. --unpin reverses it via unpinPlaceAction.
 *
 *   npx tsx --env-file=.env.development.local scripts/verify-pin-disagree.ts --pin
 *   npx tsx --env-file=.env.development.local scripts/verify-pin-disagree.ts --unpin
 *
 * TEST-only (checkRails: flag + TEST-ref + forbidden-id). Reads back RAW and
 * runs the serve transform, so it reports what the client will actually get.
 */
process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = "1";

import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import { pinPlaceAction, unpinPlaceAction, removeSeedAction } from "../src/lib/itinerary/node-actions";
import type { Trip, Day } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";
const DAY_ID = "day-5";
const PLACE_ID = "google:ChIJWzmgut0vClQRhWFIcMV2lfE"; // Bear Glacier Provincial Park
const NODE_ID = "dease-lake-bc"; // corridor node @95 — currently clusters under Stewart@338

function titleFor(day: Day, id: string): string {
  for (const p of day.segmentSuggestions ?? []) if (p.id === id) return p.title ?? id;
  for (const p of Object.values(day.suggestions ?? {})) if (p.id === id) return p.title ?? id;
  for (const w of day.waypoints ?? []) if (w.id === id) return w.title ?? id;
  return "??";
}

/** Which served node currently holds a placeId, if any. */
function locate(day: Day, placeId: string): string | null {
  for (const c of day.corridorCities ?? []) {
    if ((c.placeIds ?? []).includes(placeId)) return `${c.name}@${Math.round(c.milesFromStart)} (id=${c.id})`;
  }
  return null;
}

function printDay5(raw: Trip, label: string) {
  const served = resolveCorridorCities(raw);
  const d5 = served.days.find((d) => d.id === DAY_ID)!;
  console.log(`\n${label}`);
  console.log(`  overrides: ${JSON.stringify(raw.placeOverrides ?? [])}`);
  console.log(`  nodeSeeds: ${(raw.nodeSeeds ?? []).map((s) => `${s.name}=${s.id}`).join(", ")}`);
  console.log(`  spine: ${(d5.corridorCities ?? []).map((c) => `${c.name}@${Math.round(c.milesFromStart)}`).join(" · ")}`);
  (d5.corridorCities ?? []).forEach((c) => {
    const ids = c.placeIds ?? [];
    if (ids.length) console.log(`    ${c.name}@${Math.round(c.milesFromStart)} (id=${c.id}): ${ids.map((id) => `"${titleFor(d5, id)}"`).join(", ")}`);
  });
  console.log(`  → "${titleFor(d5, PLACE_ID)}" is under: ${locate(d5, PLACE_ID) ?? "NO NODE (residual/geometry stretch)"}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("znldzjdatkogdktymtvi")) throw new Error(`TEST-ref-or-abort: ${url}`);
  const mode = process.argv.includes("--unpin")
    ? "unpin"
    : process.argv.includes("--pin")
      ? "pin"
      : process.argv.includes("--remove-seed")
        ? "remove-seed"
        : null;
  if (!mode) throw new Error("pass --pin, --unpin, or --remove-seed <seedId>");
  const sb = createSupabaseServiceClient();
  const read = async () => (await sb.from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle()).data!.payload as Trip;

  printDay5(await read(), `BEFORE ${mode}:`);

  if (mode === "remove-seed") {
    const seedId = process.argv[process.argv.indexOf("--remove-seed") + 1];
    if (!seedId) throw new Error("--remove-seed needs a seedId arg");
    const res = await removeSeedAction(TRIP_ID, seedId);
    console.log(`\nremoveSeedAction(${seedId}) → ${JSON.stringify(res)}`);
    if (!res.ok) throw new Error("remove failed");
  } else if (mode === "pin") {
    const res = await pinPlaceAction(TRIP_ID, { dayId: DAY_ID, placeId: PLACE_ID, nodeId: NODE_ID });
    console.log(`\npinPlaceAction → ${JSON.stringify(res)}`);
    if (!res.ok) throw new Error("pin failed");
  } else {
    const res = await unpinPlaceAction(TRIP_ID, PLACE_ID);
    console.log(`\nunpinPlaceAction → ${JSON.stringify(res)}`);
    if (!res.ok) throw new Error("unpin failed");
  }

  const raw = await read();
  console.log(`\n  corridorCities stripped for re-derive: ${raw.days.every((d) => !d.corridorCities) ? "yes" : "NO (stale spine persisted)"}`);
  printDay5(raw, `AFTER ${mode}:`);
}
main().catch((e) => { console.error(e); process.exit(1); });
