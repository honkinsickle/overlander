/**
 * READ-ONLY simulation: what would the patched matcher do with PROD's 43
 * self-created duplicate pairs?
 *
 * Writes nothing. Applies nothing. Reads PROD via web/.env.local.
 *
 * `matchOne` throws on an already-linked source_record, and all 43 are linked,
 * so the decision waterfall is replicated here rather than invoked. To keep that
 * replication honest it is VALIDATED FIRST: run with the pre-patch scoring and
 * no rescue, and check it reproduces the known ground truth (all 43 became
 * `new_master_place`). Only if the replay matches is the "after" prediction
 * trusted — the same discipline used for the source_id rename tie-break sim.
 *
 * Two simplifications, both stated rather than hidden:
 *   1. The visitor record's OWN master_place is excluded from candidates. It did
 *      not exist when the decision was made; leaving it in would let a record
 *      match itself.
 *   2. Other records' new master_places DO exist now and did not then, so the
 *      candidate pool is not a perfect replay of ER-time state. Effects are
 *      reported, not assumed away.
 *
 * Steps 1 (fed_exact) is skipped: `findFederalAnchor` returns null unless
 * source_id is `nps` or `ridb`, so it cannot fire for a state-park source.
 *
 * Usage: npx tsx data/scripts/prod-matcher-fix-impact-sim.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import natural from "natural";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AMENITY_TYPES,
  CATEGORY_COMPATIBILITY,
  NAME_DOMINANT_CONFIDENCE_FLOOR,
  WIDE_RESCUE_CAT_FLOOR,
  WIDE_RESCUE_NAME_FLOOR,
  WIDE_RESCUE_RADIUS_M,
  findCandidates,
  isLinkingBarred,
  lookupCompatibility,
  normalizeName,
  type MasterPlaceCandidate,
} from "../entity-resolution/matcher.ts";

const jaroWinkler = natural.JaroWinklerDistance;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

const SOURCES = [
  "california_state_parks",
  "washington_state_parks",
  "oregon_state_parks",
  "nevada_state_parks",
  "arizona_state_parks",
  "utah_state_parks",
] as const;

type Kind = "auto_link" | "manual_review" | "new_master_place" | "amenity_rollup";
interface Decision {
  kind: Kind;
  method: string;
  target?: string;
  targetName?: string;
  confidence?: number;
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

/** Pre-patch lookup: no self-pair rule, `viewpoint` self-only. */
function oldLookup(a: string | null, b: string | null): number {
  if (!a || !b) return 0;
  const tbl = JSON.parse(JSON.stringify(CATEGORY_COMPATIBILITY)) as Record<string, Record<string, number>>;
  tbl.viewpoint = { viewpoint: 1.0 };
  return tbl[a]?.[b] ?? tbl[b]?.[a] ?? 0;
}

/** scoreMatch's formula, with the compat function swapped for before/after. */
function score(
  srName: string,
  srCat: string | null,
  c: MasterPlaceCandidate,
  compat: (a: string | null, b: string | null) => number,
) {
  const name_similarity = jaroWinkler(normalizeName(srName), normalizeName(c.canonical_name));
  const category_compatibility = compat(srCat, c.primary_category);
  const distance_score = 1 - Math.min(c.distance_m, 100) / 100;
  return {
    distance_meters: c.distance_m,
    name_similarity,
    category_compatibility,
    combined_confidence: 0.4 * distance_score + 0.4 * name_similarity + 0.2 * category_compatibility,
  };
}

async function mpHasSource(db: SupabaseClient, mpId: string, sourceId: string): Promise<boolean> {
  const r = await db
    .from("source_record")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mpId)
    .eq("source_id", sourceId);
  if (r.error || r.count == null) throw new Error(`QUERY FAILED [mpHasSource]: ${JSON.stringify(r)}`);
  return r.count > 0;
}

/** Replicates matchOne's rule order for a record, under a given scoring regime. */
async function decide(
  db: SupabaseClient,
  sr: { id: string; name: string; inferred_category: string | null; source_id: string; ownMp: string },
  patched: boolean,
): Promise<Decision> {
  const compat = patched ? lookupCompatibility : oldLookup;

  if (isLinkingBarred({ source_id: sr.source_id, inferred_category: sr.inferred_category })) {
    return { kind: "new_master_place", method: "linking_barred" };
  }
  // Step 1 fed_exact: cannot fire for a non-nps/ridb source.
  // Step 2 amenity_rollup:
  if (sr.inferred_category && (AMENITY_TYPES as readonly string[]).includes(sr.inferred_category)) {
    const parents = await findCandidates(sr.id, 100);
    const p = parents.filter((x) => x.id !== sr.ownMp);
    if (p.length > 0) return { kind: "amenity_rollup", method: "amenity_rollup", target: p[0].id };
  }

  let candidates = (await findCandidates(sr.id, 500)).filter((c) => c.id !== sr.ownMp);

  let rescued = false;
  if (candidates.length === 0 && patched) {
    const wide = (await findCandidates(sr.id, WIDE_RESCUE_RADIUS_M)).filter((c) => c.id !== sr.ownMp);
    candidates = wide.filter(
      (c) =>
        jaroWinkler(normalizeName(sr.name), normalizeName(c.canonical_name)) >= WIDE_RESCUE_NAME_FLOOR &&
        compat(sr.inferred_category, c.primary_category) >= WIDE_RESCUE_CAT_FLOOR,
    );
    if (candidates.length > 0) rescued = true;
  }
  if (candidates.length === 0) return { kind: "new_master_place", method: "no_candidates" };

  const scored = candidates.map((c) => ({ c, s: score(sr.name, sr.inferred_category, c, compat) }));

  // Step 2.5: rescued candidates route straight to manual_review.
  if (rescued) {
    let pick = scored[0];
    for (const x of scored) if (x.s.combined_confidence > pick.s.combined_confidence) pick = x;
    return {
      kind: "manual_review",
      method: "wide_rescue",
      target: pick.c.id,
      targetName: pick.c.canonical_name,
      confidence: pick.s.combined_confidence,
    };
  }

  // Step 3 name_dominant
  for (const { c, s } of scored) {
    if (s.distance_meters > 500) continue;
    if (s.name_similarity < 0.85) continue;
    if (s.category_compatibility < 0.8) continue;
    if (await mpHasSource(db, c.id, sr.source_id)) continue;
    const kind: Kind = s.combined_confidence < NAME_DOMINANT_CONFIDENCE_FLOOR ? "manual_review" : "auto_link";
    return {
      kind,
      method: kind === "auto_link" ? "name_dominant" : "name_dominant_low_conf",
      target: c.id,
      targetName: c.canonical_name,
      confidence: s.combined_confidence,
    };
  }
  // Step 4 close_nameless
  for (const { c, s } of scored) {
    if (s.distance_meters > 100) continue;
    if (s.name_similarity >= 0.85) continue;
    if (s.category_compatibility < 0.8) continue;
    if (await mpHasSource(db, c.id, sr.source_id)) continue;
    return { kind: "manual_review", method: "close_nameless", target: c.id, targetName: c.canonical_name, confidence: s.combined_confidence };
  }
  // Step 5 blended
  let best = scored[0];
  for (const x of scored) if (x.s.combined_confidence > best.s.combined_confidence) best = x;
  const conf = best.s.combined_confidence;
  if (conf >= 0.85) return { kind: "auto_link", method: "blended", target: best.c.id, targetName: best.c.canonical_name, confidence: conf };
  if (conf >= 0.6) return { kind: "manual_review", method: "blended_residual", target: best.c.id, targetName: best.c.canonical_name, confidence: conf };
  return { kind: "new_master_place", method: "blended_below_0.6", confidence: conf };
}

async function main(): Promise<void> {
  const env = parseEnvFile(join(REPO, "web", ".env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url.includes(PROD_HOST)) throw new Error(`refusing — ${url} is not PROD`);
  process.env.SUPABASE_URL = url;
  process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ── Step 1: re-derive the self-created duplicate list from PROD ──
  console.log("Re-deriving self-created duplicate pairs from PROD…\n");
  const cases: {
    id: string; name: string; inferred_category: string | null; source_id: string;
    ownMp: string; gisMp: string; gisName: string; dist: number; state: string;
  }[] = [];
  for (const s of SOURCES) {
    const srs = await db
      .from("source_record")
      .select("id,name,inferred_category,master_place_id")
      .eq("source_id", s)
      .not("master_place_id", "is", null);
    if (srs.error || srs.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(srs.error)}`);
    for (const sr of srs.data) {
      const mp = String(sr.master_place_id);
      const vb = await db.from("source_record").select("source_id").eq("master_place_id", mp);
      if (vb.error) throw new Error(`QUERY FAILED: ${JSON.stringify(vb.error)}`);
      const vSrcs = [...new Set((vb.data ?? []).map((x) => String(x.source_id)))];
      if (!(vSrcs.length === 1 && vSrcs[0] === s)) continue; // must be a phase-2 new_master_place
      let cands: MasterPlaceCandidate[];
      try { cands = await findCandidates(String(sr.id), 3000); } catch { continue; }
      for (const c of cands) {
        if (c.id === mp) continue;
        if (jaroWinkler(normalizeName(String(sr.name)), normalizeName(c.canonical_name)) < 0.999) continue;
        const ob = await db.from("source_record").select("source_id").eq("master_place_id", c.id);
        const oSrcs = [...new Set((ob.data ?? []).map((x) => String(x.source_id)))];
        if (!(oSrcs.includes("state_parks") && oSrcs.every((x) => ["state_parks", "wikipedia"].includes(x)))) continue;
        cases.push({
          id: String(sr.id), name: String(sr.name),
          inferred_category: sr.inferred_category as string | null,
          source_id: s, ownMp: mp, gisMp: c.id, gisName: c.canonical_name,
          dist: c.distance_m, state: s.slice(0, 2).toUpperCase(),
        });
        break;
      }
    }
  }
  console.log(`  self-created duplicate pairs found: ${cases.length}\n`);

  // ── Step 2: validate the replication against ground truth ──
  console.log("VALIDATING the replication — pre-patch regime must reproduce new_master_place for all of them:");
  let reproduced = 0;
  const misses: string[] = [];
  const before = new Map<string, Decision>();
  for (const c of cases) {
    const d = await decide(db, c, false);
    before.set(c.id, d);
    if (d.kind === "new_master_place") reproduced += 1;
    else if (misses.length < 8) misses.push(`     ${c.state} "${c.name}" → replay says ${d.kind}/${d.method}`);
  }
  console.log(`  reproduced new_master_place: ${reproduced}/${cases.length}`);
  for (const m of misses) console.log(m);
  console.log(
    `  VERDICT: ${reproduced === cases.length ? "replication matches ground truth — prediction is trustworthy" : "*** replication DIVERGES — treat the prediction below with caution ***"}\n`,
  );

  // ── Step 3: run the patched regime ──
  const tally = new Map<string, number>();
  const rows: string[] = [];
  for (const c of cases) {
    const after = await decide(db, c, true);
    const key = `${after.kind} / ${after.method}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    const linksToGis = after.target === c.gisMp;
    rows.push(
      `  ${c.state} ${c.name.slice(0, 44).padEnd(44)} ${c.dist.toFixed(0).padStart(5)}m  ${String(c.inferred_category).padEnd(15)} -> ${after.kind}/${after.method}${after.confidence != null ? ` (${after.confidence.toFixed(3)})` : ""}${after.target ? (linksToGis ? "  [to the GIS record]" : "  [to a DIFFERENT mp]") : ""}`,
    );
  }
  console.log("PATCHED OUTCOME per case:");
  for (const r of rows) console.log(r);
  console.log("\nTALLY:");
  for (const [k, v] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

  const auto = [...tally].filter(([k]) => k.startsWith("auto_link")).reduce((a, [, v]) => a + v, 0);
  const man = [...tally].filter(([k]) => k.startsWith("manual_review")).reduce((a, [, v]) => a + v, 0);
  const nmp = [...tally].filter(([k]) => k.startsWith("new_master_place")).reduce((a, [, v]) => a + v, 0);
  console.log(`\nSUMMARY of ${cases.length} cases under the patched matcher:`);
  console.log(`  auto_link (resolved automatically)      : ${auto}`);
  console.log(`  manual_review (surfaced, not silent)    : ${man}`);
  console.log(`  new_master_place (still unresolved)     : ${nmp}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
