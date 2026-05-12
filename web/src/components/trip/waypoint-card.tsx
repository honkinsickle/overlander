"use client";

import { ChevronRight, X } from "lucide-react";
import {
  categoryStyle,
  categoryIcon,
} from "@/components/primitives/detail-card";
import type { Waypoint } from "@/lib/trips/types";

/**
 * Waypoint row — matches Paper "Waypoint Card — Component (code-aligned)" (ALI-0),
 * specifically the "Fuel row" (ALO-0) geometry.
 *
 * Key geometry pulled from `get_computed_styles`:
 *   Outer: flex items-start · gap 12 · padding-inline 10 · padding-block 14
 *          · border-top 1 solid --border-subtle
 *   Icon:  60×60 rounded-full · bg --cat-*-bg · 1px --cat-* border
 *          · shadow 0 2 3 rgba(0,0,0,0.25)
 *   Title: Barlow 700 · 20 / 26 · --cat-*
 *   Desc:  Barlow 400 · 16 / 21 · --text-primary
 *   Tip:   Space Mono 400 · 12 / 18 · --amber · margin-top 2
 *   Chevron: 28×28 · radius 4 · rotate(270) · border 1 rgba(167,204,253,0.12)
 *            · shadow 0 6 18 rgba(0,0,0,0.45)
 *
 * Row is designed to stack inside a card frame (see DayDetail) — hence
 * border-top only (not a full border + radius) and `first:border-t-0`.
 *
 * Deviation: 0.5px Paper border bumped to 1px (browser reliability).
 * Deviation: lucide category icon + ChevronRight in place of Paper's
 * emoji + rotated ChevronDown (cleaner rendering in code).
 */
export function WaypointCard({
  tripId,
  waypoint,
  onDelete,
}: {
  tripId: string;
  waypoint: Waypoint;
  /** Temporary dev affordance — when provided, renders an X in the
   *  top-right that calls this handler instead of opening the panel. */
  onDelete?: () => void;
}) {
  const cat = categoryStyle[waypoint.category];
  const Icon = categoryIcon[waypoint.category];

  const openPanel = () => {
    // Open the rich slide-up overlay with the full enriched waypoint.
    // The day number lives in the subtitle ("Day 12 · …") — pull it so
    // the overlay's "Add to Day N" / route eyebrow render correctly.
    const dayMatch = waypoint.subtitle?.match(/Day\s+(\d+)/);
    const dayNumber = dayMatch ? parseInt(dayMatch[1], 10) : undefined;
    window.dispatchEvent(
      new CustomEvent("trip:openDetail", {
        detail: {
          place: {
            id: waypoint.id,
            title: waypoint.title,
            photoUrl: waypoint.photoUrl,
            description: waypoint.description,
            dayNumber,
            waypoint,
          },
        },
      }),
    );
  };

  return (
    <div
      className="relative w-full border-t border-border-subtle first:border-t-0"
    >
      {onDelete ? (
        <button
          type="button"
          aria-label={`Delete ${waypoint.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-2 right-2 z-10 flex items-center justify-center w-6 h-6 rounded-md bg-black/40 hover:bg-black/60"
        >
          <X className="w-3 h-3 text-text-muted" strokeWidth={1.75} />
        </button>
      ) : null}
      <button
      type="button"
      data-trip-id={tripId}
      onClick={openPanel}
      className="w-full text-left flex items-start gap-3 px-2.5 pt-3.5 pb-[19px] hover:bg-white/[0.02] transition-colors"
    >
      {/* Icon badge — 60×60 circle with category tint + thin cat accent border + subtle drop shadow */}
      <div
        className="w-[60px] h-[60px] shrink-0 flex items-center justify-center rounded-full"
        style={{
          backgroundColor: cat.bg,
          border: `1px solid ${cat.accent}`,
          boxShadow: "0 2px 3px rgba(0,0,0,0.25)",
        }}
      >
        <Icon
          aria-hidden
          className="w-7 h-7"
          style={{ color: cat.accent }}
          strokeWidth={2}
        />
      </div>

      {/* Content column — flex-1 min-w-0, 6px gap between rows, 12px right pad */}
      <div className="flex-1 min-w-0 flex flex-col gap-1.5 pr-3">
        <h3
          className="font-sans font-bold text-[20px] leading-[26px]"
          style={{ color: cat.accent }}
        >
          {waypoint.title}
        </h3>
        <p className="font-sans text-[16px] leading-[21px] text-text-primary">
          {waypoint.description}
        </p>

        {/* Callout row — tip + right-aligned caret button. 48px tall. */}
        <div className="flex items-center h-12 pr-[11px]">
          <span
            className="mt-0.5 flex-1 font-mono text-xs leading-[18px]"
            style={{ color: "var(--amber)" }}
          >
            {waypoint.tip ? `↳ ${waypoint.tip}` : ""}
          </span>
          <CaretButton />
        </div>
      </div>
    </button>
    </div>
  );
}

/** 28×28 blue-tinted caret button — `rgba(167,204,253,0.12)` border,
 *  `0 6 18 rgba(0,0,0,0.45)` shadow. We use ChevronRight directly;
 *  Paper uses ChevronDown + rotate(270deg) which is visually identical. */
function CaretButton() {
  return (
    <span
      aria-hidden
      className="w-7 h-7 shrink-0 flex items-center justify-center rounded"
      style={{
        border: "1px solid rgba(167,204,253,0.12)",
        boxShadow: "0 6px 18px rgba(0,0,0,0.45)",
      }}
    >
      <ChevronRight
        className="w-4 h-4"
        strokeWidth={1.75}
        style={{ color: "var(--input-border-focus)" }}
      />
    </span>
  );
}
