"use client";

import { useState } from "react";
import { CategoryListCard } from "@/components/trip/category-list-card";
import type { BrowseCardCategory } from "@/lib/trip-browse/palette";

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
};

const GUTTER_W = 48;

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
  mileMarkers: { mile: number; placeIds?: string[] }[];
  byId: Map<string, CorridorPlace>;
}): SpineItem[] {
  const { cities, keyStops, mileMarkers, byId } = input;
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
  const positionedPicks = curatedPicks.filter((p) => p.milesFromStart != null);
  const unpositionedPicks = curatedPicks.filter((p) => p.milesFromStart == null);
  const dd = String(dayNumber).padStart(2, "0");

  // One ordered spine: city nodes + positioned key stops + (demo) mile markers,
  // interleaved by along-route mile so a key stop sits BETWEEN the anchors at
  // the point you'd actually reach it on the drive.
  const items = buildSpineItems({
    cities,
    keyStops: positionedPicks,
    mileMarkers,
    byId,
  });

  return (
    <div
      className="flex flex-col items-center"
      style={{
        width: "var(--rail-column-w)",
        backgroundColor: "color-mix(in srgb, var(--grounds-850) 80%, transparent)",
      }}
    >
      {/* ── Day header — 464×64 band (Barlow Medium 20 / #ECEAE4) ── */}
      <div
        className="flex flex-col shrink-0"
        style={{ width: 464, height: 54, gap: 3, padding: "4px 2px 7px 2px", backgroundColor: "var(--steel-750)" }}
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
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
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
              curatedMode={curatedMode}
              last={item.last}
              onRemovePlace={onRemovePlace}
              onOpenPlace={onOpenPlace}
            />
          ) : item.type === "keystop" ? (
            <KeyStopNode
              key={`ks-${item.place.id}`}
              place={item.place}
              mile={item.mile}
              last={item.last}
              onOpenPlace={onOpenPlace}
            />
          ) : (
            <MileTick
              key={`mk-${item.mile}`}
              mile={item.mile}
              tiles={item.tiles}
              last={item.last}
              onOpenPlace={onOpenPlace}
            />
          ),
        )}
      </div>

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
  curatedMode,
  last,
  onRemovePlace,
  onOpenPlace,
}: {
  city: CorridorCity;
  tiles: CorridorPlace[];
  /** When the day has curated picks: feature this node's picks and collapse
   *  the rest behind "Explore more" (default collapsed). Otherwise show all. */
  curatedMode: boolean;
  last: boolean;
  onRemovePlace?: (placeId: string) => void;
  onOpenPlace?: (placeId: string) => void;
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

        <div className="flex flex-col" style={{ gap: 8 }}>
          {showRest &&
            rest.map((p) => (
              <CategoryListCard
                key={p.id}
                place={p}
                category={p.category}
                onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
                onRemove={
                  p.removable && onRemovePlace
                    ? () => onRemovePlace(p.id)
                    : undefined
                }
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
}: {
  place: CorridorPlace;
  mile: number;
  last: boolean;
  onOpenPlace?: (placeId: string) => void;
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
          onOpen={onOpenPlace ? () => onOpenPlace(place.id) : noop}
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
}: {
  mile: number;
  tiles?: CorridorPlace[];
  last?: boolean;
  onOpenPlace?: (placeId: string) => void;
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
            onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
          />
        ))}
      </div>
    </div>
  );
}
