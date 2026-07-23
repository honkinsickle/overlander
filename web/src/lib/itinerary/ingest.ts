/**
 * Corpus-feedback: enqueue tier-2 resolved places into the corpus so next
 * time they're tier-1 cached (self-densifying, spec §8.3 three-tier model).
 *
 * Reuses the existing `upsert_source_record` RPC — idempotent on
 * (source_id, external_id), and it does NOT trigger entity resolution, so it
 * only captures a `source_record` row and moves nothing in `master_place`.
 * Promotion to the corpus is a DELIBERATE, MANUAL step out of band. Run it
 * BARE so the whole unresolved delta promotes:
 *   npm run -w data materialize
 * (the incremental ER path — never --rematerialize). Do NOT reach for
 * --only-categories here: it is a fail-closed allowlist (materialize.ts
 * computeTrulyUnresolvedIds) that SILENTLY holds back every record whose
 * category is not listed — including any new/unmapped category a resolution
 * produced. If you must scope a run, pass an EXPLICIT, COMPLETE list of the
 * categories you intend to promote. Auto-materialize is intentionally NOT
 * wired: generation-triggered prod corpus writes need earned trust first.
 *
 * OPT-IN: nothing calls this during a normal generation unless the caller
 * explicitly enables it and passes a target client — a corpus write is a
 * deliberate act with an eyes-on target preflight.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResolvedPlace } from "./schema";

const SOURCE_ID = "google_resolved";
const QUALITY = 0.85;

export type EnqueueResult = {
  attempted: number;
  succeeded: number;
  errors: string[];
};

/**
 * Upsert each resolved place as a `source_record`. Dedupes by place_id within
 * the call (a place resolved on multiple days is one row). Idempotent at the
 * DB via (source_id, external_id = google:<place_id>).
 */
export async function enqueueResolvedPlaces(
  places: ResolvedPlace[],
  supabase: SupabaseClient,
): Promise<EnqueueResult> {
  const byId = new Map<string, ResolvedPlace>();
  for (const p of places) if (!byId.has(p.placeId)) byId.set(p.placeId, p);

  const result: EnqueueResult = {
    attempted: byId.size,
    succeeded: 0,
    errors: [],
  };

  for (const p of byId.values()) {
    const [lng, lat] = p.coords;
    const { error } = await supabase.rpc("upsert_source_record", {
      p_source_id: SOURCE_ID,
      p_external_id: `google:${p.placeId}`,
      p_name: p.displayName,
      p_inferred_category: p.category,
      p_geometry: `SRID=4326;POINT(${lng} ${lat})`,
      p_raw_payload: {
        place_id: p.placeId,
        displayName: p.displayName,
        resolvedFromName: p.name,
        location: { latitude: lat, longitude: lng },
      },
      // Keys MUST match master_place field names — resolve_field reads
      // `normalized_payload -> <field_name>` (migration
      // 20260601010000_phase3a_resolve_field_determinism). Paired with the
      // google_resolved field_precedence rows so a solo-resolved place resolves
      // (and attributes) its own name/category instead of landing with '{}'.
      p_normalized_payload: {
        canonical_name: p.displayName,
        primary_category: p.category,
        coords: [lng, lat],
        provenance: "itinerary-audit tier-2 live resolve",
      },
      p_source_quality_score: QUALITY,
    });
    if (error) result.errors.push(`${p.displayName}: ${error.message}`);
    else result.succeeded++;
  }

  return result;
}
