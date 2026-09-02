/**
 * READ-ONLY triage report for a state-park source's manual_review queue.
 *
 * Parameterised over `--source` (was `ca-prod-triage-report.ts`, CA-hardcoded).
 * Generalised for WA rather than copied: a forked copy is how the
 * overlapping-polygon fix landed in one ER script and went stale in three.
 *
 * The committed `ca-state-parks-triage-apply.ts --list` emits external_id,
 * source name, proposed master_place and confidence. A triage decision needs
 * more than that, so this adds, per item:
 *   - the full place_match score breakdown (name_similarity, distance_meters,
 *     category_compatibility, combined_confidence)
 *   - the proposed master_place's category, source_count and CONTRIBUTING
 *     source_ids (what actually backs it)
 *   - ALTERNATE targets from elsewhere in the corpus, via the repo's own
 *     `findCandidates()` RPC, scored with the same Jaro-Winkler-over-
 *     normalizeName pairing `scoreMatch()` uses.
 *
 * The alternate search exists because of the AZ precedent: two records there
 * looked like rejects but had a correctly-named target sitting elsewhere in the
 * corpus. Recommending "reject" without looking for a better home repeats that
 * mistake.
 *
 * WRITES NOTHING. Never call with --apply/--write; this script has no such path.
 *
 * Target is whatever SUPABASE_URL points at — export PROD creds inline rather
 * than editing data/.env:
 *   export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
 *   npx tsx scripts/state-parks-prod-triage-report.ts --source washington_state_parks
 */

import { createClient } from "@supabase/supabase-js";
import natural from "natural";
import { findCandidates, normalizeName } from "../entity-resolution/matcher.ts";

const jaroWinkler = natural.JaroWinklerDistance;
function requireSourceArg(): string {
  const i = process.argv.indexOf("--source");
  const v = i === -1 ? undefined : process.argv[i + 1];
  if (!v) throw new Error("usage: state-parks-prod-triage-report.ts --source <source_id>");
  return v;
}
const SOURCE_ID = requireSourceArg();
/** Wide enough to catch a better-named unit a few km away; ER's default is 500m. */
const ALT_RADIUS_M = 8000;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

function sim(a: string, b: string): number {
  return jaroWinkler(normalizeName(a), normalizeName(b));
}

function fmt(n: number | null | undefined, dp = 3): string {
  return typeof n === "number" ? n.toFixed(dp) : "n/a";
}

async function main(): Promise<void> {
  const target = process.env.SUPABASE_URL ?? "(unset)";
  console.log(`READ-ONLY triage report — ${SOURCE_ID}\ntarget: ${target}\n`);

  const srs = await sb
    .from("source_record")
    .select("id, external_id, name, inferred_category, master_place_id")
    .eq("source_id", SOURCE_ID)
    .is("master_place_id", null);
  if (srs.error || srs.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(srs.error)}`);
  const byId = new Map(srs.data.map((r) => [String(r.id), r]));
  const ids = [...byId.keys()];
  console.log(`unlinked source_records: ${ids.length}\n`);

  const pending: {
    pmId: string;
    srId: string;
    mpId: string;
    nameSim: number | null;
    distM: number | null;
    catCompat: number | null;
    conf: number | null;
  }[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb
      .from("place_match")
      .select("id, source_record_id, master_place_id, name_similarity, distance_meters, category_compatibility, combined_confidence")
      .eq("status", "pending")
      .in("source_record_id", ids.slice(i, i + 200));
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [place_match]: ${JSON.stringify(r.error)}`);
    for (const m of r.data) {
      pending.push({
        pmId: String(m.id),
        srId: String(m.source_record_id),
        mpId: String(m.master_place_id),
        nameSim: typeof m.name_similarity === "number" ? m.name_similarity : null,
        distM: typeof m.distance_meters === "number" ? m.distance_meters : null,
        catCompat: typeof m.category_compatibility === "number" ? m.category_compatibility : null,
        conf: typeof m.combined_confidence === "number" ? m.combined_confidence : null,
      });
    }
  }
  console.log(`pending place_match rows: ${pending.length}\n${"=".repeat(78)}`);

  // Sort weakest-confidence first — those need the most scrutiny.
  pending.sort((a, b) => (a.conf ?? 0) - (b.conf ?? 0));

  let n = 0;
  for (const p of pending) {
    n += 1;
    const sr = byId.get(p.srId);
    const srName = String(sr?.name ?? "?");
    const extId = String(sr?.external_id ?? "?");

    const mp = await sb
      .from("master_place")
      .select("canonical_name, primary_category, source_count, alternative_names")
      .eq("id", p.mpId)
      .maybeSingle();
    const mpName = String(mp.data?.canonical_name ?? "?");
    const mpCat = String(mp.data?.primary_category ?? "?");
    const mpSrcCount = mp.data?.source_count ?? "?";

    // What actually backs the proposed target?
    const backing = await sb.from("source_record").select("source_id").eq("master_place_id", p.mpId);
    const backingIds = backing.error ? ["(query failed)"] : [...new Set((backing.data ?? []).map((x) => String(x.source_id)))].sort();

    const proposedSim = sim(srName, mpName);

    // Alternate targets elsewhere in the corpus.
    let alts: { id: string; canonical_name: string; primary_category: string; distance_m: number; s: number }[] = [];
    try {
      const cands = await findCandidates(p.srId, ALT_RADIUS_M);
      alts = cands
        .map((c) => ({ ...c, s: sim(srName, c.canonical_name) }))
        .filter((c) => c.id !== p.mpId)
        .sort((a, b) => b.s - a.s)
        .slice(0, 3);
    } catch (err) {
      console.log(`   (findCandidates failed: ${String(err)})`);
    }
    const bestAlt = alts[0];

    // Recommendation. normalizeName strips category suffixes (SP/SB/SHP/NP…),
    // so a near-1.0 score means "same unit, different abbreviation".
    let rec: string;
    if (bestAlt && bestAlt.s > proposedSim + 0.08 && bestAlt.s >= 0.85) {
      rec = `RELINK → ${bestAlt.canonical_name} (${bestAlt.id.slice(0, 8)}, sim ${fmt(bestAlt.s)})`;
    } else if (proposedSim >= 0.90) {
      rec = "LINK";
    } else if (proposedSim >= 0.75) {
      rec = "LINK (probable — verify)";
    } else if (proposedSim < 0.55 && !(bestAlt && bestAlt.s >= 0.85)) {
      rec = "REJECT → new master_place (no good target found)";
    } else {
      rec = "UNCLEAR — needs eyes";
    }

    console.log(`\n[${String(n).padStart(2)}] ${srName}`);
    console.log(`     external_id : ${extId}`);
    console.log(`     src category: ${String(sr?.inferred_category ?? "?")}`);
    console.log(`     PROPOSED    : ${mpName}  (${p.mpId.slice(0, 8)})`);
    console.log(`                   category=${mpCat}  source_count=${String(mpSrcCount)}  backed_by=${JSON.stringify(backingIds)}`);
    console.log(`     scores      : name_sim=${fmt(p.nameSim)}  dist_m=${fmt(p.distM, 1)}  cat_compat=${fmt(p.catCompat)}  confidence=${fmt(p.conf)}`);
    console.log(`     norm-name similarity to proposed: ${fmt(proposedSim)}`);
    if (alts.length) {
      console.log(`     alternates within ${ALT_RADIUS_M}m:`);
      for (const a of alts) {
        console.log(`        sim ${fmt(a.s)}  ${a.canonical_name}  (${a.id.slice(0, 8)}, ${a.primary_category}, ${a.distance_m.toFixed(0)}m)`);
      }
    } else {
      console.log(`     alternates within ${ALT_RADIUS_M}m: none`);
    }
    console.log(`     >>> ${rec}`);
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
