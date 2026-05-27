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

export function FindNearbyPanel({
  onClose: _onClose,
}: {
  /** Reserved — currently unused. Search/panel dismissal is owned by
   *  the parent (Escape key + Top Bar's exit ✕). Chip clicks fire the
   *  `trip:findNearbySelect` event and intentionally do NOT close the
   *  panel, so a user can tap multiple categories in one session. */
  onClose?: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Find nearby"
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-panel)" }}
    >
      <FindScopeHeader />

      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 24 }}
      >
        {BUCKETS.map((bucket) => (
          <BucketSection key={bucket.id} bucket={bucket} />
        ))}
      </div>
    </div>
  );
}

function FindScopeHeader() {
  // TODO: make the scope chip tappable → opens a selector with
  // alternatives like "Whole Trip", "Today", "Near me". For v1 the
  // chip is a static badge showing the active scope.
  return (
    <div
      className="flex items-center shrink-0"
      style={{
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 18,
        paddingBottom: 14,
        gap: 12,
      }}
    >
      <span
        style={{
          fontFamily: "var(--ff-sans)",
          fontSize: 22,
          lineHeight: "28px",
          fontWeight: 700,
          color: "var(--text-primary)",
        }}
      >
        Find on:
      </span>
      <span
        role="status"
        aria-label="Scope: Current Leg"
        style={{
          display: "inline-flex",
          alignItems: "center",
          paddingTop: 6,
          paddingBottom: 6,
          paddingLeft: 14,
          paddingRight: 14,
          borderRadius: 5,
          border: "1.5px solid #4D9A6E",
          backgroundColor: "rgba(77,154,110,0.12)",
          color: "#9CD4B0",
          fontFamily: "var(--ff-sans)",
          fontSize: 16,
          lineHeight: "20px",
          fontWeight: 500,
        }}
      >
        Current Leg
      </span>
    </div>
  );
}

function BucketSection({ bucket }: { bucket: Bucket }) {
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
