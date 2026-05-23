// Throwaway diagnostic — reports routePolyline state in three places to
// confirm whether the DB-cached payload has fallen out of sync with the
// source-of-truth constant. Read-only; does not modify or reseed.
//
// Usage: tsx --env-file=.env.local scripts/check-route-polylines.ts
//
// Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
// web/.env.local (service role bypasses RLS so we can read every row).

import { createClient } from "@supabase/supabase-js";
import { LA_TO_DEADHORSE_POLYLINE } from "../src/lib/trips/alaska-route";
import type { Trip } from "../src/lib/trips/types";

function describe(label: string, value: unknown): void {
  if (typeof value !== "string") {
    console.log(`  ${label}: ${value === undefined ? "<undefined>" : value === null ? "<null>" : `<${typeof value}>`}`);
    return;
  }
  const len = value.length;
  const head = value.slice(0, 50);
  console.log(`  ${label}: length=${len}  head[0..50]=${JSON.stringify(head)}`);
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "✗ NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in web/.env.local",
    );
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n== (3) source-of-truth: LA_TO_DEADHORSE_POLYLINE constant ==");
  describe("constant", LA_TO_DEADHORSE_POLYLINE);

  console.log("\n== (1) reference_trips.la-to-deadhorse.payload.routePolyline ==");
  const { data: refRow, error: refErr } = await supabase
    .from("reference_trips")
    .select("id, title, source_version, updated_at, payload")
    .eq("id", "la-to-deadhorse")
    .maybeSingle();
  if (refErr) {
    console.error("  ✗ query error:", refErr.message);
  } else if (!refRow) {
    console.log("  <row missing>");
  } else {
    console.log(`  source_version=${refRow.source_version}  updated_at=${refRow.updated_at}`);
    const payload = refRow.payload as Trip;
    describe("payload.routePolyline", payload?.routePolyline);
  }

  console.log(
    "\n== (2) public.trips — most recent fork of la-to-deadhorse ==",
  );
  const { data: forks, error: forkErr } = await supabase
    .from("trips")
    .select("id, owner_id, title, reference_id, state, created_at, payload")
    .eq("reference_id", "la-to-deadhorse")
    .order("created_at", { ascending: false })
    .limit(3);
  if (forkErr) {
    console.error("  ✗ query error:", forkErr.message);
  } else if (!forks || forks.length === 0) {
    console.log("  <no forks of la-to-deadhorse found>");
  } else {
    console.log(`  found ${forks.length} fork(s); showing each:`);
    for (const t of forks) {
      console.log(
        `  ─ id=${t.id}  owner=${t.owner_id}  state=${t.state}  created=${t.created_at}`,
      );
      const payload = t.payload as Trip;
      describe("    payload.routePolyline", payload?.routePolyline);
    }
  }

  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
