/**
 * Pinned ER corpus — the hand-built fixture the disposable ER test project is
 * seeded with. Replaces the old "copy every prod source_record" approach (see
 * docs/decisions/2026-07-23-pinned-er-fixture.md for why, and what the trade
 * costs).
 *
 * ~17 records, one per match path, small enough to reason about end-to-end.
 * Loaded by scripts/seed-test-fixtures.ts through upsertSourceRecord (the same
 * helper the synthetic suites use — schema-safe, builds the PostGIS geometry
 * and writes normalized_payload for us).
 *
 * COORDS ARE SYNTHETIC. Points cluster at lat 34.0 (SoCal desert band),
 * deliberately clear of every synthetic suite: phase3a precedence/federation/
 * determinism (lat 51–54) and phase3b containment/federation (lat 40–45). Each
 * CASE occupies its own ~0.1° longitude slot (~9 km apart) so no case's records
 * are candidates for another's; the sub-metre offsets WITHIN a case are what
 * drive the intended match path. Geographic realism is irrelevant to the matcher
 * (it reads coords only for distance) — e.g. parks_canada at lat 34 is fine.
 *
 * Each record's expected outcome is asserted in phase3a.test.ts (the JT-corpus
 * block) and enumerated per case in test-fixtures.ts. The mapping between a
 * record here and the path it exercises:
 *
 *   Case 1  Alpha    NPS+RIDB @0m           → fed_exact
 *                    +Google @200m          → name_dominant
 *                    +OSM toilet @40m       → amenity_rollup
 *   Case 2  Orphan dump  OSM, >100m to any parent → amenity_rollup FALLS THROUGH → solo
 *   Case 3  Beta     NPS; OSM name="7" @40m → close_nameless (Beta has no osm link → guard passes)
 *   Case 4  Gamma/Delta  NPS + Google @150m, different names → name gate REJECTS → 2 places
 *   Case 5  Epsilon  parks_canada + Google @100m → name_dominant, binational; parks_canada wins canonical_name
 *   Case 6  Zeta     Google restaurant @50m from Gamma → matrix-absent category → compat 0 → solo (gate shut)
 *   Case 7  Eta      Google, null category @50m from Delta → null → compat 0 → solo (gate pins to 0)
 *   Case 8  Theta    RIDB recreation_area, isolated → new_master_place (clean single-source negative)
 *   Peak    Iota     OSM peak @78m from Alpha → peak↔campground = 0.0 (hard zero) → NOT merged
 *   Same-src Kappa1/Kappa2  two OSM gas_stations, same name, @120m → same-source guard blocks
 *                    name_dominant → blended lands 0.6 → manual_review (NOT auto-merged)
 */

import type { UpsertSourceRecordArgs } from "../../ingestion/lib/db.ts";

/** Small helper: a named place record with canonical_name in normalized_payload
 *  (the field resolve_field reads for master_place.canonical_name). */
function rec(
  args: Omit<UpsertSourceRecordArgs, "rawPayload" | "normalizedPayload"> & {
    canonicalName?: string;
    overlanderTags?: string[];
  },
): UpsertSourceRecordArgs {
  const { canonicalName, overlanderTags, ...base } = args;
  return {
    ...base,
    rawPayload: { synthetic: true, source: base.sourceId },
    normalizedPayload: {
      canonical_name: canonicalName ?? base.name,
      description: null,
      overlander_tags: overlanderTags ?? [],
      contact: null,
      access: null,
      amenities: null,
      hours: null,
    },
  };
}

const Q_NPS = 0.95;
const Q_RIDB = 0.9;
const Q_GOOGLE = 0.85;
const Q_PARKS_CANADA = 0.95;
const Q_OSM = 0.4;

export const ER_CORPUS: ReadonlyArray<UpsertSourceRecordArgs> = [
  // ── Case 1 — Alpha: 4-source merge (fed_exact + name_dominant + amenity_rollup) ──
  rec({ sourceId: "nps", externalId: "er:alpha:nps", name: "Alpha Campground", inferredCategory: "campground", point: [-116.0, 34.0], sourceQualityScore: Q_NPS }),
  rec({ sourceId: "ridb", externalId: "er:alpha:ridb", name: "Alpha Campground", inferredCategory: "campground", point: [-116.0, 34.0], sourceQualityScore: Q_RIDB }),
  rec({ sourceId: "google", externalId: "er:alpha:google", name: "Alpha Campground", inferredCategory: "campground", point: [-115.99783, 34.0], sourceQualityScore: Q_GOOGLE }),
  rec({ sourceId: "osm", externalId: "er:alpha:toilet", name: "Alpha Toilet", inferredCategory: "toilet", point: [-115.99957, 34.0], sourceQualityScore: Q_OSM }),

  // ── Peak hard-zero — Iota: OSM peak 78 m from Alpha, peak↔campground = 0.0 ──
  rec({ sourceId: "osm", externalId: "er:iota:peak", name: "Iota Peak", inferredCategory: "peak", point: [-115.99915, 34.0], sourceQualityScore: Q_OSM }),

  // ── Case 2 — Orphan dump: OSM dump_station with no parent within 100 m ──
  rec({ sourceId: "osm", externalId: "er:orphandump:osm", name: "Unnamed dump station", inferredCategory: "dump_station", point: [-115.8, 34.0], sourceQualityScore: Q_OSM }),

  // ── Case 3 — Beta: close_nameless (OSM numeric-name node near an nps-only campground) ──
  rec({ sourceId: "nps", externalId: "er:beta:nps", name: "Beta Campground", inferredCategory: "campground", point: [-115.7, 34.0], sourceQualityScore: Q_NPS }),
  rec({ sourceId: "osm", externalId: "er:beta:osm7", name: "7", inferredCategory: "campground", point: [-115.69957, 34.0], sourceQualityScore: Q_OSM }),

  // ── Case 4 — Gamma / Delta: different-named campgrounds 150 m apart, must NOT merge ──
  rec({ sourceId: "nps", externalId: "er:gamma:nps", name: "Gamma Campground", inferredCategory: "campground", point: [-115.6, 34.0], sourceQualityScore: Q_NPS }),
  rec({ sourceId: "google", externalId: "er:delta:google", name: "Delta Campground", inferredCategory: "campground", point: [-115.59837, 34.0], sourceQualityScore: Q_GOOGLE }),

  // ── Case 6 — Zeta: Google restaurant 50 m from Gamma, matrix-absent category → solo ──
  rec({ sourceId: "google", externalId: "er:zeta:google", name: "Zeta Diner", inferredCategory: "restaurant", point: [-115.60054, 34.0], sourceQualityScore: Q_GOOGLE }),

  // ── Case 7 — Eta: Google record with NO category, 50 m from Delta → compat 0 → solo ──
  rec({ sourceId: "google", externalId: "er:eta:google", name: "Eta Unknown", inferredCategory: null, point: [-115.59783, 34.0], sourceQualityScore: Q_GOOGLE }),

  // ── Case 5 — Epsilon: parks_canada + Google, binational name_dominant; parks_canada wins name ──
  rec({ sourceId: "parks_canada", externalId: "er:epsilon:parks_canada", name: "Epsilon Campground", inferredCategory: "campground", point: [-115.5, 34.0], sourceQualityScore: Q_PARKS_CANADA, overlanderTags: ["federal_land", "parks_canada"] }),
  rec({ sourceId: "google", externalId: "er:epsilon:google", name: "Epsilon Camp", inferredCategory: "campground", point: [-115.49892, 34.0], sourceQualityScore: Q_GOOGLE }),

  // ── Case 8 — Theta: isolated single-source recreation_area → solo (clean negative) ──
  rec({ sourceId: "ridb", externalId: "er:theta:ridb", name: "Theta Recreation Area", inferredCategory: "recreation_area", point: [-115.4, 34.0], sourceQualityScore: Q_RIDB }),

  // ── Same-source chain-business — Kappa1 / Kappa2: identical name+source 120 m apart ──
  rec({ sourceId: "osm", externalId: "er:kappa1:osm", name: "Kappa Fuel", inferredCategory: "gas_station", point: [-115.3, 34.0], sourceQualityScore: Q_OSM }),
  rec({ sourceId: "osm", externalId: "er:kappa2:osm", name: "Kappa Fuel", inferredCategory: "gas_station", point: [-115.2987, 34.0], sourceQualityScore: Q_OSM }),
];
