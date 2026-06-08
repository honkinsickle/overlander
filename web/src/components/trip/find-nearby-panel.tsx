"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
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
  X,
  type LucideIcon,
} from "lucide-react";
import type { Trip, Day } from "@/lib/trips/types";
import type { BrowsePlace } from "@/lib/trip-browse/places";
import { PlaceSearch } from "@/components/trip/place-search";
import { pointToPolylineMi } from "@/lib/routing/point-to-polyline";

/**
 * Find Nearby — the top-level "Search for anything" surface, shown when no
 * day panel is open (Search Active slideup state, Paper frame 5WK-0).
 *
 * Drives the SAME corpus engine as the in-panel search: the top-bar text
 * query and the category tiles both feed <PlaceSearch> (Typesense → hydrate
 * → federated LocationBrowseCards). Tiles map to real corpus
 * `primary_category` values (verified against the Typesense facet); a thin
 * or empty category just returns few/no results — the honest empty state,
 * never a fabricated fallback.
 *
 * States:
 *   - empty query AND no active tile → tile palette (zero-state)
 *   - typed query OR active tile      → results (with a back-to-palette link)
 *
 * Ranking center is the currently active/focused day (fallback: trip start);
 * search is corpus-wide, NOT scoped to a leg.
 *
 * ADD has no preselected day here, so it opens a day picker (days sorted by
 * route proximity to the place) and adds via the existing `trip:toggleAdded`
 * mechanism parameterized by the chosen day.
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

export function FindNearbyPanel({
  trip,
}: {
  trip: Trip;
  /** Reserved — panel dismissal is owned by the parent (Escape + the Top
   *  Bar's exit ✕). */
  onClose?: () => void;
}) {
  // Query mirrors the top-bar "Search for anything" input via `trip:search`.
  const [query, setQuery] = useState("");
  const [activeTile, setActiveTile] = useState<Tile | null>(null);
  // The day a result would be ranked nearest to. Seeds from the URL (?day=)
  // so proximity ranking matches the day the user was last looking at; falls
  // back to the first day. Search itself stays corpus-wide.
  const [activeDayId, setActiveDayId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const fromUrl = new URLSearchParams(window.location.search).get("day");
      if (fromUrl) return fromUrl;
    }
    return trip.days[0]?.id ?? "";
  });
  // When set, the day-picker overlay is open for this place.
  const [pending, setPending] = useState<BrowsePlace | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    const onSearch = (e: Event) => {
      const q = (e as CustomEvent<{ query: string }>).detail?.query ?? "";
      setQuery(q);
    };
    window.addEventListener("trip:search", onSearch);
    return () => window.removeEventListener("trip:search", onSearch);
  }, []);

  useEffect(() => {
    const onActiveDay = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id) setActiveDayId(id);
    };
    window.addEventListener("trip:activeDay", onActiveDay);
    return () => window.removeEventListener("trip:activeDay", onActiveDay);
  }, []);

  const activeDay = useMemo(
    () => trip.days.find((d) => d.id === activeDayId) ?? trip.days[0],
    [trip.days, activeDayId],
  );
  const center: [number, number] | undefined =
    activeDay?.startCoord ?? activeDay?.coords ?? trip.startCoords;

  const showResults = query.trim() !== "" || activeTile !== null;

  const backToPalette = () => {
    setActiveTile(null);
    // Clears the top-bar text too so query + tile reset together.
    window.dispatchEvent(new CustomEvent("trip:clearSearch"));
  };

  // ADD with no preselected day → hydrate the place (for coords + the
  // AddedPlace payload) and open the day picker.
  const handleAdd = (masterPlaceId: string) => {
    void (async () => {
      try {
        const res = await fetch("/api/places/hydrate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [masterPlaceId] }),
        });
        if (!res.ok) return;
        const { places } = (await res.json()) as { places: BrowsePlace[] };
        if (places[0]) setPending(places[0]);
      } catch {
        // best-effort
      }
    })();
  };

  const addToDay = (day: Day) => {
    if (!pending) return;
    const place = pending;
    // Paint the confirmation + close the picker first, then dispatch the
    // add on the next tick. The add triggers an RSC refresh (revalidatePath
    // in addWaypointAction) that would otherwise race the toast render.
    setConfirmation(`Added to Day ${day.dayNumber}`);
    setPending(null);
    window.setTimeout(() => setConfirmation(null), 2600);
    // Reuse the existing add-to-day mechanism, parameterized by the chosen
    // day (DayDetail listens for trip:toggleAdded → addWaypointAction).
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("trip:toggleAdded", {
          detail: {
            placeId: place.id,
            dayId: day.id,
            dayNumber: day.dayNumber,
            place: {
              id: place.id,
              title: place.title,
              description: place.description,
              photoUrl: place.photoUrl,
              coords: place.coords,
            },
          },
        }),
      );
    }, 0);
  };

  return (
    <div
      role="region"
      aria-label="Find nearby"
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: "var(--bg-panel)" }}
    >
      <FindScopeHeader />

      {pending ? (
        <DayPicker
          place={pending}
          trip={trip}
          onPick={addToDay}
          onCancel={() => setPending(null)}
        />
      ) : showResults ? (
        <div className="flex flex-col flex-1 min-h-0">
          <button
            type="button"
            onClick={backToPalette}
            className="flex items-center shrink-0"
            style={{
              gap: 8,
              paddingLeft: 20,
              paddingRight: 20,
              paddingTop: 4,
              paddingBottom: 12,
              fontFamily: "var(--ff-display)",
              fontSize: 12,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--amber)",
            }}
          >
            <ArrowLeft className="w-3.5 h-3.5" strokeWidth={2} />
            {activeTile ? `Categories · ${activeTile.label}` : "Categories"}
          </button>
          <div
            className="flex-1 overflow-y-auto no-scrollbar"
            style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 24 }}
          >
            <PlaceSearch
              query={query.trim() || "*"}
              center={center}
              primaryCategories={activeTile?.primaryCategories ?? null}
              addLabel="Add to a day"
              dayDate={activeDay?.date}
              onAdd={handleAdd}
            />
          </div>
        </div>
      ) : (
        <div
          className="flex-1 overflow-y-auto no-scrollbar"
          style={{ paddingLeft: 20, paddingRight: 20, paddingBottom: 24 }}
        >
          {BUCKETS.map((bucket) => (
            <BucketSection
              key={bucket.id}
              bucket={bucket}
              onPick={setActiveTile}
            />
          ))}
        </div>
      )}

      {confirmation ? (
        <div
          role="status"
          className="shrink-0 flex items-center justify-center"
          style={{
            margin: 12,
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "rgba(77,154,110,0.18)",
            border: "1px solid #4D9A6E",
            color: "#9CD4B0",
            fontFamily: "var(--ff-display)",
            fontSize: 13,
            letterSpacing: "0.04em",
          }}
        >
          {confirmation}
        </div>
      ) : null}
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

/** Day picker for the top-level ADD action. Lists every trip day, sorted by
 *  route proximity to the place so the likely targets float to the top —
 *  essential when the trip spans dozens of days. */
function DayPicker({
  place,
  trip,
  onPick,
  onCancel,
}: {
  place: BrowsePlace;
  trip: Trip;
  onPick: (day: Day) => void;
  onCancel: () => void;
}) {
  const ranked = useMemo(() => {
    return trip.days
      .map((day, i) => {
        const prev = trip.days[i - 1];
        const start: [number, number] | undefined =
          prev?.coords ?? (i === 0 ? trip.startCoords : undefined);
        const end = day.coords;
        const segment: [number, number][] =
          start && end ? [start, end] : end ? [end] : start ? [start] : [];
        const milesOff =
          segment.length > 0
            ? pointToPolylineMi(place.coords, segment)
            : Infinity;
        return { day, milesOff };
      })
      .sort((a, b) => a.milesOff - b.milesOff);
  }, [trip.days, trip.startCoords, place.coords]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div
        className="flex items-center shrink-0"
        style={{
          gap: 10,
          paddingLeft: 20,
          paddingRight: 16,
          paddingBottom: 12,
        }}
      >
        <div className="flex flex-col min-w-0 flex-1">
          <span
            className="uppercase"
            style={{
              fontFamily: "var(--ff-display)",
              fontSize: 11,
              letterSpacing: "0.16em",
              color: "var(--text-muted)",
            }}
          >
            Add to which day?
          </span>
          <span
            className="truncate"
            style={{
              fontFamily: "var(--ff-sans)",
              fontSize: 18,
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {place.title}
          </span>
        </div>
        <button
          type="button"
          aria-label="Cancel"
          onClick={onCancel}
          className="flex items-center justify-center shrink-0"
          style={{
            width: 36,
            height: 36,
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.1)",
            color: "var(--text-muted)",
          }}
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>
      <div
        className="flex-1 overflow-y-auto no-scrollbar"
        style={{ paddingLeft: 16, paddingRight: 16, paddingBottom: 16 }}
      >
        {ranked.map(({ day, milesOff }) => (
          <button
            key={day.id}
            type="button"
            onClick={() => onPick(day)}
            className="flex items-center w-full transition-colors hover:bg-white/[0.06]"
            style={{
              gap: 12,
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.06)",
              marginBottom: 8,
              textAlign: "left",
            }}
          >
            <span
              className="flex items-center justify-center shrink-0"
              style={{
                width: 44,
                height: 36,
                borderRadius: 6,
                backgroundColor: "rgba(255,255,255,0.05)",
                fontFamily: "var(--ff-display)",
                fontSize: 13,
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              D{day.dayNumber}
            </span>
            <span className="flex flex-col min-w-0 flex-1">
              <span
                className="truncate"
                style={{
                  fontFamily: "var(--ff-sans)",
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {day.label || `Day ${day.dayNumber}`}
              </span>
              <span
                style={{
                  fontFamily: "var(--ff-mono)",
                  fontSize: 11,
                  color: "var(--text-muted)",
                }}
              >
                {formatShortDate(day.date)}
                {Number.isFinite(milesOff)
                  ? ` · ${milesOff < 10 ? milesOff.toFixed(1) : Math.round(milesOff)} mi off route`
                  : ""}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
}
