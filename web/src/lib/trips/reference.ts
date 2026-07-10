import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isConfigured } from "@/lib/supabase/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveCorridorCities } from "./resolve-corridor-cities";
import { foldFederatedCorridorSupply } from "./bake-corridors";
import type { Trip } from "./types";

/** Where the committed snapshot lives. Resolved from the Next.js project
 *  root (`web/`) so server runtime + Node scripts both pick it up. */
const SNAPSHOT_FILE = ".alaska-snapshot.json";

let cachedReferenceTrip: { id: string; trip: Trip } | null = null;
let snapshotPromise: Promise<Trip> | null = null;

/** Load the LA→Deadhorse reference trip. DB-first; falls back to the
 *  committed snapshot if Supabase is unconfigured / unreachable / empty.
 *
 *  Build never depends on a live DB — the snapshot in `web/.alaska-snapshot.json`
 *  is the always-available source. Refresh it via `npm run snapshot`. */
export async function getAlaskaTrip(): Promise<Trip> {
  return getReferenceTrip("la-to-deadhorse");
}

export async function getReferenceTrip(id: string): Promise<Trip> {
  if (cachedReferenceTrip?.id === id) return cachedReferenceTrip.trip;

  const fromDb = await tryFetchFromDb(id);
  if (fromDb) {
    const trip = withCorridors(await withFederatedCorridorSupply(fromDb));
    cachedReferenceTrip = { id, trip };
    return trip;
  }

  const fromSnapshot = withCorridors(
    await withFederatedCorridorSupply(await loadSnapshot()),
  );
  cachedReferenceTrip = { id, trip: fromSnapshot };
  return fromSnapshot;
}

/** In-process corridor hydration (Option 1, 2026-07-07): stored
 *  reference payloads predate the corridor engine, so derive
 *  Day.corridorCities here — same resolveCorridorCities the seed-time
 *  build runs — before the result is memoized above. Pays a one-time
 *  cold cost per server process; skipped entirely once a reseeded
 *  payload arrives already carrying corridors. */
function withCorridors(trip: Trip): Trip {
  if (trip.days.some((d) => d.corridorCities)) return trip;
  const t0 = performance.now();
  const resolved = resolveCorridorCities(trip);
  const withCount = resolved.days.filter((d) => d.corridorCities).length;
  console.log(
    `[reference] corridor derivation: ${(performance.now() - t0).toFixed(0)}ms for ${withCount}/${resolved.days.length} days (memoized after first call)`,
  );
  return resolved;
}

/** Phase 1 (2026-07-09, flag `USE_FEDERATED_CORRIDOR`): fold federated
 *  master_place POIs into each day's `segmentSuggestions` BEFORE corridor
 *  derivation, so corpus places bucket under nodes via the existing
 *  segmentSuggestions path — both the bucket pool (resolve-corridor-cities)
 *  and the render pool (placePool) already read that field, so no component
 *  change. Live at serve, memoized with the trip (one cold fetch per server
 *  process) — no reseed.
 *
 *  Corpus is essentials-only (no ratings/photos), so the resulting tiles
 *  render name/category/description with a placeholder image and no stars.
 *
 *  Deliberately a SEPARATE flag from `USE_FEDERATED_POIS` (browse + map
 *  search): flipping this on cannot change those surfaces. Fails soft —
 *  any per-day RPC error leaves that day untouched. */
async function withFederatedCorridorSupply(trip: Trip): Promise<Trip> {
  if (process.env.USE_FEDERATED_CORRIDOR !== "true") return trip;
  if (!isConfigured()) return trip;

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return trip;
  }

  // Shared with the fork route's bake-at-create path (bake-corridors.ts):
  // the reference serve news up its own client and folds live-at-serve.
  return foldFederatedCorridorSupply(trip, supabase);
}

async function tryFetchFromDb(id: string): Promise<Trip | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase
      .from("reference_trips")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    if (error || !data) return null;
    return data.payload as Trip;
  } catch {
    return null;
  }
}

async function loadSnapshot(): Promise<Trip> {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const path = join(process.cwd(), SNAPSHOT_FILE);
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as Trip;
    })();
  }
  return snapshotPromise;
}
