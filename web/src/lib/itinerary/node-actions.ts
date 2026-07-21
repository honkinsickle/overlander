"use server";

/**
 * Node-model write actions (spec § node-stack model): create a node seed, pin a
 * POI to a node (with seed promotion), and their removals. All TEST-only,
 * gated by the shared rails, and written STRAIGHT to the trip — these are cheap
 * annotations (array appends), not a paid regeneration, so the living-plan
 * staging machinery would be pure overhead.
 *
 * The write is a whole-payload read-modify-write to reference_trips (same shape
 * living-plan uses). It persists INPUT ONLY: derived fields (per-day
 * corridorCities, seedResolutions) are stripped so serve re-derives them —
 * critically, withCorridors() SKIPS derivation when corridorCities are already
 * present, so persisting a stale spine would hide the very seed just added.
 *
 * NOTE: placeOverrides is keyed by placeId — one home per place (see
 * node-edits.ts). A place cannot be pinned under two nodes.
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { resolveCorridorCities } from "@/lib/trips/resolve-corridor-cities";
import type { Trip, NodeSeed, PlaceNodeOverride } from "@/lib/trips/types";
import { checkRails, type RailsFailure } from "./rails";
import {
  addNodeSeed,
  pinPlaceToNode as pinPure,
  removeSeed as removeSeedPure,
  unpinPlace as unpinPure,
  findNodeInTrip,
} from "./node-edits";

type Ok<T> = { ok: true } & T;
type Result<T> = Ok<T> | RailsFailure;

/** Raw stored payload — NOT the serve-decorated trip (which folds federated
 *  POIs and bakes corridorCities). Writes must round-trip the raw inputs. */
async function loadRaw(tripId: string): Promise<Trip | null> {
  const supabase = createSupabaseServiceClient();
  const { data, error } = await supabase
    .from("reference_trips")
    .select("payload")
    .eq("id", tripId)
    .maybeSingle();
  if (error || !data) return null;
  return data.payload as Trip;
}

/** Strip serve-derived decorations so the next serve re-derives them (and picks
 *  up the overlay change), then upsert the whole payload. */
async function persist(
  trip: Trip,
  overlay: { nodeSeeds?: NodeSeed[]; placeOverrides?: PlaceNodeOverride[] },
): Promise<RailsFailure | null> {
  const days = trip.days.map((d) => {
    const { corridorCities: _cc, ...rest } = d;
    return rest;
  });
  const { seedResolutions: _sr, ...clean } = trip;
  const payload: Trip = {
    ...clean,
    days,
    nodeSeeds: overlay.nodeSeeds ?? trip.nodeSeeds,
    placeOverrides: overlay.placeOverrides ?? trip.placeOverrides,
  };
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("reference_trips").upsert({
    id: trip.id,
    title: trip.title,
    payload,
    source_version: `node-edit@${new Date().toISOString()}`,
  });
  return error ? { ok: false, error: `Write failed: ${error.message}` } : null;
}

/** Append a node seed (idempotent: a coincident existing seed is reused). */
export async function createNodeSeedAction(
  tripId: string,
  input: { name: string; coords: [number, number] },
): Promise<Result<{ seedId: string; created: boolean }>> {
  const railed = checkRails(tripId);
  if (railed) return railed;
  const trip = await loadRaw(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };

  const res = addNodeSeed(trip.nodeSeeds ?? [], {
    name: input.name,
    coords: input.coords,
    createdAt: new Date().toISOString(),
  });
  const failed = await persist(trip, { nodeSeeds: res.seeds });
  if (failed) return failed;
  return { ok: true, seedId: res.id, created: res.created };
}

/** Pin a POI under a node, promoting a gazetteer node to a seed first. */
export async function pinPlaceAction(
  tripId: string,
  input: { dayId: string; placeId: string; nodeId: string },
): Promise<Result<{ nodeId: string; promoted: boolean }>> {
  const railed = checkRails(tripId);
  if (railed) return railed;
  const trip = await loadRaw(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };

  // Resolve the target against the CURRENT spine the user acted on.
  const spine = resolveCorridorCities(trip);
  const target = findNodeInTrip(spine, input.dayId, input.nodeId);
  if (!target) {
    return {
      ok: false,
      error: `Node "${input.nodeId}" not found on day "${input.dayId}".`,
    };
  }

  const before = (trip.nodeSeeds ?? []).length;
  const res = pinPure(
    { nodeSeeds: trip.nodeSeeds ?? [], placeOverrides: trip.placeOverrides ?? [] },
    target,
    input.placeId,
    new Date().toISOString(),
  );
  const failed = await persist(trip, {
    nodeSeeds: res.nodeSeeds,
    placeOverrides: res.placeOverrides,
  });
  if (failed) return failed;
  return { ok: true, nodeId: res.nodeId, promoted: res.nodeSeeds.length > before };
}

/** Remove a seed and prune overrides that pointed at it. */
export async function removeSeedAction(
  tripId: string,
  seedId: string,
): Promise<{ ok: true } | RailsFailure> {
  const railed = checkRails(tripId);
  if (railed) return railed;
  const trip = await loadRaw(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };

  const res = removeSeedPure(
    { nodeSeeds: trip.nodeSeeds ?? [], placeOverrides: trip.placeOverrides ?? [] },
    seedId,
  );
  const failed = await persist(trip, {
    nodeSeeds: res.nodeSeeds,
    placeOverrides: res.placeOverrides,
  });
  if (failed) return failed;
  return { ok: true };
}

/** Unpin a place (returns it to nearest-node bucketing). */
export async function unpinPlaceAction(
  tripId: string,
  placeId: string,
): Promise<{ ok: true } | RailsFailure> {
  const railed = checkRails(tripId);
  if (railed) return railed;
  const trip = await loadRaw(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };

  const placeOverrides = unpinPure(trip.placeOverrides ?? [], placeId);
  const failed = await persist(trip, { placeOverrides });
  if (failed) return failed;
  return { ok: true };
}
