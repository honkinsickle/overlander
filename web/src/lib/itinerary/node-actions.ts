"use server";

/**
 * Node-model write actions (spec § node-stack model): create a node seed, pin a
 * POI to a node (with seed promotion), reorder POIs, and their removals.
 *
 * ADR §1 dispatch (STEP 4): each action dispatches on `isUserTripId(tripId)`.
 *   - UUID user trips  -> public.trips through updateUserTripPayload (SSR/RLS,
 *     the STEP 2 optimistic-concurrency envelope). The mutate re-runs the pure
 *     edit against the FRESH payload every attempt and re-bakes corridorCities.
 *   - slug reference trips -> reference_trips via the SERVICE client, the
 *     original strip-and-serve-re-derive path. UNCHANGED, incl. checkManualRails.
 *
 * PAYLOAD SHAPE DIVERGES BY TABLE, BY DESIGN (do NOT "fix" one to match the
 * other): UUID rows carry BAKED corridorCities; slug rows carry them STRIPPED.
 * See `writeEdit` for why — the two serve paths differ.
 *
 * The write persists INPUT plus (UUID) freshly-baked corridorCities; the derived
 * `seedResolutions` is stripped/re-stamped by the bake.
 *
 * NOTE: placeOverrides is keyed by placeId — one home per place (see
 * node-edits.ts). A place cannot be pinned under two nodes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSupabaseServiceClient,
  createSupabaseServerClient,
} from "@/lib/supabase/server";
import { isUserTripId, updateUserTripPayload } from "@/lib/trips/user-trips";
import { resolveCorridorCities } from "@/lib/trips/resolve-corridor-cities";
import type { Trip, NodeSeed, PlaceNodeOverride } from "@/lib/trips/types";
import { checkManualRails, type RailsFailure } from "./rails";
import {
  addNodeSeed,
  pinPlaceToNode as pinPure,
  removeSeed as removeSeedPure,
  unpinPlace as unpinPure,
  findNodeInTrip,
} from "./node-edits";

type Ok<T> = { ok: true } & T;
type Result<T> = Ok<T> | RailsFailure;

/** DI seam for verification: drive the real actions under a seeded JWT. Client
 *  components omit it — production uses the per-request SSR client. */
type EditDeps = { client?: SupabaseClient };

type Overlay = {
  nodeSeeds?: NodeSeed[];
  placeOverrides?: PlaceNodeOverride[];
  placeRanks?: Record<string, { nodeId: string; rank: number }>;
};

/** Apply an overlay onto a trip and strip the derived `seedResolutions`. Does
 *  NOT touch corridorCities — each write path handles those (see `writeEdit`).
 *  Identical overlay logic across both tables. */
function applyOverlay(trip: Trip, overlay: Overlay): Trip {
  const { seedResolutions: _sr, ...clean } = trip;
  return {
    ...clean,
    nodeSeeds: overlay.nodeSeeds ?? trip.nodeSeeds,
    placeOverrides: overlay.placeOverrides ?? trip.placeOverrides,
    placeRanks: overlay.placeRanks ?? trip.placeRanks,
  };
}

/** Raw stored payload for a slug reference trip — NOT the serve-decorated trip.
 *  Slug path only; the UUID path reads through updateUserTripPayload under RLS. */
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

/** Slug path persist: STRIP corridorCities so the reference serve
 *  (`reference.ts` withCorridors) re-derives them, then service-upsert to
 *  reference_trips. UNCHANGED from the pre-ADR-§1 behavior. */
async function persistSlug(
  trip: Trip,
  overlay: Overlay,
): Promise<RailsFailure | null> {
  const applied = applyOverlay(trip, overlay);
  const days = applied.days.map((d) => {
    const { corridorCities: _cc, ...rest } = d;
    return rest;
  });
  const payload: Trip = { ...applied, days };
  const supabase = createSupabaseServiceClient();
  const { error } = await supabase.from("reference_trips").upsert({
    id: trip.id,
    title: trip.title,
    payload,
    source_version: `node-edit@${new Date().toISOString()}`,
  });
  return error ? { ok: false, error: `Write failed: ${error.message}` } : null;
}

/** Write-guard, dispatched on trip id.
 *
 *   UUID: AUTHENTICATED (getUser, clean error). Ownership + editability are
 *     enforced STRUCTURALLY by RLS (`trips_update_owner`) — a non-owner's
 *     read/write returns 0 rows, so updateUserTripPayload no-ops to null; there
 *     is deliberately no app-level owner check. At this scope "editable" == a
 *     user-owned UUID trip; a future `state`/`editable` predicate slots in here.
 *   slug: checkManualRails UNCHANGED (manual flag + frozen + TEST-ref, incl.
 *     checkNotFrozen). The MANUAL surface — pure overlay writes, no LLM spend —
 *     so it reads NEXT_PUBLIC_LIVING_PLAN_EDIT, not the NL flag.
 */
async function guard(tripId: string, deps: EditDeps): Promise<RailsFailure | null> {
  if (isUserTripId(tripId)) {
    const supabase = deps.client ?? (await createSupabaseServerClient());
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Sign in to edit this trip." };
    return null;
  }
  return checkManualRails(tripId);
}

/**
 * Persist an overlay edit, dispatched on trip id — the ADR §1 seam.
 *
 *   UUID user trips -> public.trips via updateUserTripPayload (onConflict
 *     "retry"). The mutate re-runs `edit` against the FRESH payload every
 *     attempt (so concurrent edits to different targets COMPOSE — it never
 *     captures a precomputed overlay, which would clobber the winner) and
 *     RE-BAKES corridorCities via resolveCorridorCities, because the
 *     public.trips serve path (getUserTrip) does NOT re-derive them. NEVER the
 *     service client here — it bypasses RLS.
 *   slug -> reference_trips via the service client, strip-and-serve-re-derive.
 *
 * PAYLOAD SHAPE DIVERGES BY TABLE, BY DESIGN: UUID carries BAKED corridorCities,
 * slug carries them STRIPPED. Each is correct for its own serve path
 * (reference.ts withCorridors re-derives; getUserTrip does not). A UUID trip
 * with no routePolyline: resolveCorridorCities returns it UNCHANGED, so the
 * overlay still persists and the existing spine is preserved — graceful, never a
 * silently-worse corridor.
 */
async function writeEdit<M>(
  tripId: string,
  edit: (trip: Trip) => { overlay: Overlay; meta: M } | null,
  deps: EditDeps,
): Promise<Result<{ meta: M }>> {
  if (isUserTripId(tripId)) {
    const box: { meta?: M } = {};
    const updated = await updateUserTripPayload(
      tripId,
      (fresh) => {
        const r = edit(fresh);
        if (!r) return null;
        box.meta = r.meta;
        return resolveCorridorCities(applyOverlay(fresh, r.overlay));
      },
      { onConflict: "retry", client: deps.client },
    );
    const meta = box.meta;
    if (updated === null || meta === undefined) {
      return {
        ok: false,
        error: "Could not save your edit — reload and try again.",
      };
    }
    return { ok: true, meta };
  }
  const trip = await loadRaw(tripId);
  if (!trip) return { ok: false, error: `Trip "${tripId}" not found.` };
  const r = edit(trip);
  if (!r) return { ok: false, error: "Edit could not be applied." };
  const failed = await persistSlug(trip, r.overlay);
  if (failed) return failed;
  return { ok: true, meta: r.meta };
}

/** Append a node seed (idempotent: a coincident existing seed is reused). */
export async function createNodeSeedAction(
  tripId: string,
  input: { name: string; coords: [number, number] },
  deps: EditDeps = {},
): Promise<Result<{ seedId: string; created: boolean }>> {
  const railed = await guard(tripId, deps);
  if (railed) return railed;
  const res = await writeEdit(
    tripId,
    (trip) => {
      const r = addNodeSeed(trip.nodeSeeds ?? [], {
        name: input.name,
        coords: input.coords,
        createdAt: new Date().toISOString(),
      });
      return {
        overlay: { nodeSeeds: r.seeds },
        meta: { seedId: r.id, created: r.created },
      };
    },
    deps,
  );
  if (!res.ok) return res;
  return { ok: true, seedId: res.meta.seedId, created: res.meta.created };
}

/** Pin a POI under a node, promoting a gazetteer node to a seed first. An
 *  optional `rankWrites` lands the place AT a position in the SAME write, so
 *  attachment + authored order commit atomically. The target node is re-resolved
 *  against the FRESH spine on every retry (the hard constraint). */
export async function pinPlaceAction(
  tripId: string,
  input: {
    dayId: string;
    placeId: string;
    nodeId: string;
    rankWrites?: Record<string, { nodeId: string; rank: number }>;
  },
  deps: EditDeps = {},
): Promise<Result<{ nodeId: string; promoted: boolean }>> {
  const railed = await guard(tripId, deps);
  if (railed) return railed;
  const res = await writeEdit(
    tripId,
    (trip) => {
      // Re-resolve the spine + target against THIS (fresh) payload, per retry.
      const spine = resolveCorridorCities(trip);
      const target = findNodeInTrip(spine, input.dayId, input.nodeId);
      if (!target) return null;
      const before = (trip.nodeSeeds ?? []).length;
      const r = pinPure(
        {
          nodeSeeds: trip.nodeSeeds ?? [],
          placeOverrides: trip.placeOverrides ?? [],
        },
        target,
        input.placeId,
        new Date().toISOString(),
      );
      const placeRanks = input.rankWrites
        ? { ...(trip.placeRanks ?? {}), ...input.rankWrites }
        : undefined;
      return {
        overlay: {
          nodeSeeds: r.nodeSeeds,
          placeOverrides: r.placeOverrides,
          placeRanks,
        },
        meta: { nodeId: r.nodeId, promoted: r.nodeSeeds.length > before },
      };
    },
    deps,
  );
  if (!res.ok) return res;
  return { ok: true, nodeId: res.meta.nodeId, promoted: res.meta.promoted };
}

/** Remove a seed and prune overrides that pointed at it. */
export async function removeSeedAction(
  tripId: string,
  seedId: string,
  deps: EditDeps = {},
): Promise<{ ok: true } | RailsFailure> {
  const railed = await guard(tripId, deps);
  if (railed) return railed;
  const res = await writeEdit(
    tripId,
    (trip) => {
      const r = removeSeedPure(
        {
          nodeSeeds: trip.nodeSeeds ?? [],
          placeOverrides: trip.placeOverrides ?? [],
        },
        seedId,
      );
      return {
        overlay: { nodeSeeds: r.nodeSeeds, placeOverrides: r.placeOverrides },
        meta: {},
      };
    },
    deps,
  );
  if (!res.ok) return res;
  return { ok: true };
}

/** Unpin a place (returns it to nearest-node bucketing) and GC a promoted seed
 *  left with no remaining references. */
export async function unpinPlaceAction(
  tripId: string,
  placeId: string,
  deps: EditDeps = {},
): Promise<{ ok: true } | RailsFailure> {
  const railed = await guard(tripId, deps);
  if (railed) return railed;
  const res = await writeEdit(
    tripId,
    (trip) => {
      const r = unpinPure(
        {
          nodeSeeds: trip.nodeSeeds ?? [],
          placeOverrides: trip.placeOverrides ?? [],
        },
        placeId,
      );
      return {
        overlay: { nodeSeeds: r.nodeSeeds, placeOverrides: r.placeOverrides },
        meta: {},
      };
    },
    deps,
  );
  if (!res.ok) return res;
  return { ok: true };
}

/** Merge authored rank writes (from insertRank) into placeRanks and persist. The
 *  merge re-spreads THIS edit's `rankWrites` over the FRESH placeRanks per retry,
 *  so concurrent rank edits to different places compose (same-place is
 *  last-write-wins, self-healed by the next drag). */
export async function setPlaceRankAction(
  tripId: string,
  rankWrites: Record<string, { nodeId: string; rank: number }>,
  deps: EditDeps = {},
): Promise<{ ok: true } | RailsFailure> {
  const railed = await guard(tripId, deps);
  if (railed) return railed;
  const res = await writeEdit(
    tripId,
    (trip) => ({
      overlay: { placeRanks: { ...(trip.placeRanks ?? {}), ...rankWrites } },
      meta: {},
    }),
    deps,
  );
  if (!res.ok) return res;
  return { ok: true };
}
