"use client";

import { useState } from "react";
import { CategoryListCard } from "@/components/trip/category-list-card";
import { DayDetailNodeBlocks } from "@/components/trip/day-detail-node-blocks";
import type { BrowseCardCategory } from "@/lib/trip-browse/palette";
import {
  coincidesWithAnchor,
  isSameAnchorPlace,
  type AnchorLike,
} from "@/lib/corridor/anchor-match";
import { classifyCuratedPicks } from "@/lib/corridor/curated-placement";
import type { PlaceNodeOverride } from "@/lib/trips/types";
import type { PlaceMove } from "@/components/trip/day-detail-node-blocks";

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
};

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
  dayDriveHours?: number;
  /** Decoded trip route polyline + this day's cumulative start mile — the edit
   *  render projects POI coords onto the route to position them in stretches
   *  (the stored milesFromStart is unreliable; see lib/corridor/stretches.ts). */
  routeLine?: [number, number][];
  dayStartMile?: number;
  /** Manual-edit drag (edit spine): pin/unpin a POI by dragging its card. */
  onMovePlace?: (move: PlaceMove) => void;
  /** Authored per-place order (Trip.placeRanks) + the same-node reorder handler. */
  ranks?: ReadonlyMap<string, number>;
  onReorderPlace?: (placeId: string, rankWrites: Record<string, number>) => void;
  pendingPlaceId?: string | null;
  errorPlaceId?: string | null;
  errorMessage?: string | null;
  onDismissError?: () => void;
};

const GUTTER_W = 48;

/** A CorridorPlace as an anchor-match subject (its title is the place name). */
function toAnchorLike(p: CorridorPlace): AnchorLike {
  return { id: p.id, name: p.title, coords: p.coords };
}

/** One entry on the rendered spine, in along-route order. */
export type SpineItem =
  | { type: "city"; city: CorridorCity; last: boolean }
  | { type: "keystop"; place: CorridorPlace; mile: number; last: boolean }
  | { type: "marker"; mile: number; tiles: CorridorPlace[]; last: boolean };

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
}): SpineItem[] {
  const { cities, keyStops, pinnedKeyStops = [], mileMarkers, byId } = input;
  const RANK = { city: 0, keystop: 1, marker: 2 };
  type Entry = { mile: number; rank: number; make: (last: boolean) => SpineItem };
  const entries: Entry[] = [];
  cities.forEach((city) =>
    entries.push({
      mile: city.milesFromStart,
      rank: RANK.city,
      make: (last) => ({ type: "city", city, last }),
    }),
  );
  keyStops.forEach((place) => {
    const mile = place.milesFromStart as number;
    entries.push({
      mile,
      rank: RANK.keystop,
      make: (last) => ({ type: "keystop", place, mile, last }),
    });
  });
  // Pinned picks sort at their NODE's mile (lands just after that node, tie →
  // city first) but show their own mile in the gutter.
  pinnedKeyStops.forEach(({ place, nodeMile }) => {
    const display = place.milesFromStart ?? nodeMile;
    entries.push({
      mile: nodeMile,
      rank: RANK.keystop,
      make: (last) => ({ type: "keystop", place, mile: display, last }),
    });
  });
  mileMarkers.forEach((mk) =>
    entries.push({
      mile: mk.mile,
      rank: RANK.marker,
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
  entries.sort((a, b) => a.mile - b.mile || a.rank - b.rank);
  return entries.map((e, i) => e.make(i === entries.length - 1));
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
  routeLine,
  dayStartMile,
  onMovePlace,
  ranks,
  onReorderPlace,
  pendingPlaceId,
  errorPlaceId,
  errorMessage,
  onDismissError,
}: Props) {
  const byId = new Map(places.map((p) => [p.id, p]));
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
    presentNodeIds: new Set(cities.map((c) => c.id)),
    placeOverrides,
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
  // Featured cards for a node: only the start/end anchor nodes carry them, each
  // matched to its own node (so a coords/id match with a differing name still
  // attaches to the right anchor).
  const featuredFor = (c: CorridorCity): CorridorPlace[] =>
    c === startCity || c === endCity
      ? anchorPicks.filter((p) =>
          isSameAnchorPlace(toAnchorLike(p), cityAnchorLike(c)),
        )
      : [];
  // The rest position on the spine by along-route mile.
  const spinePicks = unpinnedPicks.filter(
    (p) => !coincidesWithAnchor(toAnchorLike(p), cities),
  );
  const positionedPicks = spinePicks.filter((p) => p.milesFromStart != null);
  const unpositionedPicks = spinePicks.filter((p) => p.milesFromStart == null);
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
  });

  return (
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
              <CategoryListCard
                key={p.id}
                place={p}
                category={p.category}
                status={p.keyStopNote}
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                editMode={editMode}
              />
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
        {items.map((item, idx) =>
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
              tiles={item.city.placeIds.map((id) => byId.get(id)).filter(Boolean) as CorridorPlace[]}
              featured={featuredFor(item.city)}
              curatedMode={curatedMode}
              last={item.last}
              onRemovePlace={onRemovePlace}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
            />
          ) : item.type === "keystop" ? (
            <KeyStopNode
              key={`ks-${item.place.id}`}
              place={item.place}
              mile={item.mile}
              last={item.last}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
            />
          ) : (
            <MileTick
              key={`mk-${item.mile}`}
              mile={item.mile}
              tiles={item.tiles}
              last={item.last}
              onOpenPlace={onOpenPlace}
              editMode={editMode}
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
}: {
  city: CorridorCity;
  tiles: CorridorPlace[];
  /** Curated picks that ARE this city (the day's start/end anchor) — rendered
   *  as detail cards directly under the node header, so the anchor's own place
   *  is reachable here instead of duplicated as a separate positioned tile. */
  featured?: CorridorPlace[];
  /** When the day has curated picks: feature this node's picks and collapse
   *  the rest behind "Explore more" (default collapsed). Otherwise show all. */
  curatedMode: boolean;
  last: boolean;
  onRemovePlace?: (placeId: string) => void;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  // Curated picks are featured in the day-level "Today's Picks" block (reliable
  // regardless of bucketing); the spine just collapses the rest of the pool.
  const rest = curatedMode ? tiles.filter((t) => !t.curated) : tiles;
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
              <CategoryListCard
                key={p.id}
                place={p}
                category={p.category}
                status={p.keyStopNote}
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                onRemove={
                  p.removable && onRemovePlace
                    ? () => onRemovePlace(p.id)
                    : undefined
                }
                editMode={editMode}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col" style={{ gap: 8 }}>
          {showRest &&
            rest.map((p) => (
              <CategoryListCard
                key={p.id}
                place={p}
                category={p.category}
                status={p.keyStopNote}
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                onRemove={
                  p.removable && onRemovePlace
                    ? () => onRemovePlace(p.id)
                    : undefined
                }
                editMode={editMode}
              />
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
}: {
  place: CorridorPlace;
  mile: number;
  last: boolean;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  const m = Math.round(mile);
  return (
    <div className="flex" style={{ paddingBottom: 22 }}>
      {/* Gutter — mile label + amber dot/connector (featured pick). */}
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
            color: "var(--amber)",
          }}
        >
          {m}mi
        </span>
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
        <CategoryListCard
          place={place}
          category={place.category}
          status={place.keyStopNote}
          onOpen={onOpenPlace ? () => onOpenPlace(place.id) : noop}
          editMode={editMode}
        />
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
}: {
  mile: number;
  tiles?: CorridorPlace[];
  last?: boolean;
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
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
          <CategoryListCard
            key={p.id}
            place={p}
            category={p.category}
            status={p.keyStopNote}
            onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
            editMode={editMode}
          />
        ))}
      </div>
    </div>
  );
}
