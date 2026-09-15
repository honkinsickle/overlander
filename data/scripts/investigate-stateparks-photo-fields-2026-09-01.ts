/**
 * READ-ONLY enumerate-before-measure — for each of CA/AZ/NV/UT/WA/OR:
 *   (1) all distinct raw_payload.props keys across ingested state_parks records,
 *       flagging any image/photo/caption/credit/attribution-ish key + how many
 *       records carry a non-empty value;
 *   (2) the LIVE ArcGIS layer field list (?f=json) for every configured
 *       endpoint, flagging image-ish fields the normalizer does not map.
 * Writes NOTHING. Default target = whatever SUPABASE_URL is (TEST via data/.env).
 */
import { getDb } from "../ingestion/lib/db.ts";
import ingest, { _internals } from "../ingestion/sources/state-parks.ts";
void ingest;

const STATE_CONFIGS = _internals.STATE_CONFIGS as Record<string, any>;
const IMG_RE = /image|photo|img|url|link|caption|credit|attribution|author|thumb|media/i;

async function enumerateDb(): Promise<void> {
  const db = getDb();
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1];
  console.log(`\n===== DB props enumeration (target ${ref}) =====`);
  const r = await db
    .from("source_record")
    .select("external_id,is_active,raw_payload")
    .eq("source_id", "state_parks");
  if (r.error) {
    console.log("QUERY FAILED:", JSON.stringify(r.error));
    return;
  }
  const byState: Record<string, { total: number; keys: Map<string, number> }> = {};
  for (const row of r.data as any[]) {
    const st = (row.external_id.match(/^state_parks:([A-Z]{2}):/) ?? [])[1] ?? "??";
    byState[st] ??= { total: 0, keys: new Map() };
    byState[st].total++;
    const props = row.raw_payload?.props ?? row.raw_payload ?? {};
    for (const [k, v] of Object.entries(props)) {
      const nonEmpty = v != null && String(v).trim().length > 0;
      if (nonEmpty) byState[st].keys.set(k, (byState[st].keys.get(k) ?? 0) + 1);
    }
  }
  for (const st of Object.keys(byState).sort()) {
    const { total, keys } = byState[st];
    const imgKeys = [...keys.entries()].filter(([k]) => IMG_RE.test(k));
    console.log(`\n  ${st}: ${total} records`);
    console.log(`    image-ish keys (non-empty count): ${imgKeys.length ? JSON.stringify(Object.fromEntries(imgKeys)) : "NONE"}`);
    console.log(`    all non-empty prop keys: ${JSON.stringify([...keys.keys()].sort())}`);
  }
}

async function enumerateLiveLayers(): Promise<void> {
  console.log(`\n===== LIVE ArcGIS layer field lists (?f=json) =====`);
  for (const [state, cfg] of Object.entries(STATE_CONFIGS)) {
    const endpoints: Array<[string, any]> = [];
    for (const kind of ["parks", "campgrounds", "facilities", "campsites"]) {
      if (cfg[kind]) endpoints.push([kind, cfg[kind]]);
    }
    for (const [kind, ep] of endpoints) {
      try {
        const res = await fetch(`${ep.url}?f=json`, {
          headers: { "User-Agent": "overlander-data-ingestion/0.0.1 (+scoping)" },
        });
        if (!res.ok) {
          console.log(`  ${state}.${kind}: HTTP ${res.status} ${ep.url}`);
          continue;
        }
        const meta = (await res.json()) as any;
        const fields: string[] = (meta.fields ?? []).map((f: any) => f.name);
        const imgFields = fields.filter((f) => IMG_RE.test(f));
        console.log(`\n  ${state}.${kind} — ${fields.length} fields`);
        console.log(`    image-ish fields: ${imgFields.length ? JSON.stringify(imgFields) : "NONE"}`);
        if (meta.hasAttachments) console.log(`    hasAttachments = TRUE (feature-attachment photos may be available)`);
      } catch (e) {
        console.log(`  ${state}.${kind}: FETCH FAILED ${String(e).slice(0, 80)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  await enumerateDb();
  await enumerateLiveLayers();
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
