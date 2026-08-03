/**
 * Live verification of `insertRestDay` on a real TEST trip (not by reading). Clones
 * the expedition-ms28y793 generated payload (48-tile generated shape) into a temp
 * UUID row, inserts a rest day, asserts the write invariants against the STORED
 * payload, observes whether the corpus populated suggestions, checks the frozen
 * refusal, and DELETES the temp row (snapshot = it didn't exist).
 *
 * insertRestDay makes ZERO route calls, so no Mapbox token is needed.
 *   cd web && npx tsx --env-file=.env.development.local scripts/verify-rest-day.ts
 */
import { createClient } from "@supabase/supabase-js";
import { insertRestDay } from "@/lib/trips/repository";
import { checkNotFrozen } from "@/lib/itinerary/rails";
import { addDaysISO } from "@/lib/trips/reorder-days";
import type { Trip } from "@/lib/trips/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const client = createClient(url, key, { auth: { persistSession: false } });

let pass = 0,
  fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

async function read(id: string): Promise<Trip> {
  const { data, error } = await client.from("trips").select("payload").eq("id", id).maybeSingle();
  if (error) throw new Error(`read ${id}: ${error.message}`);
  if (!data) throw new Error(`read ${id}: row not found`);
  return (data as { payload: Trip }).payload;
}

async function main() {
  const { data: u } = await client.from("users").select("id").limit(1).single();
  const ownerId = (u as { id: string }).id;
  const { data: ref } = await client
    .from("reference_trips")
    .select("payload")
    .eq("id", "expedition-ms28y793")
    .single();
  const sourcePayload = (ref as { payload: Trip }).payload;

  const ids: string[] = [];
  const makeRow = async (): Promise<string> => {
    const id = crypto.randomUUID();
    const payload = { ...structuredClone(sourcePayload), id };
    const { error } = await client
      .from("trips")
      .insert({ id, owner_id: ownerId, reference_id: null, title: "REST-DAY VERIFY", state: "active", payload });
    if (error) throw new Error(`insert: ${error.message}`);
    ids.push(id);
    return id;
  };

  try {
    const t = await makeRow();
    const before = await read(t);
    const anchorId = "day-2";
    const anchorIdx = before.days.findIndex((d) => d.id === anchorId);
    const anchor = before.days[anchorIdx];
    const tailBefore = before.days.slice(anchorIdx + 1).map((d) => ({ label: d.label, date: d.date }));

    // Overlay state up front — the render/overlay-survival claim depends on it.
    check(
      "instrument has empty overlays (so overlay survival stays unit-only)",
      (before.placeOverrides?.length ?? 0) === 0 && Object.keys(before.placeRanks ?? {}).length === 0,
      `overrides=${before.placeOverrides?.length ?? 0} ranks=${Object.keys(before.placeRanks ?? {}).length}`,
    );

    const r = await insertRestDay(t, anchorId, { client });
    check("insertRestDay returned ok", r.ok, r.ok ? `restDayId=${r.restDayId} suggestions=${r.suggestionCount}` : r.reason);
    if (!r.ok) return;

    const after = await read(t);
    const rd = after.days.find((d) => d.id === r.restDayId)!;

    check(
      "layover: start === end (byte-identical) at the anchor's stop, miles 0, driveHours 0, no spine",
      JSON.stringify(rd.startCoord) === JSON.stringify(rd.coords) &&
        JSON.stringify(rd.startCoord) === JSON.stringify(anchor.coords) &&
        rd.miles === 0 && rd.driveHours === 0 && rd.corridorCities === undefined,
      `start=${JSON.stringify(rd.startCoord)} miles=${rd.miles} hrs=${rd.driveHours} spine=${rd.corridorCities} label="${rd.label}"`,
    );

    check(
      "inserted at N+1, tail renumbered contiguous (positional ids)",
      after.days.length === before.days.length + 1 &&
        after.days.every((d, i) => d.id === `day-${i + 1}` && d.dayNumber === i + 1),
      `${before.days.length} → ${after.days.length} days; layover id=${rd.id} #${rd.dayNumber}`,
    );

    check(
      "layover dated anchor+1; tail redated +1 with labels intact",
      rd.date === addDaysISO(anchor.date, 1) &&
        after.days.slice(anchorIdx + 2).every((d, i) =>
          d.label === tailBefore[i].label && d.date === addDaysISO(tailBefore[i].date, 1)),
      `anchor ${anchor.date} → layover ${rd.date}; tail[0] ${tailBefore[0]?.date}→${after.days[anchorIdx + 2]?.date}`,
    );

    check(
      "segmentSuggestions match the returned count; sparse (no authored prose)",
      (rd.segmentSuggestions?.length ?? 0) === r.suggestionCount &&
        rd.description === undefined && rd.weather === undefined &&
        rd.notes === undefined && rd.overnight === undefined && rd.heroImage === undefined,
      `count=${rd.segmentSuggestions?.length ?? 0} first=${(rd.segmentSuggestions ?? []).slice(0, 2).map((s) => `${s.id}:${(s as { title?: string }).title}`).join(" | ") || "(none)"}`,
    );

    check(
      "layover leaves routePolyline intact (zero route calls; no rebuild)",
      after.routePolyline === before.routePolyline,
      `${before.routePolyline ? before.routePolyline.length + " chars" : "none"} unchanged=${after.routePolyline === before.routePolyline}`,
    );

    // Frozen refusal — property guard (action layer) + repo layer.
    const frozen = checkNotFrozen("dawson-vancouver-cassiar");
    check("checkNotFrozen refuses the frozen slug", frozen !== null && frozen.ok === false, frozen?.error ?? "");
    const frozenInsert = await insertRestDay("dawson-vancouver-cassiar", "day-1", { client });
    check(
      "insertRestDay refuses the frozen slug at the repo layer (not-user-trip)",
      !frozenInsert.ok && frozenInsert.reason === "not-user-trip",
      frozenInsert.ok ? "UNEXPECTEDLY OK" : frozenInsert.reason,
    );
  } finally {
    for (const id of ids) await client.from("trips").delete().eq("id", id);
    console.log(`\ncleanup: deleted ${ids.length} temp row(s)`);
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"}: ${pass} pass, ${fail} fail`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("VERIFY ERROR:", e);
  process.exit(1);
});
