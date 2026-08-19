/**
 * Pilot, read-only against Google: for the sampled NONE-bucket places from
 * pilot-sample-none-bucket.ts, run each through the SAME Google Places
 * lookup mechanism the app already uses (PlaceResolver.resolve — Text
 * Search by name + locationBias, web/src/lib/itinerary/resolve.ts), then a
 * Place Details call for any resolved place, using a field mask that ADDS
 * `editorialSummary` — no existing in-app field mask requests it, but it's
 * the actual Google field for "does Google have a description," which this
 * pilot needs to answer. This is a deliberate pilot-only addition, not a
 * suggestion to change any production field mask.
 *
 * Writes ONLY to a local JSON file — zero writes to source_record,
 * master_place, or any other table. Real, billed Google API calls.
 *
 * GOOGLE_PLACES_API_KEY is loaded from web/.env.local (the only place it's
 * stored), same fallback pattern eval-llm-descriptions.ts uses for
 * ANTHROPIC_API_KEY.
 *
 * Run:
 *   cd data && npx tsx --env-file=.env scripts/pilot-google-sparse-categories.ts
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve as pathResolve } from "node:path";

const SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
// Mirrors resolve.ts's RESOLVE_FIELD_MASK exactly — same mechanism, same call shape.
const SEARCH_FIELD_MASK =
  "places.id,places.displayName,places.location,places.formattedAddress,places.types,places.primaryType";
const BIAS_RADIUS_M = 50_000; // matches resolve.ts's BIAS_RADIUS_M

// Pilot-only addition: editorialSummary is not in ANY existing in-app field
// mask (checked resolve.ts, google-places.ts's FIELD_MASK and
// DETAILS_FIELD_MASK) — added here specifically to answer this pilot's
// question, not a suggestion to change production masks.
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "editorialSummary",
  "photos",
  "rating",
  "userRatingCount",
  "types",
].join(",");

const CALL_DELAY_MS = 150; // polite pacing; not a rate-limit workaround

function loadGooglePlacesKey(): string {
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY;
  const webEnv = pathResolve(process.cwd(), "..", "web/.env.local");
  if (!existsSync(webEnv)) throw new Error("GOOGLE_PLACES_API_KEY not in env and web/.env.local missing");
  const line = readFileSync(webEnv, "utf8").split("\n").find((l) => l.startsWith("GOOGLE_PLACES_API_KEY="));
  if (!line) throw new Error("GOOGLE_PLACES_API_KEY not in web/.env.local");
  return line.split("=", 2)[1].trim().replace(/^["']|["']$/g, "");
}

type Candidate = { id: string; canonical_name: string; primary_category: string; lng: number; lat: number };

type SearchResult =
  | { status: "resolved"; placeId: string; displayName: string; formattedAddress?: string; coords: [number, number]; distanceKm: number }
  | { status: "not-found" }
  | { status: "http-error"; httpStatus: number; body: string };

type DetailsResult = {
  displayName?: string;
  formattedAddress?: string;
  editorialSummary?: string;
  photoCount: number;
  rating?: number;
  userRatingCount?: number;
  types?: string[];
};

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function searchText(key: string, name: string, biasCoords: [number, number]): Promise<SearchResult> {
  const res = await fetch(SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: name,
      maxResultCount: 1,
      locationBias: {
        circle: { center: { latitude: biasCoords[1], longitude: biasCoords[0] }, radius: BIAS_RADIUS_M },
      },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { status: "http-error", httpStatus: res.status, body: body.slice(0, 300) };
  }
  const json = (await res.json()) as {
    places?: { id: string; displayName?: { text: string }; formattedAddress?: string; location: { latitude: number; longitude: number } }[];
  };
  const p = json.places?.[0];
  if (!p) return { status: "not-found" };
  const coords: [number, number] = [p.location.longitude, p.location.latitude];
  return {
    status: "resolved",
    placeId: p.id,
    displayName: p.displayName?.text ?? name,
    formattedAddress: p.formattedAddress,
    coords,
    distanceKm: haversineKm(biasCoords, coords),
  };
}

async function getDetails(key: string, placeId: string): Promise<DetailsResult | { httpError: number; body: string }> {
  const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": DETAILS_FIELD_MASK },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { httpError: res.status, body: body.slice(0, 300) };
  }
  const p = (await res.json()) as {
    displayName?: { text: string };
    formattedAddress?: string;
    editorialSummary?: { text: string };
    photos?: unknown[];
    rating?: number;
    userRatingCount?: number;
    types?: string[];
  };
  return {
    displayName: p.displayName?.text,
    formattedAddress: p.formattedAddress,
    editorialSummary: p.editorialSummary?.text,
    photoCount: p.photos?.length ?? 0,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    types: p.types,
  };
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const key = loadGooglePlacesKey();
  const sampleFile = pathResolve(process.cwd(), "..", ".context/measurements/sparse-category-sample.json");
  const { samples } = JSON.parse(readFileSync(sampleFile, "utf8")) as { samples: Record<string, Candidate[]> };

  let searchCalls = 0;
  let detailsCalls = 0;
  let httpErrors = 0;
  let rateSignalSeen = false;
  const results: Record<string, any[]> = {};

  for (const [category, places] of Object.entries(samples)) {
    console.log(`\n=== ${category} (${places.length} places) ===`);
    results[category] = [];
    for (const place of places) {
      const search = await searchText(key, place.canonical_name, [place.lng, place.lat]);
      searchCalls++;
      if (search.status === "http-error") {
        httpErrors++;
        if (search.httpStatus === 429 || /quota|rate/i.test(search.body)) rateSignalSeen = true;
        console.log(`  [${category}] ${place.canonical_name}: HTTP ${search.httpStatus} ${search.body}`);
        results[category].push({ input: place, search });
        await sleep(CALL_DELAY_MS);
        continue;
      }
      if (search.status === "not-found") {
        console.log(`  [${category}] ${place.canonical_name}: not-found`);
        results[category].push({ input: place, search });
        await sleep(CALL_DELAY_MS);
        continue;
      }
      // resolved — fetch details for content signals.
      const details = await getDetails(key, search.placeId);
      detailsCalls++;
      if ("httpError" in details) {
        httpErrors++;
        if (details.httpError === 429 || /quota|rate/i.test(details.body)) rateSignalSeen = true;
      }
      console.log(
        `  [${category}] "${place.canonical_name}" → resolved "${search.displayName}" ` +
          `(${search.distanceKm.toFixed(2)} km away)` +
          (!("httpError" in details)
            ? ` | desc=${!!details.editorialSummary} photos=${details.photoCount} rating=${details.rating ?? "-"}`
            : ` | details HTTP ${details.httpError}`),
      );
      results[category].push({ input: place, search, details });
      await sleep(CALL_DELAY_MS);
    }
  }

  const summary = {
    totalPlaces: Object.values(samples).flat().length,
    searchCalls,
    detailsCalls,
    totalCalls: searchCalls + detailsCalls,
    httpErrors,
    rateSignalSeen,
  };
  console.log("\n=== CALL SUMMARY ===", JSON.stringify(summary, null, 2));

  writeFileSync(
    pathResolve(process.cwd(), "..", ".context/measurements/pilot-google-sparse-categories-results.json"),
    JSON.stringify({ summary, results }, null, 2),
  );
  console.log("\nWrote results to .context/measurements/pilot-google-sparse-categories-results.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
