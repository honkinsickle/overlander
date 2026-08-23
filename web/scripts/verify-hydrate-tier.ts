/**
 * verify-hydrate-tier.ts — LIVE TEST proof that the bbox/Search tier fix holds
 * end to end, including the one link the unit tests cannot cover: the
 * `hydratePlacesByIds` DB SELECT now reading `description_source`.
 *
 * The blocker: `hydratePlacesByIds` never selected `description_source`, so
 * `mapMasterPlaceRow` classified every search-hydrated place as `unverified`.
 * The unit tests exercise `mapMasterPlaceRow`/`stamp` through a fake, so they
 * cannot see the SELECT. This drives the REAL `hydratePlacesByIds` against the
 * REAL export view on TEST and asserts, per bucket, that the hydrated tier
 * equals `classifyVerificationTier(export-view description_source)`.
 *
 * READ-ONLY. No writes. TEST project only.
 *
 * Run from web/:
 *   npx tsx --env-file=.env.development.local scripts/verify-hydrate-tier.ts
 */
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { hydratePlacesByIds } from "@/lib/trip-browse/hydrate";
import { classifyVerificationTier } from "@/lib/places/resolve-places";

type DescSource = "source" | "template" | "llm" | null;
const BUCKETS: DescSource[] = ["source", "llm", "template", null];
const PER_BUCKET = 25;

async function main() {
  const supabase = createSupabaseServiceClient();

  // Sample candidate ids per description_source bucket straight off the export
  // view — that view value is the ground truth the hydrated tier must match.
  const expectedByUuid = new Map<string, DescSource>();
  const sampled: Record<string, number> = {};
  for (const bucket of BUCKETS) {
    const q = supabase
      .from("master_place_search_export")
      .select("id,description_source")
      .limit(PER_BUCKET);
    const res =
      bucket === null
        ? await q.is("description_source", null)
        : await q.eq("description_source", bucket);
    // A null count / error reads as "0 rows" but is a query failure — log the
    // whole response, per the CLAUDE.md supabase-js gotcha.
    if (res.error) {
      console.error("QUERY FAILED:", JSON.stringify(res));
      process.exit(1);
    }
    const rows = (res.data ?? []) as { id: string; description_source: DescSource }[];
    sampled[String(bucket)] = rows.length;
    for (const r of rows) expectedByUuid.set(r.id, bucket);
  }

  const allIds = [...expectedByUuid.keys()];
  console.log(
    `sampled from export view (this run): ${BUCKETS.map(
      (b) => `${String(b)}=${sampled[String(b)]}`,
    ).join(" · ")} · total ids ${allIds.length}`,
  );

  // Drive the REAL hydrate. Note MAX_IDS caps hydrate at 50, so hydrate here in
  // chunks to cover the full sample rather than silently truncating.
  const hydrated: Awaited<ReturnType<typeof hydratePlacesByIds>> = [];
  for (let i = 0; i < allIds.length; i += 50) {
    hydrated.push(...(await hydratePlacesByIds(allIds.slice(i, i + 50))));
  }

  // Assert: every survivor's tier equals classify(view description_source).
  const survivorsByBucket: Record<string, number> = {
    source: 0,
    llm: 0,
    template: 0,
    null: 0,
  };
  const mismatches: string[] = [];
  for (const place of hydrated) {
    const uuid = place.id.replace(/^mp:/, "");
    const expectedSource = expectedByUuid.get(uuid);
    if (expectedSource === undefined) continue; // not in our sample
    survivorsByBucket[String(expectedSource)]++;
    const expectedTier = classifyVerificationTier(expectedSource);
    if (place.verified !== expectedTier) {
      mismatches.push(
        `${place.id}: description_source=${String(expectedSource)} → expected ${expectedTier}, got ${String(place.verified)}`,
      );
    }
  }

  console.log(
    `hydrated survivors by bucket (this run): ${Object.entries(survivorsByBucket)
      .map(([k, v]) => `${k}=${v}`)
      .join(" · ")}`,
  );

  // The whole point of the fix: at least one 'source' or 'llm' survivor must
  // come back VERIFIED. If none survived, the run proves nothing — fail loud
  // rather than green-on-vacuum.
  const verifiedSurvivors = survivorsByBucket.source + survivorsByBucket.llm;
  if (verifiedSurvivors === 0) {
    console.error(
      "INCONCLUSIVE: no source/llm survivors hydrated — cannot prove the fix. Widen the sample.",
    );
    process.exit(1);
  }

  if (mismatches.length > 0) {
    console.error(`FAIL: ${mismatches.length} tier mismatch(es):`);
    for (const m of mismatches) console.error("  " + m);
    process.exit(1);
  }

  console.log(
    `PASS: every hydrated survivor's tier matches the export view's description_source (${verifiedSurvivors} verified survivors proving 'source'/'llm' → verified).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
