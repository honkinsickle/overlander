/**
 * Merge executor — real writes to master_place via the merge_master_place()
 * stored function.
 *
 * See:
 *   - supabase/migrations/20260903195200_merge_master_place.sql (the function
 *     + merge_audit_log table)
 *   - data/scripts/merge-preview-same-pairs.ts (dry-run — this executor's
 *     canonical-selection logic is IDENTICAL, via the shared lib)
 *   - docs/investigations/2026-09-03-merge-executor.md
 *
 * SAFETY POSTURE (do not weaken without doc update):
 *
 *   1. Refuses to run without --confirm.
 *   2. Refuses PROD writes without BOTH --target=prod AND --confirm-prod
 *      (deliberately two flags; --target=prod alone is not enough).
 *   3. Refuses without --groups <id,id,...> — no "run against everything"
 *      mode. Groups are explicit.
 *   4. Blocks known-ambiguous groups (6 and 83 today, per PR #379) unless
 *      --force-blocked. The block list is a hardcoded constant here, not
 *      a runtime lookup, so it survives even if the dry-run tool's output
 *      is stale.
 *   5. Loads the SAME group definitions the dry-run preview produced
 *      (from .context/merge-preview-groups.json) — same canonical rule
 *      via the shared lib, no per-executor divergence.
 *   6. Every merge is one atomic RPC call to merge_master_place().
 *      Partial-failure → server-side rollback of that group's transaction,
 *      audit row rolls back with it. Nothing lands half-done.
 *   7. Writes a local audit JSON copy alongside each RPC call to
 *      .context/execute-merge-audit-<timestamp>-group-<n>.json — belt-and-
 *      suspenders against loss of merge_audit_log rows (unlikely; a hedge).
 *   8. Prints canonical/absorbed IDs + moves per group so an operator can
 *      trace what happened in the terminal.
 *   9. Honours a group's optional `excluded_ids`: members the grouping pulled
 *      in that a human has ruled are NOT the same real-world place. They are
 *      never sent to merge_master_place(), so the row is left completely
 *      untouched — no absorb, no source_record move, no relationship edge.
 *      The canonical is re-picked over the MERGING members only.
 *
 * Usage:
 *   # Dry-run against a specific group (default target=test, no writes)
 *   npx tsx data/scripts/execute-merge-groups.ts --groups 12 --dry-run
 *
 *   # TEST write (validation)
 *   npx tsx data/scripts/execute-merge-groups.ts --groups 12,39,51 --target=test --confirm
 *
 *   # PROD write (real)
 *   npx tsx data/scripts/execute-merge-groups.ts --groups 12 --target=prod --confirm --confirm-prod
 *
 *   # Override the block list (if Adam has decided Group 83 explicitly)
 *   npx tsx data/scripts/execute-merge-groups.ts --groups 83 --target=test --confirm --force-blocked
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  pickCanonicalGroup,
  resolveGroupMembers,
  type MemberForCanonical,
} from "./lib/merge-canonical.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";

/**
 * Groups blocked by default until Adam explicitly resolves them (PR #379).
 * These are the group_id values from the dry-run tool's output:
 *   6  — Salton Sea SRA vs "Salton Sea" (probably should move to DIFFERENT)
 *   83 — Hat Rock (OR), 3-way with intra-NPS duplicate
 */
const DEFAULT_BLOCKED_GROUPS = new Set<number>([6, 83]);

interface CliArgs {
  groups: number[];
  target: "test" | "prod";
  confirm: boolean;
  confirmProd: boolean;
  dryRun: boolean;
  forceBlocked: boolean;
  input: string;
  notes: string | null;
  executedBy: string;
}

function parseArgs(): CliArgs {
  const argv = process.argv.slice(2);
  const args: CliArgs = {
    groups: [],
    target: "test",
    confirm: false,
    confirmProd: false,
    dryRun: false,
    forceBlocked: false,
    input: join(REPO, ".context/merge-preview-groups.json"),
    notes: null,
    executedBy: `execute-merge-groups.ts@${process.env.USER ?? "unknown"}`,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--groups") {
      args.groups = argv[++i].split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
    } else if (a.startsWith("--target=")) {
      const t = a.split("=")[1];
      if (t !== "test" && t !== "prod") throw new Error(`--target must be test or prod, got ${t}`);
      args.target = t;
    } else if (a === "--target") {
      const t = argv[++i];
      if (t !== "test" && t !== "prod") throw new Error(`--target must be test or prod, got ${t}`);
      args.target = t;
    } else if (a === "--confirm") args.confirm = true;
    else if (a === "--confirm-prod") args.confirmProd = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force-blocked") args.forceBlocked = true;
    else if (a === "--input") args.input = argv[++i];
    else if (a.startsWith("--notes=")) args.notes = a.substring("--notes=".length);
    else if (a === "--notes") args.notes = argv[++i];
    else if (a === "--executed-by") args.executedBy = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  if (args.groups.length === 0) {
    throw new Error("--groups <id,id,...> is REQUIRED. This tool refuses to run against everything.");
  }
  if (!args.dryRun && !args.confirm) {
    throw new Error("--confirm required for writes (or use --dry-run to preview).");
  }
  if (args.target === "prod" && !args.dryRun && !args.confirmProd) {
    throw new Error("PROD writes require --confirm-prod in addition to --confirm.");
  }
  return args;
}

interface MemberSide {
  id: string;
  canonical_name: string;
  source_ids: string[];
  source_count: number;
  has_polygon: boolean;
}

interface GroupIn {
  group_id: number;
  size: number;
  states: string[];
  canonical_mp_id: string | null;
  canonical_reason: string;
  absorbed_mp_ids: string[];
  member_sides: MemberSide[];
  pair_keys: string[];
  conflict_summary: string[];
  risk_summary: string[];
  /**
   * Members that the grouping pulled in but that a human has ruled are NOT
   * the same real-world place. They stay listed in `member_sides` (so the
   * record of the decision survives) but are never sent to
   * merge_master_place(). Optional — absent means "merge every member".
   */
  excluded_ids?: string[];
}

/**
 * The concrete write plan for one group, after exclusions are applied.
 * Everything downstream — the drift check, the printout and the RPC call —
 * reads THIS, never `g.absorbed_mp_ids` directly, so an excluded member
 * cannot leak into a write through a path that forgot to filter.
 */
interface GroupPlan {
  canonicalId: string;
  absorbedIds: string[];
  excluded: MemberSide[];
  canonicalReason: string;
}

function readGroups(path: string): GroupIn[] {
  if (!existsSync(path)) throw new Error(`group input file not found: ${path}`);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) throw new Error("groups input must be an array");
  return raw as GroupIn[];
}

function makeClient(target: "test" | "prod"): SupabaseClient {
  const envPath = target === "prod" ? "web/.env.local" : "data/.env";
  const env = parseEnvFile(join(REPO, envPath));
  const url = target === "prod" ? env.NEXT_PUBLIC_SUPABASE_URL : env.SUPABASE_URL;
  const key = target === "prod" ? env.SUPABASE_SERVICE_ROLE_KEY : env.SUPABASE_SERVICE_ROLE_KEY;
  const expected = target === "prod" ? PROD_HOST : TEST_HOST;
  if (!url || !url.includes(expected)) {
    throw new Error(`SAFETY: --target=${target} but resolved url ${url} is not ${expected}`);
  }
  return createClient(url, key, { auth: { persistSession: false } });
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

/**
 * Build the write plan for one group and sanity-check it.
 *
 * Two things happen here, in this order, and the order matters:
 *   1. Exclusions are applied, so the canonical is picked over the members
 *      that will ACTUALLY merge. Picking first and excluding second could
 *      elect a canonical that is then held out of its own merge.
 *   2. The re-picked canonical is compared against the one recorded in the
 *      input file. Guards against a stale input whose canonical was computed
 *      against a different roster than the rule would produce today.
 *
 * Throws on any inconsistency — this feeds a write path.
 */
function planGroup(g: GroupIn): GroupPlan {
  const asCanonical = (m: MemberSide): MemberForCanonical => ({ id: m.id, source_ids: m.source_ids });

  if (g.excluded_ids?.includes(g.canonical_mp_id ?? "")) {
    throw new Error(
      `group ${g.group_id}: canonical_mp_id ${g.canonical_mp_id} is also in excluded_ids. ` +
        `Pick a different canonical or stop excluding it.`,
    );
  }

  const split = resolveGroupMembers(g.member_sides.map((m) => ({ ...m, ...asCanonical(m) })), g.excluded_ids);
  const pick = pickCanonicalGroup(split.merging.map(asCanonical));

  if (pick.canonical == null) {
    throw new Error(
      `group ${g.group_id}: canonical is undecidable over the merging members ` +
        `(${pick.reason}). Refusing to write.`,
    );
  }
  if (pick.canonical.id !== g.canonical_mp_id) {
    throw new Error(
      `group ${g.group_id}: canonical drift — input file says ${g.canonical_mp_id ?? "null"}, ` +
        `shared-lib says ${pick.canonical.id} over the ${split.merging.length} merging member(s). ` +
        `Refusing to write against stale dry-run output.`,
    );
  }

  const absorbedIds = split.merging.map((m) => m.id).filter((id) => id !== pick.canonical!.id);

  // Belt-and-suspenders: an excluded id must never reach the RPC.
  const leaked = absorbedIds.filter((id) => (g.excluded_ids ?? []).includes(id));
  if (leaked.length > 0) {
    throw new Error(`group ${g.group_id}: excluded id(s) leaked into absorbed set: ${leaked.join(",")}`);
  }

  // Regression guard for the 106 already-validated groups. The absorbed set is
  // now DERIVED (members minus canonical, minus exclusions) rather than read
  // verbatim from the file. That matches how the dry-run tool builds it
  // (merge-preview-same-pairs.ts:553), so a group with no exclusions must come
  // out byte-identical to before this capability existed. Assert it rather
  // than trusting the two derivations to stay in step.
  if (!g.excluded_ids || g.excluded_ids.length === 0) {
    const fromFile = [...g.absorbed_mp_ids].sort();
    const derived = [...absorbedIds].sort();
    if (JSON.stringify(fromFile) !== JSON.stringify(derived)) {
      throw new Error(
        `group ${g.group_id}: derived absorbed set differs from the input file's and no exclusions are declared. ` +
          `file=[${fromFile.join(",")}] derived=[${derived.join(",")}]. ` +
          `Refusing to write — the group file and the executor disagree about who merges.`,
      );
    }
  }

  return {
    canonicalId: pick.canonical.id,
    absorbedIds,
    excluded: split.excluded,
    canonicalReason: pick.reason,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(`args: target=${args.target} groups=[${args.groups.join(",")}] confirm=${args.confirm} confirm-prod=${args.confirmProd} dry-run=${args.dryRun} force-blocked=${args.forceBlocked}`);

  const allGroups = readGroups(args.input);
  console.log(`loaded ${allGroups.length} groups from ${args.input}`);

  // Filter to requested groups, in order
  const groupById = new Map(allGroups.map((g) => [g.group_id, g]));
  const missing = args.groups.filter((id) => !groupById.has(id));
  if (missing.length > 0) throw new Error(`groups not found in input: ${missing.join(",")}`);
  const requested = args.groups.map((id) => groupById.get(id)!);

  // Enforce the block list unless overridden
  const blocked = requested.filter((g) => DEFAULT_BLOCKED_GROUPS.has(g.group_id));
  if (blocked.length > 0) {
    if (!args.forceBlocked) {
      throw new Error(
        `blocked groups requested without --force-blocked: [${blocked.map((g) => g.group_id).join(",")}]. ` +
          `These are documented in PR #379 as needing Adam's manual decision.`,
      );
    } else {
      console.log(`⚠️  --force-blocked in effect. Proceeding on blocked groups: [${blocked.map((g) => g.group_id).join(",")}]`);
    }
  }

  // Refuse any group that dry-run marked undecidable — they don't have a canonical
  const undecidable = requested.filter((g) => !g.canonical_mp_id);
  if (undecidable.length > 0) {
    throw new Error(`group(s) have no canonical pick in input: [${undecidable.map((g) => g.group_id).join(",")}]`);
  }

  // Build every plan up front. planGroup() applies exclusions, re-picks the
  // canonical over the merging members and throws on drift, so a bad group
  // aborts the whole run BEFORE any group is written.
  const plans = new Map<number, GroupPlan>();
  for (const g of requested) {
    plans.set(g.group_id, planGroup(g));
  }

  if (args.dryRun) {
    console.log("\n=== DRY-RUN — no writes ===");
    for (const g of requested) {
      printGroupPlan(g, plans.get(g.group_id)!);
    }
    return;
  }

  // Real execution path
  const db = makeClient(args.target);
  const outDir = join(REPO, ".context");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");

  console.log(`\n=== EXECUTING against ${args.target.toUpperCase()} — ${requested.length} group(s) ===`);
  for (const g of requested) {
    const plan = plans.get(g.group_id)!;
    printGroupPlan(g, plan);
    console.log(`\n> calling merge_master_place() for group ${g.group_id} ...`);
    const rpc = await db.rpc("merge_master_place", {
      p_canonical_mp_id: plan.canonicalId,
      p_absorbed_mp_ids: plan.absorbedIds,
      p_executed_by: args.executedBy,
      p_target_env: args.target,
      p_group_id: g.group_id,
      p_notes:
        args.notes ??
        `merge-groups-executor group=${g.group_id}` +
          (plan.excluded.length > 0 ? ` excluded=${plan.excluded.map((m) => m.id).join("+")}` : ""),
    });
    if (rpc.error) {
      console.error(`\n✗ RPC FAILED for group ${g.group_id}:`, rpc.error);
      console.error("Server-side transaction rolled back for this group. Aborting further groups.");
      process.exit(2);
    }
    const audit = rpc.data as { audit_id: string; canonical_mp_id: string; absorbed_mp_ids: string[]; moves: Record<string, number>; target_env: string };
    console.log(`  ✓ audit_id=${audit.audit_id}`);
    console.log(`  moves: ${JSON.stringify(audit.moves)}`);
    // Local audit copy
    const localPath = join(outDir, `execute-merge-audit-${runStamp}-group-${g.group_id}.json`);
    writeFileSync(localPath, JSON.stringify({ ...audit, group_meta: g }, null, 2));
    console.log(`  local audit copy: ${localPath}`);
  }

  console.log(`\n=== DONE ===`);
  console.log(`Executed ${requested.length} merge(s) against ${args.target.toUpperCase()}.`);
  console.log(`Audit rows in public.merge_audit_log. Local copies in .context/execute-merge-audit-${runStamp}-*.json.`);
}

function printGroupPlan(g: GroupIn, plan: GroupPlan): void {
  console.log(`\n--- group ${g.group_id} (size ${g.size}, states ${g.states.join("+")}) ---`);
  const canonicalMember = g.member_sides.find((m) => m.id === plan.canonicalId);
  console.log(`  canonical: ${canonicalMember?.canonical_name} [${canonicalMember?.source_ids.join("+")}] id=${plan.canonicalId}`);
  console.log(`  canonical reason: ${plan.canonicalReason}`);
  for (const absorbed_id of plan.absorbedIds) {
    const m = g.member_sides.find((x) => x.id === absorbed_id);
    console.log(`  absorbed:  ${m?.canonical_name} [${m?.source_ids.join("+")}] id=${absorbed_id}`);
  }
  for (const m of plan.excluded) {
    console.log(`  EXCLUDED:  ${m.canonical_name} [${m.source_ids.join("+")}] id=${m.id} — left untouched, not merged`);
  }
  if (g.risk_summary.length > 0) {
    console.log(`  risks (${g.risk_summary.length}):`);
    for (const r of g.risk_summary.slice(0, 6)) console.log(`    - ${r}`);
    if (g.risk_summary.length > 6) console.log(`    ...${g.risk_summary.length - 6} more`);
  }
}

main().catch((e: unknown) => {
  console.error("FATAL:", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
