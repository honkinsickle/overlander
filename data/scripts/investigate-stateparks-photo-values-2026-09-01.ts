/**
 * READ-ONLY — sample the actual VALUES of each candidate image field on the
 * live ArcGIS layers, to decide (per state) image-vs-page-link, populated-rate,
 * host, and whether a caption/credit field travels alongside. Writes NOTHING.
 * No DB access — hits public ArcGIS REST endpoints only.
 */
import { _internals } from "../ingestion/sources/state-parks.ts";

const CFG = _internals.STATE_CONFIGS as Record<string, any>;
const UA = "overlander-data-ingestion/0.0.1 (+scoping)";

// [state, kind, imageField] candidates surfaced by the field-list scan.
const CANDIDATES: Array<[string, string, string]> = [
  ["AZ", "campsites", "PHOTO"],
  ["NV", "facilities", "photo"],
  ["UT", "parks", "weblink1"],
  ["WA", "parks", "Imagelink"],
  ["WA", "campsites", "Keylink"],
];

function host(v: unknown): string {
  if (typeof v !== "string" || !v.trim()) return "(empty)";
  try {
    return new URL(v.trim()).host;
  } catch {
    return "(not-a-url)";
  }
}

async function main(): Promise<void> {
  for (const [state, kind, field] of CANDIDATES) {
    const ep = CFG[state]?.[kind];
    if (!ep) {
      console.log(`\n${state}.${kind}.${field}: no endpoint`);
      continue;
    }
    const url =
      `${ep.url}/query?where=${encodeURIComponent(`${field} IS NOT NULL AND ${field} <> ''`)}` +
      `&outFields=*&resultRecordCount=6&f=json`;
    let total = "?";
    try {
      const cRes = await fetch(
        `${ep.url}/query?where=${encodeURIComponent(`${field} IS NOT NULL AND ${field} <> ''`)}&returnCountOnly=true&f=json`,
        { headers: { "User-Agent": UA } },
      );
      const cJson = (await cRes.json()) as any;
      total = String(cJson.count ?? cJson.error?.message ?? "?");
    } catch {
      /* leave total as ? */
    }
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      const json = (await res.json()) as any;
      if (json.error) {
        console.log(`\n${state}.${kind}.${field}: QUERY ERROR ${JSON.stringify(json.error).slice(0, 160)}`);
        continue;
      }
      const feats: any[] = json.features ?? [];
      console.log(`\n${state}.${kind}.${field}: non-empty count = ${total}; sampled ${feats.length}`);
      const hosts: Record<string, number> = {};
      const otherImgKeys = new Set<string>();
      for (const f of feats) {
        const attrs = f.attributes ?? {};
        const val = attrs[field];
        hosts[host(val)] = (hosts[host(val)] ?? 0) + 1;
        // any sibling field that looks like a caption/credit/author
        for (const k of Object.keys(attrs)) {
          if (/caption|credit|author|attribution|copyright|license/i.test(k)) otherImgKeys.add(k);
        }
      }
      console.log(`  hosts: ${JSON.stringify(hosts)}`);
      console.log(`  sibling caption/credit/license fields present: ${otherImgKeys.size ? JSON.stringify([...otherImgKeys]) : "NONE"}`);
      for (const f of feats.slice(0, 3)) {
        const a = f.attributes ?? {};
        const nameish = a.Name ?? a.NAME ?? a.name ?? a.ParkName ?? a.poiname ?? a.UNITNAME ?? "?";
        console.log(`  e.g. ${JSON.stringify(String(nameish)).slice(0, 40)} -> ${JSON.stringify(String(a[field]).slice(0, 120))}`);
      }
    } catch (e) {
      console.log(`\n${state}.${kind}.${field}: FETCH FAILED ${String(e).slice(0, 100)}`);
    }
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
