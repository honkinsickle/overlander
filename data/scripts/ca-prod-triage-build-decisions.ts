/**
 * Build the CA PROD triage decisions file from the LIVE pending queue.
 *
 * READ-ONLY against the database; its only write is the JSON file it emits.
 *
 * Generated rather than hand-written so the 25 `link` entries carry exactly the
 * external_ids the queue actually holds — transcribing 28 rows by hand is how a
 * decision ends up pointed at the wrong record.
 *
 * The 3 `relink` overrides are keyed by external_id and their targets are
 * resolved BY NAME, then asserted against the UUID prefix recorded in the
 * signed-off report (data/scripts/ca-prod-triage-report.ts output). If a name
 * resolves to a different row than the one reviewed, this fails loudly rather
 * than silently relinking to something nobody approved.
 *
 * Usage (PROD creds exported inline):
 *   npx tsx scripts/ca-prod-triage-build-decisions.ts <out.json>
 */

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const SOURCE_ID = "california_state_parks";

/** The three overrides Adam signed off. Targets resolved by name, prefix-asserted. */
const RELINKS = [
  {
    external_id: "california_state_parks:569",
    sourceName: "Ishxenta State Park",
    targetName: "Ishxenta SP",
    expectPrefix: "453d4ecf",
    notes:
      "Manual triage RELINK: ER proposed Point Lobos Ridge NP (conf 0.389). The correctly-named unit Ishxenta SP (state_parks:CA:park:435) sits 2643m away and is the right target. TEST rejected this record to a new master_place; on PROD that would have duplicated the existing Ishxenta SP.",
  },
  {
    external_id: "california_state_parks:629",
    sourceName: "Topanga State Park",
    targetName: "Topanga SP",
    expectPrefix: "710517ba",
    notes:
      "Manual triage RELINK: ER proposed Topanga CP (sim 0.883, 274m). Topanga SP (state_parks:CA:park:572, 1294m, sim 0.918) is the correct unit — CP and SP are different designations, a distinction the raw score cannot see.",
  },
  {
    external_id: "california_state_parks:461",
    sourceName: "Colusa-Sacramento River State Recreation Area",
    targetName: "Colusa-Sacramento River SRA",
    expectPrefix: "2957ec6f",
    notes:
      "Manual triage RELINK: ER proposed the Colusa-Sacramento River Campground (category=campground, sim 0.959). The source record is the SRA itself (inferred_category=recreation_area); Colusa-Sacramento River SRA (state_parks:CA:park:140, 1154m, sim 0.972) is the right home, not its campground sub-unit.",
  },
] as const;

const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Decision {
  external_id: string;
  action: "link" | "relink" | "reject";
  target_mp_id?: string;
  notes?: string;
}

async function main(): Promise<void> {
  const outPath = process.argv[2];
  if (!outPath) throw new Error("usage: ca-prod-triage-build-decisions.ts <out.json>");
  console.log(`target db: ${process.env.SUPABASE_URL}`);

  // Live pending queue.
  const srs = await sb
    .from("source_record")
    .select("id, external_id, name")
    .eq("source_id", SOURCE_ID)
    .is("master_place_id", null);
  if (srs.error || srs.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(srs.error)}`);
  const byId = new Map(srs.data.map((r) => [String(r.id), r]));

  const pending: { externalId: string; name: string; proposedMpId: string }[] = [];
  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const r = await sb
      .from("place_match")
      .select("source_record_id, master_place_id")
      .eq("status", "pending")
      .in("source_record_id", ids.slice(i, i + 200));
    if (r.error || r.data == null) throw new Error(`QUERY FAILED [place_match]: ${JSON.stringify(r.error)}`);
    for (const m of r.data) {
      const sr = byId.get(String(m.source_record_id));
      pending.push({
        externalId: String(sr?.external_id ?? "?"),
        name: String(sr?.name ?? "?"),
        proposedMpId: String(m.master_place_id),
      });
    }
  }
  console.log(`live pending queue: ${pending.length}`);

  // Resolve each relink target by name, then assert it is the reviewed row.
  const relinkById = new Map<string, Decision>();
  for (const rl of RELINKS) {
    const q = await sb.from("master_place").select("id, canonical_name").eq("canonical_name", rl.targetName);
    if (q.error || q.data == null) throw new Error(`QUERY FAILED [${rl.targetName}]: ${JSON.stringify(q.error)}`);
    if (q.data.length !== 1) {
      throw new Error(`RELINK target '${rl.targetName}' matched ${q.data.length} rows — refusing to guess`);
    }
    const id = String(q.data[0].id);
    if (!id.startsWith(rl.expectPrefix)) {
      throw new Error(
        `RELINK target '${rl.targetName}' resolved to ${id}, which does not match the reviewed ${rl.expectPrefix}… — refusing`,
      );
    }
    if (!pending.some((p) => p.externalId === rl.external_id)) {
      throw new Error(`RELINK external_id ${rl.external_id} is not in the live pending queue — refusing`);
    }
    relinkById.set(rl.external_id, {
      external_id: rl.external_id,
      action: "relink",
      target_mp_id: id,
      notes: rl.notes,
    });
    console.log(`  relink ${rl.external_id}  ${rl.sourceName} → ${rl.targetName} (${id})`);
  }

  const decisions: Decision[] = [];
  for (const p of pending) {
    const override = relinkById.get(p.externalId);
    if (override) {
      decisions.push(override);
      continue;
    }
    decisions.push({
      external_id: p.externalId,
      action: "link",
      notes: `Manual triage LINK: ${p.name} → ER's proposed target (GIS name-abbreviation pair; Adam-approved 2026-09-02).`,
    });
  }

  const links = decisions.filter((d) => d.action === "link").length;
  const relinks = decisions.filter((d) => d.action === "relink").length;
  const rejects = decisions.filter((d) => d.action === "reject").length;
  console.log(`\ndecisions: ${decisions.length} total — ${links} link, ${relinks} relink, ${rejects} reject`);
  if (decisions.length !== pending.length) throw new Error("decision count != queue size — refusing to write");
  if (relinks !== RELINKS.length) throw new Error(`expected ${RELINKS.length} relinks, built ${relinks}`);

  writeFileSync(outPath, JSON.stringify(decisions, null, 2) + "\n");
  console.log(`wrote ${outPath}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
