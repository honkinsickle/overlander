/**
 * Pure node-model edit logic (spec § node-stack model) — the array transforms
 * behind the node-actions server actions, factored out so they're unit-testable
 * with no DB. Every function returns NEW arrays; none mutates its input.
 *
 * INVARIANT — placeOverrides is keyed by placeId: a place has exactly ONE home.
 * Pinning a place that's already pinned REPLACES its entry (it does not add a
 * second). A place cannot be pinned under two nodes at once; applyPlaceOverrides
 * relies on this (its placeId→node Map would otherwise pick a last-wins winner
 * silently). Do not append overrides without deduping on placeId.
 */
import { haversineMi } from "@/lib/routing/point-to-polyline";
import type {
  Trip,
  NodeSeed,
  PlaceNodeOverride,
  CorridorCity,
} from "@/lib/trips/types";

/** Two seeds closer than this collapse to one — a repeat pin of the "same"
 *  place returns the existing seed instead of minting a coincident twin (which
 *  would render as two nodes at the same mile: deriveCorridorCities only
 *  de-dupes a gazetteer node NEAR a seed, never seed-near-seed). ~1/4 mi. */
export const SEED_DEDUPE_MI = 0.25;

function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** A short, collision-resistant token. Injectable so tests are deterministic. */
export type SuffixGen = () => string;

const defaultSuffix: SuffixGen = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * Mint a durable seed id: `seed-<slug>-<suffix>`. Slug for legibility, suffix
 * for uniqueness — re-rolls on the (astronomically unlikely) collision with an
 * existing id, so uniqueness is guaranteed, not merely probable.
 */
export function mintSeedId(
  name: string,
  existing: ReadonlySet<string>,
  gen: SuffixGen = defaultSuffix,
): string {
  const slug = slugify(name) || "node";
  for (;;) {
    const id = `seed-${slug}-${gen()}`;
    if (!existing.has(id)) return id;
  }
}

/** The existing seed at (nearly) these coords, or null. */
export function findDuplicateSeed(
  seeds: readonly NodeSeed[],
  coords: [number, number],
  epsMi = SEED_DEDUPE_MI,
): NodeSeed | null {
  return seeds.find((s) => haversineMi(s.coords, coords) <= epsMi) ?? null;
}

/**
 * Append a seed, deduping by coordinate proximity: a place already seeded
 * returns that seed's id and leaves the list unchanged (idempotent). `created`
 * distinguishes a fresh mint from a dedupe hit.
 */
export function addNodeSeed(
  seeds: readonly NodeSeed[],
  input: { name: string; coords: [number, number]; createdAt: string; origin?: NodeSeed["origin"] },
  gen: SuffixGen = defaultSuffix,
): { seeds: NodeSeed[]; id: string; created: boolean } {
  const dup = findDuplicateSeed(seeds, input.coords);
  if (dup) return { seeds: [...seeds], id: dup.id, created: false };
  const id = mintSeedId(input.name, new Set(seeds.map((s) => s.id)), gen);
  return {
    seeds: [
      ...seeds,
      {
        id,
        name: input.name,
        coords: input.coords,
        createdAt: input.createdAt,
        origin: input.origin ?? "manual",
      },
    ],
    id,
    created: true,
  };
}

/** The node a pin targets, resolved from the current derived spine. */
export type PinTarget = Pick<CorridorCity, "id" | "kind" | "name" | "coords">;

/** Locate a node by (dayId, nodeId) in a trip's derived corridorCities. */
export function findNodeInTrip(
  trip: Trip,
  dayId: string,
  nodeId: string,
): PinTarget | null {
  const day = trip.days.find((d) => d.id === dayId);
  const node = day?.corridorCities?.find((n) => n.id === nodeId);
  return node
    ? { id: node.id, kind: node.kind, name: node.name, coords: node.coords }
    : null;
}

/**
 * Pin a place under a node (spec § node-stack model), with SEED PROMOTION: a
 * derived corridor node (gazetteer-picked, not start/end, not already a seed)
 * is minted into a durable seed FIRST, so the override can't dangle when a
 * regeneration re-derives the spine. start/end nodes (anchor-derived) and
 * existing seeds are already durable → the override points at them directly.
 *
 * Keyed by placeId (see file header): any prior home for this place is replaced.
 */
export function pinPlaceToNode(
  state: { nodeSeeds: readonly NodeSeed[]; placeOverrides: readonly PlaceNodeOverride[] },
  target: PinTarget,
  placeId: string,
  createdAt: string,
  gen: SuffixGen = defaultSuffix,
): { nodeSeeds: NodeSeed[]; placeOverrides: PlaceNodeOverride[]; nodeId: string } {
  let nodeSeeds = [...state.nodeSeeds];
  let nodeId = target.id;

  const alreadySeed = nodeSeeds.some((s) => s.id === target.id);
  if (target.kind === "corridor" && !alreadySeed) {
    // LOUD-FAIL the degenerate promotion: a seed minted without a name or coords
    // can't merge back to its gazetteer node via node-identity (name required,
    // coords ≤2mi), so it would split into a PHANTOM TWIN at the same mile — a
    // silent, hard-to-trace spine corruption. Refuse it at the source instead.
    if (!target.name?.trim() || !target.coords) {
      throw new Error(
        `pinPlaceToNode: refusing to promote node "${target.id}" to a seed — ` +
          `missing ${!target.name?.trim() ? "name" : "coords"}. A name/coord-less ` +
          `seed can't merge via node-identity and would render as a phantom twin.`,
      );
    }
    const res = addNodeSeed(
      nodeSeeds,
      { name: target.name, coords: target.coords, createdAt, origin: "promoted" },
      gen,
    );
    nodeSeeds = res.seeds;
    nodeId = res.id; // reuses a coincident seed via dedupe
  }

  // One home per place: drop any existing override for this placeId, then set.
  const placeOverrides = [
    ...state.placeOverrides.filter((o) => o.placeId !== placeId),
    { placeId, nodeId },
  ];
  return { nodeSeeds, placeOverrides, nodeId };
}

/**
 * Remove a seed and prune any overrides that pointed at it. Pruning is tidiness,
 * not correctness — applyPlaceOverrides already falls back to nearest-node for a
 * dangling override — but it keeps the persisted state clean.
 */
export function removeSeed(
  state: { nodeSeeds: readonly NodeSeed[]; placeOverrides: readonly PlaceNodeOverride[] },
  seedId: string,
): { nodeSeeds: NodeSeed[]; placeOverrides: PlaceNodeOverride[] } {
  return {
    nodeSeeds: state.nodeSeeds.filter((s) => s.id !== seedId),
    placeOverrides: state.placeOverrides.filter((o) => o.nodeId !== seedId),
  };
}

/**
 * Drop a place's pin (returns it to nearest-node bucketing) and GC the seed it
 * was pinned to IFF that seed exists ONLY to host pins — `origin:"promoted"` —
 * and no other override still references it. A "manual" seed (deliberately
 * authored) always survives; a legacy seed with no `origin` is treated as manual
 * (never GC'd). This makes unpin the true inverse of a pin's seed-promotion: a
 * pure service point promoted solely by the pin doesn't linger as a phantom
 * empty node once the pin is gone. Pure.
 */
export function unpinPlace(
  state: { nodeSeeds: readonly NodeSeed[]; placeOverrides: readonly PlaceNodeOverride[] },
  placeId: string,
): { nodeSeeds: NodeSeed[]; placeOverrides: PlaceNodeOverride[] } {
  const removed = state.placeOverrides.find((o) => o.placeId === placeId);
  const placeOverrides = state.placeOverrides.filter((o) => o.placeId !== placeId);
  let nodeSeeds = [...state.nodeSeeds];
  if (removed) {
    const seed = nodeSeeds.find((s) => s.id === removed.nodeId);
    const stillReferenced = placeOverrides.some((o) => o.nodeId === removed.nodeId);
    if (seed && seed.origin === "promoted" && !stillReferenced) {
      nodeSeeds = nodeSeeds.filter((s) => s.id !== seed.id);
    }
  }
  return { nodeSeeds, placeOverrides };
}
