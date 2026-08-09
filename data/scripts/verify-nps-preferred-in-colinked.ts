/**
 * STEP 5 verification: for each master_place co-linked to BOTH nps and ridb
 * within the STEP-4 corridor sample, confirm the URL returned by
 * pois_along_corridor.nps_photo_url is the NPS one, not the RIDB one.
 *
 * Method:
 *   1. Repeat the RPC call from verify-rpc-photo-widening (same route/buffer)
 *   2. For each returned tile that is co-linked, pull both source_records and
 *      compare the emitted url against each
 *   3. Report per-row: which source's photo won, and if none / other, why
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "unknown";
  console.log(`[env] target: ${ref}`);

  const route = { type: "LineString", coordinates: [[-120.0, 35.0], [-114.0, 37.0]] };
  const bufferM = 500_000;
  const { data: rpcRows, error: e1 } = await db.rpc("pois_along_corridor", {
    p_route: route,
    p_buffer_m: bufferM,
    p_categories: null,
  });
  if (e1) throw e1;
  const rows = rpcRows as Array<{ id: string; canonical_name: string; nps_photo_url: string | null }>;

  // Which of the returned tiles are co-linked (both nps + ridb)?
  const bySource = new Map<string, Set<string>>();
  for (let i = 0; i < rows.length; i += 200) {
    const slice = rows.slice(i, i + 200).map((r) => r.id);
    const { data: srs, error: e2 } = await db
      .from("source_record")
      .select("master_place_id, source_id")
      .in("master_place_id", slice);
    if (e2) throw e2;
    for (const sr of (srs ?? []) as Array<{ master_place_id: string; source_id: string }>) {
      if (!bySource.has(sr.master_place_id)) bySource.set(sr.master_place_id, new Set());
      bySource.get(sr.master_place_id)!.add(sr.source_id);
    }
  }
  const coLinked = rows.filter((r) => {
    const s = bySource.get(r.id) ?? new Set<string>();
    return s.has("nps") && s.has("ridb");
  });
  console.log(`\ntiles returned: ${rows.length}`);
  console.log(`co-linked (nps + ridb): ${coLinked.length}`);

  // For each co-linked tile, fetch the actual photo url stored in each source
  console.log(`\nper-tile verdict:`);
  console.log(`  ${"id".padEnd(38)}  ${"name".padEnd(38)}  emitted → source`);
  let npsWins = 0;
  let ridbWins = 0;
  let neither = 0;
  let mismatchOrOther = 0;
  for (const t of coLinked) {
    const { data: srs, error } = await db
      .from("source_record")
      .select("source_id, normalized_payload")
      .eq("master_place_id", t.id)
      .in("source_id", ["nps", "ridb"]);
    if (error) throw error;
    const npsUrl = (
      (srs ?? []).find((r) => r.source_id === "nps")?.normalized_payload as
        | { photo?: { url?: string } | null }
        | null
    )?.photo?.url ?? null;
    const ridbUrl = (
      (srs ?? []).find((r) => r.source_id === "ridb")?.normalized_payload as
        | { photo?: { url?: string } | null }
        | null
    )?.photo?.url ?? null;
    const emitted = t.nps_photo_url;

    let verdict: string;
    if (emitted == null) {
      neither += 1;
      verdict = `NONE (nps=${npsUrl ? "photo" : "null"}, ridb=${ridbUrl ? "photo" : "null"})`;
    } else if (emitted === npsUrl && emitted !== ridbUrl) {
      npsWins += 1;
      verdict = "NPS";
    } else if (emitted === ridbUrl && emitted !== npsUrl) {
      ridbWins += 1;
      verdict = `RIDB (nps=${npsUrl ? "photo" : "null"} present but not chosen)`;
    } else if (emitted === npsUrl && emitted === ridbUrl) {
      npsWins += 1;
      verdict = "NPS/RIDB identical (impossible collision — count as NPS)";
    } else {
      mismatchOrOther += 1;
      verdict = `MISMATCH — emitted url doesn't match either source`;
    }
    console.log(`  ${t.id.padEnd(38)}  ${(t.canonical_name ?? "").slice(0, 38).padEnd(38)}  → ${verdict}`);
  }

  console.log(`\nsummary:`);
  console.log(`  NPS wins       : ${npsWins} / ${coLinked.length}`);
  console.log(`  RIDB wins      : ${ridbWins} / ${coLinked.length}   (should be 0 when NPS has a photo)`);
  console.log(`  neither (null) : ${neither} / ${coLinked.length}   (both sources have photo=null)`);
  console.log(`  mismatch/other : ${mismatchOrOther}`);

  // Success criterion: for every co-linked tile whose NPS source has a photo,
  // the emitted url must match the NPS url. RIDB should only win if NPS has null.
  let violations = 0;
  for (const t of coLinked) {
    const { data: srs } = await db
      .from("source_record")
      .select("source_id, normalized_payload")
      .eq("master_place_id", t.id)
      .in("source_id", ["nps", "ridb"]);
    const npsUrl = (
      (srs ?? []).find((r) => r.source_id === "nps")?.normalized_payload as
        | { photo?: { url?: string } | null }
        | null
    )?.photo?.url ?? null;
    if (npsUrl && t.nps_photo_url !== npsUrl) {
      violations += 1;
      console.log(`  VIOLATION: tile ${t.id} has NPS photo but emitted ${t.nps_photo_url ?? "null"}`);
    }
  }
  if (violations === 0) console.log(`\n✓ ORDER BY 'nps' preferred over 'ridb' — no violations.`);
  else console.log(`\n✗ ${violations} violations — NPS-preferred ORDER BY did not win in all cases.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
