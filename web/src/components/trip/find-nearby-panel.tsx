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
 * Find Nearby — the top-level "Search for anything" surface, shown when no
 * day panel is open (Search Active slideup state, Paper frame 5WK-0).
 *
 * Renders the clean category-tile palette only — the launcher / zero state.
 * It deliberately does NOT render result cards: the corpus-only top-level
 * results were structurally thin (no photos / location / ratings) and read
 * as broken next to the rich in-panel slide browse. Until the top-level
 * search is rebuilt on the live-Google + federated merged pipeline (the
 * "search this area" viewport task), this surface stays a launcher and
 * never paints bare cards.
 *
 * The rich search still lives in the in-panel slide browse (CategoryBrowsePanel,
 * day-scoped) — untouched. The top-bar "Search for anything" input also feeds
 * that panel when a day's browse is open; here, with no day open, it has no
 * results surface to drive.
 */

type Tile = {
  id: string;
  label: string;
  icon: LucideIcon;
  isNew?: boolean;
  /** Corpus `primary_category` values this tile filters on. */
  primaryCategories: string[];
};

type Bucket = {
  id: string;
  label: string;
  color: string;
  tiles: Tile[];
};

// Tile → corpus primary_category mapping. Values verified against the live
// Typesense `primary_category` facet; only categories that exist in the
// corpus are listed. Sparse ones (coffee, auto/repair, dispersed) honestly
// return few/no hits rather than borrowing from unrelated types.
const BUCKETS: Bucket[] = [
  {
    id: "camp-explore",
    label: "CAMP & EXPLORE",
    color: "#4D9A6E",
    tiles: [
      {
        id: "dispersed",
        label: "Dispersed",
        icon: Triangle,
        isNew: true,
        primaryCategories: ["dispersed_camping"],
      },
      {
        id: "campgrounds",
        label: "Campgrounds",
        icon: Tent,
        isNew: true,
        primaryCategories: ["campground", "rv_park", "camping_cabin"],
      },
      {
        id: "trailheads",
        label: "Trailheads",
        icon: Footprints,
        isNew: true,
        primaryCategories: ["trailhead", "hiking_area"],
      },
      {
        id: "viewpoints",
        label: "Viewpoints",
        icon: Mountain,
        isNew: true,
        primaryCategories: ["viewpoint", "peak", "mountain_peak", "scenic_spot"],
      },
    ],
  },
  {
    id: "fuel-repair",
    label: "FUEL & REPAIR",
    color: "var(--cat-mountain)",
    tiles: [
      {
        id: "gas",
        label: "Gas",
        icon: Fuel,
        primaryCategories: ["gas_station", "truck_stop", "ev_charging"],
      },
      {
        id: "auto-repair",
        label: "Auto / Repair",
        icon: Wrench,
        isNew: true,
        primaryCategories: ["car_repair", "car_wash"],
      },
    ],
  },
  {
    id: "food",
    label: "FOOD",
    color: "var(--cat-food)",
    tiles: [
      {
        id: "coffee",
        label: "Coffee",
        icon: Coffee,
        primaryCategories: ["cafe"],
      },
      {
        id: "restaurants",
        label: "Restaurants",
        icon: UtensilsCrossed,
        primaryCategories: [
          "restaurant",
          "fast_food_restaurant",
          "diner",
          "american_restaurant",
          "italian_restaurant",
          "mexican_restaurant",
          "chinese_restaurant",
          "indian_restaurant",
          "french_restaurant",
          "brazilian_restaurant",
          "taco_restaurant",
          "pizza_restaurant",
          "hamburger_restaurant",
          "chicken_restaurant",
          "breakfast_restaurant",
          "family_restaurant",
          "fine_dining_restaurant",
          "steak_house",
          "sandwich_shop",
          "bar_and_grill",
          "gastropub",
          "brewpub",
        ],
      },
    ],
  },
  {
    id: "supply",
    label: "SUPPLY",
    color: "var(--cat-attraction)",
    tiles: [
      {
        id: "groceries",
        label: "Groceries",
        icon: ShoppingCart,
        primaryCategories: ["grocery", "grocery_store"],
      },
      {
        id: "water-fill",
        label: "Water fill",
        icon: Droplet,
        isNew: true,
        primaryCategories: ["water"],
      },
    ],
  },
  {
    id: "service",
    label: "SERVICE",
    color: "var(--cat-camping)",
    tiles: [
      {
        id: "showers",
        label: "Showers",
        icon: ShowerHead,
        isNew: true,
        primaryCategories: ["shower"],
      },
      {
        id: "dump-stations",
        label: "Dump stations",
        icon: Trash2,
        isNew: true,
        primaryCategories: ["dump_station"],
      },
    ],
  },
  {
    id: "stay",
    label: "STAY",
    color: "var(--cat-oddity)",
    tiles: [
      {
        id: "hotels",
        label: "Hotels",
        icon: BedDouble,
        primaryCategories: ["hotel", "motel", "resort_hotel"],
      },
    ],
  },
];

export function FindNearbyPanel() {
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
          // Tiles are inert launchers for now — the corpus-only result path
          // was removed (bare cards). Re-wired to the rich viewport search
          // when that task lands.
          <BucketSection key={bucket.id} bucket={bucket} onPick={() => {}} />
        ))}
      </div>
    </div>
  );
}

function FindScopeHeader() {
  // NOTE: "Current Leg" is intentionally inert. Legs are not search scopes
  // yet (the leg model doesn't exist), so search stays corpus-wide. Real
  // leg-scoping is pending that model; don't wire fake scoping here.
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
        aria-label="Scope: Current Leg (corpus-wide; leg-scoping pending)"
        title="Leg-scoped search is coming; results are currently trip-wide"
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

function BucketSection({
  bucket,
  onPick,
}: {
  bucket: Bucket;
  onPick: (tile: Tile) => void;
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
        {bucket.tiles.map((tile) => (
          <TileButton
            key={tile.id}
            tile={tile}
            color={bucket.color}
            onClick={() => onPick(tile)}
          />
        ))}
      </div>
    </section>
  );
}

function TileButton({
  tile,
  color,
  onClick,
}: {
  tile: Tile;
  color: string;
  onClick: () => void;
}) {
  const Icon = tile.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={tile.label}
      className="flex items-center transition-colors hover:bg-white/[0.08]"
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
        <Icon size={18} strokeWidth={2} style={{ color }} />
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
        {tile.label}
      </span>
      {tile.isNew && (
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

