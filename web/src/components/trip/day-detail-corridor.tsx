"use client";

import { createContext, useContext, useState } from "react";
import { CategoryListCard } from "@/components/trip/category-list-card";
import { DayDetailNodeBlocks } from "@/components/trip/day-detail-node-blocks";
import type { BrowseCardCategory } from "@/lib/trip-browse/palette";
import {
  coincidesWithAnchor,
  isSameAnchorPlace,
  type AnchorLike,
} from "@/lib/corridor/anchor-match";
import { classifyCuratedPicks } from "@/lib/corridor/curated-placement";
import {
  scopeRankKey,
  sortClusterByRank,
  positionPlacesOnDay,
  isRoundTripCorridor,
  type PositionedPlace,
} from "@/lib/corridor/stretches";
import { haversineMi } from "@/lib/routing/point-to-polyline";
import type { PlaceNodeOverride } from "@/lib/trips/types";
import type { PlaceMove } from "@/components/trip/day-detail-node-blocks";
import type { CuratedMenu } from "@/components/trip/curated-kebab";

/**
 * Day Detail v4 — corridor view. PURE PRESENTATIONAL.
 *
 * Renders one day as an ordered corridor of geographic city nodes down a left
 * mileage gutter (mirroring the rail's timeline-gutter treatment), each city
 * anchoring a cluster of CategoryListCard place tiles in DETAILS mode (Details
 * → action, no Add — these places are already added).
 *
 * `cities` is the canonical `Day.corridorCities` shape (`CorridorCity` from
 * lib/trips/types.ts, per docs/corridor-cities-spec.md §1). Until place→node
 * bucketing ships (spec §2.3, deferred), real data carries empty `placeIds` —
 * nodes render as a bare corridor spine (city header + explore link, no
 * tiles), which is the correct current state.
 *
 * Every interaction is stubbed // TODO: wire (Details, both "Explore more
 * [city]" links, and "Explore more of Day 01").
 */

// TODO: wire — Details, "Explore more [city]", "Explore more of Day 01".
const noop = () => {};

/** Canonical payload type, re-exported for existing demo importers. */
export type { CorridorCity } from "@/lib/trips/types";
import type { CorridorCity } from "@/lib/trips/types";

/** The subset of BrowsePlace a tile needs, plus its browse category + id. */
export type CorridorPlace = {
  id: string;
  title: string;
  category: BrowseCardCategory;
  photoUrl?: string;
  photoCredit?: string;
  photoAlt: string;
  rating?: number;
  reviewCount?: number;
  /** Google place_id (corpus tiles backed by a google source). The key for
   *  live hydrate-by-place_id of ratings/photos on day-select. Absent for
   *  waypoints and non-google corpus rows. */
  placeId?: string;
  /** True for waypoint-backed tiles (user/editorial stops) — they get the
   *  remove control. Suggestion-backed tiles stay read-only. */
  removable?: boolean;
  /** True for a curated POI backed by `Day.segmentSuggestions` — the tiles the
   *  ⋮ kebab (Move to day / Delete) can act on (geometry-free overlay edit). */
  curatedMovable?: boolean;
  /** True for the LLM's curated key stops (generated trips) — featured as the
   *  guide's picks; the rest of the pool collapses behind "Explore more". */
  curated?: boolean;
  /** Along-route distance-from-day-start (miles) for a curated key stop,
   *  projected onto the day's polyline at bake time. When present, the pick
   *  renders IN its spine position (ordered by mile) instead of the detached
   *  fallback block. Absent for pool tiles and off-corridor picks. */
  milesFromStart?: number;
  /** [lng, lat] — carried for anchor-matching (a pick that IS the day's
   *  start/end anchor renders under that node, not as a separate tile). */
  coords?: [number, number];
  /** Inline context for a curated key stop ("fuel + lunch, hot tub") — rendered
   *  as the tile's status line. Absent on pool tiles. */
  keyStopNote?: string;
  /** True when this pick IS the day's grounded overnight (notes-to-spine). Set
   *  alongside `curated` by the bake so the overnight is featured on the spine
   *  and badged distinctly from an ordinary key stop. */
  isOvernight?: boolean;
  /** Real price tier ($–$$$$) from a Google-backed source. Fetched by the
   *  hydrate endpoint and now grafted at both merge sites (day-detail-
   *  corridor-column.tsx's hydratePlaces() and synth()), same "carried
   *  through, no render consumer yet on THIS surface" status as the other
   *  passthrough fields above — the slideup already renders it via
   *  logistics.entry (browsePlaceToWaypoint → priceTierToEntry). See
   *  docs/architecture/place-pipeline-trace.md §3. */
  priceTier?: 1 | 2 | 3 | 4;
  /** Real description text from the source (BrowsePlace.description /
   *  Waypoint.description) — carried through by placePool() so the spine
   *  visibility filter can tell an enriched pick from an unreviewed
   *  placeholder. Absent/empty/whitespace-only all mean "no description" —
   *  never fabricated; the card simply renders without one. */
  description?: string;
  /** master_place.prominence_score, carried through by placePool() —
   *  corpus-only signal (absent on waypoints), used to rank a city's spine
   *  featured pick when no LLM curation names that city. See
   *  BrowsePlace.prominenceScore for what it does and doesn't measure. */
  prominenceScore?: number;
};

/** Status line for a curated pick. A featured overnight (notes-to-spine) reads
 *  distinctly from an ordinary key stop by prefixing its status with
 *  "Overnight"; everything else shows its key-stop note unchanged. */
function pickStatus(p: CorridorPlace): string | undefined {
  if (p.isOvernight)
    return p.keyStopNote ? `Overnight · ${p.keyStopNote}` : "Overnight";
  return p.keyStopNote;
}

type Props = {
  /** e.g. "Day 1 — Sat, May 30th". */
  dayLabel: string;
  /** e.g. 1 → "DAY 01" footer. */
  dayNumber: number;
  /** e.g. "Los Angeles, CA — Santa Barbara, CA". */
  routeLabel: string;
  heroImageUrl?: string;
  heroAlt?: string;
  cities: CorridorCity[];
  places: CorridorPlace[];
  /** Distance ticks (no city header) shown in the gutter between city nodes,
   *  optionally carrying place tiles that align to the marker, e.g.
   *  [{ mile: 40, placeIds: ["x"] }]. View-only — NOT part of the spec shape. */
  mileMarkers?: { mile: number; placeIds?: string[] }[];
  /** Remove a waypoint-backed tile from the day (Phase 3 editing). Only
   *  invoked for tiles whose place is `removable`. */
  onRemovePlace?: (placeId: string) => void;
  /** Open a tile's place detail (read-only, all tiles). The caller
   *  resolves the id to its source (waypoint/suggestion) and opens the
   *  shared MapDetailOverlay via trip:openDetail. */
  onOpenPlace?: (placeId: string) => void;
  /** "Explore more of Day NN" footer CTA — opens the day-scoped browse
   *  panel (Phase 3 add flow). */
  onExploreDay?: () => void;
  /** Day-level reasoned fill (briefing/weather/overnight/logistics/
   *  obligations), rendered between the hero and the spine so a generated
   *  day reads as one cohesive corridor day. Absent on reference/fork trips
   *  that carry no LLM reasoning. */
  briefing?: React.ReactNode;
  /** Manual-edit mode — threaded to every place card (drag-handle lane) and
   *  used to widen the corridor content so the wider cards fit. Off by
   *  default. In edit mode the center column renders the node-model City Block
   *  spine (DayDetailNodeBlocks) instead of the mile-interleaved read spine. */
  editMode?: boolean;
  /** User pin overrides (placeId → nodeId). A pinned CURATED pick relocates
   *  under its node (at its true mile) instead of sitting on the mile-ordered
   *  Key Stops timeline — so the read spine agrees with the edit spine and the
   *  iPad. Non-curated pins are already reflected via CorridorCity.placeIds. */
  placeOverrides?: PlaceNodeOverride[];
  /** Day driving total — labels the drive connector on a 2-node day (the
   *  single connector IS the whole day's drive). Edit render only. */
  dayMiles?: number;
  dayDriveHours?: number | null;
  /** True when this day is a layover (rest day). View mode renders the inline
   *  "Nearby" block from `places` instead of the corridor spine — a layover has
   *  no curated key stops and no corridorCities to bucket its suggestions under,
   *  so without this they'd be stored and never seen. Computed by the caller
   *  (isRestDay). */
  restDay?: boolean;
  /** Decoded trip route polyline + this day's cumulative start mile — the edit
   *  render projects POI coords onto the route to position them in stretches
   *  (the stored milesFromStart is unreliable; see lib/corridor/stretches.ts). */
  routeLine?: [number, number][];
  dayStartMile?: number;
  /** Manual-edit drag (edit spine): pin/unpin a POI by dragging its card. */
  onMovePlace?: (move: PlaceMove) => void;
  /** Authored per-place order (Trip.placeRanks) + the same-node reorder handler. */
  ranks?: ReadonlyMap<string, { nodeId: string; rank: number }>;
  onReorderPlace?: (
    placeId: string,
    rankWrites: Record<string, { nodeId: string; rank: number }>,
  ) => void;
  pendingPlaceId?: string | null;
  errorPlaceId?: string | null;
  errorMessage?: string | null;
  onDismissError?: () => void;
  /** Build the ⋮ kebab menu for a curated (segmentSuggestion) tile, or undefined
   *  to show no kebab. Wired only on editable (user) trips; read-only otherwise.
   *  The read spine renders this on every curated-POI card. */
  buildCuratedMenu?: (place: CorridorPlace) => CuratedMenu | undefined;
  /** PR2 marker→card: the place id the map marker last focused. The matching
   *  place card highlights (via FocusContext + PlaceSlot). */
  focusedId?: string | null;
};

const GUTTER_W = 48;

/** A CorridorPlace as an anchor-match subject (its title is the place name). */
function toAnchorLike(p: CorridorPlace): AnchorLike {
  return { id: p.id, name: p.title, coords: p.coords };
}

/** One entry on the rendered spine, in along-route order. A key stop's `mile` is
 *  null when no honest along-route figure exists for it (round-trip days — see
 *  `spinePosition`); the tick renders without a number rather than inventing one. */
export type SpineItem =
  | { type: "city"; city: CorridorCity; last: boolean }
  | { type: "keystop"; place: CorridorPlace; mile: number | null; last: boolean }
  | { type: "marker"; mile: number; tiles: CorridorPlace[]; last: boolean };

/** Where a curated pick sits on the spine, and what (if anything) to label it. */
export type SpinePos = {
  /** Primary sort key — day-relative along-route mile on a normal day, radial
   *  distance from the anchor on a round-trip day. */
  sort: number;
  /** Secondary key, applied only to entries sharing a `sort` value. Perpendicular
   *  offset from the route: at a polyline-end clamp this IS the distance beyond
   *  the terminus, so it orders points that all projected onto the final vertex. */
  tiebreak: number;
  /** The gutter tick, or null to render the stop with no mile. */
  label: number | null;
};

/**
 * Merge the city spine, the positioned curated key stops, and any (demo) mile
 * markers into ONE list ordered by along-route mile — so a key stop renders
 * BETWEEN the anchors at the mile you'd actually reach it, not in a detached
 * block. Ties break city → keystop → marker so a pick at a city's mile lands
 * just after that city. `last` marks the final entry (drops its connector).
 * Pure + exported for unit testing.
 */
export function buildSpineItems(input: {
  cities: CorridorCity[];
  keyStops: CorridorPlace[];
  /** Curated picks pinned UNDER a node (placeOverride): they sort at the
   *  pinned node's mile (so they render right after it) but DISPLAY their own
   *  true mile — the honest out-of-order tick that matches the edit spine. */
  pinnedKeyStops?: { place: CorridorPlace; nodeMile: number }[];
  mileMarkers: { mile: number; placeIds?: string[] }[];
  byId: Map<string, CorridorPlace>;
  /** Resolve a curated pick's spine position. Injected rather than read off the
   *  place so this merge stays pure and the geometry source stays in ONE place
   *  (`spinePosition`); the stored `milesFromStart` is never consulted here. */
  placeMile: (place: CorridorPlace) => SpinePos;
}): SpineItem[] {
  const { cities, keyStops, pinnedKeyStops = [], mileMarkers, byId, placeMile } = input;
  const RANK = { city: 0, keystop: 1, marker: 2 };
  type Entry = {
    mile: number;
    rank: number;
    tiebreak: number;
    make: (last: boolean) => SpineItem;
  };
  const entries: Entry[] = [];
  cities.forEach((city) =>
    entries.push({
      mile: city.milesFromStart,
      rank: RANK.city,
      tiebreak: 0,
      make: (last) => ({ type: "city", city, last }),
    }),
  );
  keyStops.forEach((place) => {
    const pos = placeMile(place);
    entries.push({
      mile: pos.sort,
      rank: RANK.keystop,
      tiebreak: pos.tiebreak,
      make: (last) => ({ type: "keystop", place, mile: pos.label, last }),
    });
  });
  // Pinned picks sort at their NODE's mile (lands just after that node, tie →
  // city first) but show their own mile in the gutter.
  pinnedKeyStops.forEach(({ place, nodeMile }) => {
    const pos = placeMile(place);
    entries.push({
      mile: nodeMile,
      rank: RANK.keystop,
      tiebreak: pos.tiebreak,
      make: (last) => ({ type: "keystop", place, mile: pos.label, last }),
    });
  });
  mileMarkers.forEach((mk) =>
    entries.push({
      mile: mk.mile,
      rank: RANK.marker,
      tiebreak: 0,
      make: (last) => ({
        type: "marker",
        mile: mk.mile,
        tiles: (mk.placeIds ?? [])
          .map((id) => byId.get(id))
          .filter(Boolean) as CorridorPlace[],
        last,
      }),
    }),
  );
  // Mile → type → tiebreak. The third key only ever separates entries that
  // landed on the SAME mile: without it, picks clamped to the polyline's final
  // vertex all share a sort value and Array#sort (stable) leaves them in input
  // order, which is not a route order.
  entries.sort((a, b) => a.mile - b.mile || a.rank - b.rank || a.tiebreak - b.tiebreak);
  return entries.map((e, i) => e.make(i === entries.length - 1));
}

/** The one BrowseCardCategory value fuel/charging infrastructure resolves to
 *  (`SLIDE_TO_PRIMARY_CATEGORY.fuel` in trip-browse/federated.ts — the
 *  canonical map: gas_station, ev_charging, truck_stop all roll up here
 *  before a tile ever reaches CorridorPlace.category). Checking `=== FUEL_CATEGORY`
 *  reads the already-resolved bucket rather than duplicating that source-value
 *  list — a second list here would drift from the canonical one. */
const FUEL_CATEGORY: BrowseCardCategory = "fuel";

/** Absent, empty, or whitespace-only all count as "no description" — never
 *  fabricated, so a placeholder pick with nothing written yet reads the
 *  same as one with the field truly absent. */
function hasDescription(p: CorridorPlace): boolean {
  return typeof p.description === "string" && p.description.trim().length > 0;
}

/** A place counts as real, browsable content only if it's BOTH non-fuel AND
 *  has a real description — an unenriched placeholder (real place, no
 *  description written yet) is deliberately treated the same as noise: "not
 *  ready to show" regardless of whether the place itself is legitimate. */
export function isRealContent(p: CorridorPlace): boolean {
  return p.category !== FUEL_CATEGORY && hasDescription(p);
}

/** True if at least one place clears the `isRealContent` bar. Vacuously false
 * for an empty list — an empty pool has no real content either, which is
 * exactly what makes the empty-pool case (PR #300) and the fuel-only case
 * (PR #301) special cases of this same single rule rather than three separate
 * checks to keep in sync. A fuel-only pool never clears the bar regardless of
 * description (the category clause always fails first); an all-non-fuel but
 * all-undescribed pool (Foster City: charging stations + one undescribed
 * real POI) never clears it either (the description clause fails). */
function hasRealContent(places: CorridorPlace[]): boolean {
  return places.some(isRealContent);
}

/**
 * Pick a city's spine featured pick when no LLM curation names that city —
 * the highest-`prominenceScore` place in its pool that also clears
 * `isRealContent` (never feature a fuel-only or undescribed tile just because
 * it scores well). Curated tiles are excluded from consideration: they are
 * ALREADY shown elsewhere (a coinciding anchor pick, a pinned pick, or a
 * standalone KeyStopNode at their own spine position) — featuring one here
 * too would duplicate it.
 *
 * TIEBREAK for equal (or absent) prominenceScore: prefer a tile with a photo
 * (it will actually render as a card, not a placeholder — same reasoning as
 * anchor-backfill.ts's `rank()`), then stable-order by id so the result is
 * deterministic. `prominenceScore` is treated as an imperfect signal
 * (source-corroboration + NPS/RIDB backing, not true "interest") — it is
 * what's available today; not blocked on a future quality signal.
 */
export function pickProminenceFeature(tiles: CorridorPlace[]): CorridorPlace | undefined {
  const candidates = tiles.filter((p) => !p.curated && isRealContent(p));
  if (candidates.length === 0) return undefined;
  return candidates.sort((a, b) => {
    const scoreDiff = (b.prominenceScore ?? -Infinity) - (a.prominenceScore ?? -Infinity);
    if (scoreDiff !== 0) return scoreDiff;
    const photoDiff = (b.photoUrl ? 1 : 0) - (a.photoUrl ? 1 : 0);
    if (photoDiff !== 0) return photoDiff;
    return a.id.localeCompare(b.id);
  })[0];
}

/**
 * Drop pass-through corridor cities with nothing WORTH BROWSING clustered
 * under them from the spine — a literally empty pool (no featured anchor
 * card, no pool tiles at all: PR #300), a pool that is entirely
 * gas-station/EV-charging infrastructure (PR #301), OR a pool where every
 * non-fuel tile is an unenriched placeholder with no description written
 * yet (a real place, but "not ready to show" — the Foster City case: a wall
 * of charging stations plus one undescribed real POI still has nothing
 * worth reading). A city with a MIX of fuel and at least one non-fuel,
 * DESCRIBED place still renders normally, with every tile — fuel included —
 * still listed in its pool; this only gates whether the city HEADER is
 * worth showing, never strips tiles out of a pool that does render.
 * Start/end nodes always render regardless of content: they anchor the day
 * (the trip's actual origin/overnight), not just a pass-through.
 *
 * `cityTiles`/`cityFeatured` are keyed by CorridorCity object identity
 * (the same city instances `items` was built from), matching how the caller
 * already computes them once for both the CityNode content check here and
 * the actual render. `last` is recomputed against the FILTERED list — the
 * true final visible entry drops its connector, not whatever was last in
 * the unfiltered `items` (which may now be hidden). Pure — `items` is not
 * mutated, so callers that need the full unfiltered list still have it.
 */
export function filterVisibleSpineItems(
  items: SpineItem[],
  cityTiles: Map<CorridorCity, CorridorPlace[]>,
  cityFeatured: Map<CorridorCity, CorridorPlace[]>,
): SpineItem[] {
  return items
    .filter((item) => {
      if (item.type !== "city") return true;
      if (item.city.kind !== "corridor") return true;
      const tiles = cityTiles.get(item.city) ?? [];
      const featured = cityFeatured.get(item.city) ?? [];
      return hasRealContent(tiles) || hasRealContent(featured);
    })
    .map((item, idx, arr) => ({ ...item, last: idx === arr.length - 1 }));
}

/**
 * The ONE place the read spine decides where a curated pick sits — by projecting
 * its coords onto the day's route, never by trusting the stored `milesFromStart`
 * (which `bakeGeneratedDays` measures against a zigzag line that threads the day's
 * own destination and overnight as vias, in audit push order; measured 2026-07-28,
 * that inflates PROD tiles up to x2.3 of their own day's miles).
 *
 * ROUND-TRIP DAYS GET NO MILE LABEL, DELIBERATELY. Where start == end the day's
 * driving is absent from `Trip.routePolyline` entirely — measured on
 * `expedition-ms28y793`, the polyline runs 899 mi against 1,200 mi of claimed
 * `day.miles`, and the 301-mi shortfall is exactly the six round-trip days' miles
 * (300). Projection there returns whatever main-route vertex happens to be
 * nearest, which is how three stops up to 30 road miles apart all landed on the
 * same -8mi. So there is no along-route figure to show. We order the stops
 * near→far from the anchor (the outbound sequence, matching the edit spine's
 * `orderKey`) and render the tick WITHOUT a number. A radial crow-flies distance
 * would put a different quantity behind the same "mi" as every other day, with
 * nothing on screen to distinguish them — an invented field, not a display choice.
 * `day-detail-node-blocks.tsx` reaches the same place from the other side: it
 * labels from `city.milesFromStart` and uses projection ONLY for placement.
 */
export function spinePosition(input: {
  roundTrip: boolean;
  anchor?: [number, number];
  positioned: Map<string, PositionedPlace>;
}): (place: CorridorPlace) => SpinePos {
  const { roundTrip, anchor, positioned } = input;
  return (place) => {
    if (roundTrip) {
      const radial =
        place.coords && anchor ? haversineMi(place.coords, anchor) : Number.POSITIVE_INFINITY;
      return { sort: radial, tiebreak: 0, label: null };
    }
    const pos = positioned.get(place.id);
    if (!pos) return { sort: Number.POSITIVE_INFINITY, tiebreak: 0, label: null };
    // A pick can project UPSTREAM of the day's start on an ordinary day too —
    // an off-route stop whose nearest point on the trip line falls before this
    // day begins (measured: Fremont Indian State Park at -23 on day 9 of
    // expedition-ms28y793, a Richfield->Torrey day that is NOT a round trip).
    // Keep its true position, which correctly sorts it ahead of the start node
    // and tells the reader it is behind them, but claim no mile: "-23mi" is
    // noise and clamping it to "0mi" would assert it sits at the day's start,
    // which is false by 23 miles.
    if (pos.dayMile < 0) return { sort: pos.dayMile, tiebreak: pos.offsetMi, label: null };
    return { sort: pos.dayMile, tiebreak: pos.offsetMi, label: pos.dayMile };
  };
}

/** The place id the map marker focused (PR2 marker→card). Provided by
 *  DayDetailCorridor and read by every PlaceSlot, so the sub-components (CityNode,
 *  KeyStopNode, MileTick, RestDayNearby) need no prop threading. */
const FocusContext = createContext<string | null>(null);

/** Wraps one place card with a `data-place-id` handle (found by the map-marker
 *  focus listener via querySelector) and the focus highlight. Mirrors
 *  find-nearby's card wrapper exactly: the glow is a box-shadow on the WRAPPER,
 *  not on the card's own `overflow-clip` root (which would clip it). `fit-content`
 *  keeps the wrapper hugging the fixed-width card inside a stretch flex column. */
function PlaceSlot({
  placeId,
  children,
}: {
  placeId: string;
  children: React.ReactNode;
}) {
  const focused = placeId === useContext(FocusContext);
  return (
    <div
      data-place-id={placeId}
      style={{
        width: "fit-content",
        borderRadius: 8,
        transition: "box-shadow 160ms ease",
        boxShadow: focused
          ? "0 0 0 2px var(--amber), 0 0 18px 2px color-mix(in srgb, var(--amber) 55%, transparent)"
          : "none",
      }}
    >
      {children}
    </div>
  );
}

export function DayDetailCorridor({
  dayLabel,
  dayNumber,
  routeLabel,
  heroImageUrl,
  heroAlt = "",
  cities,
  places,
  mileMarkers = [],
  onRemovePlace,
  onOpenPlace,
  onExploreDay,
  briefing,
  editMode = false,
  placeOverrides = [],
  dayMiles,
  dayDriveHours,
  restDay = false,
  routeLine,
  dayStartMile,
  onMovePlace,
  ranks,
  onReorderPlace,
  pendingPlaceId,
  errorPlaceId,
  errorMessage,
  onDismissError,
  buildCuratedMenu,
  focusedId,
}: Props) {
  const byId = new Map(places.map((p) => [p.id, p]));
  // Read-spine cluster order: the SAME node-scoped rank key the edit spine builds
  // (scopeRankKey), so a city node's pool tiles render in authored order rather
  // than raw server/mile order (Hop A). Undefined when nothing's ranked, in which
  // case sortClusterByRank is a passthrough. Curated key stops honor it separately
  // (Hop B, via classifyCuratedPicks) — they don't render inside the pool cluster.
  const rankKey = scopeRankKey(cities, ranks);
  // Generated trips flag the LLM's curated key stops; when any exist, they
  // render IN their spine position (ordered by along-route mile) and each
  // node collapses the rest of its pool behind "Explore more". Reference
  // trips (no curated flags) keep showing all tiles inline.
  const curatedMode = places.some((p) => p.curated);
  // Deduped curated picks, split by whether the bake positioned them
  // (milesFromStart): positioned → in-spine key-stop nodes; unpositioned
  // (off-corridor, or a layover day with no polyline) → the fallback block, so
  // nothing disappears.
  const curatedPicks = curatedMode
    ? Array.from(
        new Map(places.filter((p) => p.curated).map((p) => [p.id, p])).values(),
      )
    : [];
  // Override wins over both anchor and mile-position: a curated pick explicitly
  // PINNED to a node this day relocates under it (rendered via pinnedKeyStops
  // below, at its true mile). Split those out FIRST so the anchor/positioned
  // logic only sees the non-pinned rest (precedence: override > anchor > mile).
  const { pinnedByNode, rest: unpinnedPicks } = classifyCuratedPicks({
    curatedPicks,
    cities,
    placeOverrides,
    rankKey,
  });
  // A pick that IS the start/end anchor (matched by id | name | tight coords —
  // the shared anchor-match rule) renders as a featured detail card UNDER that
  // city node, not as a separate positioned key stop: same place, shown once,
  // its card still reachable at the anchor.
  const startCity = cities[0];
  const endCity = cities[cities.length - 1];
  const cityAnchorLike = (c: CorridorCity): AnchorLike => ({
    id: c.id,
    name: c.name,
    coords: c.coords,
  });
  const anchorPicks = unpinnedPicks.filter((p) =>
    coincidesWithAnchor(toAnchorLike(p), cities),
  );
  // Every city's own pool tiles, resolved up front so featuredFor (next) can
  // fall back to a prominence pick from THIS city's pool when no LLM
  // curation names it — needed before featuredFor so the fallback has
  // something to rank.
  const cityTiles = new Map<CorridorCity, CorridorPlace[]>();
  for (const c of cities) {
    cityTiles.set(c, sortClusterByRank(c.placeIds, rankKey).map((id) => byId.get(id)).filter(Boolean) as CorridorPlace[]);
  }
  // Featured card for a node: an anchor node (start/end) first tries the
  // LLM's own curation (a pick that coincides with that anchor's identity —
  // never overridden by the fallback below). ANY city with no curated match —
  // anchor or mid-corridor — falls back to that city's own highest-prominence
  // real-content pick, so every rendered city gets an inline highlight, not
  // just anchors the LLM happened to name itself.
  const featuredFor = (c: CorridorCity): CorridorPlace[] => {
    if (c === startCity || c === endCity) {
      const curated = anchorPicks.filter((p) =>
        isSameAnchorPlace(toAnchorLike(p), cityAnchorLike(c)),
      );
      if (curated.length > 0) return curated;
    }
    const pick = pickProminenceFeature(cityTiles.get(c) ?? []);
    return pick ? [pick] : [];
  };
  // The rest position on the spine by along-route mile.
  const spinePicks = unpinnedPicks.filter(
    (p) => !coincidesWithAnchor(toAnchorLike(p), cities),
  );
  // Project EVERY curated pick, not just the spine ones: `pinnedKeyStops` are
  // disjoint from `spinePicks` (classifyCuratedPicks splits pinned out first)
  // and they need a mile for their gutter tick too. curatedPicks is the superset
  // of both, so one pass covers the lot.
  const roundTrip = isRoundTripCorridor(cities);
  const positioned = positionPlacesOnDay({
    line: routeLine ?? [],
    places: curatedPicks,
    dayStartMile: dayStartMile ?? 0,
  });
  const placeMile = spinePosition({ roundTrip, anchor: cities[0]?.coords, positioned });
  // In-spine vs the fallback block: a pick is positionable when the geometry can
  // place it — projected onto the day's route, or (round-trip) measurable from
  // the anchor. Everything else keeps its card in the fallback block, exactly as
  // an unpositioned pick did when this read stored miles.
  const canPosition = (p: CorridorPlace) =>
    roundTrip ? !!p.coords && !!cities[0]?.coords : positioned.has(p.id);
  const positionedPicks = spinePicks.filter(canPosition);
  const unpositionedPicks = spinePicks.filter((p) => !canPosition(p));
  // Pinned picks render at their node's position (carrying their true mile).
  const pinnedKeyStops = cities.flatMap((c) =>
    (pinnedByNode.get(c.id) ?? []).map((place) => ({ place, nodeMile: c.milesFromStart })),
  );
  const dd = String(dayNumber).padStart(2, "0");

  // One ordered spine: city nodes + positioned key stops + pinned picks (at
  // their node) + (demo) mile markers, interleaved by along-route mile so a key
  // stop sits BETWEEN the anchors at the point you'd actually reach it.
  const items = buildSpineItems({
    cities,
    keyStops: positionedPicks,
    pinnedKeyStops,
    mileMarkers,
    byId,
    placeMile,
  });

  // A pass-through corridor city with nothing clustered under it (no featured
  // anchor card, no pool tiles for "Explore more") renders as a bare name +
  // mile tick with no content — the density-cascade symptom from strict-
  // proximity corridor selection (PR #296, 21-29 cities/day on dense routes).
  // Drop it from the RENDERED spine only; `cities`/`items` (the data) are
  // untouched, so mile-marker continuity and any logic reading the full
  // corridor city list (fuel gaps, day-splitting, plan-diff labels) still see
  // every city.
  const cityFeatured = new Map<CorridorCity, CorridorPlace[]>();
  for (const c of cities) {
    cityFeatured.set(c, featuredFor(c));
  }
  const visibleItems = filterVisibleSpineItems(items, cityTiles, cityFeatured);

  return (
    <FocusContext.Provider value={focusedId ?? null}>
    <div
      className="flex flex-col items-center"
      style={{
        width: "var(--rail-column-w)",
        backgroundColor: "color-mix(in srgb, var(--grounds-850) 80%, transparent)",
        // Edit mode widens the column 478->511 (and content 462->495) so the
        // wider place cards (400->440) fit. Overriding the tokens here cascades
        // to every descendant that reads them.
        ...(editMode
          ? ({
              "--rail-column-w": "511px",
              "--rail-card-w": "495px",
            } as React.CSSProperties)
          : {}),
      }}
    >
      {/* ── Day header — 464×64 band (Barlow Medium 20 / #ECEAE4) ── */}
      <div
        className="flex flex-col shrink-0"
        style={{
          // Edit mode widens the content to --rail-card-w (495); match the
          // header band to it so it spans the same width as the hero photo.
          // Non-edit keeps its original fixed 464.
          width: editMode ? "var(--rail-card-w)" : 464,
          height: 54,
          gap: 3,
          padding: "4px 2px 7px 12px",
          backgroundColor: "var(--steel-750)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontWeight: 500,
            fontSize: 20,
            lineHeight: "24px",
            color: "var(--text-primary)",
          }}
        >
          {dayLabel}
        </span>
        <span style={{ fontFamily: "var(--ff-sans)", fontSize: 14, lineHeight: "18px", color: "var(--text-muted)" }}>
          {routeLabel}
        </span>
      </div>

      {/* Content column — 462px, ~8px gutter each side of the 478px column. */}
      <div className="flex flex-col" style={{ width: "var(--rail-card-w)" }}>
      {/* ── Day hero ───────────────────────────────────────────── */}
      <div>
        <div
          role="img"
          aria-label={heroAlt || routeLabel}
          style={{
            width: "100%",
            height: 148,
            borderRadius: 3,
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-card)",
            backgroundImage: heroImageUrl ? `url(${heroImageUrl})` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
      </div>

      {/* ── Day-level reasoned fill (LLM briefing/weather/overnight/
           logistics/obligations) — the day's context, above the route ── */}
      {briefing && <div style={{ paddingTop: 16 }}>{briefing}</div>}

      {/* Edit surface: the node-model City Block spine (nodes with POIs
          grouped beneath, mile gutter, capped labeled drives, orphan tail).
          The read view keeps the mile-interleaved spine below so the two
          treatments can be compared directly. */}
      {editMode ? (
        <DayDetailNodeBlocks
          cities={cities}
          byId={byId}
          line={routeLine ?? []}
          dayStartMile={dayStartMile ?? 0}
          dayMiles={dayMiles}
          dayDriveHours={dayDriveHours}
          onOpenPlace={onOpenPlace}
          onRemovePlace={onRemovePlace}
          editMode={editMode}
          onMovePlace={onMovePlace}
          ranks={ranks}
          onReorderPlace={onReorderPlace}
          pendingPlaceId={pendingPlaceId}
          errorPlaceId={errorPlaceId}
          errorMessage={errorMessage}
          onDismissError={onDismissError}
        />
      ) : restDay ? (
        <RestDayNearby
          places={places}
          onOpenPlace={onOpenPlace}
          buildCuratedMenu={buildCuratedMenu}
          editMode={editMode}
        />
      ) : (
      <>
      {/* ── Fallback block — curated picks the bake couldn't position on the
           spine (off-corridor, or a layover day with no polyline). Positioned
           picks render in-spine below; this keeps the rest visible. ── */}
      {unpositionedPicks.length > 0 && (
        <div className="flex flex-col" style={{ paddingTop: 16, gap: 10 }}>
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 11,
              lineHeight: "14px",
              letterSpacing: "0.16em",
              color: "var(--amber-dark)",
            }}
          >
            Today&apos;s Key Stops
          </span>
          <div className="flex flex-col" style={{ gap: 8 }}>
            {unpositionedPicks.map((p) => (
              <PlaceSlot key={p.id} placeId={p.id}>
                <CategoryListCard
                  place={p}
                  verified={!!p.placeId}
                  category={p.category}
                  description={p.description}
                  status={pickStatus(p)}
                  onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                  curatedMenu={buildCuratedMenu?.(p)}
                  editMode={editMode}
                />
              </PlaceSlot>
            ))}
          </div>
        </div>
      )}

      {/* Section label for the in-spine key stops — sits above the Start
          (Carmacks) node. Only when the day actually has positioned picks. */}
      {positionedPicks.length > 0 && (
        <span
          className="uppercase"
          style={{
            paddingTop: 16,
            fontFamily: "var(--ff-display)",
            fontSize: 11,
            lineHeight: "14px",
            letterSpacing: "0.16em",
            color: "var(--amber-dark)",
          }}
        >
          Key Stops
        </span>
      )}

      {/* ── Corridor spine — city nodes with key stops interleaved at their
           along-route mile (ordered Start → key stops → End). ── */}
      <div className="flex flex-col" style={{ paddingTop: positionedPicks.length > 0 ? 12 : 16 }}>
        {visibleItems.map((item, idx) =>
          item.type === "city" ? (
            <CityNode
              // Unique among siblings: a same-city day (rest day, or a
              // round-trip passing one city twice) yields nodes whose slug
              // `id` collides; keying on id alone produced duplicate React
              // keys → reconciliation left a phantom node across day switches.
              // kind disambiguates start/end; idx covers two same-kind
              // through-cities with the same slug.
              key={`${item.city.id}-${item.city.kind}-${idx}`}
              city={item.city}
              tiles={cityTiles.get(item.city) ?? []}
              featured={cityFeatured.get(item.city) ?? []}
              curatedMode={curatedMode}
              last={item.last}
              onRemovePlace={onRemovePlace}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
              buildCuratedMenu={buildCuratedMenu}
            />
          ) : item.type === "keystop" ? (
            <KeyStopNode
              key={`ks-${item.place.id}`}
              place={item.place}
              mile={item.mile}
              last={item.last}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
              buildCuratedMenu={buildCuratedMenu}
            />
          ) : (
            <MileTick
              key={`mk-${item.mile}`}
              mile={item.mile}
              tiles={item.tiles}
              last={item.last}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
              buildCuratedMenu={buildCuratedMenu}
            />
          ),
        )}
      </div>
      </>
      )}

      {/* ── Footer CTA ─────────────────────────────────────────── */}
      <div style={{ padding: 15 }}>
        <button
          type="button"
          onClick={onExploreDay ?? noop}
          className="w-full uppercase"
          style={{
            height: 44,
            borderRadius: 6,
            border: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-card)",
            color: "var(--amber-light)",
            fontFamily: "var(--ff-display)",
            fontSize: 13,
            letterSpacing: "0.14em",
          }}
        >
          Explore more of Day {dd}
        </button>
      </div>
      </div>
    </div>
    </FocusContext.Provider>
  );
}

/** A layover's inline "Nearby" block: the day's own segmentSuggestions (corpus
 *  tiles near the stop, ranked by distance, capped at 10) as place cards. A rest
 *  day has no curated key stops and no corridor spine to bucket these under, so
 *  without this block they'd be stored and never seen. Copy is deliberately NOT
 *  "walkable" — the 16 km corridor buffer means some sit ~10 miles out. */
function RestDayNearby({
  places,
  onOpenPlace,
  buildCuratedMenu,
  editMode,
}: {
  places: CorridorPlace[];
  onOpenPlace?: (id: string) => void;
  buildCuratedMenu?: (place: CorridorPlace) => CuratedMenu | undefined;
  editMode: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ paddingTop: 16, gap: 10 }}>
      <div className="flex flex-col" style={{ gap: 2 }}>
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 11,
            lineHeight: "14px",
            letterSpacing: "0.16em",
            color: "var(--amber-dark)",
          }}
        >
          Nearby
        </span>
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontSize: 12,
            lineHeight: "16px",
            color: "var(--text-muted)",
          }}
        >
          Within about 10 miles of your stop, closest first
        </span>
      </div>
      {places.length > 0 ? (
        <div className="flex flex-col" style={{ gap: 8 }}>
          {places.map((p) => (
            <PlaceSlot key={p.id} placeId={p.id}>
              <CategoryListCard
                place={p}
                verified={!!p.placeId}
                category={p.category}
                description={p.description}
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                curatedMenu={buildCuratedMenu?.(p)}
                editMode={editMode}
              />
            </PlaceSlot>
          ))}
        </div>
      ) : (
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontSize: 13,
            lineHeight: "17px",
            color: "var(--text-muted)",
          }}
        >
          No places found near this stop.
        </span>
      )}
    </div>
  );
}

/** One city node: gutter (mile label + timeline dot/connector) + content
 *  (city header, "Explore more [city]" link, place-tile cluster). */
function CityNode({
  city,
  tiles,
  featured = [],
  curatedMode,
  last,
  onRemovePlace,
  onOpenPlace,
  editMode,
  buildCuratedMenu,
}: {
  city: CorridorCity;
  tiles: CorridorPlace[];
  /** This city's featured pick — either a curated place that IS this city (an
   *  anchor match, rendered here instead of duplicated as a separate
   *  positioned tile), or, when no curation names this city, the pool's own
   *  highest-prominence real-content pick (see pickProminenceFeature). At
   *  most one entry today, but kept as an array for the anchor-match path's
   *  existing shape. */
  featured?: CorridorPlace[];
  /** When the day has curated picks: feature this node's picks and collapse
   *  the rest behind "Explore more" (default collapsed). Otherwise show all. */
  curatedMode: boolean;
  last: boolean;
  onRemovePlace?: (placeId: string) => void;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
  buildCuratedMenu?: (place: CorridorPlace) => CuratedMenu | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  // Curated picks are featured in the day-level "Today's Picks" block (reliable
  // regardless of bucketing); the spine just collapses the rest of the pool.
  // Exclude whatever's already shown as this city's featured pick (curated
  // anchor match OR the new prominence fallback) so "Explore N more" never
  // double-counts it — same tile, shown once. `!t.curated` still covers a
  // curated tile that's featured ELSEWHERE (a different anchor, a pinned
  // node, or its own standalone KeyStopNode); the featuredIds check covers
  // the (non-curated) prominence-fallback case that check doesn't reach.
  const featuredIds = new Set(featured.map((f) => f.id));
  const rest = tiles.filter(
    (t) => !featuredIds.has(t.id) && (!curatedMode || !t.curated),
  );
  const showRest = !curatedMode || expanded;
  const isStart = city.kind === "start";
  // Real derivation output is fractional (projected along-route miles);
  // the gutter shows whole miles.
  const mileLabel = isStart ? "Start" : `${Math.round(city.milesFromStart)}mi`;

  return (
    <div className="flex" style={{ paddingBottom: 22 }}>
      {/* Gutter — mile label + timeline dot/connector (rail treatment). */}
      <div className="relative shrink-0" style={{ width: GUTTER_W }}>
        <span
          className="absolute"
          style={{
            top: 1,
            left: 4,
            fontFamily: "var(--ff-mono)",
            fontSize: 12,
            lineHeight: "16px",
            letterSpacing: "-0.02em",
            color: "var(--timeline-active)",
          }}
        >
          {mileLabel}
        </span>
        {/* Node dot + connector line down to the next node. */}
        <div className="absolute" style={{ left: 10, top: 22, bottom: last ? undefined : -22, width: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 100, backgroundColor: "var(--timeline-active)" }} />
          {!last && (
            <div className="absolute" style={{ top: 6, left: 2.5, bottom: 0, width: 1, backgroundColor: "var(--timeline-inactive)" }} />
          )}
        </div>
      </div>

      {/* Content — header, curated picks, collapsible pool. */}
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 10 }}>
        <div className="flex flex-col" style={{ gap: 3 }}>
          <span style={{ fontFamily: "var(--ff-sans)", fontWeight: 600, fontSize: 17, lineHeight: "22px", color: "var(--text-primary)" }}>
            {city.name}
          </span>
          {/* Reference trips (no curated picks) keep the passive explore link. */}
          {!curatedMode && (
            <button
              type="button"
              onClick={noop}
              className="self-start"
              style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--text-primary)" }}
            >
              Explore more {city.name} →
            </button>
          )}
        </div>

        {/* Featured anchor cards — this node's own place (the day's start/end),
            shown once, here, with its full detail card. */}
        {featured.length > 0 && (
          <div className="flex flex-col" style={{ gap: 8 }}>
            {featured.map((p) => (
              <PlaceSlot key={p.id} placeId={p.id}>
                <CategoryListCard
                  place={p}
                  verified={!!p.placeId}
                  category={p.category}
                  description={p.description}
                  status={pickStatus(p)}
                  onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                  onRemove={
                    p.removable && onRemovePlace
                      ? () => onRemovePlace(p.id)
                      : undefined
                  }
                  curatedMenu={buildCuratedMenu?.(p)}
                  editMode={editMode}
                />
              </PlaceSlot>
            ))}
          </div>
        )}

        <div className="flex flex-col" style={{ gap: 8 }}>
          {showRest &&
            rest.map((p) => (
              <PlaceSlot key={p.id} placeId={p.id}>
                <CategoryListCard
                  place={p}
                  verified={!!p.placeId}
                  category={p.category}
                  description={p.description}
                  status={pickStatus(p)}
                  onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                  onRemove={
                    p.removable && onRemovePlace
                      ? () => onRemovePlace(p.id)
                      : undefined
                  }
                  curatedMenu={buildCuratedMenu?.(p)}
                  editMode={editMode}
                />
              </PlaceSlot>
            ))}
        </div>

        {/* Demote the pool: collapsed by default, revealed on demand. */}
        {curatedMode && rest.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="self-start"
            style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--text-muted)" }}
          >
            {expanded
              ? `Hide ${rest.length} more ↑`
              : `Explore ${rest.length} more near ${city.name} →`}
          </button>
        )}
      </div>
    </div>
  );
}

/** One key-stop node: an on-route curated pick in its spine position. Gutter
 *  carries the mile tick + an amber dot (distinct from the white city dots);
 *  the content column holds the curated tile. The "KEY STOPS" section header
 *  above the spine labels the group; the gutter mile is the distance-from-start. */
function KeyStopNode({
  place,
  mile,
  last,
  onOpenPlace,
  editMode,
  buildCuratedMenu,
}: {
  place: CorridorPlace;
  /** null on a round-trip day — the stop keeps its dot and its place in the
   *  order, but no mile is claimed for it (see `spinePosition`). */
  mile: number | null;
  last: boolean;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
  buildCuratedMenu?: (place: CorridorPlace) => CuratedMenu | undefined;
}) {
  const m = mile == null ? null : Math.round(mile);
  return (
    <div className="flex" style={{ paddingBottom: 22 }}>
      {/* Gutter — mile label + amber dot/connector (featured pick). */}
      <div className="relative shrink-0" style={{ width: GUTTER_W }}>
        {m != null && (
          <span
            className="absolute"
            style={{
              top: 1,
              left: 4,
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "-0.02em",
              color: "var(--amber)",
            }}
          >
            {m}mi
          </span>
        )}
        {/* Amber 8px dot (centered on the 13px spine line) + connector. */}
        <div className="absolute" style={{ left: 10, top: 22, bottom: last ? undefined : -22, width: 6 }}>
          <div style={{ width: 8, height: 8, marginLeft: -1, borderRadius: 100, backgroundColor: "var(--amber)" }} />
          {!last && (
            <div className="absolute" style={{ top: 8, left: 2.5, bottom: 0, width: 1, backgroundColor: "var(--timeline-inactive)" }} />
          )}
        </div>
      </div>

      {/* Content — the curated tile at its spine position (mile in the gutter). */}
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        <PlaceSlot placeId={place.id}>
          <CategoryListCard
            place={place}
            verified={!!place.placeId}
            category={place.category}
            description={place.description}
            status={pickStatus(place)}
            onOpen={onOpenPlace ? () => onOpenPlace(place.id) : noop}
            curatedMenu={buildCuratedMenu?.(place)}
            editMode={editMode}
          />
        </PlaceSlot>
      </div>
    </div>
  );
}

/** Distance tick in the gutter (no city header). May carry place tiles that
 *  align to the marker on the spine (e.g. The Broad at the 40mi mark). */
function MileTick({
  mile,
  tiles = [],
  last = false,
  onOpenPlace,
  editMode,
  buildCuratedMenu,
}: {
  mile: number;
  tiles?: CorridorPlace[];
  last?: boolean;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
  buildCuratedMenu?: (place: CorridorPlace) => CuratedMenu | undefined;
}) {
  const hasTiles = tiles.length > 0;
  return (
    <div className="flex" style={hasTiles ? { paddingBottom: 22 } : { height: 30 }}>
      <div className="relative shrink-0" style={{ width: GUTTER_W }}>
        <span
          className="absolute"
          style={{
            top: 1,
            left: 4,
            fontFamily: "var(--ff-mono)",
            fontSize: 12,
            lineHeight: "16px",
            letterSpacing: "-0.02em",
            color: "var(--timeline-active)",
          }}
        >
          {mile}mi
        </span>
        {/* Node dot (white 6px) + connector line starting below it — matches a
         *  city node, so the vertical line has a gap at the marker. */}
        <div className="absolute" style={{ left: 10, top: 22, bottom: last ? undefined : -22, width: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 100, backgroundColor: "var(--timeline-active)" }} />
          {!last && (
            <div className="absolute" style={{ top: 6, left: 2.5, bottom: 0, width: 1, backgroundColor: "var(--timeline-inactive)" }} />
          )}
        </div>
      </div>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        {tiles.map((p) => (
          <PlaceSlot key={p.id} placeId={p.id}>
            <CategoryListCard
              place={p}
              verified={!!p.placeId}
              category={p.category}
              description={p.description}
              status={pickStatus(p)}
              onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
              curatedMenu={buildCuratedMenu?.(p)}
              editMode={editMode}
            />
          </PlaceSlot>
        ))}
      </div>
    </div>
  );
}
