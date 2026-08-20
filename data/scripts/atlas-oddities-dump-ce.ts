/**
 * Read-only dump of the remaining pending atlas_oddities rows in
 * bucket 3.C (shared-first-noun / different-suffix) and 3.E (residual).
 *
 * Pulls fresh from the DB (not the classifier JSONL) so pm-ids, scoring,
 * and mp_source_ids reflect current TEST state at print time. Sub-labels
 * 3.E rows into the three sub-patterns from the last report:
 *
 *   punctuation-only          — normalized names are identical (e.g. em-
 *                               dash vs hyphen, "and" vs "&", "The " prefix)
 *   semantic-superset         — one name's token set is a strict subset of
 *                               the other's after stopword/punct normalization
 *   different-first-shared-middle — first tokens differ but at least one
 *                               non-stopword token is shared
 *   residual                  — none of the above
 *
 * NO WRITES.
 */
import { getDb } from "../ingestion/lib/db.ts";
import { readFileSync } from "node:fs";

interface Row {
  place_match_id: string;
  shape: "C" | "E";
  sub_pattern: string | null; // set only for E
  ao_name: string;
  mp_name: string;
  name_sim: number;
  distance_m: number;
  mp_source_ids: string[];
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and", "at", "in", "on", "for", "by", "&"]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[–—-]/g, " ") // em-dash / en-dash / hyphen → space
    .replace(/[^a-z0-9\s]/g, " ") // strip other punctuation
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function normPunct(s: string): string {
  return tokenize(s).join(" ");
}

function subPatternForE(ao: string, mp: string): string {
  const aoTok = new Set(tokenize(ao));
  const mpTok = new Set(tokenize(mp));

  if (normPunct(ao) === normPunct(mp)) return "punctuation-only";

  const aoSubset = [...aoTok].every((t) => mpTok.has(t));
  const mpSubset = [...mpTok].every((t) => aoTok.has(t));
  if ((aoSubset || mpSubset) && aoTok.size !== mpTok.size) return "semantic-superset";

  const overlap = [...aoTok].filter((t) => mpTok.has(t));
  const aoFirst = tokenize(ao)[0];
  const mpFirst = tokenize(mp)[0];
  if (overlap.length > 0 && aoFirst !== mpFirst) return "different-first-shared-middle";

  return "residual";
}

async function main() {
  const db = getDb();

  // Get the pm-ids for shape C and E from the classifier JSONL. This is
  // just row selection — every field printed below is fetched fresh from
  // the DB.
  const classified = readFileSync("/tmp/ao-classified-ambiguous.jsonl", "utf8")
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
  const pmIdsByShape: Record<"C" | "E", string[]> = {
    C: classified.filter((o) => o.shape === "C_shared_noun_diff_suffix").map((o) => o.place_match_id),
    E: classified.filter((o) => o.shape === "E_residual").map((o) => o.place_match_id),
  };
  const shapeById = new Map<string, "C" | "E">();
  for (const id of pmIdsByShape.C) shapeById.set(id, "C");
  for (const id of pmIdsByShape.E) shapeById.set(id, "E");
  const allIds = [...pmIdsByShape.C, ...pmIdsByShape.E];

  // Fresh fetch of each row's place_match + SR + MP.
  const CHUNK = 100;
  const pmRows: any[] = [];
  for (let i = 0; i < allIds.length; i += CHUNK) {
    const chunk = allIds.slice(i, i + CHUNK);
    const r = await db
      .from("place_match")
      .select(`
        id, status, distance_meters, name_similarity, combined_confidence,
        source_record!inner (id, name),
        master_place!inner (id, canonical_name, primary_category)
      `)
      .in("id", chunk);
    if (r.error || r.data == null) {
      console.error("pm fetch failed:", r);
      process.exit(1);
    }
    pmRows.push(...r.data);
  }

  // Fresh source list for each target MP.
  const mpIds = [...new Set(pmRows.map((r: any) => r.master_place.id))];
  const srByMp = new Map<string, string[]>();
  for (let i = 0; i < mpIds.length; i += CHUNK) {
    const chunk = mpIds.slice(i, i + CHUNK);
    const r = await db.from("source_record").select("master_place_id, source_id").in("master_place_id", chunk);
    if (r.error) {
      console.error("sr fetch failed:", r);
      process.exit(1);
    }
    for (const row of r.data ?? []) {
      const arr = srByMp.get(row.master_place_id) ?? [];
      arr.push(row.source_id);
      srByMp.set(row.master_place_id, arr);
    }
  }

  // Sanity: every returned row must still be pending. Anything else is a
  // drift signal — surface loudly.
  const notPending = pmRows.filter((r: any) => r.status !== "pending");
  if (notPending.length > 0) {
    console.error(`WARN: ${notPending.length} rows are no longer pending — dump reflects prior triage snapshot for those:`);
    for (const r of notPending) console.error(`  pm=${r.id}  status=${r.status}  ao='${r.source_record.name}'`);
  }

  const rows: Row[] = pmRows.map((r: any) => {
    const shape = shapeById.get(r.id) ?? "E";
    const aoName = r.source_record.name;
    const mpName = r.master_place.canonical_name;
    return {
      place_match_id: r.id,
      shape,
      sub_pattern: shape === "E" ? subPatternForE(aoName, mpName) : null,
      ao_name: aoName,
      mp_name: mpName,
      name_sim: r.name_similarity,
      distance_m: r.distance_meters,
      mp_source_ids: (srByMp.get(r.master_place.id) ?? []).sort(),
    };
  });

  // Sort: bucket (C first, then E), then name_sim desc within bucket.
  rows.sort((a, b) => {
    if (a.shape !== b.shape) return a.shape === "C" ? -1 : 1;
    return b.name_sim - a.name_sim;
  });

  // Print markdown table.
  console.log("| # | bucket | sub-pattern | AO name | Target MP name | name_sim | dist (m) | MP sources | place_match_id |");
  console.log("|---|---|---|---|---|--:|--:|---|---|");
  rows.forEach((r, i) => {
    const sub = r.sub_pattern ?? "";
    const srs = r.mp_source_ids.join(", ");
    // Escape pipe chars in names.
    const ao = r.ao_name.replace(/\|/g, "\\|");
    const mp = r.mp_name.replace(/\|/g, "\\|");
    console.log(
      `| ${i + 1} | 3.${r.shape} | ${sub} | ${ao} | ${mp} | ${r.name_sim.toFixed(3)} | ${r.distance_m.toFixed(1)} | ${srs} | ${r.place_match_id} |`,
    );
  });

  console.log(`\nTotal rows: ${rows.length}  (bucket 3.C: ${rows.filter((r) => r.shape === "C").length}, bucket 3.E: ${rows.filter((r) => r.shape === "E").length})`);
  const eSubs: Record<string, number> = {};
  for (const r of rows.filter((r) => r.shape === "E")) {
    const k = r.sub_pattern ?? "residual";
    eSubs[k] = (eSubs[k] ?? 0) + 1;
  }
  console.log(`Bucket 3.E sub-pattern counts:`, eSubs);
}

main().catch((err) => {
  console.error("dump: fatal", err);
  process.exit(1);
});
