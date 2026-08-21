/**
 * Read-only spot-check: does normalized_payload.amenities on OSM
 * source_records actually match what the raw tags say? Sanity pass before
 * OSM amenities starts flowing to master_place for the first time (per the
 * new field_precedence row, 20260818140000_osm_amenities_field_precedence.sql).
 *
 * Same spirit as the 2026-08-18 LLM-eligibility audit's spot-checks: pull a
 * real sample, print the raw evidence next to the derived value, eyeball it.
 * NOT modifying anything.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const AMENITY_KEYS = ["water", "toilet", "shower", "dump_station", "fire_ring", "picnic"] as const;

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = new URL(url).host.split(".")[0];
  console.log(`Project: ${ref}  (must be TEST znldzjdatkogdktymtvi)`);
  if (ref !== "znldzjdatkogdktymtvi") throw new Error("Refusing non-TEST");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  // Pull ALL OSM source_records with a non-null normalized_payload.amenities
  // — paginated explicitly. A bare .limit(2000) silently truncates at
  // PostgREST's default max-rows (1000) regardless of the requested value,
  // which would make a "corpus-wide" count below a truncated sample dressed
  // as a total. Page through with .range() instead.
  const PAGE = 1000;
  const data: any[] = [];
  let from = 0;
  while (true) {
    const r = await db
      .from("source_record")
      .select("id, external_id, name, inferred_category, normalized_payload, raw_payload")
      .eq("source_id", "osm")
      .eq("is_active", true)
      .not("normalized_payload->amenities", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      console.error("QUERY FAILED:", r);
      throw new Error("query failed");
    }
    data.push(...r.data);
    if (r.data.length < PAGE) break;
    from += PAGE;
  }
  // Filter to non-empty amenities objects (compact() drops empty keys but
  // could in principle leave {}; be defensive).
  const withAmenities = data.filter((r: any) => {
    const a = r.normalized_payload?.amenities;
    return a && typeof a === "object" && Object.keys(a).length > 0;
  });
  console.log(`OSM active SRs with non-null normalized_payload.amenities: ${data.length}`);
  console.log(`...with a non-empty amenities object: ${withAmenities.length}\n`);

  // Per-key counts, for context.
  const perKey: Record<string, number> = {};
  for (const k of AMENITY_KEYS) perKey[k] = 0;
  for (const r of withAmenities) {
    const a = (r as any).normalized_payload.amenities as Record<string, unknown>;
    for (const k of AMENITY_KEYS) if (a[k] === true) perKey[k]++;
  }
  console.log("Per-key true counts:");
  for (const k of AMENITY_KEYS) console.log(`  ${k.padEnd(14)} ${perKey[k]}`);
  console.log();

  // Deterministic-ish spread: one sample per key (first match), plus a
  // handful of multi-key rows, capped at ~15 total.
  const samples: any[] = [];
  const seen = new Set<string>();
  for (const k of AMENITY_KEYS) {
    const hit = withAmenities.find((r: any) => r.normalized_payload.amenities[k] === true && !seen.has(r.id));
    if (hit) { samples.push(hit); seen.add((hit as any).id); }
  }
  const multiKey = withAmenities
    .filter((r: any) => Object.keys(r.normalized_payload.amenities).length >= 2 && !seen.has(r.id))
    .slice(0, 5);
  for (const r of multiKey) { samples.push(r); seen.add((r as any).id); }

  console.log(`─── ${samples.length} samples: derived amenities vs raw tags ───\n`);
  let suspicious = 0;
  for (const r of samples as any[]) {
    const tags = r.raw_payload?.element?.tags ?? {};
    const amenities = r.normalized_payload.amenities;
    console.log(`${r.name ?? "(unnamed)"}  [${r.inferred_category ?? "?"}]  osm:${r.external_id}`);
    console.log(`  derived amenities: ${JSON.stringify(amenities)}`);
    console.log(`  raw tags:          ${JSON.stringify(tags)}`);
    // Re-derive independently (mirrors normalizeOsm's own logic) to confirm
    // the stored value matches what the raw tags actually say — a
    // consistency check, not a re-implementation to trust blindly.
    const expected = {
      water: tags.drinking_water === "yes" || tags.amenity === "drinking_water" ? true : undefined,
      toilet: tags.toilets === "yes" || tags.amenity === "toilets" ? true : undefined,
      shower: tags.shower === "yes" || tags.amenity === "shower" ? true : undefined,
      dump_station: tags.amenity === "sanitary_dump_station" ? true : undefined,
      fire_ring: tags.amenity === "fire_pit" || tags.amenity === "bbq" ? true : undefined,
      picnic: tags.tourism === "picnic_site" ? true : undefined,
    };
    const expectedCompact = Object.fromEntries(Object.entries(expected).filter(([, v]) => v !== undefined));
    // Order-independent comparison — Postgres jsonb does not preserve key
    // insertion order, so a plain JSON.stringify() compare is unsound (a
    // real bug in an earlier version of this script: it flagged
    // same-content objects as mismatches purely on key order).
    const sameKeys =
      Object.keys(expectedCompact).sort().join(",") === Object.keys(amenities).sort().join(",");
    const sameValues = Object.keys(expectedCompact).every(
      (k) => (expectedCompact as any)[k] === amenities[k],
    );
    const matches = sameKeys && sameValues;
    console.log(`  re-derived matches stored value: ${matches ? "YES" : "NO — MISMATCH"}`);
    if (!matches) suspicious++;
    // Plausibility flag: a dump_station on a category that structurally
    // can't have one (mirrors the BACKLOG waste_disposal-mis-mapping class
    // of bug — already fixed in normalizeOsm per its amenity=== check, but
    // worth a live-data confirmation).
    if (amenities.dump_station && tags.amenity !== "sanitary_dump_station") {
      console.log(`  ⚠ dump_station=true but raw amenity tag is "${tags.amenity}", not sanitary_dump_station`);
      suspicious++;
    }
    console.log();
  }

  console.log(`─── Result: ${suspicious} of ${samples.length} samples flagged ───\n`);

  // Corpus-wide (not just the sample): how many OSM SRs have a STALE
  // dump_station=true derived from the pre-#202 amenity=waste_disposal
  // mapping, rather than the current amenity=sanitary_dump_station logic?
  // (docs/BACKLOG.md "PROD OSM waste_disposal reclassify" documents this
  // exact bug class for inferred_category on PROD; this checks whether
  // stale normalized_payload.amenities values from the same pre-fix window
  // also persist on TEST.)
  const dumpStationTrue = withAmenities.filter(
    (r: any) => r.normalized_payload.amenities.dump_station === true,
  );
  const staleFromWasteDisposal = dumpStationTrue.filter(
    (r: any) => (r.raw_payload?.element?.tags ?? {}).amenity === "waste_disposal",
  );
  console.log(`─── Corpus-wide check: dump_station=true staleness ───`);
  console.log(`  OSM SRs with amenities.dump_station = true (of the ${data.length} probed): ${dumpStationTrue.length}`);
  console.log(`  ...of those, raw amenity tag is "waste_disposal" (pre-#202 stale mapping): ${staleFromWasteDisposal.length}`);
  if (staleFromWasteDisposal.length > 0) {
    console.log(`  STALE ROW IDS: ${staleFromWasteDisposal.map((r: any) => r.id).join(", ")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
