import {
  DayDetailCorridor,
  type CorridorCity,
  type CorridorPlace,
} from "@/components/trip/day-detail-corridor";

/**
 * THROWAWAY scratch route — Day Detail v4 corridor view fed hardcoded dummy
 * data. Visual-only; no gazetteer / derivation / along-route math. The
 * corridorCities array matches docs/corridor-cities-spec.md §1 shape.
 * Drop before merge.
 */

const CDN = "https://app.paper.design/file-assets/01KT785MVAVVBE8RGAP9FED33Y";
const IMG = {
  scenic1: `${CDN}/14WWQ8JJ5B49PQRZS6W7067PJ5.avif`,
  scenic2: `${CDN}/5ZBSPM9YYA57R1ENM5ZKSJ4R88.jpg`,
  food1: `${CDN}/3SSAFY1NAPNFE83MH7S3EVXCY4.jpg`,
  food2: `${CDN}/01KV6GTWMQCVFS0ZJXB6TBED9B.png`,
  urban: `${CDN}/51F3SVN9CW0XQ0J86VC8PP8KTP.jpg`,
  hero: `${CDN}/3QYT8N00ZJVQPDYZQS725QNH9M.avif`,
};

// Dummy place pool — referenced by CorridorCity.placeIds.
const PLACES: CorridorPlace[] = [
  // Los Angeles
  { id: "la-griffith", title: "Griffith Observatory", category: "scenic", photoUrl: IMG.scenic1, photoAlt: "Observatory over the city", rating: 4.7, reviewCount: 64000 },
  { id: "la-gcm", title: "Grand Central Market", category: "food", photoUrl: IMG.food1, photoAlt: "Market food stalls", rating: 4.5, reviewCount: 23000 },
  { id: "la-broad", title: "The Broad", category: "attraction", photoUrl: IMG.urban, photoAlt: "Contemporary art museum", rating: 4.6, reviewCount: 18000 },
  // Ventura
  { id: "ven-botanical", title: "Ventura Botanical Gardens", category: "scenic", photoUrl: IMG.scenic2, photoAlt: "Hillside gardens", rating: 4.6, reviewCount: 1200 },
  { id: "ven-mission", title: "Mission San Buenaventura", category: "attraction", photoUrl: IMG.urban, photoAlt: "Spanish mission", rating: 4.6, reviewCount: 2100 },
  { id: "ven-tacos", title: "Beach House Tacos", category: "food", photoUrl: IMG.food2, photoAlt: "Tacos on the pier", rating: 4.4, reviewCount: 3400 },
  // Santa Barbara
  { id: "sb-inspiration", title: "Inspiration Point Trail", category: "scenic", photoUrl: IMG.scenic1, photoAlt: "Coastal ridge trail", rating: 4.8, reviewCount: 2600 },
  { id: "sb-county", title: "Santa Barbara County Courthouse", category: "attraction", photoUrl: IMG.urban, photoAlt: "Historic courthouse tower", rating: 4.8, reviewCount: 9100 },
  { id: "sb-superrica", title: "La Super-Rica Taqueria", category: "food", photoUrl: IMG.food1, photoAlt: "Taqueria counter", rating: 4.5, reviewCount: 5200 },
];

// Dummy corridor — spec §1.1 shape. Coords are illustrative city points.
const CITIES: CorridorCity[] = [
  {
    id: "los-angeles-ca",
    name: "Los Angeles, CA",
    kind: "start",
    milesFromStart: 0,
    coords: [-118.2437, 34.0522],
    placeIds: ["la-griffith", "la-gcm", "la-broad"],
  },
  {
    id: "ventura-ca",
    name: "Ventura, CA",
    kind: "corridor",
    milesFromStart: 65,
    coords: [-119.2290, 34.2746],
    placeIds: ["ven-botanical", "ven-mission", "ven-tacos"],
  },
  {
    id: "santa-barbara-ca",
    name: "Santa Barbara, CA",
    kind: "end",
    milesFromStart: 95,
    coords: [-119.6982, 34.4208],
    placeIds: ["sb-inspiration", "sb-county", "sb-superrica"],
  },
];

export default function DayDetailCorridorDemo() {
  return (
    <main className="flex min-h-screen" style={{ backgroundColor: "var(--bg-map)" }}>
      <DayDetailCorridor
        dayLabel="Day 1 — Sat, May 30th"
        dayNumber={1}
        routeLabel="Los Angeles, CA — Santa Barbara, CA"
        heroImageUrl={IMG.hero}
        heroAlt="Los Angeles to Santa Barbara"
        cities={CITIES}
        places={PLACES}
        mileMarkers={[40]}
      />
    </main>
  );
}
