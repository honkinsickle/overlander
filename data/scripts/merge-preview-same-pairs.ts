/**
 * READ-ONLY dry-run merge preview for the SAME-bucket duplicate pairs.
 *
 * v2 (2026-09-03). Adds n-way cluster detection and the Agua Caliente
 * exclusion from PR #372's verdict.
 *   - v1 (PR #370): per-pair preview only. Handled every pair independently.
 *   - v2: union-find over all pairs so any master_place involved in more
 *         than one pair collapses into a single n-way merge group. Emits
 *         both per-pair rows (for backward compatibility) AND per-group
 *         rows (the new correct unit of work for a real merge).
 *
 * For each pair the tool hydrates both master_place rows, applies the
 * state_parks-GIS-wins canonical rule from the parent investigation
 * (docs/investigations/2026-09-02-cross-source-duplicates.md §3), enumerates
 * FK deltas a real merge would need to perform, and diffs field-by-field.
 *
 * For each merge group it picks THE single canonical winner across all
 * records in the group (using the same rule), lists every other record as
 * an "absorbed" candidate, and rolls up the per-pair conflicts into a
 * per-group set with the pair each conflict came from.
 *
 * WRITES NOTHING. Every query is a SELECT. Refuses any argument matching
 * --apply|--write|--execute|--commit|--run|--do.
 *
 * Inputs and exclusions:
 *   - Reads pairs from .context/same-pairs-resolved.json by default (may be
 *     overridden via --input <path>). That file is produced by PR #368's
 *     sort script + a prefix-resolver query — same input as v1.
 *   - Excludes one specific pair by default: Agua Caliente County Park
 *     (ABDSP) ↔ NPS Anza-Borrego Desert State Park. PR #372's verdict found
 *     the canonical master_place there is a corrupted state_parks federation
 *     (upstream dissolveBoundaries bug: UNITNBR="622" shares between two
 *     source features and the merge kept both polygons under one name).
 *     Not a merge candidate until that upstream bug is fixed. Pass
 *     --include-agua-caliente to override.
 *
 * Outputs (both .context/, gitignored):
 *   merge-preview-135.csv    — one row per pair (post-exclusion count)
 *   merge-preview-135.json   — full structured per-pair record
 *   merge-preview-groups.csv — one row per n-way merge group
 *   merge-preview-groups.json— full structured per-group record
 *
 * Usage:
 *   npx tsx data/scripts/merge-preview-same-pairs.ts
 *       [--input .context/same-pairs-resolved.json]
 *       [--limit N]                     # first N pairs (for testing)
 *       [--include-agua-caliente]       # override the exclusion
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

// The single pair excluded by default. See PR #372 §3.
const AGUA_CALIENTE_CANONICAL = "9cf912c6-10c8-4af2-bada-499abcdeb2d7";
const NPS_ANZA_BORREGO_ABSORBED = "2e118c6f-aad5-43ad-926b-5bb0f04626dc";

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
  source_ids: string[];
  source_record_ids: string[];
  place_match_count: number;
  gen_content_count: number;
  photo_candidate_count: number;
  child_relationships: string[];
  parent_relationships: string[];
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
  conflicts: string[];
  risks: string[];
  original: PairIn;
}

interface Group {
  group_id: number;
  member_mp_ids: string[]; // all records in the group
  pair_keys: string[]; // pair_keys of the pairs that built this group
  size: number; // count of member records
  states: string[]; // distinct states across member records
  canonical_mp_id: string | null; // single canonical picked across the group
  canonical_reason: string;
  absorbed_mp_ids: string[]; // all non-canonical members
  member_sides: Array<{ id: string; canonical_name: string; source_ids: string[]; source_count: number; has_polygon: boolean }>;
  conflict_summary: string[]; // union of pair-level conflicts, with which pair each came from
  risk_summary: string[]; // union of pair-level risks, deduped
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
  return (raw as PairIn[]).filter((r) => r.visitor_mp_full && r.other_mp_full);
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
    throw new Error(`QUERY FAILED [master_place ${mp_id}]: ${JSON.stringify(mp.error)}`);
  }

  const sr = await db.from("source_record").select("id,source_id,is_active").eq("master_place_id", mp_id);
  if (sr.error || sr.data == null) {
    throw new Error(`QUERY FAILED [source_record ${mp_id}]: ${JSON.stringify(sr.error)}`);
  }
  const active = (sr.data ?? []).filter((x) => x.is_active !== false);

  const pm = await db.from("place_match").select("id", { count: "exact", head: true }).eq("master_place_id", mp_id);
  const gc = await db
    .from("master_place_generated_content")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mp_id);
  const pc = await db
    .from("master_place_photo_candidate")
    .select("id", { count: "exact", head: true })
    .eq("master_place_id", mp_id);

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
    place_match_count: pm.count ?? 0,
    gen_content_count: gc.count ?? 0,
    photo_candidate_count: pc.count ?? 0,
    child_relationships: (rel_child.data ?? []).map((x) => String(x.parent_master_place_id)),
    parent_relationships: (rel_parent.data ?? []).map((x) => String(x.child_master_place_id)),
  };
}

// ---------- canonical rule ----------
//
// Extracted to data/scripts/lib/merge-canonical.ts so the merge executor
// uses the same rule. pickCanonicalPair stays local because the dry-run
// output includes a pair-level `canonical_side` column that the group-level
// picker doesn't have; the pair function reuses VISITOR_SRC from the lib.

import { VISITOR_SRC, pickCanonicalGroup } from "./lib/merge-canonical.ts";

function pickCanonicalPair(a: Side, b: Side): { winner: Side; loser: Side; reason: string } | { reason: string } {
  const av = new Set(a.source_ids);
  const bv = new Set(b.source_ids);
  const a_gis = av.has("state_parks");
  const b_gis = bv.has("state_parks");
  const a_visitor = [...av].some((s) => VISITOR_SRC.has(s));
  const b_visitor = [...bv].some((s) => VISITOR_SRC.has(s));
  if (b_gis && !a_gis) return { winner: b, loser: a, reason: "state_parks-GIS-backed row wins" };
  if (a_gis && !b_gis) return { winner: a, loser: b, reason: "state_parks-GIS-backed row wins" };
  if (a_gis && b_gis) {
    if (b_visitor && !a_visitor) return { winner: a, loser: b, reason: "both GIS-backed; untagged GIS home wins" };
    if (a_visitor && !b_visitor) return { winner: b, loser: a, reason: "both GIS-backed; untagged GIS home wins" };
    return { reason: "both GIS-backed and both visitor-tagged; needs manual" };
  }
  if (av.size > bv.size) return { winner: a, loser: b, reason: "neither GIS; more sources wins" };
  if (bv.size > av.size) return { winner: b, loser: a, reason: "neither GIS; more sources wins" };
  return { reason: "neither GIS and equal sources; needs manual" };
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
  if (nonNull(canonical.geometry_polygon) && nonNull(absorbed.geometry_polygon)) {
    out.push("geometry_polygon: both sides have a polygon");
  }
  return out;
}

// ---------- union-find ----------

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    if (this.parent.get(x) !== x) this.parent.set(x, this.find(this.parent.get(x)!));
    return this.parent.get(x)!;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  groups(): Map<string, string[]> {
    const out = new Map<string, string[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      if (!out.has(r)) out.set(r, []);
      out.get(r)!.push(x);
    }
    return out;
  }
}

// ---------- main ----------

interface Args {
  input: string;
  limit: number | null;
  includeAguaCaliente: boolean;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let input = join(REPO, ".context/same-pairs-resolved.json");
  let limit: number | null = null;
  let includeAguaCaliente = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") input = argv[++i];
    else if (argv[i] === "--limit") limit = Number(argv[++i]);
    else if (argv[i] === "--include-agua-caliente") includeAguaCaliente = true;
  }
  return { input, limit, includeAguaCaliente };
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

  const allPairs = readInput(args.input);
  console.log(`loaded ${allPairs.length} pairs from input`);

  // Apply the Agua Caliente exclusion.
  let pairs = allPairs;
  const excluded: PairIn[] = [];
  if (!args.includeAguaCaliente) {
    pairs = allPairs.filter((p) => {
      const isAC =
        (p.visitor_mp_full === AGUA_CALIENTE_CANONICAL && p.other_mp_full === NPS_ANZA_BORREGO_ABSORBED) ||
        (p.other_mp_full === AGUA_CALIENTE_CANONICAL && p.visitor_mp_full === NPS_ANZA_BORREGO_ABSORBED);
      if (isAC) excluded.push(p);
      return !isAC;
    });
    console.log(`excluded ${excluded.length} pair(s) (Agua Caliente / NPS Anza-Borrego, per PR #372 §3)`);
  }
  if (args.limit != null) pairs = pairs.slice(0, args.limit);
  console.log(`processing ${pairs.length} pair(s)`);

  const previews: Preview[] = [];
  let idx = 0;
  for (const p of pairs) {
    idx++;
    const [visitor, other] = await Promise.all([hydrate(db, p.visitor_mp_full), hydrate(db, p.other_mp_full)]);
    const c = pickCanonicalPair(visitor, other);
    const decided = "winner" in c;
    const canonical = decided ? (c as { winner: Side }).winner : null;
    const absorbed = decided ? (c as { loser: Side }).loser : null;

    const moves = {
      source_records: absorbed ? absorbed.source_record_ids.length : Math.max(visitor.source_record_ids.length, other.source_record_ids.length),
      place_matches_dropped_by_cascade: absorbed
        ? absorbed.place_match_count
        : Math.max(visitor.place_match_count, other.place_match_count),
      generated_content: absorbed ? absorbed.gen_content_count : Math.max(visitor.gen_content_count, other.gen_content_count),
      photo_candidates: absorbed ? absorbed.photo_candidate_count : Math.max(visitor.photo_candidate_count, other.photo_candidate_count),
      child_relationships: absorbed
        ? absorbed.child_relationships.length
        : Math.max(visitor.child_relationships.length, other.child_relationships.length),
      parent_relationships: absorbed
        ? absorbed.parent_relationships.length
        : Math.max(visitor.parent_relationships.length, other.parent_relationships.length),
    };

    const conflicts = canonical && absorbed ? fieldConflicts(canonical, absorbed) : ["canonical side unresolved — cannot compute conflicts"];

    const risks: string[] = [];
    if (!decided) risks.push(`canonical_side=either — needs manual decision (${c.reason})`);
    if (canonical && absorbed && canonical.primary_category !== absorbed.primary_category) {
      risks.push(`primary_category differs (${canonical.primary_category} vs ${absorbed.primary_category})`);
    }
    if (moves.parent_relationships > 0 || moves.child_relationships > 0) {
      const self_ref =
        absorbed &&
        canonical &&
        (absorbed.child_relationships.includes(canonical.id) || absorbed.parent_relationships.includes(canonical.id));
      if (self_ref) risks.push("self-reference hazard — absorbed is already in a place_relationships row with canonical");
      else risks.push(`${moves.parent_relationships + moves.child_relationships} place_relationships edge(s) need rewriting`);
    }
    if (canonical && absorbed && nonNull(canonical.geometry_polygon) && nonNull(absorbed.geometry_polygon)) {
      risks.push("both rows have geometry_polygon — real merge needs a polygon-picking rule");
    }
    if (moves.place_matches_dropped_by_cascade > 0)
      risks.push(`${moves.place_matches_dropped_by_cascade} place_match rows on absorbed would drop via CASCADE`);
    if (moves.generated_content > 0) risks.push(`${moves.generated_content} master_place_generated_content row(s) to move`);
    if (moves.photo_candidates > 0) risks.push(`${moves.photo_candidates} master_place_photo_candidate row(s) to move`);

    previews.push({
      pair_key: [visitor.id, other.id].sort().join("|"),
      state: p.state,
      visitor,
      other,
      canonical_side: decided ? (canonical === visitor ? "visitor" : "other") : "either",
      canonical_reason: c.reason,
      canonical_mp_id: canonical?.id ?? null,
      absorbed_mp_id: absorbed?.id ?? null,
      moves,
      conflicts,
      risks,
      original: p,
    });

    if (idx % 20 === 0) console.log(`  processed ${idx}/${pairs.length}`);
  }
  console.log(`processed ${previews.length}/${pairs.length}`);

  // ---------- union-find over all mp_ids from all pairs ----------
  const uf = new UnionFind();
  const sideById = new Map<string, Side>();
  for (const p of previews) {
    uf.union(p.visitor.id, p.other.id);
    sideById.set(p.visitor.id, p.visitor);
    sideById.set(p.other.id, p.other);
  }
  const rawGroups = uf.groups();
  const groups: Group[] = [];
  let gid = 0;
  for (const [, members] of rawGroups) {
    gid++;
    const memberSides = members.map((id) => sideById.get(id)!).filter(Boolean);
    if (memberSides.length < 2) continue; // only groups with real merge work
    const pairsInGroup = previews.filter((p) => members.includes(p.visitor.id) || members.includes(p.other.id));
    const uniquePairKeys = [...new Set(pairsInGroup.map((p) => p.pair_key))];
    const gpick = pickCanonicalGroup(memberSides);
    const canonical = gpick.canonical;
    const absorbedIds = canonical ? memberSides.filter((s) => s.id !== canonical.id).map((s) => s.id) : [];

    const conflict_summary: string[] = [];
    const risk_summary_set = new Set<string>();
    for (const p of pairsInGroup) {
      for (const c of p.conflicts) conflict_summary.push(`[pair ${p.visitor.canonical_name} ↔ ${p.other.canonical_name}] ${c}`);
      for (const r of p.risks) risk_summary_set.add(r);
    }

    groups.push({
      group_id: gid,
      member_mp_ids: members,
      pair_keys: uniquePairKeys,
      size: memberSides.length,
      states: [...new Set(pairsInGroup.map((p) => p.state))],
      canonical_mp_id: canonical?.id ?? null,
      canonical_reason: gpick.reason,
      absorbed_mp_ids: absorbedIds,
      member_sides: memberSides.map((s) => ({
        id: s.id,
        canonical_name: s.canonical_name,
        source_ids: s.source_ids,
        source_count: s.source_count,
        has_polygon: nonNull(s.geometry_polygon),
      })),
      conflict_summary,
      risk_summary: [...risk_summary_set],
    });
  }

  // ---------- outputs ----------

  const jsonOut = join(REPO, ".context/merge-preview-135.json");
  writeFileSync(jsonOut, JSON.stringify(previews, null, 2));
  const csvOut = join(REPO, ".context/merge-preview-135.csv");
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

  const groupsJsonOut = join(REPO, ".context/merge-preview-groups.json");
  writeFileSync(groupsJsonOut, JSON.stringify(groups, null, 2));
  const groupsCsvOut = join(REPO, ".context/merge-preview-groups.csv");
  const gHeader = [
    "group_id",
    "size",
    "states",
    "canonical_mp_id",
    "canonical_name",
    "canonical_reason",
    "member_count",
    "absorbed_ids",
    "absorbed_names",
    "n_conflicts",
    "n_risks",
  ];
  const gRows: string[] = [gHeader.join(",")];
  for (const g of groups) {
    const canonicalSide = g.canonical_mp_id ? g.member_sides.find((m) => m.id === g.canonical_mp_id) : null;
    const absorbedSides = g.member_sides.filter((m) => g.absorbed_mp_ids.includes(m.id));
    gRows.push(
      toCsvRow([
        g.group_id,
        g.size,
        g.states.join("+"),
        g.canonical_mp_id ?? "",
        canonicalSide?.canonical_name ?? "",
        g.canonical_reason,
        g.size,
        g.absorbed_mp_ids.join("+"),
        absorbedSides.map((s) => s.canonical_name).join(" | "),
        g.conflict_summary.length,
        g.risk_summary.length,
      ]),
    );
  }
  writeFileSync(groupsCsvOut, gRows.join("\n"));

  console.log(`\nwrote: ${jsonOut}`);
  console.log(`wrote: ${csvOut}`);
  console.log(`wrote: ${groupsJsonOut}`);
  console.log(`wrote: ${groupsCsvOut}`);

  // ---------- summary ----------
  const by_side: Record<string, number> = {};
  for (const p of previews) by_side[p.canonical_side] = (by_side[p.canonical_side] ?? 0) + 1;
  console.log(`\ncanonical_side across ${previews.length} pairs: ${JSON.stringify(by_side)}`);

  const sizes = new Map<number, number>();
  for (const g of groups) sizes.set(g.size, (sizes.get(g.size) ?? 0) + 1);
  console.log(`\nmerge groups: ${groups.length}`);
  for (const [s, n] of [...sizes.entries()].sort()) console.log(`  size ${s}: ${n} groups`);

  const multi = groups.filter((g) => g.size > 2);
  console.log(`\nn-way clusters (size > 2): ${multi.length}`);
  for (const g of multi) {
    const canonical = g.member_sides.find((m) => m.id === g.canonical_mp_id);
    console.log(`  group ${g.group_id}: size=${g.size}, canonical=${canonical?.canonical_name}, states=${g.states.join(",")}`);
    for (const m of g.member_sides) {
      const isCanonical = m.id === g.canonical_mp_id;
      console.log(`    ${isCanonical ? "★" : " "} ${m.canonical_name} [${m.source_ids.join("+")}] polygon=${m.has_polygon} sc=${m.source_count}`);
    }
  }

  const unresolved = groups.filter((g) => !g.canonical_mp_id);
  console.log(`\ngroups without a decidable canonical: ${unresolved.length}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
