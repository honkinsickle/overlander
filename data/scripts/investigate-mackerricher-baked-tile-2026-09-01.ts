/**
 * READ-ONLY — find baked "MacKerricher" tiles in PROD trips + reference_trips
 * payloads, and dump the photo/credit/placeId of any match. Writes NOTHING.
 */
import { getDb } from "../ingestion/lib/db.ts";

const PROD = "nqzeywzcowujzyegxbsr";

function walkForMackerricher(payload: unknown, out: any[]): void {
  // Trip payloads hold days[].segmentSuggestions[] / suggestions[] and
  // keyStops[] tiles. Rather than assume shape, deep-walk for any object with
  // a title/name containing "Kerricher".
  const seen = new Set<unknown>();
  const stack: unknown[] = [payload];
  while (stack.length) {
    const node = stack.pop();
    if (node == null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const v of node) stack.push(v);
      continue;
    }
    const o = node as Record<string, unknown>;
    const nameish = [o.title, o.name, o.label, o.canonicalName].filter((x) => typeof x === "string") as string[];
    if (nameish.some((s) => /kerricher/i.test(s))) {
      out.push({
        title: o.title ?? o.name ?? o.label,
        photoUrl: o.photoUrl ?? null,
        photoCredit: o.photoCredit ?? null,
        photoAlt: o.photoAlt ?? null,
        placeId: o.placeId ?? o.googlePlaceId ?? o.google_place_id ?? null,
        sourceId: o.sourceId ?? o.source ?? null,
        category: o.category ?? null,
        keys: Object.keys(o),
      });
    }
    for (const v of Object.values(o)) stack.push(v);
  }
}

async function scan(table: string, idCol: string, extra: string): Promise<void> {
  const db = getDb();
  const res = await db.from(table).select(`${idCol},${extra},payload`);
  if (res.error) {
    console.log(`QUERY FAILED (${table}):`, JSON.stringify(res.error));
    return;
  }
  console.log(`\n=== ${table}: ${res.data?.length ?? 0} rows scanned ===`);
  for (const row of res.data as any[]) {
    const hits: any[] = [];
    walkForMackerricher(row.payload, hits);
    if (hits.length) {
      console.log(`\n  ${idCol}=${row[idCol]}  ${extra}=${JSON.stringify(row[extra.split(",")[0]] ?? "")}`);
      for (const h of hits) {
        console.log(`    - title=${JSON.stringify(h.title)} category=${h.category} sourceId=${h.sourceId}`);
        console.log(`      photoUrl   = ${JSON.stringify(h.photoUrl)}`);
        console.log(`      photoCredit= ${JSON.stringify(h.photoCredit)}`);
        console.log(`      placeId    = ${JSON.stringify(h.placeId)}`);
        console.log(`      tile keys  = ${JSON.stringify(h.keys)}`);
      }
    }
  }
}

async function main(): Promise<void> {
  const ref = (process.env.SUPABASE_URL ?? "").match(/\/\/([^.]+)\./)?.[1] ?? "";
  console.log(`target project: ${ref} ${ref === PROD ? "** PROD **" : "(non-PROD)"}`);
  await scan("reference_trips", "id", "title");
  await scan("trips", "id", "reference_id");
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
