/**
 * TEST-only, READ-only. Closes L1: measures nps_only / ridb_only / both /
 * neither buckets at CORPUS scale (all 1,749 searchable non-land_status
 * master_places) by direct source_record queries — bypasses the RPC's
 * 1000-row REST pagination cap.
 *
 * Also reports how many tiles carry a photo (per bucket), using the same
 * "source has non-null normalized_payload.photo.url" predicate the RPC's
 * lateral evaluates.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

async function pageAll<T>(fn: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const page = await fn(from, from + size - 1);
    out.push(...page);
    if (page.length < size) break;
    from += size;
  }
  return out;
}

async function main() {
  const db: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  const allowProd = process.argv.includes("--allow-prod");
  if (ref !== "znldzjdatkogdktymtvi" && !allowProd) {
    throw new Error(`Refusing: not TEST (got ${ref}). Pass --allow-prod to explicitly authorize a PROD read.`);
  }
  console.log(`[env] ${ref === "nqzeywzcowujzyegxbsr" ? "PROD" : "TEST"} ${ref}`);

  // 1. Enumerate every searchable non-land_status master_place id
  const searchableRows = await pageAll<{ id: string }>(async (from, to) => {
    const { data, error } = await db
      .from("master_place")
      .select("id")
      .eq("is_searchable", true)
      .neq("primary_category", "land_status")
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as { id: string }[];
  });
  const searchableIds = new Set(searchableRows.map((r) => r.id));
  console.log(`\n[corpus] searchable non-land_status master_places: ${searchableIds.size}`);

  // 2. Enumerate every source_record linked to master_place, project source_id
  //    + photo presence + master_place_id
  const srRows = await pageAll<{
    master_place_id: string;
    source_id: string;
    normalized_payload: { photo?: { url?: string } | null } | null;
  }>(async (from, to) => {
    const { data, error } = await db
      .from("source_record")
      .select("master_place_id, source_id, normalized_payload")
      .not("master_place_id", "is", null)
      .in("source_id", ["nps", "ridb"])
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as any[];
  });
  console.log(`[corpus] source_records with source_id in (nps, ridb) and linked: ${srRows.length}`);

  // 3. Per master_place: which sources link + which have photo url
  type SrcState = {
    npsLinked: boolean;
    ridbLinked: boolean;
    npsHasPhoto: boolean;
    ridbHasPhoto: boolean;
  };
  const perMp = new Map<string, SrcState>();
  for (const r of srRows) {
    if (!searchableIds.has(r.master_place_id)) continue;
    const s = perMp.get(r.master_place_id) ?? {
      npsLinked: false,
      ridbLinked: false,
      npsHasPhoto: false,
      ridbHasPhoto: false,
    };
    const photoUrl = r.normalized_payload?.photo?.url;
    const hasPhoto = typeof photoUrl === "string" && photoUrl.length > 0;
    if (r.source_id === "nps") {
      s.npsLinked = true;
      if (hasPhoto) s.npsHasPhoto = true;
    } else if (r.source_id === "ridb") {
      s.ridbLinked = true;
      if (hasPhoto) s.ridbHasPhoto = true;
    }
    perMp.set(r.master_place_id, s);
  }

  // 4. Bucket every searchable id
  const b = {
    nps_only: 0,
    ridb_only: 0,
    both: 0,
    neither: 0,
  };
  const p = {
    nps_only: 0,
    ridb_only: 0,
    both: 0,
    neither: 0,
  };
  // For "both" tiles: which source's photo would the RPC pick?
  let both_nps_wins = 0;
  let both_ridb_wins = 0;
  let both_neither_photo = 0;

  for (const id of searchableIds) {
    const s = perMp.get(id);
    const hasNps = !!s?.npsLinked;
    const hasRidb = !!s?.ridbLinked;
    const npsPhoto = !!s?.npsHasPhoto;
    const ridbPhoto = !!s?.ridbHasPhoto;
    // Same predicate the RPC lateral evaluates: WHERE photo url IS NOT NULL,
    // ORDER BY nps=0, ridb=1, LIMIT 1
    const wouldEmit = npsPhoto || ridbPhoto;

    if (hasNps && hasRidb) {
      b.both++;
      if (wouldEmit) p.both++;
      if (npsPhoto) both_nps_wins++;
      else if (ridbPhoto) both_ridb_wins++;
      else both_neither_photo++;
    } else if (hasNps) {
      b.nps_only++;
      if (wouldEmit) p.nps_only++;
    } else if (hasRidb) {
      b.ridb_only++;
      if (wouldEmit) p.ridb_only++;
    } else {
      b.neither++;
      if (wouldEmit) p.neither++;
    }
  }

  console.log(`\n[corpus] tile composition (all ${searchableIds.size} searchable non-land_status tiles)`);
  console.log(`  bucket        tiles   would-emit-photo`);
  console.log(`  nps_only      ${String(b.nps_only).padStart(5)}   ${p.nps_only}`);
  console.log(`  ridb_only     ${String(b.ridb_only).padStart(5)}   ${p.ridb_only}`);
  console.log(`  both          ${String(b.both).padStart(5)}   ${p.both}`);
  console.log(`  neither       ${String(b.neither).padStart(5)}   ${p.neither}`);
  console.log(`  TOTAL         ${String(searchableIds.size).padStart(5)}   ${p.nps_only + p.ridb_only + p.both + p.neither}`);

  console.log(`\n[both bucket — ORDER BY resolution]`);
  console.log(`  NPS wins        : ${both_nps_wins}`);
  console.log(`  RIDB wins (NPS null) : ${both_ridb_wins}`);
  console.log(`  neither has photo : ${both_neither_photo}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
