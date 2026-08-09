/**
 * READ-ONLY PROD measurement: RIDB photo baseline.
 *
 * Reads PROD creds inline from web/.env.local — no supabase link mutation.
 *
 * Reports:
 *   - distinct RIDB-backed searchable non-land_status master_places
 *   - how many of those already have normalized_payload.photo populated
 *   - distinct facility_id + recarea_id sets for a full-fanout MEDIA call
 *   - projected /media request count = distinct facilities + distinct recareas
 *     that still need photo
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const PROD_HOST = "nqzeywzcowujzyegxbsr.supabase.co";

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

async function pageAll<T>(fn: (from: number, to: number) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  const size = 1000;
  let from = 0;
  while (true) {
    const page = await fn(from, from + size - 1);
    out.push(...page);
    if (page.length < size) break;
    from += size;
  }
  return out;
}

async function main() {
  const prodEnv = parseEnvFile(join(REPO, "web", ".env.local"));
  const url = prodEnv.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = prodEnv.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PROD_HOST)) throw new Error(`URL ${url} is not PROD`);
  if (!key) throw new Error("PROD service role key missing");
  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
  console.log(`[PROD] ${url}   (via env only, no supabase link)`);

  // All RIDB source_records linked to a master_place. Grab external_id +
  // master_place_id + a slim normalized_payload projection.
  console.log("\nFetching all ridb source_records linked to a master_place...");
  const rows = await pageAll(async (from, to) => {
    const { data, error } = await db
      .from("source_record")
      .select("external_id, master_place_id, normalized_payload")
      .eq("source_id", "ridb")
      .not("master_place_id", "is", null)
      .range(from, to);
    if (error) throw error;
    return data as { external_id: string; master_place_id: string; normalized_payload: Record<string, unknown> | null }[];
  });
  console.log(`  linked ridb source_records: ${rows.length}`);

  // Distinct master_places
  const mpIds = new Set(rows.map((r) => r.master_place_id));
  console.log(`  distinct master_place ids   : ${mpIds.size}`);

  // Filter master_place for searchable non-land_status
  const mpArr = [...mpIds];
  let searchableMps = new Set<string>();
  const chunk = 200;
  for (let i = 0; i < mpArr.length; i += chunk) {
    const slice = mpArr.slice(i, i + chunk);
    const { data, error } = await db
      .from("master_place")
      .select("id")
      .in("id", slice)
      .eq("is_searchable", true)
      .neq("primary_category", "land_status");
    if (error) throw error;
    for (const r of data ?? []) searchableMps.add(r.id);
  }
  console.log(`  searchable, non-land_status master_places (RIDB-backed): ${searchableMps.size}`);

  // Restrict rows to those under searchable master_places
  const eligibleRows = rows.filter((r) => searchableMps.has(r.master_place_id));

  // Split by external_id shape
  const facilityIds = new Set<string>();
  const recareaIds = new Set<string>();
  const other = new Set<string>();
  for (const r of eligibleRows) {
    const parts = r.external_id.split(":"); // ridb:facility:<id> | ridb:recarea:<id>
    if (parts.length === 3 && parts[0] === "ridb") {
      if (parts[1] === "facility") facilityIds.add(parts[2]);
      else if (parts[1] === "recarea") recareaIds.add(parts[2]);
      else other.add(r.external_id);
    } else other.add(r.external_id);
  }
  console.log(`\n  distinct facility ids (eligible): ${facilityIds.size}`);
  console.log(`  distinct recarea ids (eligible) : ${recareaIds.size}`);
  console.log(`  external_id oddities            : ${other.size}`);

  // How many eligible rows already carry photo on normalized_payload?
  let withPhoto = 0;
  let withoutPhoto = 0;
  const facilitiesNeedingMedia = new Set<string>();
  const recareasNeedingMedia = new Set<string>();
  for (const r of eligibleRows) {
    const np = (r.normalized_payload ?? {}) as Record<string, unknown>;
    const photo = np.photo as { url?: unknown } | null | undefined;
    const hasPhoto = photo != null && typeof photo === "object" && typeof photo.url === "string" && (photo.url as string).length > 0;
    if (hasPhoto) withPhoto++;
    else {
      withoutPhoto++;
      const parts = r.external_id.split(":");
      if (parts[0] === "ridb" && parts.length === 3) {
        if (parts[1] === "facility") facilitiesNeedingMedia.add(parts[2]);
        else if (parts[1] === "recarea") recareasNeedingMedia.add(parts[2]);
      }
    }
  }
  console.log(`\n  eligible rows with normalized_payload.photo   : ${withPhoto}`);
  console.log(`  eligible rows without photo                   : ${withoutPhoto}`);
  console.log(`\n[MEDIA FAN-OUT — actual /media request count if a full backfill ran TODAY]`);
  console.log(`  /facilities/{id}/media requests: ${facilitiesNeedingMedia.size}`);
  console.log(`  /recareas/{id}/media requests  : ${recareasNeedingMedia.size}`);
  console.log(`  TOTAL /media requests          : ${facilitiesNeedingMedia.size + recareasNeedingMedia.size}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
