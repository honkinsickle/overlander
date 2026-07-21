"use client";

/**
 * Edit-mode "City Block" render of a day (spec § node-stack model, Paper
 * artboard "Trip Edit— aligned v1-1"). The node model made visible: a day is
 * an ordered list of city NODES, each carrying the POIs bucketed beneath it,
 * against a left mile-timeline gutter. Replaces the mile-INTERLEAVED spine
 * (buildSpineItems) for the edit surface only — the read view keeps its
 * existing render so the two can be compared directly.
 *
 * Deliberate scope (rendering only):
 * - Timeline is CONTENT-DRIVEN, not mile-proportional. The inter-node drive is
 *   a capped, labeled connector ("264 mi · 5.2 hr") — a 400-mi 2-node day would
 *   be thousands of px of empty gutter otherwise, and nearly every real day is
 *   that shape. The label does the work whitespace can't.
 * - A POI carries a gutter mile tick only when it has `milesFromStart` (today:
 *   curated key stops). Un-positioned POIs render as cards under their node in
 *   bucket order, without a tick — never dropped. (The fix that gives every POI
 *   a mile is server-side: persist the mile bucketing already computes.)
 * - Orphans (pool places bucketed under no node — >25mi from every node) go to
 *   an "Along the way" tail group, off the rail. The model rests on nodes being
 *   real road positions, so a distant place is not forced under one.
 * - Drag handles render but are inert (drag is a later slice).
 */
import { Fragment } from "react";
import type { CorridorCity } from "@/lib/trips/types";
import { CategoryListCard } from "@/components/trip/category-list-card";
import type { CorridorPlace } from "@/components/trip/day-detail-corridor";

const GUTTER_W = 48;
const noop = () => {};

type Props = {
  cities: CorridorCity[];
  /** Resolves a placeId (from `city.placeIds`) to its tile. */
  byId: Map<string, CorridorPlace>;
  /** Pool places referenced by no node — the "Along the way" group. */
  orphans: CorridorPlace[];
  /** Day totals — used to label the drive connector on a 2-node day (the
   *  single connector IS the whole day's drive). */
  dayMiles?: number;
  dayDriveHours?: number;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
};

export function DayDetailNodeBlocks({
  cities,
  byId,
  orphans,
  dayMiles,
  dayDriveHours,
  onOpenPlace,
  onRemovePlace,
  editMode = true,
}: Props) {
  const wholeDay = cities.length === 2;
  return (
    <div className="flex flex-col" style={{ paddingTop: 16 }}>
      {cities.map((city, i) => {
        const next = cities[i + 1];
        const tiles = city.placeIds
          .map((id) => byId.get(id))
          .filter(Boolean) as CorridorPlace[];
        return (
          <Fragment key={`${city.id}-${city.kind}-${i}`}>
            <NodeCityBlock
              city={city}
              tiles={tiles}
              isLastBlock={i === cities.length - 1}
              onOpenPlace={onOpenPlace}
              onRemovePlace={onRemovePlace}
              editMode={editMode}
            />
            {next && (
              <DriveConnector
                miles={Math.round(next.milesFromStart - city.milesFromStart)}
                hours={wholeDay ? dayDriveHours : undefined}
                wholeDayMiles={wholeDay ? dayMiles : undefined}
              />
            )}
          </Fragment>
        );
      })}
      {orphans.length > 0 && (
        <AlongTheWay places={orphans} onOpenPlace={onOpenPlace} editMode={editMode} />
      )}
    </div>
  );
}

/** One rail row: fixed 48px gutter (optional mile tick + dot + connector line
 *  down to the next row) beside the content column. Mirrors the read-view
 *  spine geometry so the two treatments stay visually aligned. */
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
  /** Draw the connector from the row top (no dot break) — used by the drive
   *  connector so the "driving" stretch reads as one continuous line. */
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

/** A city node header (white dot + mile) followed by its bucketed POI cards,
 *  each on the shared rail. Positioned POIs get an amber tick; un-positioned
 *  ones sit flush without a tick, in bucket order. */
function NodeCityBlock({
  city,
  tiles,
  isLastBlock,
  onOpenPlace,
  onRemovePlace,
  editMode,
}: {
  city: CorridorCity;
  tiles: CorridorPlace[];
  isLastBlock: boolean;
  onOpenPlace?: (placeId: string) => void;
  onRemovePlace?: (placeId: string) => void;
  editMode?: boolean;
}) {
  const isStart = city.kind === "start";
  const mileLabel = isStart ? "Start" : `${Math.round(city.milesFromStart)}mi`;
  // The rail terminates on the final node's final element (no drive/orphans
  // render on the rail after it). Orphans are detached below.
  const headerIsTerminal = isLastBlock && tiles.length === 0;

  return (
    <>
      <RailRow mile={mileLabel} last={headerIsTerminal}>
        <div className="flex flex-col" style={{ gap: 3, paddingBottom: tiles.length ? 12 : 0 }}>
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
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 13,
              lineHeight: "18px",
              color: "var(--text-muted)",
            }}
          >
            Explore more {city.name} →
          </button>
        </div>
      </RailRow>

      {tiles.map((p, j) => {
        const positioned = p.milesFromStart != null;
        return (
          <RailRow
            key={p.id}
            mile={positioned ? `${Math.round(p.milesFromStart as number)}mi` : null}
            mileColor="var(--amber)"
            dot={positioned}
            dotColor="var(--amber)"
            dotSize={8}
            last={isLastBlock && j === tiles.length - 1}
          >
            <CategoryListCard
              place={p}
              category={p.category}
              status={p.keyStopNote}
              onOpen={onOpenPlace ? () => onOpenPlace(p.id) : noop}
              onRemove={p.removable && onRemovePlace ? () => onRemovePlace(p.id) : undefined}
              editMode={editMode}
            />
          </RailRow>
        );
      })}
    </>
  );
}

/** The capped, labeled drive between two nodes. Fixed vertical space (NOT
 *  scaled to miles); the label carries the distance the whitespace can't. */
function DriveConnector({
  miles,
  hours,
  wholeDayMiles,
}: {
  miles: number;
  hours?: number;
  wholeDayMiles?: number;
}) {
  const mi = wholeDayMiles ?? miles;
  const label =
    hours != null ? `↓  ${mi} mi · ${hours} hr drive` : `↓  ${mi} mi drive`;
  return (
    <RailRow dot={false} lineFromTop gap={14}>
      <div style={{ paddingTop: 8, paddingBottom: 8 }}>
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
  );
}

/** Off-rail tail group for pool places bucketed under no node (>25mi from
 *  every node). Surfaced so nothing is silently dropped — the node/POI rule
 *  keeps them off the road-position rail. */
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
