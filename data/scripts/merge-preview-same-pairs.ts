/**
 * READ-ONLY dry-run merge preview for the SAME-bucket duplicate pairs surfaced
 * by the cross-source duplicate sort (see
 * docs/investigations/2026-09-02-cross-source-duplicates.md and its
 * subsequent sorting pass).
 *
 * For each pair the tool decides which side would be canonical (per the
 * state_parks-GIS-wins precedent established across CA/OR/NV), enumerates what
 * would need to move if the merge executed (source_records, place_relationships,
 * generated_content, photo_candidates), and surfaces any field-level conflict
 * between the two rows that a real merge would need a human decision on.
 *
 * WRITES NOTHING. Every query is a SELECT. The tool refuses to run with any
 * argument resembling `--apply`, `--write`, or `--execute`. Emits two files:
 *
 *   .context/merge-preview-136.csv   — one flat row per pair, spreadsheet-friendly
 *   .context/merge-preview-136.json  — full structured per-pair record
 *
 * Usage:
 *   npx tsx data/scripts/merge-preview-same-pairs.ts
 *       [--input .context/same-pairs-resolved.json]   # override input
 *       [--limit N]                                    # preview first N pairs
 *
 * Reads PROD from web/.env.local. Refuses to run against any other project.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

// Refuse write-flavoured arguments outright.
for (const arg of process.argv.slice(2)) {
  if (/^--(apply|write|execute|commit|run|do)$/i.test(arg)) {
    throw new Error(`refusing — this tool is preview-only. Argument ${arg} is not accepted.`);
  }
}

interface PairIn {
  state: string;
  visitor_mp_full: string;
  other_mp_full: string;
  visitor_mp: string;
  other_mp: string;
  visitor_name: string;
  other_name: string;
  visitor_cat: string;
  other_cat: string;
  visitor_srcs: string;
  other_srcs: string;
  dist_m: string;
  name_sim: string;
  name_class: string;
  content_class: string;
  reason?: string;
}

interface Side {
  id: string;
  canonical_name: string;
  primary_category: string;
  secondary_categories: string[] | null;
  overlander_tags: string[] | null;
  description: string | null;
  amenities: unknown;
  hours: unknown;
  contact: unknown;
  access: unknown;
  services: unknown;
  capacity: unknown;
  seasonality: unknown;
  cell_signal: unknown;
  attribution: Record<string, unknown> | null;
  prominence_score: number;
  source_count: number;
  is_searchable: boolean;
  rating: number | null;
  review_count: number | null;
  price_tier: number | null;
  photo_url: string | null;
  geometry_polygon: unknown;
  source_ids: string[]; // active backing sources
  source_record_ids: string[]; // active source_record ids pointing at this mp
  place_match_count: number;
  gen_content_count: number;
  photo_candidate_count: number;
  child_relationships: string[]; // parent mp_ids where this row is CHILD
  parent_relationships: string[]; // child mp_ids where this row is PARENT
}

interface Preview {
  pair_key: string;
  state: string;
  visitor: Side;
  other: Side;
  canonical_side: "visitor" | "other" | "either";
  canonical_reason: string;
  canonical_mp_id: string | null;
  absorbed_mp_id: string | null;
  moves: {
    source_records: number;
    place_matches_dropped_by_cascade: number;
    generated_content: number;
    photo_candidates: number;
    child_relationships: number;
    parent_relationships: number;
  };
  conflicts: string[]; // human-readable per-field conflict descriptions
  risks: string[]; // dry-run-execution risk flags
  original: PairIn;
}

// ---------- env / client ----------

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

function makeClient(): SupabaseClient {
  const env = parseEnvFile(join(REPO, "web/.env.local"));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !url.includes(PROD_HOST)) {
    throw new Error(`refusing — resolved url ${url} is not PROD (${PROD_HOST})`);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ---------- inputs ----------

function readInput(path: string): PairIn[] {
  if (!existsSync(path)) {
    throw new Error(
      `input file not found: ${path}\n` +
        `Provide via --input or produce one with the sort script + prefix-resolver.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("input must be an array");
  const pairs = (raw as PairIn[]).filter(
    (r) => r.visitor_mp_full && r.other_mp_full,
  );
  return pairs;
}

// ---------- data hydration ----------

async function hydrate(db: SupabaseClient, mp_id: string): Promise<Side> {
  const mp = await db
    .from("master_place")
    .select(
      "id,canonical_name,primary_category,secondary_categories,overlander_tags,description,amenities,hours,contact,access,services,capacity,seasonality,cell_signal,attribution,prominence_score,source_count,is_searchable,rating,review_count,price_tier,photo_url,geometry_polygon",
    )
    .eq("id", mp_id)
    .maybeSingle();
  if (mp.error || mp.data == null) {
    throw new Error(
      `QUERY FAILED [master_place ${mp_id}]: ${JSON.stringify(mp.error)}`,
    );
  }

  const sr = await db
    .from("source_record")
    .select("id,source_id,is_active")
    .eq("master_place_id", mp_id);
  if (sr.error || sr.data == null) {
    throw new Error(`QUERY FAILED [source_record ${mp_id}]: ${JSON.stringify(sr.error)}`);
  }
  const active = (sr.data ?? []).filter((x) => x.is_active !== false);

  const pm = await db
    .from("place_match")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mp_id);
  const pm_count = pm.count ?? 0;

  const gc = await db
    .from("master_place_generated_content")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mp_id);
  const gc_count = gc.count ?? 0;

  const pc = await db
    .from("master_place_photo_candidate")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mp_id);
  const pc_count = pc.count ?? 0;

  const rel_child = await db
    .from("place_relationships")
    .select("parent_master_place_id")
    .eq("child_master_place_id", mp_id);
  const rel_parent = await db
    .from("place_relationships")
    .select("child_master_place_id")
    .eq("parent_master_place_id", mp_id);

  return {
    id: String(mp.data.id),
    canonical_name: String(mp.data.canonical_name ?? ""),
    primary_category: String(mp.data.primary_category ?? ""),
    secondary_categories: (mp.data.secondary_categories as string[] | null) ?? null,
    overlander_tags: (mp.data.overlander_tags as string[] | null) ?? null,
    description: (mp.data.description as string | null) ?? null,
    amenities: mp.data.amenities,
    hours: mp.data.hours,
    contact: mp.data.contact,
    access: mp.data.access,
    services: mp.data.services,
    capacity: mp.data.capacity,
    seasonality: mp.data.seasonality,
    cell_signal: mp.data.cell_signal,
    attribution: (mp.data.attribution as Record<string, unknown>) ?? null,
    prominence_score: Number(mp.data.prominence_score ?? 0),
    source_count: Number(mp.data.source_count ?? 0),
    is_searchable: mp.data.is_searchable === true,
    rating: (mp.data.rating as number | null) ?? null,
    review_count: (mp.data.review_count as number | null) ?? null,
    price_tier: (mp.data.price_tier as number | null) ?? null,
    photo_url: (mp.data.photo_url as string | null) ?? null,
    geometry_polygon: mp.data.geometry_polygon,
    source_ids: [...new Set(active.map((x) => String(x.source_id)))].sort(),
    source_record_ids: active.map((x) => String(x.id)),
    place_match_count: pm_count,
    gen_content_count: gc_count,
    photo_candidate_count: pc_count,
    child_relationships: (rel_child.data ?? []).map((x) =>
      String(x.parent_master_place_id),
    ),
    parent_relationships: (rel_parent.data ?? []).map((x) =>
      String(x.child_master_place_id),
    ),
  };
}

// ---------- canonical rule ----------

const VISITOR_SRC = new Set([
  "california_state_parks",
  "washington_state_parks",
  "oregon_state_parks",
  "nevada_state_parks",
  "arizona_state_parks",
  "utah_state_parks",
]);

function pickCanonical(visitor: Side, other: Side): { side: "visitor" | "other" | "either"; reason: string } {
  const v = new Set(visitor.source_ids);
  const o = new Set(other.source_ids);
  const v_has_gis = v.has("state_parks");
  const o_has_gis = o.has("state_parks");
  const v_visitor = [...v].some((s) => VISITOR_SRC.has(s));
  const o_visitor = [...o].some((s) => VISITOR_SRC.has(s));
  // Primary rule: whichever side has state_parks GIS is canonical
  if (o_has_gis && !v_has_gis) {
    return { side: "other", reason: "other side has state_parks GIS record; visitor does not" };
  }
  if (v_has_gis && !o_has_gis) {
    return { side: "visitor", reason: "visitor side has state_parks GIS record; other does not" };
  }
  // Both GIS-backed: prefer whichever is NOT visitor-source-tagged (cleaner GIS home)
  if (v_has_gis && o_has_gis) {
    if (o_visitor && !v_visitor) {
      return { side: "visitor", reason: "both GIS-backed; visitor is the untagged GIS home" };
    }
    if (v_visitor && !o_visitor) {
      return { side: "other", reason: "both GIS-backed; other is the untagged GIS home" };
    }
    return { side: "either", reason: "both GIS-backed and both visitor-tagged; needs manual call" };
  }
  // Neither has state_parks GIS
  if (v.size > o.size) return { side: "visitor", reason: "neither has state_parks; visitor has more sources" };
  if (o.size > v.size) return { side: "other", reason: "neither has state_parks; other has more sources" };
  return { side: "either", reason: "neither has state_parks and equal sources; needs manual call" };
}

// ---------- field-conflict detection ----------

function nonNull(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function stableStringify(v: unknown): string {
  if (v == null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify((v as Record<string, unknown>)[k])).join(",") +
    "}"
  );
}

function fieldConflicts(canonical: Side, absorbed: Side): string[] {
  const out: string[] = [];
  const scalar: (keyof Side)[] = [
    "canonical_name",
    "primary_category",
    "description",
    "rating",
    "review_count",
    "price_tier",
    "photo_url",
  ];
  for (const k of scalar) {
    const cv = canonical[k];
    const av = absorbed[k];
    if (nonNull(cv) && nonNull(av) && cv !== av) {
      out.push(`${String(k)}: canonical="${String(cv).slice(0, 60)}" absorbed="${String(av).slice(0, 60)}"`);
    }
  }
  const jsonb: (keyof Side)[] = [
    "amenities",
    "hours",
    "contact",
    "access",
    "services",
    "capacity",
    "seasonality",
    "cell_signal",
  ];
  for (const k of jsonb) {
    const cv = canonical[k];
    const av = absorbed[k];
    if (nonNull(cv) && nonNull(av) && stableStringify(cv) !== stableStringify(av)) {
      out.push(`${String(k)}: both non-null with different values`);
    }
  }
  // Arrays
  const arr: (keyof Side)[] = ["secondary_categories", "overlander_tags"];
  for (const k of arr) {
    const cv = (canonical[k] as string[] | null) ?? [];
    const av = (absorbed[k] as string[] | null) ?? [];
    const cs = [...new Set(cv)].sort();
    const as_ = [...new Set(av)].sort();
    if (cs.length > 0 && as_.length > 0 && stableStringify(cs) !== stableStringify(as_)) {
      out.push(`${String(k)}: canonical=[${cs.join(",")}] absorbed=[${as_.join(",")}]`);
    }
  }
  // Geometry polygon
  if (nonNull(canonical.geometry_polygon) && nonNull(absorbed.geometry_polygon)) {
    out.push("geometry_polygon: both sides have a polygon");
  }
  return out;
}

// ---------- main ----------

interface Args {
  input: string;
  limit: number | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let input = join(REPO, ".context/same-pairs-resolved.json");
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[++i];
    else if (argv[i] === "--limit") limit = Number(argv[++i]);
  }
  return { input, limit };
}

function toCsvRow(cells: (string | number | null)[]): string {
  return cells
    .map((c) => {
      if (c == null) return "";
      const s = String(c);
      if (s.includes(",") || s.includes('"') || s.includes("\n"))
        return '"' + s.replace(/"/g, '""') + '"';
      return s;
    })
    .join(",");
}

async function main(): Promise<void> {
  const args = parseArgs();
  const db = makeClient();

  const inputPairs = readInput(args.input);
  const pairs = args.limit != null ? inputPairs.slice(0, args.limit) : inputPairs;
  console.log(`loaded ${inputPairs.length} pairs${args.limit != null ? ` (using first ${pairs.length})` : ""}`);

  const previews: Preview[] = [];
  let idx = 0;
  for (const p of pairs) {
    idx++;
    const [visitor, other] = await Promise.all([hydrate(db, p.visitor_mp_full), hydrate(db, p.other_mp_full)]);
    const c = pickCanonical(visitor, other);
    const canonical = c.side === "visitor" ? visitor : c.side === "other" ? other : null;
    const absorbed = c.side === "visitor" ? other : c.side === "other" ? visitor : null;

    // Deltas assume the absorbed side's rows would repoint or be dropped.
    // If canonical_side === "either", we don't decide who moves; we report both sides' inventories separately.
    const moves = {
      source_records: absorbed ? absorbed.source_record_ids.length : Math.max(visitor.source_record_ids.length, other.source_record_ids.length),
      place_matches_dropped_by_cascade: absorbed ? absorbed.place_match_count : Math.max(visitor.place_match_count, other.place_match_count),
      generated_content: absorbed ? absorbed.gen_content_count : Math.max(visitor.gen_content_count, other.gen_content_count),
      photo_candidates: absorbed ? absorbed.photo_candidate_count : Math.max(visitor.photo_candidate_count, other.photo_candidate_count),
      child_relationships: absorbed ? absorbed.child_relationships.length : Math.max(visitor.child_relationships.length, other.child_relationships.length),
      parent_relationships: absorbed ? absorbed.parent_relationships.length : Math.max(visitor.parent_relationships.length, other.parent_relationships.length),
    };

    const conflicts = canonical && absorbed ? fieldConflicts(canonical, absorbed) : ["canonical side unresolved — cannot compute conflicts"];

    const risks: string[] = [];
    if (c.side === "either") risks.push("canonical_side=either — needs manual decision");
    if (canonical && absorbed && canonical.primary_category !== absorbed.primary_category) {
      risks.push(`primary_category differs (${canonical.primary_category} vs ${absorbed.primary_category})`);
    }
    if (moves.parent_relationships > 0 || moves.child_relationships > 0) {
      // A merge would rewrite these; guard against self-reference and dedupe.
      const self_ref_hazard =
        absorbed &&
        canonical &&
        (absorbed.child_relationships.includes(canonical.id) ||
          absorbed.parent_relationships.includes(canonical.id));
      if (self_ref_hazard) risks.push("absorbed row participates in a relationship WITH the canonical row — merging would create a self-reference (deduplicate)");
      else risks.push(`${moves.parent_relationships + moves.child_relationships} place_relationships edge(s) would need rewriting`);
    }
    if (canonical && absorbed && nonNull(canonical.geometry_polygon) && nonNull(absorbed.geometry_polygon)) {
      risks.push("both rows have geometry_polygon — a real merge would need to pick one");
    }
    if (moves.place_matches_dropped_by_cascade > 0) {
      risks.push(`${moves.place_matches_dropped_by_cascade} place_match rows on absorbed side would drop via CASCADE unless explicitly repointed`);
    }
    if (moves.generated_content > 0) risks.push(`${moves.generated_content} master_place_generated_content row(s) to move`);
    if (moves.photo_candidates > 0) risks.push(`${moves.photo_candidates} master_place_photo_candidate row(s) to move`);
    if (conflicts.length > 0 && !risks.some((r) => r.includes("category differs"))) {
      // Called out separately because field conflicts are a distinct risk class from FK moves
    }

    const preview: Preview = {
      pair_key: [visitor.id, other.id].sort().join("|"),
      state: p.state,
      visitor,
      other,
      canonical_side: c.side,
      canonical_reason: c.reason,
      canonical_mp_id: canonical?.id ?? null,
      absorbed_mp_id: absorbed?.id ?? null,
      moves,
      conflicts,
      risks,
      original: p,
    };
    previews.push(preview);

    if (idx % 20 === 0) console.log(`  processed ${idx}/${pairs.length}`);
  }
  console.log(`processed ${previews.length}/${pairs.length}`);

  // ---------- outputs ----------

  const jsonOut = join(REPO, ".context/merge-preview-136.json");
  writeFileSync(jsonOut, JSON.stringify(previews, null, 2));

  const csvOut = join(REPO, ".context/merge-preview-136.csv");
  const header = [
    "state",
    "canonical_side",
    "canonical_reason",
    "canonical_mp_id",
    "canonical_name",
    "canonical_srcs",
    "absorbed_mp_id",
    "absorbed_name",
    "absorbed_srcs",
    "move_source_records",
    "move_place_matches_drop",
    "move_generated_content",
    "move_photo_candidates",
    "move_child_rels",
    "move_parent_rels",
    "n_conflicts",
    "conflicts_summary",
    "n_risks",
    "risks_summary",
  ];
  const rows: string[] = [header.join(",")];
  for (const p of previews) {
    const canonical = p.canonical_side === "visitor" ? p.visitor : p.canonical_side === "other" ? p.other : null;
    const absorbed = p.canonical_side === "visitor" ? p.other : p.canonical_side === "other" ? p.visitor : null;
    rows.push(
      toCsvRow([
        p.state,
        p.canonical_side,
        p.canonical_reason,
        canonical?.id ?? "",
        canonical?.canonical_name ?? "",
        canonical?.source_ids.join("+") ?? "",
        absorbed?.id ?? "",
        absorbed?.canonical_name ?? "",
        absorbed?.source_ids.join("+") ?? "",
        p.moves.source_records,
        p.moves.place_matches_dropped_by_cascade,
        p.moves.generated_content,
        p.moves.photo_candidates,
        p.moves.child_relationships,
        p.moves.parent_relationships,
        p.conflicts.length,
        p.conflicts.slice(0, 3).join("; "),
        p.risks.length,
        p.risks.slice(0, 4).join("; "),
      ]),
    );
  }
  writeFileSync(csvOut, rows.join("\n"));

  console.log(`\nwrote: ${jsonOut}`);
  console.log(`wrote: ${csvOut}`);

  // ---------- summary ----------

  const by_side: Record<string, number> = {};
  const by_state: Record<string, Record<string, number>> = {};
  let any_conflicts = 0;
  let any_risks = 0;
  let either_count = 0;
  for (const p of previews) {
    by_side[p.canonical_side] = (by_side[p.canonical_side] ?? 0) + 1;
    (by_state[p.state] ??= {})[p.canonical_side] = ((by_state[p.state] ??= {})[p.canonical_side] ?? 0) + 1;
    if (p.conflicts.length > 0 && !(p.conflicts.length === 1 && p.conflicts[0].includes("unresolved"))) any_conflicts++;
    if (p.risks.length > 0) any_risks++;
    if (p.canonical_side === "either") either_count++;
  }
  console.log(`\ncanonical side: ${JSON.stringify(by_side)}`);
  console.log(`by state:`);
  for (const [st, m] of Object.entries(by_state).sort()) console.log(`  ${st}  ${JSON.stringify(m)}`);
  console.log(`\npairs with any field conflict: ${any_conflicts}`);
  console.log(`pairs with any risk flag: ${any_risks}`);
  console.log(`"either" canonical side (needs manual call): ${either_count}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
