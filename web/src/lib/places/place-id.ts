/**
 * Canonical place-id normalization for `resolvePlaces()`.
 *
 * Step 2 of docs/decisions/2026-08-21-place-data-resolver-consolidation.md.
 * Design + the full id inventory: docs/architecture/resolve-places-design.md §3.
 *
 * THE PROBLEM. The same place reaches the card layer under up to eight
 * different id strings, in TWO different schemes:
 *
 *   master_place.id   531b1c71-…            bare uuid, the DB column
 *   tile id           mp:531b1c71-…         applied at the projection layer
 *                                           (trip-browse/federated.ts), NEVER stored
 *   Google place_id   ChIJ…                 BrowsePlace.placeId, /api/places/details key
 *   live Google       gpl/ChIJ…             BrowsePlace.id from googlePlacesSource
 *   live Foursquare   fsq/…
 *   live Recreation.gov ridb/…
 *   live USFS         usfs/…
 *   live BLM          blm/…
 *   live OSM          node/…
 *
 * Two traps this module exists to avoid, both easy to miss from the ADR's
 * one-line "add a normalization step":
 *
 *   1. FEDERATED USES `:` AND LIVE USES `/`. `mp:<uuid>` vs `gpl/<id>` are not
 *      one scheme with different prefixes — they are two schemes.
 *   2. THE LIVE PREFIX IS NOT THE SourceId. SourceId is
 *      google/foursquare/rec-gov/osm; the prefixes are gpl/fsq/ridb/node.
 *      Deriving one from the other is wrong for four of six sources, so the
 *      map below is explicit.
 *
 * Nothing here throws. A malformed id degrades to `opaque` and is preserved
 * verbatim, so one bad id in a merge means "this one won't match", not a
 * crash.
 */

import type { SourceId } from "@/lib/discovery/types";

/** Prefix used on federated tile ids. `:` separator, unlike live's `/`. */
export const MASTER_PLACE_PREFIX = "mp";

/** The live id prefixes actually emitted by the discovery adapters, mapped to
 *  the `SourceId` they correspond to. Deliberately hand-written: the prefix and
 *  the SourceId differ for gpl/fsq/ridb/node, so this cannot be derived. */
export const LIVE_ID_PREFIX_TO_SOURCE = {
  gpl: "google",
  fsq: "foursquare",
  ridb: "rec-gov",
  usfs: "usfs",
  blm: "blm",
  node: "osm",
} as const satisfies Record<string, SourceId>;

export type LiveIdPrefix = keyof typeof LIVE_ID_PREFIX_TO_SOURCE;

const LIVE_PREFIXES = Object.keys(LIVE_ID_PREFIX_TO_SOURCE) as LiveIdPrefix[];

/** Inverse of the above, for building an id from a SourceId. Not every
 *  SourceId has an id prefix (nps/wikipedia/ioverlander/fixture never mint
 *  BrowsePlace ids of their own), so this is partial by design. */
export const SOURCE_TO_LIVE_ID_PREFIX: Partial<Record<SourceId, LiveIdPrefix>> =
  Object.fromEntries(
    LIVE_PREFIXES.map((p) => [LIVE_ID_PREFIX_TO_SOURCE[p], p]),
  ) as Partial<Record<SourceId, LiveIdPrefix>>;

/** RFC-4122 shape. Case-insensitive: uuid hex is case-insensitive and Postgres
 *  emits lowercase, so `MP:ABC…` and `abc…` must be the same place. Version and
 *  variant nibbles are NOT constrained — master_place uses gen_random_uuid()
 *  (v4) today, but rejecting a v1/v7 id would be a gratuitous failure. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

export type CanonicalPlaceId =
  /** A row in public.master_place. `uuid` is always lowercase. */
  | { kind: "master_place"; uuid: string }
  /** A result from a live discovery adapter. `externalId` is verbatim. */
  | { kind: "live"; source: SourceId; prefix: LiveIdPrefix; externalId: string }
  /** A bare Google place_id, reached ONLY via googlePlaceId(). Never inferred
   *  from an unprefixed string. Canonicalises to the same `gpl/…` string a
   *  live Google result uses, so the two forms of "the same Google place"
   *  converge — which is the point. */
  | { kind: "google_place"; placeId: string }
  /** Unrecognised. Preserved verbatim so it round-trips unchanged. */
  | { kind: "opaque"; raw: string };

/**
 * Parse any of the id forms above into a canonical id.
 *
 * Never throws. Never guesses: an unprefixed non-uuid string is `opaque`, not
 * "probably a Google place id" — bare Google ids must come through
 * `googlePlaceId()` where the caller knows what it has.
 */
export function parsePlaceId(raw: string): CanonicalPlaceId {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { kind: "opaque", raw };

  // WHICH SCHEME? Decided by whichever separator appears FIRST, not by
  // checking `:` before `/`.
  //
  // Checking `:` first is the obvious implementation and it is wrong: a live
  // id whose EXTERNAL ID contains a colon (`fsq/abc:def`) would be read as a
  // colon-scheme id with prefix `fsq/abc`, fail the `mp` test, and fall out as
  // opaque — silently unresolvable. External ids are opaque third-party
  // tokens; nothing guarantees they avoid `:`. Caught by a test fixture that
  // contained a stray colon.
  const colon = trimmed.indexOf(":");
  const slash = trimmed.indexOf("/");
  const colonFirst = colon > 0 && (slash < 0 || colon < slash);
  const slashFirst = slash > 0 && (colon < 0 || slash < colon);

  // Federated: `mp:<uuid>`. Prefix case-insensitive, uuid lowercased.
  if (colonFirst) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const rest = trimmed.slice(colon + 1);
    if (prefix === MASTER_PLACE_PREFIX) {
      // `mp:` with a non-uuid body is malformed, NOT a master_place. Falling
      // through to opaque keeps it distinguishable instead of minting an id
      // that can never resolve.
      return isUuid(rest)
        ? { kind: "master_place", uuid: rest.toLowerCase() }
        : { kind: "opaque", raw };
    }
    // Any other `x:y` is not ours — opaque, verbatim.
    return { kind: "opaque", raw };
  }

  // Live: `<prefix>/<externalId>`. Only the FIRST `/` splits — OSM way ids and
  // some Foursquare ids can contain further slashes.
  if (slashFirst) {
    const prefix = trimmed.slice(0, slash).toLowerCase();
    const externalId = trimmed.slice(slash + 1);
    if (externalId.length > 0 && (LIVE_PREFIXES as string[]).includes(prefix)) {
      const p = prefix as LiveIdPrefix;
      // externalId is NOT case-folded — Google/Foursquare ids are opaque and
      // case-sensitive.
      return { kind: "live", source: LIVE_ID_PREFIX_TO_SOURCE[p], prefix: p, externalId };
    }
    return { kind: "opaque", raw };
  }

  // Bare uuid → master_place. This is what makes `mp:<uuid>` and `<uuid>`
  // converge, which the ADR requires for Day.waypoints.
  if (isUuid(trimmed)) {
    return { kind: "master_place", uuid: trimmed.toLowerCase() };
  }

  return { kind: "opaque", raw };
}

/** Build a canonical id for a known master_place uuid. Returns `opaque` rather
 *  than throwing if handed a non-uuid, matching parsePlaceId's posture. */
export function masterPlaceId(uuid: string): CanonicalPlaceId {
  const t = uuid.trim();
  return isUuid(t)
    ? { kind: "master_place", uuid: t.toLowerCase() }
    : { kind: "opaque", raw: uuid };
}

/** Build a canonical id for a BARE Google place_id (the `BrowsePlace.placeId`
 *  / `POST /api/places/details` form). Canonicalises to `gpl/<placeId>` so it
 *  is the same identity as the live Google result for that place. */
export function googlePlaceId(placeId: string): CanonicalPlaceId {
  const t = placeId.trim();
  return t.length > 0 ? { kind: "google_place", placeId: t } : { kind: "opaque", raw: placeId };
}

/** The single string form. This is what goes in `BrowsePlace.id`, what the
 *  dedupe key is, and what a client cache should key on. */
export function toCanonicalString(id: CanonicalPlaceId): string {
  switch (id.kind) {
    case "master_place":
      return `${MASTER_PLACE_PREFIX}:${id.uuid}`;
    case "live":
      return `${id.prefix}/${id.externalId}`;
    case "google_place":
      // Same string a live Google result carries — deliberate convergence.
      return `${SOURCE_TO_LIVE_ID_PREFIX.google}/${id.placeId}`;
    case "opaque":
      return id.raw;
  }
}

/** Parse-and-stringify in one step — the common call. Idempotent. */
export function canonicalizePlaceId(raw: string): string {
  return toCanonicalString(parsePlaceId(raw));
}

/** True when two raw id strings denote the same place. `mp:<uuid>` vs bare
 *  `<uuid>` → true; `gpl/<x>` vs `mp:<uuid>` → false. */
export function samePlaceId(a: string, b: string): boolean {
  return canonicalizePlaceId(a) === canonicalizePlaceId(b);
}

/** The bare `master_place.id` for a canonical id, or null. Use at the DB
 *  boundary — `hydratePlacesByIds` and every Supabase filter want the bare
 *  uuid, never the `mp:` form. */
export function masterPlaceUuid(id: CanonicalPlaceId): string | null {
  return id.kind === "master_place" ? id.uuid : null;
}

/** The Google place_id for a canonical id, or null. Both `gpl/<x>` (live) and
 *  the bare `google_place` form yield the same value — this is the key
 *  `/api/places/details` and `placeDetails()` want. */
export function googlePlaceIdOf(id: CanonicalPlaceId): string | null {
  if (id.kind === "google_place") return id.placeId;
  if (id.kind === "live" && id.source === "google") return id.externalId;
  return null;
}

/** Partition a mixed list of raw ids by what they resolve to. The `ids` scope
 *  of resolvePlaces() uses this to decide which half fetches what; ids that
 *  are neither land in `other` rather than being dropped silently. */
export function partitionPlaceIds(raw: string[]): {
  masterPlaceUuids: string[];
  googlePlaceIds: string[];
  other: CanonicalPlaceId[];
} {
  const masterPlaceUuids: string[] = [];
  const googlePlaceIds: string[] = [];
  const other: CanonicalPlaceId[] = [];
  const seenMp = new Set<string>();
  const seenG = new Set<string>();
  for (const r of raw) {
    const id = parsePlaceId(r);
    const uuid = masterPlaceUuid(id);
    if (uuid) {
      if (!seenMp.has(uuid)) {
        seenMp.add(uuid);
        masterPlaceUuids.push(uuid);
      }
      continue;
    }
    const g = googlePlaceIdOf(id);
    if (g) {
      if (!seenG.has(g)) {
        seenG.add(g);
        googlePlaceIds.push(g);
      }
      continue;
    }
    other.push(id);
  }
  return { masterPlaceUuids, googlePlaceIds, other };
}
