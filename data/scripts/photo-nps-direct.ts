/**
 * NPS-direct photo pull for NPS-sourced CA campgrounds with no baked photo.
 *
 * Matches each target master_place to its NPS unit by the STRUCTURED id captured
 * at ingestion (source_record.external_id = 'nps:campground:<id>') — no name/geo
 * fuzzy matching. Pulls the unit's `images` from the NPS API, filters non-photos
 * with pickPhoto (fix #4), and since NPS is first-party / U.S.-government public
 * domain, accepts a usable image DIRECTLY (no Google cross-check, no
 * manual_review). Outcomes with no usable image are recorded as 'no_candidate'
 * with a reason (never silently skipped):
 *   - the matched unit's images are all non-photo (maps/signs/logos), or
 *   - the structured id no longer resolves in the current NPS API.
 *
 * NOT wired into rendering. Auth: TEST Supabase + NPS_API_KEY from data/.env.
 *
 * Run (TEST):
 *   npm run -w data backfill:photo-nps -- --dry-run
 *   npm run -w data backfill:photo-nps
 */

import { Command } from "commander";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";
import { pickPhoto } from "../photo-backfill/nps-photos.ts";

const PROD_REF = "nqzeywzcowujzyegxbsr";
const PHOTO_SOURCES = ["nps", "ridb", "wikipedia", "atlas_oddities", "family_destinations", "editorial_food"];
const PILOT_RUN = "nps-direct-2026-09-01";
const UA = "overlander-data-photo-pilot/0.1 (adam@acwcreative.com)";

function targetRef(): string {
  return (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
}
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

type NpsImage = { url?: string; credit?: string | null; title?: string | null; altText?: string | null; caption?: string | null };
type NpsCg = { id: string; name: string; url?: string | null; images?: NpsImage[] };

/** Index ALL CA NPS campgrounds by id (no image filter — need to tell "found, no usable photo" from "not found"). */
async function fetchNpsCaById(): Promise<Map<string, NpsCg>> {
  const key = process.env.NPS_API_KEY;
  if (!key) throw new Error("NPS_API_KEY is not set");
  const map = new Map<string, NpsCg>();
  const size = 50;
  for (let start = 0; ; start += size) {
    const u = new URL("https://developer.nps.gov/api/v1/campgrounds");
    u.searchParams.set("stateCode", "CA");
    u.searchParams.set("limit", String(size));
    u.searchParams.set("start", String(start));
    u.searchParams.set("api_key", key);
    const r = await fetch(u.toString(), { headers: { Accept: "application/json", "User-Agent": UA } });
    if (!r.ok) throw new Error(`NPS campgrounds ${r.status}`);
    const j = (await r.json()) as { data?: NpsCg[] };
    const rows = j.data ?? [];
    for (const c of rows) if (c.id) map.set(c.id, c);
    if (rows.length < size) break;
  }
  return map;
}

type Row = {
  master_place_id: string;
  place_name: string;
  external_id: string;
  campId: string | null;
};

async function enumerateTargets(db: SupabaseClient): Promise<Row[]> {
  const camps = await pageAll<{ id: string; canonical_name: string }>((f, t) =>
    db.from("master_place").select("id,canonical_name").eq("primary_category", "campground").eq("state", "CA").order("id").range(f, t),
  );
  const campIds = new Set(camps.map((c) => c.id));
  const nameById = new Map(camps.map((c) => [c.id, c.canonical_name]));

  const npsSR = await pageAll<{ id: string; master_place_id: string; external_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id,external_id").eq("source_id", "nps").order("id").range(f, t),
  );
  const npsExtByMp = new Map<string, string>();
  for (const s of npsSR) if (campIds.has(s.master_place_id)) npsExtByMp.set(s.master_place_id, s.external_id);

  const photoSR = await pageAll<{ id: string; master_place_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id").in("source_id", PHOTO_SOURCES).not("normalized_payload->photo->>url", "is", null).order("id").range(f, t),
  );
  const hasPhoto = new Set(photoSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));
  const gSR = await pageAll<{ id: string; master_place_id: string }>((f, t) =>
    db.from("source_record").select("id,master_place_id").in("source_id", ["google", "google_resolved"]).order("id").range(f, t),
  );
  const hasGoogle = new Set(gSR.map((s) => s.master_place_id).filter((id) => campIds.has(id)));

  const out: Row[] = [];
  for (const [mpId, ext] of npsExtByMp) {
    if (hasPhoto.has(mpId) || hasGoogle.has(mpId)) continue;
    const m = /^nps:campground:(.+)$/.exec(ext);
    out.push({ master_place_id: mpId, place_name: nameById.get(mpId) ?? "", external_id: ext, campId: m ? m[1] : null });
  }
  return out;
}

async function main(): Promise<void> {
  const program = new Command();
  program
    .option("--dry-run", "Preview only; no writes.")
    .option("--confirm", "Required for PRODUCTION.")
    .parse(process.argv);
  const opts = program.opts<{ dryRun?: boolean; confirm?: boolean }>();

  const db = getDb();
  const ref = targetRef();
  if (!opts.dryRun && ref === PROD_REF && !opts.confirm) {
    logger.error({ target: ref }, "refusing PRODUCTION without --confirm");
    process.exitCode = 1; return;
  }
  const apply = !opts.dryRun;
  console.log(`Target: ${ref}${ref === PROD_REF ? " ** PROD **" : " (test)"} | apply=${apply} | pilot_run=${PILOT_RUN}`);

  const targets = await enumerateTargets(db);
  console.log(`Target set (nps-sourced CA campground, zero photo coverage): ${targets.length}`);
  const withId = targets.filter((t) => t.campId).length;
  console.log(`  matched by structured id (nps:campground:<id>): ${withId} | needing name/geo fallback: ${targets.length - withId}`);
  if (targets.length === 0) return;

  const npsIndex = await fetchNpsCaById();
  console.log(`  NPS CA campgrounds indexed by id: ${npsIndex.size}`);

  const stat = { accepted: 0, noCandidate: 0, fallbackNeeded: 0 };
  const rows: Record<string, unknown>[] = [];
  const samples: string[] = [];

  for (const t of targets) {
    let matchedVia = "structured_id";
    if (!t.campId) {
      // No structured id — task says fall back to name/geo only here. Flagged, not attempted
      // (there are none in the current target set; kept explicit for the general case).
      matchedVia = "fallback_needed";
      stat.fallbackNeeded++;
    }
    const cg = t.campId ? npsIndex.get(t.campId) : undefined;

    let match_status: string;
    let image_url: string | null = null;
    let source_page_url: string | null = null;
    let license: string | null = null;
    let attribution: string | null = null;
    let title: string | null = null;
    let reason: string;

    if (!cg) {
      match_status = "no_candidate";
      reason = t.campId
        ? `structured NPS id ${t.campId} not found in current NPS API CA listing (unit removed/renamed upstream since ingestion)`
        : `no structured NPS campground id on source_record (${t.external_id}); name/geo fallback not attempted`;
      stat.noCandidate++;
    } else {
      const photo = pickPhoto((cg.images ?? []) as Parameters<typeof pickPhoto>[0]);
      if (!photo?.url) {
        match_status = "no_candidate";
        reason = `NPS unit "${cg.name}" found but all ${(cg.images ?? []).length} image(s) filtered as non-photo (maps/signs/logos)`;
        stat.noCandidate++;
      } else {
        match_status = "accepted";
        image_url = photo.url;
        source_page_url = cg.url ?? null;
        const credit = (photo.credit ?? "").trim();
        // NPS content is a U.S. Government work → public domain. A credit line, if
        // present, is recorded as attribution (NPS often credits "NPS" or "NPS/Name").
        license = "Public domain (U.S. Government work, NPS)";
        attribution = credit.length > 0 ? credit : null;
        title = photo.title ?? photo.altText ?? null;
        reason = `NPS first-party image (unit "${cg.name}"), accepted directly; credit=${credit || "(none)"}`;
        stat.accepted++;
        if (samples.length < 10) samples.push(`  [accepted] "${t.place_name}" ← ${cg.name}\n      ${image_url}\n      license=${license} | attribution=${attribution ?? "(none)"} | page=${source_page_url ?? "(none)"}`);
      }
    }

    if (samples.length < 10 && match_status === "no_candidate") samples.push(`  [no_candidate] "${t.place_name}" (id=${t.campId ?? "none"}, via=${matchedVia})\n      ${reason}`);

    rows.push({
      master_place_id: t.master_place_id,
      source: "nps",
      image_url,
      thumb_url: null,
      source_page_url,
      license,
      license_class: match_status === "accepted" ? "public_domain" : null,
      attribution,
      title,
      match_status,
      match_confidence: match_status === "accepted" ? 1 : null,
      name_score: t.campId ? 1 : null, // exact structured-id match
      distance_m: null,
      match_reason: `[nps-direct via ${matchedVia}] ${reason}`,
      place_name: t.place_name,
      primary_category: "campground",
      pilot_run: PILOT_RUN,
      raw: { external_id: t.external_id, campId: t.campId, matchedVia, npsUnitName: cg?.name ?? null },
    });
  }

  console.log(`\nRows to write: ${rows.length}`);
  if (apply) {
    // idempotent re-run: clear any prior nps-direct rows for these places
    const ids = targets.map((t) => t.master_place_id);
    const del = await db.from("master_place_photo_candidate").delete().eq("pilot_run", PILOT_RUN).in("master_place_id", ids);
    if (del.error) { logger.error({ err: del.error }, "delete prior nps-direct rows failed"); throw new Error("delete failed"); }
    const ins = await db.from("master_place_photo_candidate").insert(rows);
    if (ins.error) { logger.error({ err: ins.error }, "insert failed"); throw new Error("insert failed"); }
    console.log(`Wrote ${rows.length} rows (pilot_run=${PILOT_RUN}).`);
  } else {
    console.log("(dry-run: no rows written)");
  }

  console.log("\n=== NPS-DIRECT RESULT ===");
  console.log(JSON.stringify({ target: ref, pilotRun: PILOT_RUN, apply, targets: targets.length, matchedByStructuredId: withId, ...stat }, null, 2));
  console.log("\n=== SAMPLES ===");
  for (const s of samples) console.log(s);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { logger.error({ err }, "photo-nps-direct: fatal"); process.exit(1); });
}
