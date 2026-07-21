"use client";

/**
 * Edit-mode "City Block" render of a day (spec § node-stack model, Paper
 * artboard "Trip Edit— aligned v1-1"). A day is an ordered list of city NODES;
 * the DRIVE between two nodes is a CONTAINER holding the POIs whose position
 * falls within that stretch, in mile order, on a left mile-timeline gutter.
 * Replaces the mile-interleaved read spine for the edit surface only.
 *
 * POI positions come from projecting each place's COORDS onto the route
 * (positionPlacesOnDay) — NOT the stored `milesFromStart`, which is unreliable
 * on current generated trips (~+589-mi foreign offset). This is a render-time
 * stopgap pending the day-coords persistence fix; see
 * lib/corridor/stretches.ts and docs/findings/2026-07-20-*.md.
 *
 * Scope: rendering only, edit-mode gated. Drag handles inert. Node = white dot
 * + city name (a place ON the road); POI = amber tick + mile, indented within
 * its stretch (a stop within the drive). Content-driven height. Off-corridor
 * places (offset > bufferMi) are the only thing in "Along the way".
 */
import { Fragment, useMemo } from "react";
import type { CorridorCity } from "@/lib/trips/types";
import type { LngLat } from "@/lib/routing/route-between";
import {
  positionPlacesOnDay,
  assignPlacesToStretches,
  type PositionedPlace,
} from "@/lib/corridor/stretches";
import { CategoryListCard } from "@/components/trip/category-list-card";
import type { CorridorPlace } from "@/components/trip/day-detail-corridor";

const GUTTER_W = 48;
const noop = () => {};

type Props = {
  cities: CorridorCity[];
  byId: Map<string, CorridorPlace>;
  /** Decoded trip route polyline — POIs project onto it for their position. */
  line: LngLat[];
  /** This day's cumulative start mile along the route (dayStartMiles[idx]). */
  dayStartMile: number;
  /** Day totals — label the whole-day drive on a 2-node day. */
  dayMiles?: number;
  dayDriveHours?: number;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
};

export function DayDetailNodeBlocks({
  cities,
  byId,
  line,
  dayStartMile,
  dayMiles,
  dayDriveHours,
  onOpenPlace,
  onRemovePlace,
  editMode = true,
}: Props) {
  const { positioned, nodeClusters, stretches, alongTheWay } = useMemo(() => {
    // Node/card dedup happens upstream now (corridor/node-identity, applied in
    // resolveCorridorCities + bakeGeneratedDays), so this pool already excludes
    // any place that IS a node — no per-surface filtering here.
    const places = Array.from(byId.values());
    const positioned = positionPlacesOnDay({ line, places, dayStartMile });
    const { nodeClusters, stretches, alongTheWay } = assignPlacesToStretches({
      nodeMiles: cities.map((c) => c.milesFromStart),
      positioned,
    });
    return { positioned, nodeClusters, stretches, alongTheWay };
  }, [byId, line, dayStartMile, cities]);

  // Whole-day dwell (2 coincident nodes, 0-mi "drive"): collapse to one node
  // with its places beneath — no duplicate header, no "0 mi drive" connector.
  const isDwell =
    cities.length === 2 &&
    cities[0].milesFromStart === cities[cities.length - 1].milesFromStart;

  const orphanCards = alongTheWay
    .map((id) => byId.get(id))
    .filter(Boolean) as CorridorPlace[];

  if (isDwell) {
    // One place, one location — everything hangs under the single node.
    const clusterIds = [
      ...nodeClusters.flat(),
      ...stretches.flatMap((s) => s.placeIds),
    ];
    return (
      <div className="flex flex-col" style={{ paddingTop: 16 }}>
        <NodeHeaderRow city={cities[0]} last={clusterIds.length === 0} />
        {clusterIds.map((id, j) => (
          <PoiRow
            key={id}
            place={byId.get(id)}
            pos={positioned.get(id)}
            last={j === clusterIds.length - 1}
            onOpenPlace={onOpenPlace}
            onRemovePlace={onRemovePlace}
            editMode={editMode}
          />
        ))}
        {orphanCards.length > 0 && (
          <AlongTheWay places={orphanCards} onOpenPlace={onOpenPlace} editMode={editMode} />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col" style={{ paddingTop: 16 }}>
      {cities.map((city, i) => {
        const next = cities[i + 1];
        const clusterIds = nodeClusters[i] ?? [];
        const stretchIds = next ? stretches[i]?.placeIds ?? [] : [];
        // The rail terminates on the final node's last cluster card (nothing
        // renders on the rail after the last node).
        const clusterLast = (j: number) =>
          !next && j === clusterIds.length - 1;
        return (
          <Fragment key={`${city.id}-${city.kind}-${i}`}>
            <NodeHeaderRow city={city} last={!next && clusterIds.length === 0} />
            {/* The node's arrival cluster: places within the attach radius —
                where you eat, where you sleep — hang UNDER the node header. */}
            {clusterIds.map((id, j) => (
              <PoiRow
                key={id}
                place={byId.get(id)}
                pos={positioned.get(id)}
                last={clusterLast(j)}
                onOpenPlace={onOpenPlace}
                onRemovePlace={onRemovePlace}
                editMode={editMode}
              />
            ))}
            {next && (
              <StretchContainer
                miles={Math.round(next.milesFromStart - city.milesFromStart)}
                hours={cities.length === 2 ? dayDriveHours : undefined}
                wholeDayMiles={cities.length === 2 ? dayMiles : undefined}
                placeIds={stretchIds}
                byId={byId}
                positioned={positioned}
                isLast={i === cities.length - 2}
                onOpenPlace={onOpenPlace}
                onRemovePlace={onRemovePlace}
                editMode={editMode}
              />
            )}
          </Fragment>
        );
      })}
      {orphanCards.length > 0 && (
        <AlongTheWay places={orphanCards} onOpenPlace={onOpenPlace} editMode={editMode} />
      )}
    </div>
  );
}

/** Fixed 48px gutter (optional mile tick + dot + connector) beside content. */
function RailRow({
  mile,
  mileColor = "var(--timeline-active)",
  dot = true,
  dotColor = "var(--timeline-active)",
  dotSize = 6,
  last = false,
  gap = 14,
  lineFromTop = false,
  children,
}: {
  mile?: string | null;
  mileColor?: string;
  dot?: boolean;
  dotColor?: string;
  dotSize?: number;
  last?: boolean;
  gap?: number;
  lineFromTop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex" style={{ paddingBottom: last ? 0 : gap }}>
      <div className="relative shrink-0" style={{ width: GUTTER_W }}>
        {mile != null && (
          <span
            className="absolute"
            style={{
              top: 1,
              left: 4,
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "-0.02em",
              color: mileColor,
            }}
          >
            {mile}
          </span>
        )}
        <div
          className="absolute"
          style={{ left: 10, top: lineFromTop ? 0 : 22, bottom: last ? undefined : -gap, width: 6 }}
        >
          {dot && (
            <div
              style={{
                width: dotSize,
                height: dotSize,
                marginLeft: dotSize > 6 ? -1 : 0,
                borderRadius: 100,
                backgroundColor: dotColor,
              }}
            />
          )}
          {!last && (
            <div
              className="absolute"
              style={{
                top: dot ? dotSize : 0,
                left: 2.5,
                bottom: 0,
                width: 1,
                backgroundColor: "var(--timeline-inactive)",
              }}
            />
          )}
        </div>
      </div>
      <div className="flex flex-col" style={{ flex: 1, minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

/** A city node: white dot + mile + bold city name + explore link. A place ON
 *  the road (distinct from a POI, which is a stop within the drive). */
function NodeHeaderRow({ city, last }: { city: CorridorCity; last: boolean }) {
  const mileLabel = city.kind === "start" ? "Start" : `${Math.round(city.milesFromStart)}mi`;
  return (
    <RailRow mile={mileLabel} last={last}>
      <div className="flex flex-col" style={{ gap: 3, paddingBottom: 2 }}>
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontWeight: 700,
            fontSize: 22,
            lineHeight: "26px",
            color: "var(--text-primary)",
          }}
        >
          {city.name}
        </span>
        <button
          type="button"
          onClick={noop}
          className="self-start"
          style={{ fontFamily: "var(--ff-sans)", fontSize: 13, lineHeight: "18px", color: "var(--text-muted)" }}
        >
          Explore more {city.name} →
        </button>
      </div>
    </RailRow>
  );
}

/** One POI within a stretch: amber tick + its day-relative mile + card. */
function PoiRow({
  place,
  pos,
  last,
  onOpenPlace,
  onRemovePlace,
  editMode,
}: {
  place?: CorridorPlace;
  pos?: PositionedPlace;
  last: boolean;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  if (!place) return null;
  return (
    <RailRow
      mile={pos ? `${Math.max(0, Math.round(pos.dayMile))}mi` : null}
      mileColor="var(--amber)"
      dot={!!pos}
      dotColor="var(--amber)"
      dotSize={8}
      last={last}
    >
      <CategoryListCard
        place={place}
        category={place.category}
        status={place.keyStopNote}
        onOpen={onOpenPlace ? () => onOpenPlace(place.id) : noop}
        onRemove={place.removable && onRemovePlace ? () => onRemovePlace(place.id) : undefined}
        editMode={editMode}
      />
    </RailRow>
  );
}

/** The drive between two nodes, as a container: a labeled header ("↓ 264 mi ·
 *  5.2 hr drive"), then its POIs in mile order. Content-driven height (NOT
 *  scaled to miles). */
function StretchContainer({
  miles,
  hours,
  wholeDayMiles,
  placeIds,
  byId,
  positioned,
  isLast,
  onOpenPlace,
  onRemovePlace,
  editMode,
}: {
  miles: number;
  hours?: number;
  wholeDayMiles?: number;
  placeIds: string[];
  byId: Map<string, CorridorPlace>;
  positioned: Map<string, PositionedPlace>;
  isLast: boolean;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  const mi = wholeDayMiles ?? miles;
  const label = hours != null ? `↓  ${mi} mi · ${hours} hr drive` : `↓  ${mi} mi drive`;
  return (
    <>
      <RailRow dot={false} lineFromTop gap={12}>
        <div style={{ paddingTop: 8, paddingBottom: placeIds.length ? 4 : 8 }}>
          <span
            style={{
              fontFamily: "var(--ff-mono)",
              fontSize: 12,
              lineHeight: "16px",
              letterSpacing: "0.02em",
              color: "var(--text-muted)",
            }}
          >
            {label}
          </span>
        </div>
      </RailRow>
      {placeIds.map((id, j) => (
        <PoiRow
          key={id}
          place={byId.get(id)}
          pos={positioned.get(id)}
          // The last POI of the last stretch terminates the rail (next node
          // header follows otherwise).
          last={false}
          onOpenPlace={onOpenPlace}
          onRemovePlace={onRemovePlace}
          editMode={editMode}
        />
      ))}
    </>
  );
}

/** Off-rail tail for OFF-CORRIDOR places (offset > bufferMi) — a place you
 *  genuinely detour to, not a stop on the drive. Empty on every day of the
 *  current trip; kept for correctness. */
function AlongTheWay({
  places,
  onOpenPlace,
  editMode,
}: {
  places: CorridorPlace[];
  onOpenPlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  return (
    <div className="flex flex-col" style={{ paddingTop: 20, paddingLeft: GUTTER_W, gap: 10 }}>
      <span
        className="uppercase"
        style={{
          fontFamily: "var(--ff-display)",
          fontSize: 11,
          lineHeight: "14px",
          letterSpacing: "0.16em",
          color: "var(--text-muted)",
        }}
      >
        Along the way
      </span>
      <div className="flex flex-col" style={{ gap: 8 }}>
        {places.map((p) => (
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
