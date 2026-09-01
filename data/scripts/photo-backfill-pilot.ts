/**
 * Photo-backfill pilot — CA campgrounds, license-clear sources only.
 *
 * For each CA `campground` master_place with NO photo coverage today (no
 * photo-eligible source_record carrying normalized_payload.photo.url, and no
 * google/google_resolved link), search license-clear sources for a photo:
 *   - Wikimedia Commons (File-namespace geosearch + name text search)
 *   - NPS API campgrounds (public-domain agency media)
 * Score each candidate on name-token overlap + geographic proximity, and
 * write `accepted` (strong) and `manual_review` (ambiguous) candidates into
 * public.master_place_photo_candidate. NOT-FOUND and license-rejected are
 * counted only.
 *
 * DELIBERATE STOP POINT: nothing here is wired into rendering. The corridor
 * RPC / category-list-card do not read master_place_photo_candidate. Promotion
 * to a live read path is a separate, explicitly authorized step.
 *
 * Excluded by design (flagged in the session report): USFS / BLM / CA State
 * Parks own-site media (no queryable license-clear photo endpoint — their
 * ArcGIS feature services carry no photo URLs), and dispersed_camping (a
 * separate primary_category from the named `campground` scope).
 *
 * Run (TEST):
 *   npm run -w data backfill:photo-pilot -- --dry-run
 *   npm run -w data backfill:photo-pilot -- --per-source 25
 *   npm run -w data backfill:photo-pilot                    # full target set
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { geosearchPhotos, textSearchPhotos, type CommonsCandidate } from "../photo-backfill/commons.ts";
import { fetchCaCampgrounds, matchNps, type NpsCampground } from "../photo-backfill/nps-photos.ts";
import { adjudicateCommons, adjudicateNps, attributionString, type Adjudication } from "../photo-backfill/matcher.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const PAGE = 1000;
const CONCURRENCY = 3;
const PHOTO_SOURCES = ["nps", "ridb", "wikipedia", "atlas_oddities", "family_destinations", "editorial_food"];
const GOOGLE_SOURCES = ["google", "google_resolved"];
// order = which contributing source labels a target for stratification/reporting
const SOURCE_TAG_PRIORITY = ["usfs", "state_parks", "ridb", "blm", "nps", "osm"];

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}

function chunk<T>(a: T[], n: number): T[][] {
  const o: T[][] = [];
  for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
  return o;
}

type Target = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  sourceTag: string;
};

async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const r = await run(from, from + PAGE - 1);
    if (r.error || r.data == null) {
      logger.error({ resp: r }, "query failed");
      throw new Error("query failed (see log)");
    }
    out.push(...r.data);
    if (r.data.length < PAGE) break;
  }
  return out;
}

/** Enumerate CA campgrounds with zero photo coverage today, tagged by source. */
async function enumerateTargets(db: SupabaseClient): Promise<{ targets: Target[]; noCoord: number; totals: Record<string, number> }> {
  const camps = await pageAll<{ id: string }>((f, t) =>
    db.from("master_place").select("id").eq("primary_category", "campground").eq("state", "CA").range(f, t),
  );
  const campIds = new Set(camps.map((c) => c.id));

  const photoSR = await pageAll<{ master_place_id: string }>((f, t) =>
    db.from("source_record").select("master_place_id").in("source_id", PHOTO_SOURCES).not("normalized_payload->photo->>url", "is", null).range(f, t),
  );
  const hasPhoto = new Set(photoSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));
  const gSR = await pageAll<{ master_place_id: string }>((f, t) =>
    db.from("source_record").select("master_place_id").in("source_id", GOOGLE_SOURCES).range(f, t),
  );
  const hasGoogle = new Set(gSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));

  const targetIds = camps.map((c) => c.id).filter((id) => !hasPhoto.has(id) && !hasGoogle.has(id));
  const targetSet = new Set(targetIds);

  // coords + names from the search export (has lng/lat); some target rows are
  // excluded from the export (needs_review / operational_status) → no coord.
  const exp = await pageAll<{ id: string; lng: number | null; lat: number | null; canonical_name: string | null }>((f, t) =>
    db.from("master_place_search_export").select("id,lng,lat,canonical_name").eq("primary_category", "campground").range(f, t),
  );
  const expById = new Map(exp.map((e) => [e.id, e]));

  // source tags for stratification (chunked .in to avoid URL overflow)
  const tagById = new Map<string, string>();
  for (const c of chunk(targetIds, 200)) {
    const r = await db.from("source_record").select("master_place_id,source_id").in("master_place_id", c);
    if (r.error) { logger.error({ err: r.error }, "source tag query failed"); throw new Error("source tag query failed"); }
    const sourcesByMp = new Map<string, Set<string>>();
    for (const s of r.data as Array<{ master_place_id: string; source_id: string }>) {
      if (!sourcesByMp.has(s.master_place_id)) sourcesByMp.set(s.master_place_id, new Set());
      sourcesByMp.get(s.master_place_id)!.add(s.source_id);
    }
    for (const [mp, srcs] of sourcesByMp) {
      const tag = SOURCE_TAG_PRIORITY.find((s) => srcs.has(s)) ?? "generated_only";
      tagById.set(mp, tag);
    }
  }

  const targets: Target[] = [];
  let noCoord = 0;
  const totals: Record<string, number> = {};
  for (const id of targetIds) {
    const e = expById.get(id);
    const tag = tagById.get(id) ?? "generated_only";
    totals[tag] = (totals[tag] ?? 0) + 1;
    if (!e || e.lng == null || e.lat == null || !e.canonical_name) { noCoord++; continue; }
    targets.push({ id, name: e.canonical_name, lng: e.lng, lat: e.lat, sourceTag: tag });
  }
  void targetSet;
  return { targets, noCoord, totals };
}

type CandidateRow = {
  master_place_id: string;
  source: string;
  image_url: string;
  thumb_url: string | null;
  source_page_url: string | null;
  license: string | null;
  license_url: string | null;
  license_class: string;
  attribution: string | null;
  title: string | null;
  match_status: string;
  match_confidence: number;
  name_score: number;
  distance_m: number | null;
  match_reason: string;
  place_name: string;
  primary_category: string;
  pilot_run: string;
  raw: unknown;
};

function commonsToRow(t: Target, c: CommonsCandidate, adj: Adjudication, pilotRun: string): CandidateRow {
  return {
    master_place_id: t.id,
    source: c.via === "text" ? "wikimedia_commons" : "wikimedia_commons",
    image_url: c.imageUrl,
    thumb_url: c.thumbUrl,
    source_page_url: c.sourcePageUrl,
    license: c.license,
    license_url: c.licenseUrl,
    license_class: adj.licenseClass,
    attribution: attributionString(adj.licenseClass, c.artist, c.license),
    title: c.title,
    match_status: adj.status,
    match_confidence: adj.confidence,
    name_score: adj.nameScore,
    distance_m: adj.distanceM,
    match_reason: adj.reason,
    place_name: t.name,
    primary_category: "campground",
    pilot_run: pilotRun,
    raw: { via: c.via, artist: c.artist, imageDescription: c.imageDescription },
  };
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--dry-run", "Preview only; no writes.")
    .option("--limit <n>", "Max target places to process (after stratification).", parseInt)
    .option("--per-source <n>", "Cap targets processed per contributing-source tag.", parseInt)
    .option("--radius <m>", "Commons geosearch radius in meters.", parseInt)
    .option("--pilot-run <label>", "Batch label stored on each row.")
    .option("--confirm", "Required for PRODUCTION.")
    .parse(process.argv);

  const opts = program.opts<{
    dryRun?: boolean; limit?: number; perSource?: number; radius?: number; pilotRun?: string; confirm?: boolean;
  }>();

  const db = getDb();
  const ref = targetRef();
  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error({ target: ref }, "refusing PRODUCTION without --confirm");
    process.exitCode = 1;
    return;
  }
  const apply = !opts.dryRun;
  const radius = opts.radius ?? 2000;
  const pilotRun = opts.pilotRun ?? `ca-campground-${new Date().toISOString().slice(0, 10)}`;
  console.log(`Target: ${ref}${ref === PROD_REF ? " ** PROD **" : " (test)"} | apply=${apply} | pilot_run=${pilotRun} | radius=${radius}m`);

  const { targets, noCoord, totals } = await enumerateTargets(db);
  console.log(`\nTarget set (CA campgrounds, zero photo coverage): ${targets.length} with coords; ${noCoord} excluded from export (no coord).`);
  console.log("Target totals by source tag:", JSON.stringify(totals));

  // stratified sample
  let selected = targets;
  if (opts.perSource) {
    const byTag = new Map<string, Target[]>();
    for (const t of targets) { if (!byTag.has(t.sourceTag)) byTag.set(t.sourceTag, []); byTag.get(t.sourceTag)!.push(t); }
    selected = [...byTag.values()].flatMap((arr) => arr.slice(0, opts.perSource));
  }
  if (opts.limit) selected = selected.slice(0, opts.limit);
  console.log(`Processing ${selected.length} places (stratified per-source=${opts.perSource ?? "∞"}, limit=${opts.limit ?? "∞"}).\n`);

  // prefetch NPS CA campgrounds once
  let npsCgs: NpsCampground[] = [];
  try {
    npsCgs = await fetchCaCampgrounds();
    console.log(`NPS CA campgrounds prefetched: ${npsCgs.length}`);
  } catch (err) {
    logger.warn({ err }, "NPS prefetch failed — proceeding with Commons only");
  }

  const rowsToStore: CandidateRow[] = [];
  const stat = { processed: 0, accepted: 0, manual: 0, noCandidate: 0, rejected: 0, errors: 0 };
  const bySourceTag: Record<string, { processed: number; accepted: number; manual: number; none: number }> = {};
  const acceptedSamples: CandidateRow[] = [];

  const tally = (tag: string, key: "processed" | "accepted" | "manual" | "none") => {
    bySourceTag[tag] ??= { processed: 0, accepted: 0, manual: 0, none: 0 };
    bySourceTag[tag][key]++;
  };

  for (const batch of chunk(selected, CONCURRENCY)) {
    await Promise.all(batch.map(async (t) => {
      tally(t.sourceTag, "processed");
      stat.processed++;
      try {
        const commons: CommonsCandidate[] = [
          ...(await geosearchPhotos(t.lat, t.lng, { radiusM: radius, limit: 8 })),
          ...(await textSearchPhotos(`${t.name} California`, { limit: 5 })),
        ];
        const adjudicated = commons.map((c) => ({ c, adj: adjudicateCommons(t.name, c) }));

        // NPS
        const npsRows: CandidateRow[] = [];
        const npsMatch = matchNps(t.name, t.lng, t.lat, npsCgs);
        if (npsMatch) {
          const img = npsMatch.campground.images[0];
          const adj = adjudicateNps(npsMatch.nameScore, npsMatch.sub, npsMatch.distanceM, img.credit ?? null);
          if (adj.status !== "reject") {
            npsRows.push({
              master_place_id: t.id, source: "nps", image_url: img.url, thumb_url: null,
              source_page_url: npsMatch.campground.pageUrl, license: adj.licenseClass === "public_domain" ? "Public domain (NPS)" : (img.credit ?? null),
              license_url: null, license_class: adj.licenseClass,
              attribution: adj.licenseClass === "public_domain" ? null : (img.credit ?? null),
              title: img.title ?? img.altText ?? null, match_status: adj.status, match_confidence: adj.confidence,
              name_score: adj.nameScore, distance_m: adj.distanceM, match_reason: adj.reason,
              place_name: t.name, primary_category: "campground", pilot_run: pilotRun,
              raw: { npsId: npsMatch.campground.id, credit: img.credit, caption: img.caption },
            });
          }
        }

        const accepted = [
          ...adjudicated.filter((x) => x.adj.status === "accepted").map((x) => commonsToRow(t, x.c, x.adj, pilotRun)),
          ...npsRows.filter((r) => r.match_status === "accepted"),
        ].sort((a, b) => b.match_confidence - a.match_confidence);
        const manual = [
          ...adjudicated.filter((x) => x.adj.status === "manual_review").map((x) => commonsToRow(t, x.c, x.adj, pilotRun)),
          ...npsRows.filter((r) => r.match_status === "manual_review"),
        ].sort((a, b) => b.match_confidence - a.match_confidence);

        if (accepted.length > 0) {
          // store the single best accepted photo + any manual_review alternates
          rowsToStore.push(accepted[0], ...manual);
          stat.accepted++;
          tally(t.sourceTag, "accepted");
          if (acceptedSamples.length < 12) acceptedSamples.push(accepted[0]);
        } else if (manual.length > 0) {
          rowsToStore.push(...manual);
          stat.manual++;
          tally(t.sourceTag, "manual");
        } else {
          // Distinguish "nothing any source returned" (not-found) from
          // "candidates existed but none survived license+match" (rejected).
          const anyCandidate = commons.length > 0 || npsMatch != null;
          if (anyCandidate) stat.rejected++;
          else stat.noCandidate++;
          tally(t.sourceTag, "none");
        }
      } catch (err) {
        stat.errors++;
        logger.warn({ err, name: t.name }, "place processing error");
      }
    }));
    if (stat.processed % 30 < CONCURRENCY) process.stderr.write(`  ${stat.processed}/${selected.length} acc=${stat.accepted} man=${stat.manual}\n`);
    await new Promise((r) => setTimeout(r, 350));
  }

  // Dedupe by (master_place_id, image_url): the same file can surface via both
  // geosearch and text search (or NPS+Commons). The unique constraint forbids
  // two rows with the same conflict key in one upsert command. Keep the best:
  // accepted over manual_review, then higher confidence.
  const statusRank: Record<string, number> = { accepted: 2, manual_review: 1 };
  const dedup = new Map<string, CandidateRow>();
  for (const r of rowsToStore) {
    const k = `${r.master_place_id}|${r.image_url}`;
    const cur = dedup.get(k);
    const better =
      !cur ||
      (statusRank[r.match_status] ?? 0) > (statusRank[cur.match_status] ?? 0) ||
      ((statusRank[r.match_status] ?? 0) === (statusRank[cur.match_status] ?? 0) &&
        r.match_confidence > cur.match_confidence);
    if (better) dedup.set(k, r);
  }
  const finalRows = [...dedup.values()];
  console.log(`\nCandidate rows to store: ${finalRows.length} (${rowsToStore.length - finalRows.length} duplicate (place,image) pairs collapsed)`);
  if (apply && finalRows.length > 0) {
    let stored = 0;
    for (const c of chunk(finalRows, 200)) {
      const { error } = await db.from("master_place_photo_candidate").upsert(c, { onConflict: "master_place_id,image_url" });
      if (error) { logger.error({ err: error }, "upsert failed"); throw new Error("upsert failed"); }
      stored += c.length;
    }
    console.log(`Stored ${stored} candidate rows into master_place_photo_candidate.`);
  } else if (!apply) {
    console.log("(dry-run: no rows written)");
  }

  console.log("\n=== PILOT RESULT ===");
  console.log(JSON.stringify({ target: ref, pilotRun, apply, ...stat }, null, 2));
  console.log("\n=== BY SOURCE TAG (processed | accepted | manual_review | none) ===");
  for (const [tag, s] of Object.entries(bySourceTag).sort((a, b) => b[1].processed - a[1].processed)) {
    console.log(`  ${tag.padEnd(16)} ${String(s.processed).padStart(4)} | ${String(s.accepted).padStart(4)} | ${String(s.manual).padStart(4)} | ${String(s.none).padStart(4)}`);
  }
  console.log("\n=== ACCEPTED SAMPLES ===");
  for (const s of acceptedSamples) {
    console.log(`  "${s.place_name}" → ${s.source} | ${s.license} | dist=${s.distance_m == null ? "n/a" : Math.round(s.distance_m) + "m"} score=${s.name_score.toFixed(2)} conf=${s.match_confidence.toFixed(2)}`);
    console.log(`      ${s.image_url}`);
    console.log(`      page: ${s.source_page_url ?? "(none)"} | attribution: ${s.attribution ?? "(public domain)"}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error({ err }, "photo-backfill-pilot: fatal");
    process.exit(1);
  });
}
