/** READ-only Overpass count query: how many nodes for
 *  amenity=sanitary_dump_station and (tourism=camp_site AND backcountry=yes)
 *  exist in the PROD-active corridor bbox today?
 *
 *  Uses `out count;` so nothing is downloaded but the totals. No writes,
 *  no ingestion. Query the same public Overpass mirror the adapter uses. */
import { createClient } from "@supabase/supabase-js";

const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const UA = "overlander-diagnostic/0.0.1 (read-only count)";

async function overpassCount(query: string): Promise<number> {
  let lastErr: unknown;
  for (const url of MIRRORS) {
    try {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), 180_000);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal,
      });
      clearTimeout(to);
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} @ ${url}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        continue;
      }
      const json = (await res.json()) as { elements?: Array<{ tags?: { total?: string; nodes?: string } }> };
      const el = json.elements?.[0];
      const t = el?.tags?.total ?? el?.tags?.nodes ?? "0";
      console.log(`   (mirror: ${url.replace(/^https:\/\//, "")})`);
      return Number(t);
    } catch (e) {
      lastErr = e;
      console.log(`   (mirror ${url} failed, trying next)`);
    }
  }
  throw lastErr;
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const ref = url.match(/\/\/([^.]+)\./)?.[1];
  if (ref !== "nqzeywzcowujzyegxbsr") throw new Error(`Refusing: not PROD (${ref})`);
  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log(`[env] PROD ${ref}`);

  // Look up the active corridor bbox from active_corridor_buffer view.
  const { data, error } = await db
    .from("active_corridor_buffer")
    .select("id, name, bbox_west, bbox_south, bbox_east, bbox_north")
    .limit(1)
    .single();
  if (error) throw error;
  const [w, s, e, n] = [data.bbox_west, data.bbox_south, data.bbox_east, data.bbox_north] as number[];
  console.log(`[corridor] ${data.name}  bbox=[${w},${s},${e},${n}]`);
  const bbox = `${s},${w},${n},${e}`; // south,west,north,east

  // 1. amenity=sanitary_dump_station — nodes only (matches current adapter's shape)
  const q1 = `[out:json][timeout:180];
node["amenity"="sanitary_dump_station"](${bbox});
out count;`;
  const n1 = await overpassCount(q1);
  console.log(`\namenity=sanitary_dump_station (nodes) : ${n1}`);

  // Also count ways + relations for context — matches "if we widened to nwr".
  const q1all = `[out:json][timeout:180];
nwr["amenity"="sanitary_dump_station"](${bbox});
out count;`;
  const n1all = await overpassCount(q1all);
  console.log(`amenity=sanitary_dump_station (nwr)   : ${n1all}`);

  // 2. tourism=camp_site + backcountry=yes — the dispersed classifier target
  const q2 = `[out:json][timeout:180];
node["tourism"="camp_site"]["backcountry"="yes"](${bbox});
out count;`;
  const n2 = await overpassCount(q2);
  console.log(`\ntourism=camp_site + backcountry=yes (nodes) : ${n2}`);
  const q2all = `[out:json][timeout:180];
nwr["tourism"="camp_site"]["backcountry"="yes"](${bbox});
out count;`;
  const n2all = await overpassCount(q2all);
  console.log(`tourism=camp_site + backcountry=yes (nwr)   : ${n2all}`);

  // 3. For context: what's currently on PROD for these two markers?
  //    (Rows the adapter ALREADY has that carry the tag on their tags blob.)
  //    Rely on my earlier findings: 0 sanitary_dump_station rows, 23 with
  //    tourism=camp_site + backcountry=yes.
  console.log(`\n[context] rows currently on PROD source_record via existing ingest:`);
  console.log(`  amenity=sanitary_dump_station                 : 0   (never queried)`);
  console.log(`  tourism=camp_site + backcountry=yes           : 23  (fetched incidentally with camp_site)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
