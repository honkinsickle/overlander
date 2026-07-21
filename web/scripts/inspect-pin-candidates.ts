/**
 * Read-only: print each real-spine day's nodes + their bucketed placeIds (with
 * POI titles), so we can pick a POI clustering under node A and pin it to a
 * DISAGREEING node B (Phase 0 falsification). No writes.
 *   npx tsx --env-file=.env.development.local scripts/inspect-pin-candidates.ts
 */
process.env.NEXT_PUBLIC_LIVING_PLAN_EDIT = "1";

import { createSupabaseServiceClient } from "../src/lib/supabase/server";
import { resolveCorridorCities } from "../src/lib/trips/resolve-corridor-cities";
import type { Trip, Day } from "../src/lib/trips/types";

const TRIP_ID = "dawson-cassiar-livingplan-test";

/** id → title for every place in the day's render pool. */
function poolTitles(day: Day): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of day.segmentSuggestions ?? []) m.set(p.id, p.title ?? p.id);
  for (const p of Object.values(day.suggestions ?? {})) m.set(p.id, p.title ?? p.id);
  for (const w of day.waypoints ?? []) m.set(w.id, w.title ?? w.id);
  return m;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes("znldzjdatkogdktymtvi")) throw new Error(`TEST-ref-or-abort: ${url}`);
  const sb = createSupabaseServiceClient();
  const { data } = await sb.from("reference_trips").select("payload").eq("id", TRIP_ID).maybeSingle();
  const raw = data!.payload as Trip;
  console.log(`nodeSeeds: ${(raw.nodeSeeds ?? []).map((s) => `${s.name}=${s.id}`).join(", ") || "none"}`);
  console.log(`placeOverrides: ${JSON.stringify(raw.placeOverrides ?? [])}`);

  const served = resolveCorridorCities(raw);
  served.days.forEach((day, i) => {
    const cities = day.corridorCities ?? [];
    if (cities.length < 3) return; // real-spine days only
    const titles = poolTitles(day);
    console.log(`\n── Day ${i + 1} (${day.id}) — ${day.label}`);
    cities.forEach((c, ci) => {
      const ids = c.placeIds ?? [];
      const labelled = ids.map((id) => `${id} "${titles.get(id) ?? "??"}"`);
      console.log(`  [node ${ci}] id=${c.id}  ${c.name}@${Math.round(c.milesFromStart)} kind=${c.kind}  placeIds(${ids.length}): ${labelled.join(" | ") || "—"}`);
    });
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
