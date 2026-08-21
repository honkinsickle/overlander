/**
 * Sub-classifier for the 103 remaining `ambiguous` rows from the triage.
 * Read-only, no DB writes. Splits into four proposed shapes + a residual.
 *
 * SHAPES (each defined against the actual pair, not just the samples):
 *
 * A. parent ↔ facility-at-parent
 *    MP name contains AO name as a prefix (or vice-versa) AND the extra
 *    tokens are a known facility-type suffix (Visitor Center, Lookout,
 *    Trailhead, Park Store, Museum, etc.). Point Reyes Lighthouse ↔
 *    Point Reyes Lighthouse Visitor Center — real hierarchy, not a
 *    same-entity match.
 *
 * B. same name, moderate distance
 *    name_sim ≥ 0.95 AND distance in [20, 60m]. Identical name; the
 *    distance likely reflects centroid vs. actual viewpoint. Plymouth
 *    Pillars Park at 49.7m.
 *
 * C. shared proper noun, different suffix
 *    First non-stopword token identical, but the last non-stopword token
 *    of each name is different (Wrigley Mansion ↔ Wrigley Gardens).
 *    Requires name_sim in [0.60, 0.95); otherwise A or B would have
 *    caught it.
 *
 * D. complete mismatch on shared coord
 *    name_sim in [0.60, 0.75] AND distance < 20m AND no common non-
 *    stopword token between AO and MP names.
 *
 * E. residual — anything not fitting A-D.
 *
 * Each rule is tested independently and the first-matching wins in the
 * order A → B → C → D → E. That order is deliberate: A/B are structural
 * (name-shape / distance), C/D are compositional.
 */
import { readFileSync, writeFileSync } from "node:fs";

type Shape = "A_parent_facility" | "B_same_name_moderate_dist" | "C_shared_noun_diff_suffix" | "D_mismatch_shared_coord" | "E_residual";

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "at", "in", "on", "for", "by", "&"]);
const FACILITY_SUFFIXES = [
  "visitor center", "visitor centre", "visitors center", "vc",
  "lookout", "trailhead", "trail", "park store", "campground", "cg",
  "museum", "gift shop", "picnic area", "day use area",
  "monument", "national historic site", "national monument",
  "state park", "state historic park", "regional park", "state historic site",
  "audio tour", "tree", "cabin", "grove",
];

function tokenize(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function containsFacilitySuffix(remainderTokens: string[]): boolean {
  if (remainderTokens.length === 0) return false;
  const remainder = remainderTokens.join(" ");
  return FACILITY_SUFFIXES.some((suf) => {
    const sufToks = suf.split(" ");
    // Match if the remainder contains the suffix as a contiguous run.
    for (let i = 0; i + sufToks.length <= remainderTokens.length; i++) {
      if (remainderTokens.slice(i, i + sufToks.length).every((t, j) => t === sufToks[j])) {
        return true;
      }
    }
    // Or if the trimmed suffix string appears in the joined form (handles
    // hyphenation variants that tokenize the same).
    return remainder.includes(suf);
  });
}

function isParentFacility(aoTokens: string[], mpTokens: string[]): boolean {
  // one side is a strict prefix of the other, and the tail contains a
  // known facility suffix.
  const isPrefix = (short: string[], long: string[]) =>
    short.length > 0 && short.length < long.length && short.every((t, i) => t === long[i]);
  if (isPrefix(aoTokens, mpTokens)) return containsFacilitySuffix(mpTokens.slice(aoTokens.length));
  if (isPrefix(mpTokens, aoTokens)) return containsFacilitySuffix(aoTokens.slice(mpTokens.length));
  return false;
}

function commonTokens(a: string[], b: string[]): string[] {
  const setB = new Set(b);
  return [...new Set(a.filter((t) => setB.has(t)))];
}

function firstToken(toks: string[]): string | null {
  return toks[0] ?? null;
}

function lastToken(toks: string[]): string | null {
  return toks.at(-1) ?? null;
}

interface Row {
  ao_name: string;
  mp_name: string;
  mp_primary_category: string | null;
  mp_source_ids: string[];
  combined_confidence: number;
  distance_meters: number;
  name_similarity: number;
  place_match_id: string;
}

function classify(r: Row): { shape: Shape; why: string } {
  const ao = tokenize(r.ao_name);
  const mp = tokenize(r.mp_name);
  const nameSim = r.name_similarity;
  const dist = r.distance_meters;

  if (isParentFacility(ao, mp)) {
    return {
      shape: "A_parent_facility",
      why: `one name is a prefix of the other AND remainder contains a facility suffix`,
    };
  }
  if (nameSim >= 0.95 && dist >= 20 && dist <= 60) {
    return {
      shape: "B_same_name_moderate_dist",
      why: `name_sim ${nameSim.toFixed(2)} ≥ 0.95 AND distance ${dist.toFixed(1)}m in [20, 60]`,
    };
  }
  const first = firstToken(ao);
  const last = lastToken(ao);
  const firstMp = firstToken(mp);
  const lastMp = lastToken(mp);
  if (
    first != null &&
    firstMp != null &&
    first === firstMp &&
    last != null &&
    lastMp != null &&
    last !== lastMp &&
    nameSim >= 0.6 &&
    nameSim < 0.95
  ) {
    return {
      shape: "C_shared_noun_diff_suffix",
      why: `first token '${first}' shared, last tokens differ ('${last}' vs '${lastMp}'), name_sim ${nameSim.toFixed(2)}`,
    };
  }
  const common = commonTokens(ao, mp);
  if (nameSim >= 0.6 && nameSim <= 0.75 && dist < 20 && common.length === 0) {
    return {
      shape: "D_mismatch_shared_coord",
      why: `name_sim ${nameSim.toFixed(2)} in [0.60, 0.75] AND distance ${dist.toFixed(1)}m < 20 AND no common token`,
    };
  }
  return { shape: "E_residual", why: `no shape rule matched (name_sim ${nameSim.toFixed(2)}, dist ${dist.toFixed(1)}m)` };
}

function main() {
  const path = "/tmp/ao-triage-149.jsonl";
  const rows: Row[] = readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
    .filter((r: any) => r.bucket === "ambiguous");
  if (rows.length !== 103) {
    console.warn(`WARN: expected 103 ambiguous rows, got ${rows.length}`);
  }

  const shapes: Record<Shape, (Row & { why: string })[]> = {
    A_parent_facility: [],
    B_same_name_moderate_dist: [],
    C_shared_noun_diff_suffix: [],
    D_mismatch_shared_coord: [],
    E_residual: [],
  };
  for (const r of rows) {
    const c = classify(r);
    shapes[c.shape].push({ ...r, why: c.why });
  }

  console.log(`Total ambiguous: ${rows.length}`);
  console.log("Shape counts:");
  for (const [k, arr] of Object.entries(shapes)) {
    console.log(`  ${k}: ${arr.length}`);
  }

  for (const [shape, arr] of Object.entries(shapes)) {
    console.log(`\n=== ${shape} (${arr.length}) — up to 10 by confidence ===`);
    const sample = [...arr].sort((a, b) => b.combined_confidence - a.combined_confidence).slice(0, 10);
    for (const r of sample) {
      console.log(`  ao='${r.ao_name}'  ↔  mp='${r.mp_name}'  |  conf=${r.combined_confidence.toFixed(3)}  name_sim=${r.name_similarity.toFixed(3)}  d=${r.distance_meters.toFixed(1)}m  cat=${r.mp_primary_category}  srcs=${r.mp_source_ids.join(",")}`);
      console.log(`     why: ${r.why}`);
    }
  }

  // Persist shape-labeled JSONL so executors can filter by (shape,
  // place_match_id) — the Eagle Rock lesson: never key an action off a
  // homonym-prone column like canonical_name.
  const out: string[] = [];
  for (const [shape, arr] of Object.entries(shapes)) {
    for (const r of arr) out.push(JSON.stringify({ shape, ...r }));
  }
  const outPath = "/tmp/ao-classified-ambiguous.jsonl";
  writeFileSync(outPath, out.join("\n") + "\n");
  console.log(`\nWROTE ${out.length} shape-labeled rows → ${outPath}`);

  // For residual: show source-set concentration to see if there's a hidden pattern.
  const residualSrc: Record<string, number> = {};
  for (const r of shapes.E_residual) {
    const k = r.mp_source_ids.join(",") || "(none)";
    residualSrc[k] = (residualSrc[k] ?? 0) + 1;
  }
  console.log(`\nResidual source-set concentration:`, residualSrc);
}

main();
