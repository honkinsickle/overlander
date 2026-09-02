/**
 * READ-ONLY simulation: would the source_id rename change any RESOLVED FIELD?
 *
 * `resolve_field()` orders by
 *     fp.priority asc, sr.source_quality_score desc nulls last, sr.source_id asc
 * (20260601010000_phase3a_resolve_field_determinism.sql). The third key is the
 * source_id itself — so renaming `state_parks_web` → `california_state_parks`
 * moves it a long way alphabetically (c… sorts before nps/ridb/usfs, s… sorts
 * after). Where a co-linked source ties on BOTH priority and quality score,
 * the winner can flip, and the rename would silently change resolved data
 * rather than being a pure identifier change.
 *
 * This reproduces that ORDER BY in JS for every affected master_place and every
 * field the renamed source has a precedence row for, and reports any field
 * whose winner differs before vs after.
 *
 * Writes nothing. Usage: npx tsx data/scripts/source-id-rename-tiebreak-sim.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const TEST_HOST = "znldzjdatkogdktymtvi.supabase.co";
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

const RENAMES = [
  { old: "state_parks_web", next: "california_state_parks" },
  { old: "state_parks_web_wa", next: "washington_state_parks" },
] as const;

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

interface Contributor {
  sourceId: string;
  quality: number;
  hasField: boolean;
}

/** The exact ORDER BY from resolve_field(), applied to candidate contributors. */
function winner(
  cands: { sourceId: string; quality: number; priority: number }[],
): string | null {
  if (cands.length === 0) return null;
  return [...cands].sort(
    (a, b) =>
      a.priority - b.priority ||
      b.quality - a.quality ||
      a.sourceId.localeCompare(b.sourceId),
  )[0].sourceId;
}

async function simulate(label: string, db: SupabaseClient): Promise<void> {
  console.log(`\n${"=".repeat(74)}\n${label}\n${"=".repeat(74)}`);

  // Full precedence table: field -> source -> priority
  const fpRes = await db.from("field_precedence").select("field_name,source_id,priority").range(0, 999);
  if (fpRes.error || fpRes.data == null) throw new Error(`QUERY FAILED [fp]: ${JSON.stringify(fpRes.error)}`);
  const fp = new Map<string, Map<string, number>>();
  for (const r of fpRes.data as { field_name: string; source_id: string; priority: number }[]) {
    if (!fp.has(r.field_name)) fp.set(r.field_name, new Map());
    fp.get(r.field_name)!.set(r.source_id, r.priority);
  }

  for (const { old, next } of RENAMES) {
    const fields = [...fp.entries()].filter(([, m]) => m.has(old)).map(([f]) => f).sort();
    console.log(`\n── ${old} → ${next}`);
    if (fields.length === 0) {
      console.log("   no field_precedence rows here — nothing to simulate");
      continue;
    }
    console.log(`   fields with a precedence row: ${JSON.stringify(fields)}`);

    // Affected master_places = those with a linked source_record from `old`.
    const mpIds = new Set<string>();
    for (let off = 0; ; off += 1000) {
      const r = await db
        .from("source_record")
        .select("master_place_id")
        .eq("source_id", old)
        .not("master_place_id", "is", null)
        .order("id")
        .range(off, off + 999);
      if (r.error || r.data == null) throw new Error(`QUERY FAILED: ${JSON.stringify(r.error)}`);
      for (const x of r.data) if (typeof x.master_place_id === "string") mpIds.add(x.master_place_id);
      if (r.data.length < 1000) break;
    }
    const ids = [...mpIds];
    if (ids.length === 0) {
      console.log("   no linked master_places here — nothing to simulate");
      continue;
    }
    console.log(`   affected master_places: ${ids.length}`);

    // All ACTIVE contributors to those master_places, with the fields they carry.
    const byMp = new Map<string, Contributor[]>();
    const perField = new Map<string, Map<string, Contributor[]>>();
    for (const f of fields) perField.set(f, new Map());

    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const r = await db
        .from("source_record")
        .select("master_place_id, source_id, source_quality_score, is_active, normalized_payload")
        .in("master_place_id", chunk)
        .eq("is_active", true);
      if (r.error || r.data == null) throw new Error(`QUERY FAILED [contributors]: ${JSON.stringify(r.error)}`);
      for (const row of r.data) {
        const mp = String(row.master_place_id);
        const sid = String(row.source_id);
        const q = typeof row.source_quality_score === "number" ? row.source_quality_score : 0.5;
        const np = isRecord(row.normalized_payload) ? row.normalized_payload : {};
        if (!byMp.has(mp)) byMp.set(mp, []);
        byMp.get(mp)!.push({ sourceId: sid, quality: q, hasField: false });
        for (const f of fields) {
          const v = np[f];
          if (v === undefined || v === null) continue;
          const m = perField.get(f)!;
          if (!m.has(mp)) m.set(mp, []);
          m.get(mp)!.push({ sourceId: sid, quality: q, hasField: true });
        }
      }
    }

    // Validate the simulation against reality BEFORE trusting its prediction:
    // the modelled "winner before" must match master_place.attribution, which is
    // what recompute_master_place() actually wrote. A model that cannot
    // reproduce the present has no standing to predict the future.
    const actualAttr = new Map<string, Record<string, unknown>>();
    for (let i = 0; i < ids.length; i += 200) {
      const r = await db.from("master_place").select("id, attribution").in("id", ids.slice(i, i + 200));
      if (r.error || r.data == null) throw new Error(`QUERY FAILED [attribution]: ${JSON.stringify(r.error)}`);
      for (const row of r.data) {
        if (isRecord(row.attribution)) actualAttr.set(String(row.id), row.attribution);
      }
    }

    let flips = 0;
    const flipDetail: string[] = [];
    let tieExposure = 0;
    let validAgree = 0;
    let validDisagree = 0;
    const validDetail: string[] = [];

    for (const f of fields) {
      const prios = fp.get(f)!;
      for (const [mp, contribs] of perField.get(f)!) {
        const before = contribs
          .filter((c) => prios.has(c.sourceId))
          .map((c) => ({ sourceId: c.sourceId, quality: c.quality, priority: prios.get(c.sourceId)! }));
        const after = before.map((c) => ({ ...c, sourceId: c.sourceId === old ? next : c.sourceId }));

        const wBefore = winner(before);
        const wAfter = winner(after);
        const wBeforeMapped = wBefore === old ? next : wBefore;

        // Tie exposure: does anything tie the renamed source on priority AND quality?
        const self = before.find((c) => c.sourceId === old);
        if (self && before.some((c) => c.sourceId !== old && c.priority === self.priority && c.quality === self.quality)) {
          tieExposure += 1;
        }

        // Validation: does the model's "winner before" match what's on disk?
        const attr = actualAttr.get(mp);
        const actual = attr ? attr[f] : undefined;
        if (typeof actual === "string") {
          if (actual === wBefore) validAgree += 1;
          else {
            validDisagree += 1;
            if (validDetail.length < 8) {
              validDetail.push(
                `      ${f.padEnd(20)} mp=${mp.slice(0, 8)}  model=${wBefore} attribution=${actual}` +
                  `   [candidates: ${before.map((c) => `${c.sourceId}(p${c.priority},q${c.quality})`).join(", ")}]`,
              );
            }
          }
        }

        if (wBeforeMapped !== wAfter) {
          flips += 1;
          if (flipDetail.length < 12) {
            flipDetail.push(
              `      ${f.padEnd(20)} mp=${mp.slice(0, 8)}  ${wBefore} → ${wAfter}` +
                `   [candidates: ${before.map((c) => `${c.sourceId}(p${c.priority},q${c.quality})`).join(", ")}]`,
            );
          }
        }
      }
    }

    const validTotal = validAgree + validDisagree;
    console.log(
      `   MODEL VALIDATION vs master_place.attribution: ${validAgree}/${validTotal} agree` +
        `${validDisagree ? `, ${validDisagree} DISAGREE` : ""}` +
        `${validTotal === 0 ? "  *** nothing compared — model is unvalidated ***" : ""}`,
    );
    for (const d of validDetail) console.log(d);
    console.log(`   field-resolutions where something TIES ${old} on priority AND quality: ${tieExposure}`);
    console.log(`   RESOLVED-VALUE FLIPS caused by the rename: ${flips}`);
    for (const d of flipDetail) console.log(d);
    console.log(
      `   VERDICT: ${flips === 0 ? "pure identifier rename — no resolved field changes owner" : "*** NOT a pure rename — resolved data would change ***"}`,
    );
  }
}

async function main(): Promise<void> {
  const t = parseEnvFile(join(REPO, "data", ".env"));
  const p = parseEnvFile(join(REPO, "web", ".env.local"));
  if (!t.SUPABASE_URL.includes(TEST_HOST)) throw new Error("data/.env is not TEST");
  if (!p.NEXT_PUBLIC_SUPABASE_URL.includes(PROD_HOST)) throw new Error("web/.env.local is not PROD");
  await simulate(`TEST (${TEST_HOST})`, createClient(t.SUPABASE_URL, t.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
  await simulate(`PROD (${PROD_HOST})`, createClient(p.NEXT_PUBLIC_SUPABASE_URL, p.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }));
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
