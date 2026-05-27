"use client";

import {
  BedDouble,
  Coffee,
  Droplet,
  Footprints,
  Fuel,
  Mountain,
  ShoppingCart,
  ShowerHead,
  Tent,
  Trash2,
  Triangle,
  UtensilsCrossed,
  Wrench,
  type LucideIcon,
} from "lucide-react";

/**
 * Find Nearby zero-state — 13-chip, 6-bucket grouped palette per Paper
 * frame 5WK-0 (1RA9-0 Slideup · Search Active). Replaces the older flat
 * POI palette. Shown when the user opens the Top Bar search input
 * (Search Active slideup state).
 *
 * Bucket colors reuse existing color tokens by hue, not by name (so
 * FUEL & REPAIR uses --cat-mountain (blue), SUPPLY uses --cat-attraction
 * (amber), SERVICE uses --cat-camping (teal), STAY uses --cat-oddity
 * (purple), FOOD uses --cat-food (orange)). CAMP & EXPLORE uses the
 * camping-waypoint green #4D9A6E from trip-browse/palette.ts, which is
 * not currently a CSS token — left inline to avoid a token rename in
 * this PR.
 *
 * Chip clicks fire `trip:findNearbySelect` with the chip id. Wiring to
 * actual category fetches lives in a follow-up.
 */

type Chip = {
  id: string;
  label: string;
  icon: LucideIcon;
  isNew?: boolean;
};

type Bucket = {
  id: string;
  label: string;
  color: string;
  chips: Chip[];
};

const BUCKETS: Bucket[] = [
  {
    id: "camp-explore",
    label: "CAMP & EXPLORE",
    color: "#4D9A6E",
    chips: [
      { id: "dispersed", label: "Dispersed", icon: Triangle, isNew: true },
      { id: "campgrounds", label: "Campgrounds", icon: Tent, isNew: true },
      { id: "trailheads", label: "Trailheads", icon: Footprints, isNew: true },
      { id: "viewpoints", label: "Viewpoints", icon: Mountain, isNew: true },
    ],
  },
  {
    id: "fuel-repair",
    label: "FUEL & REPAIR",
    color: "var(--cat-mountain)",
    chips: [
      { id: "gas", label: "Gas", icon: Fuel },
      { id: "auto-repair", label: "Auto / Repair", icon: Wrench, isNew: true },
    ],
  },
  {
    id: "food",
    label: "FOOD",
    color: "var(--cat-food)",
    chips: [
      { id: "coffee", label: "Coffee", icon: Coffee },
      { id: "restaurants", label: "Restaurants", icon: UtensilsCrossed },
    ],
  },
  {
    id: "supply",
    label: "SUPPLY",
    color: "var(--cat-attraction)",
    chips: [
      { id: "groceries", label: "Groceries", icon: ShoppingCart },
      { id: "water-fill", label: "Water fill", icon: Droplet, isNew: true },
    ],
  },
  {
    id: "service",
    label: "SERVICE",
    color: "var(--cat-camping)",
    chips: [
      { id: "showers", label: "Showers", icon: ShowerHead, isNew: true },
      { id: "dump-stations", label: "Dump stations", icon: Trash2, isNew: true },
    ],
  },
  {
    id: "stay",
    label: "STAY",
    color: "var(--cat-oddity)",
    chips: [{ id: "hotels", label: "Hotels", icon: BedDouble }],
  },
];

const TOTAL_CHIPS = BUCKETS.reduce((n, b) => n + b.chips.length, 0);

export function FindNearbyPanel({
  dayLabel,
  onClose,
}: {
  /** Day-context label shown in the "ADDING TO" strip. e.g. "Day 1 · Fri, May 29". */
  dayLabel?: string;
  onClose?: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Find nearby"
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-panel)" }}
    >
      <AddingToHeader dayLabel={dayLabel} />
      <header
        className="flex items-baseline justify-between shrink-0"
        style={{
          paddingLeft: 20,
          paddingRight: 20,
          paddingTop: 18,
          paddingBottom: 10,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--ff-sans)",
            fontSize: 18,
            lineHeight: "22px",
            fontWeight: 700,
            color: "var(--text-primary)",
          }}
        >
          Find nearby
        </h2>
        <span
          style={{
            fontFamily: "var(--ff-mono)",
            fontSize: 11,
            color: "var(--text-muted)",
            letterSpacing: "0.06em",
          }}
        >
          {TOTAL_CHIPS} items · {BUCKETS.length} groups
        </span>
      </header>

      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 24 }}
      >
        {BUCKETS.map((bucket) => (
          <BucketSection key={bucket.id} bucket={bucket} onChipClick={onClose} />
        ))}
      </div>
    </div>
  );
}

function AddingToHeader({ dayLabel }: { dayLabel?: string }) {
  return (
    <div
      className="flex items-center justify-between shrink-0"
      style={{
        height: 43,
        paddingLeft: 20,
        paddingRight: 20,
        backgroundColor: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid var(--border-subtle, rgba(255,255,255,0.06))",
      }}
    >
      <div className="flex items-center" style={{ gap: 8 }}>
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.16em",
            color: "var(--text-muted)",
          }}
        >
          Adding to
        </span>
        <span
          style={{
            fontFamily: "var(--ff-sans)",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--amber)",
          }}
        >
          {dayLabel ?? "Day 1"}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--ff-mono)",
          fontSize: 11,
          color: "var(--text-muted)",
          letterSpacing: "0.04em",
        }}
      >
        tap any result to add
      </span>
    </div>
  );
}

function BucketSection({
  bucket,
  onChipClick,
}: {
  bucket: Bucket;
  onChipClick?: () => void;
}) {
  return (
    <section style={{ marginTop: 18 }}>
      <div
        className="flex items-center"
        style={{ gap: 8, marginBottom: 10, paddingLeft: 4 }}
      >
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: bucket.color,
            display: "inline-block",
            boxShadow: `0 0 6px ${bucket.color}55`,
          }}
        />
        <span
          className="uppercase"
          style={{
            fontFamily: "var(--ff-display)",
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: "0.18em",
            color: "var(--text-muted)",
          }}
        >
          {bucket.label}
        </span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
        }}
      >
        {bucket.chips.map((chip) => (
          <ChipButton
            key={chip.id}
            chip={chip}
            bucketColor={bucket.color}
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent("trip:findNearbySelect", {
                  detail: { chipId: chip.id, bucketId: bucket.id },
                }),
              );
              onChipClick?.();
            }}
          />
        ))}
      </div>
    </section>
  );
}

function ChipButton({
  chip,
  bucketColor,
  onClick,
}: {
  chip: Chip;
  bucketColor: string;
  onClick: () => void;
}) {
  const Icon = chip.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={chip.label}
      className="flex items-center transition-colors"
      style={{
        height: 44,
        paddingLeft: 8,
        paddingRight: 12,
        gap: 10,
        borderRadius: 8,
        backgroundColor: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.06)",
        textAlign: "left",
      }}
    >
      <span
        aria-hidden
        className="flex items-center justify-center shrink-0"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: "rgba(255,255,255,0.06)",
        }}
      >
        <Icon
          size={18}
          strokeWidth={2}
          style={{ color: bucketColor }}
        />
      </span>
      <span
        className="truncate"
        style={{
          flex: 1,
          fontFamily: "var(--ff-sans)",
          fontSize: 14,
          fontWeight: 500,
          color: "var(--text-primary)",
        }}
      >
        {chip.label}
      </span>
      {chip.isNew && (
        <span
          className="uppercase shrink-0"
          style={{
            fontFamily: "var(--ff-mono)",
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: "var(--amber)",
            backgroundColor: "rgba(200,169,110,0.12)",
            border: "1px solid rgba(200,169,110,0.28)",
            padding: "2px 6px",
            borderRadius: 3,
          }}
        >
          NEW
        </span>
      )}
    </button>
  );
}
