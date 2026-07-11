"use client";

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
  const dd = String(dayNumber).padStart(2, "0");

  // Interleave bare mile markers between city nodes by mile position.
  type Item =
    | { type: "city"; city: CorridorCity; last: boolean }
    | { type: "marker"; mile: number; tiles: CorridorPlace[] };
  const items: Item[] = [];
  cities.forEach((city, i) => {
    const isLastCity = i === cities.length - 1;
    items.push({ type: "city", city, last: isLastCity });
    const nextMile = isLastCity ? Infinity : cities[i + 1].milesFromStart;
    mileMarkers
      .filter((mk) => mk.mile > city.milesFromStart && mk.mile < nextMile)
      .forEach((mk) =>
        items.push({
          type: "marker",
          mile: mk.mile,
          tiles: (mk.placeIds ?? []).map((id) => byId.get(id)).filter(Boolean) as CorridorPlace[],
        }),
      );
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

      {/* ── Corridor of city nodes ─────────────────────────────── */}
      <div className="flex flex-col" style={{ paddingTop: 16 }}>
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
              last={item.last && idx === items.length - 1}
              onRemovePlace={onRemovePlace}
              onOpenPlace={onOpenPlace}
            />
          ) : (
            <MileTick
              key={`mk-${item.mile}`}
              mile={item.mile}
              tiles={item.tiles}
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
  last,
  onRemovePlace,
  onOpenPlace,
}: {
  city: CorridorCity;
  tiles: CorridorPlace[];
  last: boolean;
  onRemovePlace?: (placeId: string) => void;
  onOpenPlace?: (placeId: string) => void;
}) {
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

      {/* Content — header, explore link, tile cluster. */}
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0, gap: 10 }}>
        <div className="flex flex-col" style={{ gap: 3 }}>
          <span style={{ fontFamily: "var(--ff-sans)", fontWeight: 600, fontSize: 17, lineHeight: "22px", color: "var(--text-primary)" }}>
            {city.name}
          </span>
          <button
            type="button"
            onClick={noop}
            className="self-start"
            style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--text-primary)" }}
          >
            Explore more {city.name} →
          </button>
        </div>

        <div className="flex flex-col" style={{ gap: 8 }}>
          {tiles.map((p) => (
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
      </div>
    </div>
  );
}

/** Distance tick in the gutter (no city header). May carry place tiles that
 *  align to the marker on the spine (e.g. The Broad at the 40mi mark). */
function MileTick({
  mile,
  tiles = [],
  onOpenPlace,
}: {
  mile: number;
  tiles?: CorridorPlace[];
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
        <div className="absolute" style={{ left: 10, top: 22, bottom: -22, width: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: 100, backgroundColor: "var(--timeline-active)" }} />
          <div className="absolute" style={{ top: 6, left: 2.5, bottom: 0, width: 1, backgroundColor: "var(--timeline-inactive)" }} />
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
