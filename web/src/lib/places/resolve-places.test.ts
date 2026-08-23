/**
 * `resolvePlaces()` behaviour, driven through the dependency seam.
 *
 * SCOPE NOTE: the session's brief asked for tests on the id normalization
 * specifically (that is place-id.test.ts, and it is the exhaustive one). These
 * additional tests exist because the brief also asked for resolvePlaces() to be
 * "correct in isolation, verified by tests" — merge, dedupe, scope branching
 * and fail-soft are the parts that carry behaviour, so leaving them unpinned
 * would make that claim hollow.
 *
 * No network, no DB, no env: every dependency is faked via `deps`. Nothing here
 * touches Supabase, Typesense, or Google.
 *
 * Run: cd web && npx tsx --test src/lib/places/resolve-places.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePlaces,
  enrichByGoogleId,
  classifyVerificationTier,
  sortByVerificationTier,
  isSuggestable,
  type ResolveDeps,
} from "./resolve-places";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import {
  mapMasterPlaceRow,
  type MasterPlaceRow,
} from "@/lib/trip-browse/federated";

const UUID = "531b1c71-96f2-4002-bc4e-cc1b6db49dc1";
const UUID2 = "7af6a3d1-3a16-479c-926e-3eee7a2ba65c";
const GID = "ChIJN1t_tDeuEmsRUsoyG83frY4";

type DescSource = "source" | "template" | "llm" | null;

/** A federated master_place row shaped as `hydratePlacesByIds` (via the export
 *  view) and `pois_along_corridor` hand it to `mapMasterPlaceRow`. Minimal but
 *  real-shaped: it carries `description_source`, which is the whole point. */
function federatedRow(uuid: string, description_source: DescSource): MasterPlaceRow {
  return {
    id: uuid,
    canonical_name: `place-${uuid.slice(0, 4)}`,
    primary_category: "campground",
    lng: -122.68,
    lat: 45.52,
    prominence_score: 0,
    mvum_corridor: null,
    overlander_tags: null,
    amenities: null,
    hours: null,
    contact: null,
    access: null,
    services: null,
    capacity: null,
    seasonality: null,
    cell_signal: null,
    geometry_polygon: null,
    description: null,
    attribution: null,
    description_source,
  };
}

/** A fake `hydratePlacesByIds` that matches the REAL function's contract: each
 *  id runs through the REAL `mapMasterPlaceRow`, so returned places carry
 *  `mp:<uuid>` ids and a `verified` tier derived from `description_source` —
 *  exactly what production emits. This is what the previous fakes got wrong
 *  (they returned bare-uuid ids and omitted `verified`), which is how the
 *  bbox tier blocker hid behind a green suite. `dsByUuid` supplies each id's
 *  tier source; ids absent from it resolve to `null` → unverified. */
function realContractHydrate(dsByUuid: Record<string, DescSource>) {
  return async (ids: string[]): Promise<BrowsePlace[]> =>
    ids.map((id) =>
      mapMasterPlaceRow(federatedRow(id, dsByUuid[id] ?? null), "camping"),
    );
}

function place(id: string, extra: Partial<BrowsePlace> = {}): BrowsePlace {
  return {
    id,
    coords: [-122.68, 45.52],
    photoAlt: "P",
    title: "P",
    pills: [],
    stats: [],
    mention: { primary: "", secondary: "" },
    description: "",
    pullquote: { text: "", name: "", meta: "" },
    placeInfo: { address: "" },
    cta: "Add to day",
    ...extra,
  };
}

/** All deps stubbed to empty; override what a test cares about. */
function deps(over: Partial<ResolveDeps> = {}): Partial<ResolveDeps> {
  return {
    discover: async () => [],
    search: async () => [],
    hydratePlacesByIds: async () => [],
    fetchFederatedPois: async () => [],
    placeDetails: async () => null,
    ...over,
  };
}

// ── ids scope ─────────────────────────────────────────────────────────

test("ids scope hands hydrate the BARE uuids, deduped across spellings", async () => {
  let got: string[] | null = null;
  await resolvePlaces({
    scope: { kind: "ids", ids: [`mp:${UUID}`, UUID, UUID.toUpperCase(), UUID2, `gpl/${GID}`] },
    deps: deps({
      hydratePlacesByIds: async (ids) => {
        got = ids;
        return [];
      },
    }),
  });
  assert.deepEqual(got, [UUID, UUID2]);
});

test("ids scope has no live discovery path — Google ids yield nothing live", async () => {
  let discoverCalls = 0;
  const r = await resolvePlaces({
    scope: { kind: "ids", ids: [`gpl/${GID}`] },
    deps: deps({
      discover: async () => {
        discoverCalls += 1;
        return [place("x")];
      },
    }),
  });
  assert.equal(discoverCalls, 0);
  assert.equal(r.counts.live, 0);
  assert.deepEqual(r.places, []);
});

// ── bbox scope ────────────────────────────────────────────────────────

test("bbox + query routes free text to discover and '*'-searches the corpus", async () => {
  let textQuery: string | undefined;
  let searchQuery: string | undefined;
  await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], query: "hot springs" },
    deps: deps({
      discover: async (a) => {
        textQuery = a.textQuery;
        return [];
      },
      search: async (p) => {
        searchQuery = p.query;
        return [];
      },
    }),
  });
  assert.equal(textQuery, "hot springs");
  assert.equal(searchQuery, "hot springs");
});

test("bbox + categories maps corpus primaries to the slide buckets Google covers", async () => {
  let categories: string[] | undefined;
  await resolvePlaces({
    // campground -> camping, gas_station -> fuel, dispersed_camping -> (none)
    scope: {
      kind: "bbox",
      bbox: [-1, -1, 1, 1],
      categories: ["campground", "gas_station", "dispersed_camping"],
    },
    deps: deps({
      discover: async (a) => {
        categories = a.categories;
        return [];
      },
    }),
  });
  assert.deepEqual(new Set(categories), new Set(["camping", "fuel"]));
});

test("an all-overland category set runs federated-only, and that is not an error", async () => {
  let discoverCalls = 0;
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["dispersed_camping", "water"] },
    deps: deps({
      discover: async () => {
        discoverCalls += 1;
        return [];
      },
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: async () => [place(`mp:${UUID}`)],
    }),
  });
  assert.equal(discoverCalls, 0);
  assert.deepEqual(r.failedSources, []);
  assert.equal(r.counts.federated, 1);
});

// ── day-corridor scope ────────────────────────────────────────────────

test("day-corridor fans out one discover + one RPC per slide key", async () => {
  const discovered: string[] = [];
  const rpcKeys: string[] = [];
  await resolvePlaces({
    scope: {
      kind: "day-corridor",
      start: [-122.7, 45.5],
      end: [-122.6, 45.5],
      categories: ["scenic", "food"],
      supabase: {} as never,
    },
    deps: deps({
      discover: async (a) => {
        discovered.push(...a.categories);
        return [];
      },
      fetchFederatedPois: async (a) => {
        rpcKeys.push(a.slideKey);
        return [];
      },
    }),
  });
  assert.deepEqual(new Set(discovered), new Set(["scenic", "food"]));
  assert.deepEqual(new Set(rpcKeys), new Set(["scenic", "food"]));
});

test("day-corridor drops places beyond the corridor and sorts by distance from start", async () => {
  const start: [number, number] = [-122.7, 45.5];
  const end: [number, number] = [-122.5, 45.5];
  const near = place("node/1", { coords: [-122.55, 45.5], category: "scenic" }); // on the line, far along
  const nearer = place("node/2", { coords: [-122.69, 45.5], category: "scenic" }); // on the line, near start
  const faraway = place("node/3", { coords: [-122.6, 47.5], category: "scenic" }); // ~2° north
  const r = await resolvePlaces({
    scope: { kind: "day-corridor", start, end, categories: ["scenic"] },
    include: { federated: false },
    deps: deps({ discover: async () => [near, nearer, faraway] }),
  });
  assert.deepEqual(
    r.places.map((p) => p.id),
    ["node/2", "node/1"],
  );
});

test("day-corridor: federated places carry verified from mapMasterPlaceRow (not defaulted)", async () => {
  const start: [number, number] = [-122.7, 45.5];
  const end: [number, number] = [-122.6, 45.5];
  const verifiedPlace = place(`mp:${UUID}`, {
    coords: [-122.65, 45.5],
    category: "scenic",
    verified: "verified",
  });
  const unverifiedPlace = place(`mp:${UUID2}`, {
    coords: [-122.66, 45.5],
    category: "scenic",
    verified: "unverified",
  });
  const r = await resolvePlaces({
    scope: {
      kind: "day-corridor",
      start,
      end,
      categories: ["scenic"],
      supabase: {} as never,
    },
    include: { live: false },
    deps: deps({
      fetchFederatedPois: async () => [verifiedPlace, unverifiedPlace],
    }),
  });
  const byId = new Map(r.places.map((p) => [p.id, p]));
  assert.equal(byId.get(`mp:${UUID}`)?.verified, "verified");
  assert.equal(byId.get(`mp:${UUID2}`)?.verified, "unverified");
});

test("day-corridor: verified sort applies — verified before unverified after corridor distance sort", async () => {
  const start: [number, number] = [-122.7, 45.5];
  const end: [number, number] = [-122.5, 45.5];
  // Unverified place is closer to start, verified is farther
  const unverifiedNear = place(`mp:${UUID}`, {
    coords: [-122.69, 45.5],
    category: "scenic",
    verified: "unverified",
    title: "Unverified-near",
  });
  const verifiedFar = place(`mp:${UUID2}`, {
    coords: [-122.55, 45.5],
    category: "scenic",
    verified: "verified",
    title: "Verified-far",
  });
  const r = await resolvePlaces({
    scope: {
      kind: "day-corridor",
      start,
      end,
      categories: ["scenic"],
      supabase: {} as never,
    },
    include: { live: false },
    deps: deps({
      fetchFederatedPois: async () => [unverifiedNear, verifiedFar],
    }),
  });
  assert.deepEqual(r.places.map((p) => p.title), [
    "Verified-far", "Unverified-near",
  ]);
});

test("day-corridor runs live-only when no supabase client is supplied", async () => {
  let rpcCalls = 0;
  const r = await resolvePlaces({
    scope: {
      kind: "day-corridor",
      start: [-122.7, 45.5],
      end: [-122.6, 45.5],
      categories: ["scenic"],
    },
    deps: deps({
      fetchFederatedPois: async () => {
        rpcCalls += 1;
        return [];
      },
    }),
  });
  assert.equal(rpcCalls, 0);
  assert.deepEqual(r.failedSources, []);
});

// ── merge + id normalization at the merge boundary ────────────────────

test("merge dedupes on CANONICAL id — a bare uuid and its mp: form are one place", async () => {
  // This is the case a raw-string dedupe misses, and the reason the merge keys
  // on the canonical form rather than on `p.id` as-is.
  const r = await resolvePlaces({
    scope: { kind: "ids", ids: [UUID] },
    deps: deps({
      hydratePlacesByIds: async () => [
        place(UUID, { title: "bare" }),
        place(`mp:${UUID}`, { title: "prefixed" }),
      ],
    }),
  });
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].id, `mp:${UUID}`);
  assert.equal(r.counts.deduped, 1);
});

test("live wins an id tie with federated", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    deps: deps({
      discover: async () => [place(`mp:${UUID}`, { title: "from live" })],
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: async () => [place(UUID, { title: "from corpus" })],
    }),
  });
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].title, "from live");
  assert.equal(r.places[0].source, "live");
});

test("every returned place is stamped with a canonical id and a source", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    deps: deps({
      discover: async () => [place(`GPL/${GID}`)],
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: async () => [place(UUID)],
    }),
  });
  assert.deepEqual(
    r.places.map((p) => [p.id, p.source]),
    [
      [`gpl/${GID}`, "live"],
      [`mp:${UUID}`, "master_place"],
    ],
  );
});

test("cross-source physical dedupe is OFF by default and opt-in", async () => {
  // Two ids, same category, same coords, same title — one physical place.
  const a = place("node/1", { category: "scenic", title: "Mirror Lake" });
  const b = place(`mp:${UUID}`, { category: "scenic", title: "Mirror Lake" });
  const base = {
    scope: { kind: "bbox" as const, bbox: [-1, -1, 1, 1] as [number, number, number, number], categories: ["viewpoint"] },
    deps: deps({
      discover: async () => [a],
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: async () => [b],
    }),
  };
  const off = await resolvePlaces(base);
  assert.equal(off.places.length, 2);
  const on = await resolvePlaces({ ...base, crossSourceDedupe: true });
  assert.equal(on.places.length, 1);
  assert.equal(on.places[0].source, "live");
});

// ── fail-soft ─────────────────────────────────────────────────────────

test("a thrown half is contained: the other half still returns, and the failure is named", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    deps: deps({
      discover: async () => [place("node/1")],
      search: async () => {
        throw new Error("typesense exploded");
      },
    }),
  });
  assert.equal(r.places.length, 1);
  assert.deepEqual(r.failedSources, ["corpus"]);
  assert.equal(r.sourceErrors, undefined); // detail withheld by default
});

test("error detail is withheld unless explicitly requested", async () => {
  const input = {
    scope: { kind: "bbox" as const, bbox: [-1, -1, 1, 1] as [number, number, number, number] },
    deps: deps({
      search: async () => {
        throw new Error("relation \"master_place\" does not exist");
      },
    }),
  };
  const quiet = await resolvePlaces(input);
  assert.equal(quiet.sourceErrors, undefined);
  const loud = await resolvePlaces({ ...input, includeErrorDetail: true });
  assert.match(loud.sourceErrors?.corpus ?? "", /master_place/);
});

test("include lets a caller disable either half without the resolver reading env", async () => {
  let searched = 0;
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { federated: false },
    deps: deps({
      discover: async () => [place("node/1")],
      search: async () => {
        searched += 1;
        return [];
      },
    }),
  });
  assert.equal(searched, 0);
  assert.equal(r.counts.federated, 0);
  assert.equal(r.places.length, 1);
});

// ── limit + enrichment ────────────────────────────────────────────────

test("limit caps post-merge", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    limit: 2,
    deps: deps({ discover: async () => [place("node/1"), place("node/2"), place("node/3")] }),
  });
  assert.equal(r.places.length, 2);
});

test("enrichment is OFF by default", async () => {
  let calls = 0;
  await resolvePlaces({
    scope: { kind: "ids", ids: [UUID] },
    deps: deps({
      hydratePlacesByIds: async () => [place(`mp:${UUID}`, { placeId: GID })],
      placeDetails: async () => {
        calls += 1;
        return { rating: 4.5 };
      },
    }),
  });
  assert.equal(calls, 0);
});

test("enrichment grafts rich fields without overwriting what the place already has", async () => {
  const r = await resolvePlaces({
    scope: { kind: "ids", ids: [UUID] },
    enrich: true,
    deps: deps({
      hydratePlacesByIds: async () => [
        // Already has a photo; has no rating.
        place(`mp:${UUID}`, { placeId: GID, photoUrl: "corpus.jpg" }),
      ],
      placeDetails: async () => ({ rating: 4.5, reviewCount: 12, photoUrl: "google.jpg" }),
    }),
  });
  const p = r.places[0];
  assert.equal(p.rating, 4.5); // filled
  assert.equal(p.reviewCount, 12); // filled
  assert.equal(p.photoUrl, "corpus.jpg"); // NOT overwritten
});

test("enrichment reaches a federated place via placeId and a live one via its gpl/ id", async () => {
  const asked: string[] = [];
  await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    enrich: true,
    deps: deps({
      discover: async () => [place(`gpl/${GID}`)],
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: async () => [place(UUID, { placeId: "ChIJ_other" })],
      placeDetails: async (id) => {
        asked.push(id);
        return null;
      },
    }),
  });
  assert.deepEqual(new Set(asked), new Set([GID, "ChIJ_other"]));
});

test("a null from placeDetails leaves the place un-enriched rather than blanking it", async () => {
  const r = await resolvePlaces({
    scope: { kind: "ids", ids: [UUID] },
    enrich: true,
    deps: deps({
      hydratePlacesByIds: async () => [place(`mp:${UUID}`, { placeId: GID, title: "Kept" })],
      placeDetails: async () => null,
    }),
  });
  assert.equal(r.places[0].title, "Kept");
  assert.equal(r.places[0].rating, undefined);
});

// ── enrichByGoogleId (the standalone map-returning capability) ─────────

test("enrichByGoogleId: a resolved id is present with its fields", async () => {
  const map = await enrichByGoogleId([GID], {
    placeDetails: async () => ({ rating: 4.5, reviewCount: 12 }),
  });
  assert.deepEqual(Object.keys(map), [GID]);
  assert.equal(map[GID].rating, 4.5);
  assert.equal(map[GID].reviewCount, 12);
});

test("enrichByGoogleId: resolved-empty {} is INCLUDED (present key, empty object)", async () => {
  const map = await enrichByGoogleId([GID], {
    placeDetails: async () => ({}), // Google resolved the place, nothing to add
  });
  assert.ok(GID in map, "the {} entry must be present");
  assert.deepEqual(map[GID], {});
});

test("enrichByGoogleId: a null/failed lookup is OMITTED (no key at all)", async () => {
  const map = await enrichByGoogleId([GID], {
    placeDetails: async () => null, // missing key / network / non-OK
  });
  assert.ok(!(GID in map), "a failed id must not appear in the map");
  assert.deepEqual(Object.keys(map), []);
});

test("enrichByGoogleId: the {}-vs-omit distinction across a mixed set", async () => {
  const resolved = "ChIJ_resolved";
  const empty = "ChIJ_empty";
  const failed = "ChIJ_failed";
  const map = await enrichByGoogleId([resolved, empty, failed], {
    placeDetails: async (id) =>
      id === resolved ? { rating: 4 } : id === empty ? {} : null,
  });
  // Present: resolved (with fields) and empty ({}). Absent: failed.
  assert.deepEqual(new Set(Object.keys(map)), new Set([resolved, empty]));
  assert.equal(map[resolved].rating, 4);
  assert.deepEqual(map[empty], {});
  assert.ok(!(failed in map));
});

test("enrichByGoogleId: partial results across MULTIPLE batches are all merged", async () => {
  const ids = ["a", "b", "c", "d", "e"];
  const map = await enrichByGoogleId(ids, {
    batchSize: 2, // forces 3 sequential batches (2,2,1)
    // odd-indexed ids fail (null), even-indexed resolve
    placeDetails: async (id) =>
      ids.indexOf(id) % 2 === 0 ? { rating: ids.indexOf(id) } : null,
  });
  assert.deepEqual(new Set(Object.keys(map)), new Set(["a", "c", "e"]));
  assert.equal(map.a.rating, 0);
  assert.equal(map.c.rating, 2);
  assert.equal(map.e.rating, 4);
});

test("enrichByGoogleId: dedupes ids — placeDetails runs once per UNIQUE id", async () => {
  const calls: string[] = [];
  const map = await enrichByGoogleId([GID, GID, "ChIJ_other", GID], {
    placeDetails: async (id) => {
      calls.push(id);
      return { rating: 3 };
    },
  });
  assert.deepEqual(calls.slice().sort(), [GID, "ChIJ_other"].sort());
  assert.deepEqual(new Set(Object.keys(map)), new Set([GID, "ChIJ_other"]));
});

test("enrichByGoogleId: empty input makes no calls and returns an empty map", async () => {
  let calls = 0;
  const map = await enrichByGoogleId([], {
    placeDetails: async () => {
      calls += 1;
      return {};
    },
  });
  assert.equal(calls, 0);
  assert.deepEqual(map, {});
});

// ── Verification tier ────────────────────────────────────────────────

test("classifyVerificationTier: source → verified", () => {
  assert.equal(classifyVerificationTier("source"), "verified");
});

test("classifyVerificationTier: llm → verified (per the eligibility ADR)", () => {
  assert.equal(classifyVerificationTier("llm"), "verified");
});

test("classifyVerificationTier: template → unverified", () => {
  assert.equal(classifyVerificationTier("template"), "unverified");
});

test("classifyVerificationTier: null/undefined → unverified", () => {
  assert.equal(classifyVerificationTier(null), "unverified");
  assert.equal(classifyVerificationTier(undefined), "unverified");
});

test("sortByVerificationTier puts verified before unverified, preserving order within tiers", () => {
  const a = place("a", { title: "Verified-1", verified: "verified" });
  const b = place("b", { title: "Unverified-1", verified: "unverified" });
  const c = place("c", { title: "Verified-2", verified: "verified" });
  const d = place("d", { title: "Unverified-2", verified: "unverified" });
  const sorted = sortByVerificationTier([b, a, d, c]);
  assert.deepEqual(sorted.map((p) => p.title), [
    "Verified-1", "Verified-2", "Unverified-1", "Unverified-2",
  ]);
});

test("isSuggestable: verified → true, unverified → false", () => {
  assert.ok(isSuggestable(place("a", { verified: "verified" })));
  assert.ok(!isSuggestable(place("b", { verified: "unverified" })));
});

test("isSuggestable: no verified field → false (absence = unverified)", () => {
  assert.ok(!isSuggestable(place("c")));
});

test("live places are always stamped verified", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { federated: false },
    deps: deps({ discover: async () => [place("node/1")] }),
  });
  assert.equal(r.places[0].verified, "verified");
});

// ── bbox tier: end-to-end through the REAL mapMasterPlaceRow ─────────────
// These drive resolvePlaces → resolveFederated → the real-contract hydrate
// (which runs the REAL mapMasterPlaceRow) → stamp. `description_source` is
// supplied on the federated row exactly as the export view would carry it, so
// the classifier and its plumbing are exercised, not a simplified stand-in.
// (The one link a unit test can't cover is the DB SELECT in hydrate.ts that
// reads description_source off the view — that is the fix itself and is
// verified by inspection; see the cutover-plan doc for the live-TEST note.)

test("bbox: description_source='source' → verified end-to-end, real mp: id", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: realContractHydrate({ [UUID]: "source" }),
    }),
  });
  assert.equal(r.places[0].verified, "verified");
  // The real hydrate contract: mp:<uuid> id, not a bare uuid. The old fake
  // returned a bare uuid, which is how the blocker hid.
  assert.equal(r.places[0].id, `mp:${UUID}`);
});

test("bbox: description_source='llm' → verified (eligibility ADR)", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: realContractHydrate({ [UUID]: "llm" }),
    }),
  });
  assert.equal(r.places[0].verified, "verified");
});

test("bbox: description_source='template' → unverified", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: realContractHydrate({ [UUID]: "template" }),
    }),
  });
  assert.equal(r.places[0].verified, "unverified");
});

test("bbox: no description_source → unverified", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: realContractHydrate({ [UUID]: null }),
    }),
  });
  assert.equal(r.places[0].verified, "unverified");
});

test("bbox: verified (source, llm) sort before unverified (template) in the merged set", async () => {
  const UUID3 = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [
        { id: UUID } as never,
        { id: UUID2 } as never,
        { id: UUID3 } as never,
      ],
      hydratePlacesByIds: realContractHydrate({
        [UUID]: "template",
        [UUID2]: "source",
        [UUID3]: "llm",
      }),
    }),
  });
  // Verified (source, llm) first, unverified (template) last. Order within a
  // tier preserved, so the two verified keep their pre-sort order.
  assert.deepEqual(
    r.places.map((p) => p.verified),
    ["verified", "verified", "unverified"],
  );
  assert.deepEqual(
    r.places.map((p) => p.id),
    [`mp:${UUID2}`, `mp:${UUID3}`, `mp:${UUID}`],
  );
});

// REGRESSION GUARD for the blocker: with the real-contract hydrate, a
// 'source' corpus result MUST NOT come back unverified. A fake that returns a
// bare-uuid id + omits `verified` (the old shape) would have silently passed
// the pre-fix code; this asserts the id form so that shape can't return.
test("bbox: a real-contract 'source' result never regresses to unverified", async () => {
  const r = await resolvePlaces({
    scope: { kind: "bbox", bbox: [-1, -1, 1, 1], categories: ["campground"] },
    include: { live: false },
    deps: deps({
      search: async () => [{ id: UUID } as never],
      hydratePlacesByIds: realContractHydrate({ [UUID]: "source" }),
    }),
  });
  assert.equal(r.places.length, 1);
  assert.equal(r.places[0].id, `mp:${UUID}`);
  assert.notEqual(r.places[0].verified, "unverified");
});
