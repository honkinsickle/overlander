/**
 * Backfill Wikipedia photos onto non-NPS corpus POIs that have no photo.
 *
 * For each qualifying master_place (searchable, no photo, not NPS, named),
 * runs the Wikipedia Geosearch matcher and, for high/medium-confidence
 * matches with a licensed image, upserts a `wikipedia` source_record
 * linked to the master_place.
 *
 * The corridor RPC's photo lateral join (nps > ridb > wikipedia) then
 * picks up the photo on the next read.
 *
 * Idempotent: re-running skips places that already have a linked
 * wikipedia source_record. --force re-evaluates all.
 *
 * Run:
 *   npm run -w data backfill:wikipedia-photo -- --dry-run     # preview
 *   npm run -w data backfill:wikipedia-photo                  # apply (test)
 *   npm run -w data backfill:wikipedia-photo -- --limit 50    # first 50
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { matchPoi, toNormalizedPhoto } from "../ingestion/sources/wikipedia.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const PAGE = 500;
const CONCURRENCY = 3;
const SOURCE_ID = "wikipedia";
const SOURCE_QUALITY = 0.6;

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}

type Candidate = {
  id: string;
  canonical_name: string;
  primary_category: string;
  lng: number;
  lat: number;
};

async function fetchCandidates(
  db: SupabaseClient,
  skipIds: Set<string>,
): Promise<Candidate[]> {
  const out: Candidate[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await db
      .from("master_place_search_export")
      .select("id, canonical_name, primary_category, lng, lat, photo_url, overlander_tags")
      .order("prominence_score", { ascending: false })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`search export scan: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const r of data as any[]) {
      if (r.photo_url) continue;
      if (skipIds.has(r.id)) continue;
      if (!r.canonical_name || r.canonical_name.startsWith("Unnamed")) continue;
      if ((r.overlander_tags ?? []).includes("nps")) continue;
      out.push({
        id: r.id,
        canonical_name: r.canonical_name,
        primary_category: r.primary_category,
        lng: r.lng,
        lat: r.lat,
      });
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return out;
}

async function fetchExistingWikiIds(db: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id")
      .eq("source_id", SOURCE_ID)
      .eq("is_active", true)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`wiki scan: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const r of data) {
      if (r.master_place_id) ids.add(r.master_place_id);
    }
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return ids;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--dry-run", "Preview only; no writes.")
    .option("--limit <n>", "Max POIs to process.", parseInt)
    .option("--confirm", "Required for PRODUCTION.")
    .option("--force", "Re-evaluate POIs with an existing wikipedia record.")
    .parse(process.argv);

  const opts = program.opts<{
    dryRun?: boolean;
    limit?: number;
    confirm?: boolean;
    force?: boolean;
  }>();

  const db = getDb();
  const ref = targetRef();

  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error({ target: ref }, "refusing PRODUCTION without --confirm");
    process.exitCode = 1;
    return;
  }

  console.log(`Target: ${ref}${ref === PROD_REF ? " ** PROD **" : " (test)"}`);

  const skipIds = opts.force ? new Set<string>() : await fetchExistingWikiIds(db);
  console.log(`Existing wikipedia source_records: ${skipIds.size}`);

  const all = await fetchCandidates(db, skipIds);
  const candidates = opts.limit ? all.slice(0, opts.limit) : all;
  console.log(`Candidates: ${all.length} total, processing ${candidates.length}`);

  if (candidates.length === 0) {
    console.log("Nothing to process.");
    return;
  }

  const apply = !opts.dryRun;
  let scanned = 0, noMatch = 0, highConf = 0, medConf = 0, upserted = 0, errors = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);

    const results = await Promise.all(
      batch.map(async (poi) => {
        try {
          return { poi, match: await matchPoi(poi.canonical_name, poi.lat, poi.lng) };
        } catch (err) {
          logger.warn({ err, name: poi.canonical_name }, "match error");
          return { poi, match: null, err: true };
        }
      }),
    );

    for (const r of results) {
      scanned++;
      if ((r as any).err) { errors++; continue; }
      if (!r.match) { noMatch++; continue; }

      if (r.match.confidence === "high") highConf++;
      else medConf++;

      const photo = toNormalizedPhoto(r.match);
      const externalId = `wikipedia:${r.match.wikiTitle.replace(/\s+/g, "_")}`;

      if (!apply) {
        console.log(
          `  [${r.match.confidence}] "${r.poi.canonical_name}" → "${r.match.wikiTitle}" ` +
          `dist=${r.match.distM}m score=${r.match.nameScore.toFixed(2)} lic=${photo.license}`,
        );
        continue;
      }

      const { error } = await db.from("source_record").upsert(
        {
          source_id: SOURCE_ID,
          external_id: externalId,
          name: r.match.wikiTitle,
          inferred_category: r.poi.primary_category,
          geometry: `SRID=4326;POINT(${r.poi.lng} ${r.poi.lat})`,
          raw_payload: {
            wiki_title: r.match.wikiTitle,
            confidence: r.match.confidence,
            name_score: r.match.nameScore,
            dist_m: r.match.distM,
            image: r.match.image,
            fetched_at: new Date().toISOString(),
          },
          normalized_payload: { photo },
          source_quality_score: SOURCE_QUALITY,
          master_place_id: r.poi.id,
          is_active: true,
        },
        { onConflict: "source_id,external_id" },
      );

      if (error) {
        errors++;
        logger.warn({ err: error, externalId }, "upsert failed");
      } else {
        upserted++;
      }
    }

    if (scanned % 30 === 0 && scanned > 0) {
      process.stderr.write(
        `  ${scanned}/${candidates.length} high=${highConf} med=${medConf} none=${noMatch}\n`,
      );
    }

    if (i + CONCURRENCY < candidates.length) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  const summary = { target: ref, apply, scanned, noMatch, highConf, medConf, upserted, errors };
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "backfill-wikipedia-photo: fatal");
    process.exit(1);
  });
}
