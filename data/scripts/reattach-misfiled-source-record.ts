/**
 * Reattach a source_record that is misfiled onto the wrong master_place.
 *
 * THE BUG PATTERN THIS FIXES (found 2026-09-04 across groups 77, 41, 68 and
 * 78's cave): a visitor-content source_record for park X is attached to the
 * master_place for park Y, where X already exists as its own master_place.
 * The symptom is that Y's resolved description is about X — e.g. a
 * master_place named "Bothe-Napa Valley SP" whose description is Bale Grist
 * Mill's water-powered grist mill.
 *
 * It is NOT a merge problem and merge_master_place() cannot fix it: the
 * offending record lives INSIDE one master_place rather than being a separate
 * group member, so `excluded_ids` has no purchase on it.
 *
 * What this does, in one transaction's worth of steps:
 *   1. Repoints the source_record to its correct master_place.
 *   2. Recomputes BOTH master_places, so the loser drops the foreign field
 *      values and the winner picks the record up.
 *
 * SAFETY POSTURE (mirrors execute-merge-groups.ts):
 *   - Dry-run by default. --confirm required for any write.
 *   - PROD requires BOTH --target=prod AND --confirm-prod.
 *   - Refuses if the source_record is not currently on --from.
 *   - Refuses if --to does not exist.
 *   - Prints both master_places' description before and after.
 *
 * Usage:
 *   # preview
 *   npx tsx data/scripts/reattach-misfiled-source-record.ts \
 *     --external-id oregon_state_parks:170 \
 *     --from 18fcb124-29bf-4af2-9419-0753781a63bc \
 *     --to   c0d6a01b-2481-4a09-8367-6bf7b296b98d --dry-run
 *
 *   # TEST write
 *   ... --target=test --confirm
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";

interface Args {
  externalId: string; from: string; to: string;
  target: "test" | "prod"; confirm: boolean; confirmProd: boolean; dryRun: boolean;
}

function parseArgs(): Args {
  const a: Args = { externalId: "", from: "", to: "", target: "test", confirm: false, confirmProd: false, dryRun: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--external-id") a.externalId = argv[++i];
    else if (k === "--from") a.from = argv[++i];
    else if (k === "--to") a.to = argv[++i];
    else if (k.startsWith("--target=")) {
      const t = k.split("=")[1];
      if (t !== "test" && t !== "prod") throw new Error(`--target must be test or prod`);
      a.target = t;
    } else if (k === "--confirm") a.confirm = true;
    else if (k === "--confirm-prod") a.confirmProd = true;
    else if (k === "--dry-run") a.dryRun = true;
    else throw new Error(`unknown arg: ${k}`);
  }
  if (!a.externalId || !a.from || !a.to) throw new Error("--external-id, --from and --to are all required.");
  if (!a.dryRun && !a.confirm) throw new Error("--confirm required for writes (or use --dry-run).");
  if (a.target === "prod" && !a.dryRun && !a.confirmProd) throw new Error("PROD writes require --confirm-prod as well as --confirm.");
  return a;
}

function parseEnvFile(p: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("="); if (eq === -1) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[line.slice(0, eq).trim()] = v;
  }
  return out;
}

function makeClient(target: "test" | "prod"): SupabaseClient {
  const env = parseEnvFile(join(REPO, target === "prod" ? "web/.env.local" : "data/.env"));
  const url = target === "prod" ? env.NEXT_PUBLIC_SUPABASE_URL : env.SUPABASE_URL;
  const expected = target === "prod" ? PROD_HOST : TEST_HOST;
  if (!url || !url.includes(expected)) throw new Error(`SAFETY: --target=${target} but resolved url ${url} is not ${expected}`);
  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function describe(c: SupabaseClient, id: string, label: string): Promise<void> {
  const r = await c.from("master_place").select("canonical_name,description,attribution,source_count").eq("id", id).maybeSingle();
  if (r.error) throw new Error(`read ${id}: ${JSON.stringify(r.error)}`);
  const d = r.data as { canonical_name: string; description: string | null; attribution: Record<string, string> | null; source_count: number } | null;
  if (!d) { console.log(`  ${label}: (row not found)`); return; }
  const head = (d.description ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 110);
  console.log(`  ${label}: '${d.canonical_name}' sources=${d.source_count} desc_from=${d.attribution?.description ?? "(none)"}`);
  console.log(`      "${head}${head.length === 110 ? "…" : ""}"`);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const c = makeClient(args.target);
  console.log(`target=${args.target} dry-run=${args.dryRun}`);
  console.log(`reattach ${args.externalId}: ${args.from} -> ${args.to}\n`);

  const sr = await c.from("source_record").select("id,master_place_id,source_id,name").eq("external_id", args.externalId).maybeSingle();
  if (sr.error) throw new Error(`source_record lookup FAILED: ${JSON.stringify(sr.error)}`);
  const row = sr.data as { id: string; master_place_id: string; source_id: string; name: string } | null;
  if (!row) throw new Error(`source_record ${args.externalId} not found`);
  if (row.master_place_id !== args.from) {
    throw new Error(`SAFETY: ${args.externalId} is on ${row.master_place_id}, not --from ${args.from}. Refusing.`);
  }
  const dest = await c.from("master_place").select("id").eq("id", args.to).maybeSingle();
  if (dest.error || !dest.data) throw new Error(`SAFETY: --to ${args.to} does not exist. Refusing.`);
  console.log(`source_record: ${row.source_id} name='${row.name}'\n`);

  console.log("BEFORE:");
  await describe(c, args.from, "from");
  await describe(c, args.to, "to  ");

  if (args.dryRun) { console.log("\n=== DRY-RUN — no writes ==="); return; }

  const upd = await c.from("source_record").update({ master_place_id: args.to }).eq("id", row.id);
  if (upd.error) throw new Error(`repoint FAILED: ${JSON.stringify(upd.error)}`);
  for (const id of [args.from, args.to]) {
    const rp = await c.rpc("recompute_master_place", { p_master_place_id: id });
    if (rp.error) throw new Error(`recompute ${id} FAILED: ${JSON.stringify(rp.error)}`);
  }

  console.log("\nAFTER:");
  await describe(c, args.from, "from");
  await describe(c, args.to, "to  ");
  console.log("\n=== DONE ===");
}

main().catch((e: unknown) => { console.error("FATAL:", e instanceof Error ? e.message : String(e)); process.exit(1); });
