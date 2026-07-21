/**
 * B — exercise the node-SEED path end to end on real data for the first time.
 * Pins Bell 2 Lodge (a Cassiar service point that no populated-places gazetteer
 * will ever carry) as a node on dawson-cassiar-livingplan-test, via the real
 * createNodeSeedAction, and verifies through the serve transform that:
 *   1. the seed persists (nodeSeeds),
 *   2. deriveCorridorCities FORCE-INCLUDES it past popFloor/spacing/maxNodes,
 *   3. it renders as a node (kind:"corridor") on its day,
 *   4. seedResolutions reports it resolved (not dormant),
 *   5. the node/card dedup (C) then strips the Bell 2 Lodge POI card.
 *
 * TEST-only: createNodeSeedAction gates on checkRails (flag + TEST-ref +
 * forbidden-id). --write performs the real DB write; default is a dry preview.
 *   npx tsx --env-file=.env.development.local scripts/verify-bell2-seed.ts --write
 */
process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = "1"; // rails flag (TEST edit path)

import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import { createNodeSeedAction } from "../src/lib/itinerary/node-actions";
import type { Trip } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("znldzjdatkogdktymtvi")) throw new Error(`TEST-ref-or-abort: ${url}`);
  const write = process.argv.includes("--write");
  const sb = createSupabaseServiceClient();

  const { data } = await sb.from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
  const trip = data!.payload as Trip;

  // Bell 2 Lodge lives in day 5's segmentSuggestions — grab its real coords.
  const bell = trip.days.flatMap((d) => d.segmentSuggestions ?? []).find((p) => /bell 2 lodge/i.test(p.title ?? ""));
  if (!bell?.coords) throw new Error("Bell 2 Lodge POI not found on the trip");
  console.log(`Bell 2 Lodge POI: id=${bell.id} coords=${JSON.stringify(bell.coords)}`);
  console.log(`existing nodeSeeds: ${(trip.nodeSeeds ?? []).length}`);

  if (!write) {
    console.log("\nDRY — would call createNodeSeedAction with name='Bell 2 Lodge'. Re-run with --write.");
    return;
  }

  const res = await createNodeSeedAction(TRIP_ID, { name: "Bell 2 Lodge", coords: bell.coords });
  console.log(`\ncreateNodeSeedAction → ${JSON.stringify(res)}`);
  if (!res.ok) throw new Error("action failed");

  // Read back RAW + run the serve transform.
  const { data: rb } = await sb.from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
  const raw = rb!.payload as Trip;
  console.log(`\n1. seed persisted: nodeSeeds=${(raw.nodeSeeds ?? []).length}  (${(raw.nodeSeeds ?? []).map((s) => s.name).join(", ")})`);
  console.log(`   corridorCities stripped for re-derive: ${raw.days.every((d) => !d.corridorCities) ? "yes" : "NO (stale spine persisted)"}`);

  const served = resolveCorridorCities(raw);
  const d5 = served.days[4];
  const node = (d5.corridorCities ?? []).find((c) => /bell 2/i.test(c.name));
  const bellPop = 0; // Bell 2 is sub-floor / no population — force-include is the only way it's a node
  console.log(`\n2-3. Bell 2 as a NODE on day 5: ${node ? `yes — ${node.name}@${Math.round(node.milesFromStart)} kind=${node.kind}` : "NO"}`);
  console.log(`     (force-included past popFloor 10k — Bell 2 pop≈${bellPop})`);
  console.log(`     day 5 spine: ${(d5.corridorCities ?? []).map((c) => `${c.name}@${Math.round(c.milesFromStart)}`).join(" · ")}`);

  const resolved = (served.seedResolutions ?? []).find((r: { name?: string }) => /bell 2/i.test(r.name ?? ""));
  console.log(`\n4. seedResolutions reports it: ${resolved ? JSON.stringify(resolved) : "absent"}`);

  const card = (d5.segmentSuggestions ?? []).find((p) => /bell 2 lodge/i.test(p.title ?? ""));
  console.log(`\n5. dedup: Bell 2 Lodge still a CARD on day 5: ${card ? "STILL PRESENT" : "stripped ✓ (renders once, as the node)"}`);
  console.log(`   day 5 cards: ${(d5.segmentSuggestions ?? []).map((p) => p.title).join(" · ")}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
