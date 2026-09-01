/**
 * RIDB-direct photo pull for RIDB-sourced CA campgrounds with no baked photo.
 *
 * Goes back to the LIVE recreation.gov (RIDB) Facility Media endpoint
 * (GET /facilities/{FacilityID}/media) rather than the ingestion snapshot, to
 * catch media added since. Matches each master_place to its facility by the
 * STRUCTURED id captured at ingestion (source_record.external_id =
 * 'ridb:facility:<FacilityID>') — no name/geo fuzzy matching.
 *
 * RIDB aggregates media across agencies AND partner/individual contributors, so
 * unlike the NPS-own-site pass it is NOT uniformly public domain. Per-image
 * rights are read from the media object's `Credits`:
 *   - explicit federal-agency credit → clear → match_status='accepted'
 *   - empty, individual, or other credit → rights unclear → 'manual_review'
 * No usable image (empty media, all non-photo, or a stale/404 FacilityID) →
 * 'no_candidate' with a reason.
 *
 * NOT wired into rendering. Auth: TEST Supabase + RIDB_API_KEY from data/.env.
 *
 * Run (TEST):
 *   npm run -w data backfill:photo-ridb -- --dry-run
 *   npm run -w data backfill:photo-ridb
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { pickPhoto } from "../photo-backfill/nps-photos.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const RIDB_BASE = "https://ridb.recreation.gov/api/v1";
const PHOTO_SOURCES = ["nps", "ridb", "wikipedia", "atlas_oddities", "family_destinations", "editorial_food"];
const PILOT_RUN = "ridb-direct-2026-09-01";
const CONCURRENCY = 4;

// Federal-agency credit lines (recreation.gov media) that are clearly U.S.-
// government works → clear to use. Anything else (individual names, partners,
// empty) is treated as rights-unclear and routed to manual_review.
const FEDERAL_CREDIT_RE =
  /national park|national forest|national monument|national recreation|national grassland|forest service|\busda\b|\busfs\b|\bnps\b|park service|bureau of land management|\bblm\b|army corps|\busace\b|corps of engineers|fish (and|&|and\/or) wildlife|\busfws\b|bureau of reclamation|reclamation|ranger (district|station)|u\.?s\.? government|federal government|\bdoi\b|department of the interior/i;

function classifyRights(credits: string | null | undefined): { clear: boolean; note: string } {
  const c = (credits ?? "").trim();
  if (c.length === 0) return { clear: false, note: "no credit line — rights unstated (not assuming public domain)" };
  if (FEDERAL_CREDIT_RE.test(c)) return { clear: true, note: `federal-agency credit: "${c}"` };
  return { clear: false, note: `credit names a non-federal/individual source: "${c}" — rights unclear` };
}

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}
const chunk = <T>(a: T[], n: number): T[][] => { const o: T[][] = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

async function pageAll<T>(build: (f: number, t: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const out: T[] = [];
  for (let f = 0; ; f += 1000) {
    const r = await build(f, f + 999);
    if (r.error || r.data == null) { logger.error({ resp: r }, "query failed"); throw new Error("query failed"); }
    out.push(...r.data);
    if (r.data.length < 1000) break;
  }
  return out;
}

type MediaEntry = { URL?: string | null; MediaType?: string | null; Title?: string | null; Credits?: string | null; IsPrimary?: boolean | string | null };

/** Fetch facility media. Returns entries, or `null` when the facility does not resolve (404). */
async function fetchFacilityMedia(facilityId: string): Promise<MediaEntry[] | null> {
  const key = process.env.RIDB_API_KEY;
  if (!key) throw new Error("RIDB_API_KEY is not set");
  const url = `${RIDB_BASE}/facilities/${encodeURIComponent(facilityId)}/media`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(url, { headers: { apikey: key, Accept: "application/json" } });
    if (r.status === 404) return null; // stale / removed FacilityID
    if (r.status === 429 || r.status >= 500) { await new Promise((res) => setTimeout(res, 500 * 2 ** attempt)); continue; }
    if (!r.ok) throw Object.assign(new Error(`RIDB media ${r.status}`), { status: r.status });
    const j = (await r.json()) as { RECDATA?: MediaEntry[] };
    return j.RECDATA ?? [];
  }
  throw new Error(`RIDB media ${facilityId}: exhausted retries`);
}

type Row = { master_place_id: string; place_name: string; external_id: string; facilityId: string | null };

async function enumerateTargets(db: SupabaseClient): Promise<Row[]> {
  const camps = await pageAll<{ id: string; canonical_name: string }>((f, t) =>
    db.from("master_place").select("id,canonical_name").eq("primary_category", "campground").eq("state", "CA").order("id").range(f, t));
  const campIds = new Set(camps.map((c) => c.id));
  const nameById = new Map(camps.map((c) => [c.id, c.canonical_name]));
  const ridbSR = await pageAll<{ id: string; master_place_id: string; external_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id,external_id").eq("source_id", "ridb").order("id").range(f, t));
  const ridbExtByMp = new Map<string, string>();
  for (const s of ridbSR) if (campIds.has(s.master_place_id)) ridbExtByMp.set(s.master_place_id, s.external_id);
  const photoSR = await pageAll<{ id: string; master_place_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id").in("source_id", PHOTO_SOURCES).not("normalized_payload->photo->>url", "is", null).order("id").range(f, t));
  const hasPhoto = new Set(photoSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));
  const gSR = await pageAll<{ id: string; master_place_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id").in("source_id", ["google", "google_resolved"]).order("id").range(f, t));
  const hasGoogle = new Set(gSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));
  const out: Row[] = [];
  for (const [mpId, ext] of ridbExtByMp) {
    if (hasPhoto.has(mpId) || hasGoogle.has(mpId)) continue;
    const m = /^ridb:facility:(.+)$/.exec(ext);
    out.push({ master_place_id: mpId, place_name: nameById.get(mpId) ?? "", external_id: ext, facilityId: m ? m[1] : null });
  }
  return out;
}

async function main(): Promise<void> {
  const program = new Command();
  program.option("--dry-run", "Preview only; no writes.").option("--limit <n>", "Max targets.", parseInt).option("--confirm", "Required for PRODUCTION.").parse(process.argv);
  const opts = program.opts<{ dryRun?: boolean; limit?: number; confirm?: boolean }>();
  const db = getDb();
  const ref = targetRef();
  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) { logger.error({ target: ref }, "refusing PRODUCTION without --confirm"); process.exitCode = 1; return; }
  const apply = !opts.dryRun;
  console.log(`Target: ${ref}${ref === PROD_REF ? " ** PROD **" : " (test)"} | apply=${apply} | pilot_run=${PILOT_RUN}`);

  let targets = await enumerateTargets(db);
  if (opts.limit) targets = targets.slice(0, opts.limit);
  const withId = targets.filter((t) => t.facilityId).length;
  console.log(`Target set (ridb-sourced CA campground, zero photo coverage): ${targets.length}`);
  console.log(`  matched by structured id (ridb:facility:<id>): ${withId} | needing name/geo fallback: ${targets.length - withId}`);
  if (targets.length === 0) return;

  const stat = { accepted: 0, manualReview: 0, noCandidate: 0, staleId: 0, noMedia: 0, allNonPhoto: 0, errors: 0, fallbackNeeded: targets.length - withId };
  const rows: Record<string, unknown>[] = [];
  const acceptedSamples: string[] = [];
  const manualSamples: string[] = [];

  for (const batch of chunk(targets, CONCURRENCY)) {
    await Promise.all(batch.map(async (t) => {
      let match_status: string, image_url: string | null = null, source_page_url: string | null = null;
      let license: string | null = null, license_class: string | null = null, attribution: string | null = null, title: string | null = null, reason: string;
      const matchedVia = t.facilityId ? "structured_id" : "fallback_needed";
      try {
        if (!t.facilityId) {
          match_status = "no_candidate"; reason = `no structured RIDB facility id (${t.external_id}); name/geo fallback not attempted`; stat.noCandidate++;
        } else {
          const media = await fetchFacilityMedia(t.facilityId);
          if (media === null) {
            match_status = "no_candidate"; reason = `RIDB facility ${t.facilityId} media endpoint returned 404 (FacilityID stale/removed upstream)`; stat.noCandidate++; stat.staleId++;
          } else {
            // RIDB extension to the non-photo filter: keep only image MediaType, then pickPhoto (maps/signs/logos).
            const images = media.filter((m) => (m.MediaType ?? "").toLowerCase() === "image" && m.URL);
            const usable = images.filter((m) => pickPhoto([{ url: m.URL!, title: m.Title ?? null, credit: m.Credits ?? null, altText: null, caption: null }]) !== null);
            if (usable.length === 0) {
              match_status = "no_candidate";
              if (media.length === 0) { reason = `RIDB facility ${t.facilityId} resolved but has no media`; stat.noMedia++; }
              else { reason = `RIDB facility ${t.facilityId} has ${media.length} media item(s) but none usable as a photo (non-image types or maps/signs)`; stat.allNonPhoto++; }
              stat.noCandidate++;
            } else {
              const primaryFirst = [...usable].sort((a, b) => (String(b.IsPrimary) === "true" ? 1 : 0) - (String(a.IsPrimary) === "true" ? 1 : 0));
              const clear = primaryFirst.find((m) => classifyRights(m.Credits).clear);
              const chosen = clear ?? primaryFirst[0];
              const rights = classifyRights(chosen.Credits);
              image_url = chosen.URL!;
              source_page_url = `https://www.recreation.gov/camping/campgrounds/${t.facilityId}`;
              attribution = (chosen.Credits ?? "").trim() || null;
              title = chosen.Title ?? null;
              if (rights.clear) {
                match_status = "accepted"; license = "Public domain (U.S. Government work, via recreation.gov/RIDB)"; license_class = "public_domain";
                reason = `RIDB first-party image; ${rights.note}`; stat.accepted++;
                if (acceptedSamples.length < 8) acceptedSamples.push(`  [accepted] "${t.place_name}" (facility ${t.facilityId})\n      ${image_url}\n      credit=${attribution ?? "(none)"} | ${rights.note}`);
              } else {
                match_status = "manual_review"; license = null; license_class = null;
                reason = `RIDB image found but ${rights.note}`; stat.manualReview++;
                if (manualSamples.length < 8) manualSamples.push(`  [manual_review] "${t.place_name}" (facility ${t.facilityId})\n      ${image_url}\n      credit=${attribution ?? "(none)"} | ${rights.note}`);
              }
            }
          }
        }
      } catch (err) {
        stat.errors++; match_status = "no_candidate"; reason = `error: ${String((err as Error)?.message ?? err).slice(0, 200)}`; stat.noCandidate++;
        logger.warn({ err, place: t.place_name }, "ridb verify error");
      }
      rows.push({
        master_place_id: t.master_place_id, source: "ridb", image_url, thumb_url: null, source_page_url,
        license, license_class, attribution, title, match_status,
        match_confidence: match_status === "accepted" ? 1 : match_status === "manual_review" ? 0.5 : null,
        name_score: t.facilityId ? 1 : null, distance_m: null,
        match_reason: `[ridb-direct via ${matchedVia}] ${reason}`,
        place_name: t.place_name, primary_category: "campground", pilot_run: PILOT_RUN,
        raw: { external_id: t.external_id, facilityId: t.facilityId, matchedVia },
      });
    }));
    process.stderr.write(`  ${rows.length}/${targets.length} acc=${stat.accepted} manual=${stat.manualReview} noCand=${stat.noCandidate}(stale=${stat.staleId},noMedia=${stat.noMedia}) err=${stat.errors}\n`);
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log(`\nRows to write: ${rows.length}`);
  if (apply) {
    const ids = targets.map((t) => t.master_place_id);
    for (const c of chunk(ids, 200)) {
      const del = await db.from("master_place_photo_candidate").delete().eq("pilot_run", PILOT_RUN).in("master_place_id", c);
      if (del.error) { logger.error({ err: del.error }, "delete prior failed"); throw new Error("delete failed"); }
    }
    for (const c of chunk(rows, 200)) {
      const ins = await db.from("master_place_photo_candidate").insert(c);
      if (ins.error) { logger.error({ err: ins.error }, "insert failed"); throw new Error("insert failed"); }
    }
    console.log(`Wrote ${rows.length} rows (pilot_run=${PILOT_RUN}).`);
  } else console.log("(dry-run: no rows written)");

  console.log("\n=== RIDB-DIRECT RESULT ===");
  console.log(JSON.stringify({ target: ref, pilotRun: PILOT_RUN, apply, targets: targets.length, matchedByStructuredId: withId, ...stat }, null, 2));
  console.log("\n=== ACCEPTED SAMPLES ===");
  for (const s of acceptedSamples) console.log(s);
  console.log("\n=== MANUAL_REVIEW SAMPLES ===");
  for (const s of manualSamples) console.log(s);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { logger.error({ err }, "photo-ridb-direct: fatal"); process.exit(1); });
}
