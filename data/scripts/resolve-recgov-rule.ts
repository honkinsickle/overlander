/**
 * Deterministic recreation.gov-ID queue resolver (usfs-campground specific).
 *
 * THE RULE — auto-confirm a pending place_match when:
 *   1. the usfs source_record payload references recreation.gov/camping/campgrounds/<id>
 *   2. <id> resolves to a ridb source_record with external_id ridb:facility:<id>
 *   3. that ridb source_record is attached to the SAME master_place the pending row proposes
 * Surfaced but NEVER acted on:
 *   - different-mp: <id> resolves to a DIFFERENT master_place (likely mis-pairing)
 *   - not-in-corpus: <id> names a facility we haven't ingested
 *
 * MODES:
 *   (default) --dry-run   read-only. Classifies the full pending-usfs queue,
 *                         reports match counts, 20 samples, the per-MP
 *                         canonical_name/primary_category precedence simulation
 *                         (what recompute_master_place would rename), projected
 *                         source_count per MP, and the full different-mp list.
 *   --apply --tag <t>     confirm every matched row via resolve_place_match,
 *                         tagged resolved_by='rule:recgov-id:<t>'. Writes a
 *                         reversal snapshot BEFORE any write. Chunked, with a
 *                         health check between chunks.
 *   --undo <t>            read the snapshot for tag <t> and reverse every row
 *                         via unresolve_place_match. Chunked + health-checked.
 *
 * FLAGS: --limit N (cap matched rows, for a small test apply), --chunk N.
 *
 * SNAPSHOT: ~/.config/overlander/queue-snapshots/recgov-<tag>.jsonl (outside
 * the repo, per CLAUDE.md; /tmp is unreliable across sessions).
 *
 * TEST-ONLY guard: refuses unless SUPABASE_URL points at the TEST project.
 */
import { getDb } from "../ingestion/lib/db.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const TEST_REF = "znldzjdatkogdktymtvi";
const SNAP_DIR = join(homedir(), ".config", "overlander", "queue-snapshots");

type Outcome = "matched" | "different-mp" | "not-in-corpus" | "no-recgov-id";

interface Row {
  pm_id: string;
  sr_id: string;
  mp_id: string;            // master_place the pending row proposes
  usfs_name: string;
  category: string;
  recgov_ids: string[];
  resolved_mp: string | null; // MP the recgov id actually resolves to (via ridb)
  outcome: Outcome;
}

interface SnapshotRow {
  pm_id: string;
  sr_id: string;
  mp_id: string;
  recgov_id: string;
  prior_sr_master_place_id: string | null;
  prior_canonical_name: string | null;
  prior_primary_category: string | null;
  prior_source_count: number | null;
}

function argVal(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function recgovIds(sr: { raw_payload?: unknown; normalized_payload?: unknown }): string[] {
  const flat = JSON.stringify(sr.raw_payload ?? {}) + JSON.stringify(sr.normalized_payload ?? {});
  const ids = new Set<string>();
  for (const m of flat.matchAll(/recreation\.gov\\?\/camping\\?\/campgrounds\\?\/(\d{4,})/gi)) ids.add(m[1]);
  return [...ids];
}

async function pageAll<T>(q: (from: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const rows: T[] = [];
  for (let f = 0; ; f += 1000) {
    const r = await q(f);
    if (r.error || r.data == null) { console.log("QUERY FAILED:", r); throw new Error("query failed"); }
    const b = r.data as T[];
    rows.push(...b);
    if (b.length < 1000) break;
  }
  return rows;
}

async function health(db: ReturnType<typeof getDb>): Promise<number> {
  const t0 = Date.now();
  const r = await db.from("master_place").select("id").limit(1);
  const ms = Date.now() - t0;
  if (r.error) { console.log("HEALTH CHECK FAILED:", r.error); throw new Error("health check failed"); }
  return ms;
}

// (priority asc, quality desc, source_id asc) winner among SRs with a
// precedence row and a non-null value for the field — mirrors resolve_field.
function precedenceWinner(
  srs: { source_id: string; quality: number; value: string | null }[],
  prec: Map<string, number>,
): { source_id: string; value: string } | null {
  const eligible = srs.filter((s) => s.value != null && prec.has(s.source_id));
  if (eligible.length === 0) return null;
  eligible.sort((a, b) =>
    (prec.get(a.source_id)! - prec.get(b.source_id)!) ||
    (b.quality - a.quality) ||
    (a.source_id < b.source_id ? -1 : a.source_id > b.source_id ? 1 : 0));
  const w = eligible[0];
  return { source_id: w.source_id, value: w.value! };
}

async function classifyQueue(db: ReturnType<typeof getDb>): Promise<Row[]> {
  // Global RIDB facility -> master_place maps.
  const byFac = new Map<string, string>();
  const ridbRows = await pageAll<{ external_id: string; master_place_id: string | null }>((f) =>
    db.from("source_record").select("external_id,master_place_id").eq("source_id", "ridb").order("id").range(f, f + 999));
  for (const x of ridbRows) {
    const m = (x.external_id || "").match(/facility:(\d+)/);
    if (m && x.master_place_id) byFac.set(m[1], x.master_place_id);
  }

  const sel = "id,master_place_id,source_record!inner(id,source_id,inferred_category,name,raw_payload,normalized_payload)";
  const pm = await pageAll<Record<string, unknown>>((f) =>
    db.from("place_match").select(sel).eq("status", "pending").eq("source_record.source_id", "usfs").order("id").range(f, f + 999));

  const rows: Row[] = [];
  for (const r of pm) {
    const sr = (r as { source_record: Record<string, unknown> }).source_record;
    const ids = recgovIds(sr as { raw_payload?: unknown; normalized_payload?: unknown });
    const mpId = r.master_place_id as string;
    let outcome: Outcome; let resolvedMp: string | null = null;
    if (ids.length === 0) outcome = "no-recgov-id";
    else if (ids.some((id) => byFac.get(id) === mpId)) { outcome = "matched"; resolvedMp = mpId; }
    else if (ids.some((id) => byFac.has(id))) { outcome = "different-mp"; resolvedMp = ids.map((id) => byFac.get(id)).find((x): x is string => !!x) ?? null; }
    else outcome = "not-in-corpus";
    rows.push({
      pm_id: r.id as string,
      sr_id: sr.id as string,
      mp_id: mpId,
      usfs_name: sr.name as string,
      category: sr.inferred_category as string,
      recgov_ids: ids,
      resolved_mp: resolvedMp,
      outcome,
    });
  }
  return rows;
}

async function dryRun(db: ReturnType<typeof getDb>): Promise<void> {
  const rows = await classifyQueue(db);
  const matched = rows.filter((r) => r.outcome === "matched");
  const differentMp = rows.filter((r) => r.outcome === "different-mp");
  const notInCorpus = rows.filter((r) => r.outcome === "not-in-corpus");

  console.log(`\n═══ RULE MATCH COUNTS (full pending-usfs queue: ${rows.length}) ═══`);
  console.log(`  matched          : ${matched.length}   (auto-confirm candidates)`);
  console.log(`  different-mp      : ${differentMp.length}   (surface only — likely mis-pairing)`);
  console.log(`  not-in-corpus     : ${notInCorpus.length}   (surface only — facility not ingested)`);
  console.log(`  no-recgov-id      : ${rows.filter((r) => r.outcome === "no-recgov-id").length}`);

  // ── RIDB facility names + affected MP state + linked SRs, batched. ──
  const facIds = [...new Set(matched.flatMap((r) => r.recgov_ids))];
  const facName = new Map<string, string>();
  for (let i = 0; i < facIds.length; i += 100) {
    const r = await db.from("source_record").select("external_id,name").eq("source_id", "ridb").in("external_id", facIds.slice(i, i + 100).map((id) => `ridb:facility:${id}`));
    for (const x of (r.data ?? []) as { external_id: string; name: string }[]) {
      const m = x.external_id.match(/facility:(\d+)/); if (m) facName.set(m[1], x.name);
    }
  }
  const mpIds = [...new Set(matched.map((r) => r.mp_id))];
  const mp = new Map<string, { canonical_name: string | null; primary_category: string | null; source_count: number }>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const r = await db.from("master_place").select("id,canonical_name,primary_category,source_count").in("id", mpIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; canonical_name: string | null; primary_category: string | null; source_count: number }[]) mp.set(x.id, x);
  }
  // Linked is_active SRs per affected MP (for the precedence simulation).
  const linkedByMp = new Map<string, { source_id: string; quality: number; cname: string | null; pcat: string | null }[]>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const r = await db.from("source_record").select("master_place_id,source_id,source_quality_score,normalized_payload").in("master_place_id", mpIds.slice(i, i + 100)).eq("is_active", true);
    for (const x of (r.data ?? []) as { master_place_id: string; source_id: string; source_quality_score: number; normalized_payload: Record<string, unknown> | null }[]) {
      const arr = linkedByMp.get(x.master_place_id) ?? [];
      const np = x.normalized_payload ?? {};
      arr.push({ source_id: x.source_id, quality: x.source_quality_score, cname: (np.canonical_name as string) ?? null, pcat: (np.primary_category as string) ?? null });
      linkedByMp.set(x.master_place_id, arr);
    }
  }
  // The usfs SRs being added (name/payload) — batch by sr_id.
  const srAdd = new Map<string, { cname: string | null; pcat: string | null; is_active: boolean }>();
  const srIds = matched.map((r) => r.sr_id);
  for (let i = 0; i < srIds.length; i += 100) {
    const r = await db.from("source_record").select("id,is_active,normalized_payload").in("id", srIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; is_active: boolean; normalized_payload: Record<string, unknown> | null }[]) {
      const np = x.normalized_payload ?? {};
      srAdd.set(x.id, { cname: (np.canonical_name as string) ?? null, pcat: (np.primary_category as string) ?? null, is_active: x.is_active });
    }
  }

  // field_precedence for the two fields the user cares about.
  const precRows = await pageAll<{ field_name: string; source_id: string; priority: number }>((f) =>
    db.from("field_precedence").select("field_name,source_id,priority").in("field_name", ["canonical_name", "primary_category"]).order("field_name").range(f, f + 999));
  const precCname = new Map<string, number>(); const precPcat = new Map<string, number>();
  for (const p of precRows) (p.field_name === "canonical_name" ? precCname : precPcat).set(p.source_id, p.priority);

  // ── 20 samples ──
  console.log(`\n═══ 20 SAMPLES (usfs name → target MP → recreation.gov id → ridb name) ═══`);
  for (const r of matched.slice(0, 20)) {
    const id = r.recgov_ids.find((x) => facName.has(x)) ?? r.recgov_ids[0];
    console.log(`  "${r.usfs_name}"  →  MP "${mp.get(r.mp_id)?.canonical_name ?? "?"}"  →  recgov:${id}  →  ridb "${facName.get(id) ?? "?"}"`);
  }

  // ── Precedence simulation: rename / recategorize ──
  const addedByMp = new Map<string, string[]>(); // mp -> sr_ids added
  for (const r of matched) { const a = addedByMp.get(r.mp_id) ?? []; a.push(r.sr_id); addedByMp.set(r.mp_id, a); }
  const renames: { mp: string; field: string; before: string | null; after: string }[] = [];
  const counts: { mp: string; name: string | null; prior: number; projected: number }[] = [];
  for (const mpId of mpIds) {
    const cur = linkedByMp.get(mpId) ?? [];
    const addedSrIds = addedByMp.get(mpId) ?? [];
    const added = addedSrIds.map((id) => srAdd.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    const all = [
      ...cur.map((s) => ({ source_id: s.source_id, quality: s.quality, cname: s.cname, pcat: s.pcat })),
      ...added.map((s) => ({ source_id: "usfs", quality: 0.9, cname: s.cname, pcat: s.pcat })),
    ];
    const cWin = precedenceWinner(all.map((s) => ({ source_id: s.source_id, quality: s.quality, value: s.cname })), precCname);
    const pWin = precedenceWinner(all.map((s) => ({ source_id: s.source_id, quality: s.quality, value: s.pcat })), precPcat);
    const m = mp.get(mpId);
    if (cWin && m && cWin.value !== m.canonical_name) renames.push({ mp: mpId, field: "canonical_name", before: m.canonical_name, after: cWin.value });
    if (pWin && m && pWin.value !== m.primary_category) renames.push({ mp: mpId, field: "primary_category", before: m.primary_category, after: pWin.value });
    const activeAdds = added.filter((a) => a.is_active).length;
    counts.push({ mp: mpId, name: m?.canonical_name ?? null, prior: m?.source_count ?? 0, projected: (m?.source_count ?? 0) + activeAdds });
  }

  console.log(`\n═══ PRECEDENCE IMPACT (recompute_master_place under field_precedence) ═══`);
  console.log(`  canonical_name / primary_category CHANGES: ${renames.length}`);
  for (const c of renames) console.log(`    MP ${c.mp}  ${c.field}:  "${c.before}"  →  "${c.after}"`);
  if (renames.length === 0) console.log(`    (none — usfs ties ridb on canonical_name@pri3 and loses on source_id ASC; usfs has no primary_category precedence row)`);

  console.log(`\n═══ PROJECTED source_count on affected MPs (${counts.length} distinct MPs) ═══`);
  counts.sort((a, b) => b.projected - a.projected);
  const atOrOver20 = counts.filter((c) => c.projected >= 20);
  console.log(`  max projected source_count : ${counts[0]?.projected ?? 0}  (MP "${counts[0]?.name ?? "?"}", prior ${counts[0]?.prior ?? 0})`);
  console.log(`  MPs reaching >= 20         : ${atOrOver20.length}`);
  for (const c of atOrOver20) console.log(`    ⚠ MP "${c.name}"  ${c.prior} → ${c.projected}`);
  console.log(`  top 10 by projected count:`);
  for (const c of counts.slice(0, 10)) console.log(`    ${c.prior} → ${c.projected}  "${c.name}"`);

  // ── Full different-mp list (untouched) ──
  console.log(`\n═══ DIFFERENT-MP ROWS — SURFACED, NOT TOUCHED (${differentMp.length}) ═══`);
  const dmpMpIds = [...new Set(differentMp.flatMap((r) => [r.mp_id, r.resolved_mp].filter((x): x is string => !!x)))];
  const dmpNames = new Map<string, string | null>();
  for (let i = 0; i < dmpMpIds.length; i += 100) {
    const r = await db.from("master_place").select("id,canonical_name").in("id", dmpMpIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; canonical_name: string | null }[]) dmpNames.set(x.id, x.canonical_name);
  }
  for (const r of differentMp) {
    const id = r.recgov_ids[0];
    console.log(`  "${r.usfs_name}" [${r.category}]  pending→MP "${dmpNames.get(r.mp_id) ?? "?"}"  but recgov:${id} → MP "${r.resolved_mp ? dmpNames.get(r.resolved_mp) ?? "?" : "?"}"`);
  }

  console.log(`\n(DRY RUN — no writes. Migration 20260817120000 is NOT applied yet.)`);
}

async function apply(db: ReturnType<typeof getDb>, tag: string, limit: number | undefined, chunk: number): Promise<void> {
  const rows = (await classifyQueue(db)).filter((r) => r.outcome === "matched");
  const target = limit ? rows.slice(0, limit) : rows;
  console.log(`[apply] tag=${tag}  matched=${rows.length}  applying=${target.length}  chunk=${chunk}`);

  // Snapshot BEFORE any write.
  const mpIds = [...new Set(target.map((r) => r.mp_id))];
  const mpState = new Map<string, { canonical_name: string | null; primary_category: string | null; source_count: number }>();
  for (let i = 0; i < mpIds.length; i += 100) {
    const r = await db.from("master_place").select("id,canonical_name,primary_category,source_count").in("id", mpIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; canonical_name: string | null; primary_category: string | null; source_count: number }[]) mpState.set(x.id, x);
  }
  const srMp = new Map<string, string | null>();
  const srIds = target.map((r) => r.sr_id);
  for (let i = 0; i < srIds.length; i += 100) {
    const r = await db.from("source_record").select("id,master_place_id").in("id", srIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; master_place_id: string | null }[]) srMp.set(x.id, x.master_place_id);
  }
  const snapshot: SnapshotRow[] = target.map((r) => ({
    pm_id: r.pm_id, sr_id: r.sr_id, mp_id: r.mp_id,
    recgov_id: r.recgov_ids.find((id) => id) ?? "",
    prior_sr_master_place_id: srMp.get(r.sr_id) ?? null,
    prior_canonical_name: mpState.get(r.mp_id)?.canonical_name ?? null,
    prior_primary_category: mpState.get(r.mp_id)?.primary_category ?? null,
    prior_source_count: mpState.get(r.mp_id)?.source_count ?? null,
  }));
  if (!existsSync(SNAP_DIR)) mkdirSync(SNAP_DIR, { recursive: true });
  const snapPath = join(SNAP_DIR, `recgov-${tag}.jsonl`);
  if (existsSync(snapPath)) throw new Error(`snapshot ${snapPath} already exists — pick a fresh tag or --undo it first`);
  writeFileSync(snapPath, snapshot.map((s) => JSON.stringify(s)).join("\n") + "\n");
  console.log(`[apply] wrote reversal snapshot: ${snapPath} (${snapshot.length} rows)`);

  // Prior canonical_name/primary_category per MP — the mid-run rename guard.
  const priorByMp = new Map<string, { cname: string | null; pcat: string | null }>();
  for (const s of snapshot) if (!priorByMp.has(s.mp_id)) priorByMp.set(s.mp_id, { cname: s.prior_canonical_name, pcat: s.prior_primary_category });

  let ok = 0; const errors: { pm_id: string; error: string }[] = [];
  let baseline = 0; let globalMaxSc = 0;
  const renames: { mp: string; field: string; before: string | null; after: string | null }[] = [];
  const overflow: { mp: string; source_count: number }[] = [];
  let halt: string | null = null;

  for (let i = 0; i < target.length && !halt; i += chunk) {
    const chunkRows = target.slice(i, i + chunk);
    for (const r of chunkRows) {
      const res = await db.rpc("resolve_place_match", { p_place_match_id: r.pm_id, p_resolved_by: `rule:recgov-id:${tag}` });
      if (res.error) { errors.push({ pm_id: r.pm_id, error: res.error.message }); halt = "resolve raised an exception"; break; }
      ok++;
    }
    const ms = await health(db);
    if (i === 0) baseline = ms;

    // Re-read MPs touched this chunk: rename / recategorize / source_count guards.
    const touched = [...new Set(chunkRows.map((r) => r.mp_id))];
    for (let j = 0; j < touched.length; j += 100) {
      const rr = await db.from("master_place").select("id,canonical_name,primary_category,source_count").in("id", touched.slice(j, j + 100));
      for (const m of (rr.data ?? []) as { id: string; canonical_name: string | null; primary_category: string | null; source_count: number }[]) {
        const p = priorByMp.get(m.id);
        if (p && m.canonical_name !== p.cname) renames.push({ mp: m.id, field: "canonical_name", before: p.cname, after: m.canonical_name });
        if (p && m.primary_category !== p.pcat) renames.push({ mp: m.id, field: "primary_category", before: p.pcat, after: m.primary_category });
        if (m.source_count > globalMaxSc) globalMaxSc = m.source_count;
        if (m.source_count >= 20) overflow.push({ mp: m.id, source_count: m.source_count });
      }
    }
    console.log(`  chunk ${i / chunk + 1}: applied ${ok}/${target.length}  errors=${errors.length}  health=${ms}ms  maxSC=${globalMaxSc}`);

    if (!halt && errors.length) halt = "resolve raised an exception";
    if (!halt && baseline > 0 && ms > Math.max(baseline * 5, 5000)) halt = `health latency degraded (${ms}ms vs baseline ${baseline}ms)`;
    if (!halt && renames.length) halt = "canonical_name/primary_category changed";
    if (!halt && overflow.length) halt = "MP reached source_count >= 20";
  }

  console.log(`\n[apply] confirmed=${ok}/${target.length}  errors=${errors.length}  renames=${renames.length}  maxSourceCount=${globalMaxSc}`);
  if (halt) {
    console.log(`\n⛔ HALTED: ${halt} — stopped after ${ok} confirms. Undo with the tag below to reverse.`);
    if (errors.length) console.log("  errors:", JSON.stringify(errors.slice(0, 10), null, 2));
    if (renames.length) console.log("  renames:", JSON.stringify(renames.slice(0, 10), null, 2));
    if (overflow.length) console.log("  overflow:", JSON.stringify(overflow.slice(0, 10), null, 2));
  } else {
    console.log(`[apply] no halt conditions tripped — ${ok} confirms, 0 renames, maxSourceCount ${globalMaxSc}.`);
  }
  console.log(`[apply] snapshot: ${snapPath}`);
  console.log(`[apply] undo with:  npx tsx --env-file=.env scripts/resolve-recgov-rule.ts --undo ${tag}`);
}

async function undo(db: ReturnType<typeof getDb>, tag: string, chunk: number): Promise<void> {
  const snapPath = join(SNAP_DIR, `recgov-${tag}.jsonl`);
  if (!existsSync(snapPath)) throw new Error(`no snapshot at ${snapPath}`);
  const snapshot = readFileSync(snapPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as SnapshotRow);
  console.log(`[undo] tag=${tag}  reversing ${snapshot.length} rows`);
  let ok = 0; const errors: { pm_id: string; error: string }[] = [];
  const mismatches: { mp_id: string; expected: string | null; got: string | null }[] = [];
  for (let i = 0; i < snapshot.length; i += chunk) {
    for (const s of snapshot.slice(i, i + chunk)) {
      const res = await db.rpc("unresolve_place_match", { p_place_match_id: s.pm_id, p_prior_sr_master_place_id: s.prior_sr_master_place_id });
      if (res.error) errors.push({ pm_id: s.pm_id, error: res.error.message }); else ok++;
    }
    const ms = await health(db);
    console.log(`  chunk ${i / chunk + 1}: reversed ${ok}/${snapshot.length}  errors=${errors.length}  health=${ms}ms`);
  }
  // Verify canonical_name restored.
  const mpIds = [...new Set(snapshot.map((s) => s.mp_id))];
  const prior = new Map<string, string | null>(); for (const s of snapshot) prior.set(s.mp_id, s.prior_canonical_name);
  for (let i = 0; i < mpIds.length; i += 100) {
    const r = await db.from("master_place").select("id,canonical_name").in("id", mpIds.slice(i, i + 100));
    for (const x of (r.data ?? []) as { id: string; canonical_name: string | null }[]) if (x.canonical_name !== prior.get(x.id)) mismatches.push({ mp_id: x.id, expected: prior.get(x.id) ?? null, got: x.canonical_name });
  }
  console.log(`\n[undo] reversed=${ok}  errors=${errors.length}  canonical_name mismatches after restore=${mismatches.length}`);
  if (mismatches.length) console.log(JSON.stringify(mismatches.slice(0, 20), null, 2));
  if (errors.length) console.log(JSON.stringify(errors.slice(0, 20), null, 2));
}

async function main(): Promise<void> {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  if (ref !== TEST_REF) throw new Error(`Refusing: not TEST (${ref})`);
  const chunk = Number(argVal("--chunk") ?? 25);
  const limit = argVal("--limit") ? Number(argVal("--limit")) : undefined;

  if (process.argv.includes("--undo")) {
    const tag = argVal("--undo");
    if (!tag) throw new Error("--undo requires a <tag>");
    await undo(db, tag, chunk);
  } else if (process.argv.includes("--apply")) {
    const tag = argVal("--tag");
    if (!tag) throw new Error("--apply requires --tag <tag>");
    await apply(db, tag, limit, chunk);
  } else {
    console.log(`[env] TEST ${ref}  (DRY RUN)  ${new Date().toISOString()}`);
    await dryRun(db);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
