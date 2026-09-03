/**
 * READ-ONLY investigation of cross-source duplicate master_places surfaced by
 * the six-state visitor-content promotion.
 *
 * A "pair" is: a master_place linked to one of the six state-park visitor
 * sources, and a DIFFERENT master_place within `RADIUS_M` whose canonical_name
 * normalises to something highly similar — i.e. probably the same physical
 * place, split across sources.
 *
 * Writes nothing. Reads TEST from data/.env and PROD from web/.env.local.
 *
 * TWO measures are reported, because the original per-state figure used a
 * narrower filter and comparing like-for-like matters:
 *   NARROW — candidate's primary_category in {oddity, park_feature}. This
 *            reproduces the method behind the "78 pairs" figure.
 *   BROAD  — any category. Catches OSM/RIDB/NPS collisions the narrow filter
 *            misses, which is the actual population of interest.
 *
 * Usage:
 *   npx tsx data/scripts/crosssource-duplicate-investigation.ts [--prod] [--csv]
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import natural from "natural";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findCandidates, normalizeName } from "../entity-resolution/matcher.ts";

const jaroWinkler = natural.JaroWinklerDistance;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

const RADIUS_M = 3000;
const NAME_FLOOR = 0.85;
const NARROW_CATEGORIES = new Set(["oddity", "park_feature"]);

const STATES = [
  { code: "CA", source: "california_state_parks" },
  { code: "WA", source: "washington_state_parks" },
  { code: "OR", source: "oregon_state_parks" },
  { code: "NV", source: "nevada_state_parks" },
  { code: "AZ", source: "arizona_state_parks" },
  { code: "UT", source: "utah_state_parks" },
] as const;

interface Side {
  id: string;
  name: string;
  category: string;
  sourceCount: number;
  searchable: boolean;
  hasDescription: boolean;
  descLen: number;
  hasPhoto: boolean;
  photoHost: string | null;
  sources: string[];
}

interface Pair {
  state: string;
  sourceExternalId: string;
  sourceName: string;
  visitor: Side;
  other: Side;
  distanceM: number;
  nameSim: number;
  narrow: boolean;
  /** Content shape — drives the merge category. */
  contentClass: "other_only" | "visitor_only" | "both" | "neither";
  /** Name identical after normalisation, or merely similar. */
  nameClass: "identical" | "similar";
}

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

/** Hydrate a master_place into a Side, including whether it has renderable content. */
async function hydrate(db: SupabaseClient, id: string, exportPhoto: Map<string, string | null>): Promise<Side> {
  const mp = await db
    .from("master_place")
    .select("id,canonical_name,primary_category,source_count,is_searchable,description")
    .eq("id", id)
    .single();
  if (mp.error || mp.data == null) throw new Error(`QUERY FAILED [master_place ${id}]: ${JSON.stringify(mp.error)}`);
  const back = await db.from("source_record").select("source_id").eq("master_place_id", id);
  if (back.error) throw new Error(`QUERY FAILED [backing ${id}]: ${JSON.stringify(back.error)}`);
  const desc = typeof mp.data.description === "string" ? mp.data.description : "";
  const photo = exportPhoto.get(id) ?? null;
  return {
    id,
    name: String(mp.data.canonical_name ?? ""),
    category: String(mp.data.primary_category ?? ""),
    sourceCount: typeof mp.data.source_count === "number" ? mp.data.source_count : 0,
    searchable: mp.data.is_searchable === true,
    hasDescription: desc.trim().length > 0,
    descLen: desc.length,
    hasPhoto: photo != null,
    photoHost: photo ? new URL(photo).hostname : null,
    sources: [...new Set((back.data ?? []).map((x) => String(x.source_id)))].sort(),
  };
}

async function derivePairs(db: SupabaseClient): Promise<Pair[]> {
  // Photo comes from the export view's lateral join, not master_place.photo_url
  // (the column is not the surface that renders — a correction made 2026-09-02).
  const exportPhoto = new Map<string, string | null>();
  for (let off = 0; ; off += 1000) {
    const r = await db.from("master_place_search_export").select("id,photo_url").order("id").range(off, off + 999);
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [export]: ${JSON.stringify(r.error)}`);
    for (const x of r.data) exportPhoto.set(String(x.id), typeof x.photo_url === "string" ? x.photo_url : null);
    if (r.data.length < 1000) break;
  }

  const pairs: Pair[] = [];
  const seen = new Set<string>();
  for (const st of STATES) {
    const srs: { id: string; name: string; ext: string; mp: string }[] = [];
    for (let off = 0; ; off += 1000) {
      const r = await db
        .from("source_record")
        .select("id,name,external_id,master_place_id")
        .eq("source_id", st.source)
        .not("master_place_id", "is", null)
        .order("id")
        .range(off, off + 999);
      if (r.error || r.data == null) throw new Error(`QUERY FAILED [${st.source}]: ${JSON.stringify(r.error)}`);
      for (const x of r.data) {
        srs.push({ id: String(x.id), name: String(x.name), ext: String(x.external_id), mp: String(x.master_place_id) });
      }
      if (r.data.length < 1000) break;
    }

    for (const sr of srs) {
      let cands;
      try {
        cands = await findCandidates(sr.id, RADIUS_M);
      } catch {
        continue;
      }
      for (const c of cands) {
        if (c.id === sr.mp) continue;
        const sim = jaroWinkler(normalizeName(sr.name), normalizeName(c.canonical_name));
        if (sim < NAME_FLOOR) continue;
        const key = [sr.mp, c.id].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        const visitor = await hydrate(db, sr.mp, exportPhoto);
        const other = await hydrate(db, c.id, exportPhoto);
        const vHas = visitor.hasDescription || visitor.hasPhoto;
        const oHas = other.hasDescription || other.hasPhoto;
        pairs.push({
          state: st.code,
          sourceExternalId: sr.ext,
          sourceName: sr.name,
          visitor,
          other,
          distanceM: c.distance_m,
          nameSim: sim,
          narrow: NARROW_CATEGORIES.has(other.category),
          contentClass: vHas && oHas ? "both" : vHas ? "visitor_only" : oHas ? "other_only" : "neither",
          nameClass: sim >= 0.999 ? "identical" : "similar",
        });
      }
    }
  }
  return pairs;
}

function report(label: string, pairs: Pair[], csv: boolean): void {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  const narrow = pairs.filter((p) => p.narrow);
  console.log(`  BROAD  (any category) : ${pairs.length} pairs`);
  console.log(`  NARROW (oddity/park_feature only — reproduces the "78" method) : ${narrow.length} pairs`);

  console.log(`\n  by state (count, per the standing "weigh count over rate" note):`);
  for (const st of STATES) {
    const b = pairs.filter((p) => p.state === st.code).length;
    const n = narrow.filter((p) => p.state === st.code).length;
    console.log(`     ${st.code}  broad ${String(b).padStart(3)}   narrow ${String(n).padStart(3)}`);
  }

  const tally = (key: (p: Pair) => string) => {
    const m = new Map<string, number>();
    for (const p of pairs) m.set(key(p), (m.get(key(p)) ?? 0) + 1);
    return Object.fromEntries([...m].sort((a, b) => b[1] - a[1]));
  };
  console.log(`\n  CATEGORY 1 — content shape (which side has description/photo):`);
  console.log(`     ${JSON.stringify(tally((p) => p.contentClass))}`);
  console.log(`  CATEGORY 2 — name match:`);
  console.log(`     ${JSON.stringify(tally((p) => p.nameClass))}`);
  console.log(`  other side's primary_category:`);
  console.log(`     ${JSON.stringify(tally((p) => p.other.category))}`);
  console.log(`  other side's backing sources:`);
  console.log(`     ${JSON.stringify(tally((p) => p.other.sources.join("+") || "(none)"))}`);

  console.log(`\n  CANONICAL-SOURCE PATTERN — is the visitor side the richer one?`);
  const richer = pairs.filter((p) => p.visitor.sourceCount > p.other.sourceCount).length;
  const equal = pairs.filter((p) => p.visitor.sourceCount === p.other.sourceCount).length;
  const poorer = pairs.filter((p) => p.visitor.sourceCount < p.other.sourceCount).length;
  console.log(`     visitor side has MORE sources : ${richer}`);
  console.log(`     equal                          : ${equal}`);
  console.log(`     visitor side has FEWER sources : ${poorer}`);
  const vDesc = pairs.filter((p) => p.visitor.hasDescription).length;
  const oDesc = pairs.filter((p) => p.other.hasDescription).length;
  const vPhoto = pairs.filter((p) => p.visitor.hasPhoto).length;
  const oPhoto = pairs.filter((p) => p.other.hasPhoto).length;
  console.log(`     visitor has description ${vDesc}/${pairs.length} · other has description ${oDesc}/${pairs.length}`);
  console.log(`     visitor has photo       ${vPhoto}/${pairs.length} · other has photo       ${oPhoto}/${pairs.length}`);

  console.log(`\n  ⚠️ FLAGGED — merging may be WRONG (name similar but not identical):`);
  const flagged = pairs.filter((p) => p.nameClass === "similar");
  console.log(`     ${flagged.length} pairs`);
  for (const p of flagged.slice(0, 15)) {
    console.log(`        ${p.state} "${p.sourceName}" ↔ "${p.other.name}" [${p.other.category}] sim=${p.nameSim.toFixed(3)} ${p.distanceM.toFixed(0)}m`);
  }

  if (csv) {
    console.log(`\n  FULL PAIR LIST (csv)`);
    console.log("state,source_external_id,source_name,visitor_mp,visitor_name,visitor_cat,visitor_srcs,visitor_desc,visitor_photo,other_mp,other_name,other_cat,other_srcs,other_desc,other_photo,dist_m,name_sim,name_class,content_class,narrow");
    for (const p of pairs) {
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      console.log([
        p.state, q(p.sourceExternalId), q(p.sourceName),
        p.visitor.id.slice(0, 8), q(p.visitor.name), p.visitor.category, q(p.visitor.sources.join("+")),
        p.visitor.descLen, p.visitor.photoHost ?? "",
        p.other.id.slice(0, 8), q(p.other.name), p.other.category, q(p.other.sources.join("+")),
        p.other.descLen, p.other.photoHost ?? "",
        p.distanceM.toFixed(0), p.nameSim.toFixed(3), p.nameClass, p.contentClass, p.narrow,
      ].join(","));
    }
  }
}

async function main(): Promise<void> {
  const csv = process.argv.includes("--csv");
  const wantProd = process.argv.includes("--prod");
  const env = parseEnvFile(join(REPO, wantProd ? "web/.env.local" : "data/.env"));
  const url = wantProd ? env.NEXT_PUBLIC_SUPABASE_URL : env.SUPABASE_URL;
  const expect = wantProd ? PROD_HOST : TEST_HOST;
  if (!url.includes(expect)) throw new Error(`refusing — resolved url ${url} is not ${expect}`);

  // findCandidates() uses the module-level client in matcher.ts, which reads
  // process.env — so point it at the same database we are reporting on.
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const label = wantProd ? `PROD (${PROD_HOST})` : `TEST (${TEST_HOST})`;
  report(label, await derivePairs(db), csv);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
