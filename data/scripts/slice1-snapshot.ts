/**
 * Corridor-ingest ROLLBACK SNAPSHOT (read-only).
 *
 * Records the immutable primary keys of every existing source_record,
 * master_place, AND place_match, plus baseline counts, to a durable file.
 * Run this IMMEDIATELY BEFORE a corridor ingest run. slice1-rollback.ts then
 * deletes exactly the rows whose id is NOT in this snapshot (set-difference on
 * the immutable PK) — the only rollback discriminator immune to the
 * fetch_timestamp bump that a re-upsert of overlapping existing rows causes.
 * See docs/decisions/2026-07-23-corridor-rollback-by-id-snapshot.md.
 *
 * Run:
 *   npm run -w data slice:snapshot            # → default durable path
 *   npm run -w data slice:snapshot -- <path>  # custom output path
 *
 * Default output: ~/.config/overlander/slice1-rollback-snapshot.json
 * (durable across sessions/reboots — same convention as env-backups; NOT /tmp,
 * which proved unreliable). Must survive until rollback.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

const TEST_REF = "znldzjdatkogdktymtvi";
const OUT =
  process.argv.slice(2).find((a) => !a.startsWith("--")) ??
  path.join(os.homedir(), ".config/overlander/slice1-rollback-snapshot.json");

async function allIds(table: string): Promise<string[]> {
  const db = getDb();
  const ids: string[] = [];
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db.from(table).select("id").order("id").range(from, from + page - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    ids.push(...(data as { id: string }[]).map((r) => r.id));
    if (data.length < page) break;
    from += page;
  }
  return ids;
}

async function tallySourceIds(): Promise<Record<string, number>> {
  const db = getDb();
  const out: Record<string, number> = {};
  let from = 0;
  const page = 1000;
  for (;;) {
    const { data, error } = await db.from("source_record").select("source_id").range(from, from + page - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    for (const r of data as { source_id: string }[]) out[r.source_id] = (out[r.source_id] ?? 0) + 1;
    if (data.length < page) break;
    from += page;
  }
  return out;
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  if (!url.includes(TEST_REF)) {
    throw new Error(`Refusing: expected TEST project (${TEST_REF}), got ${url}. Corpus rollback is TEST-only.`);
  }

  const sourceRecordIds = await allIds("source_record");
  const masterPlaceIds = await allIds("master_place");
  const placeMatchIds = await allIds("place_match");
  const bySource = await tallySourceIds();

  const snapshot = {
    project: url,
    note: "pre-corridor-ingest rollback snapshot",
    counts: {
      source_record: sourceRecordIds.length,
      master_place: masterPlaceIds.length,
      place_match: placeMatchIds.length,
      bySource,
    },
    sourceRecordIds,
    masterPlaceIds,
    placeMatchIds,
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(snapshot));
  logger.info({ out: OUT, counts: snapshot.counts }, "slice1-snapshot: written");
  console.log("snapshot written:", OUT);
  console.log("counts:", JSON.stringify(snapshot.counts));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
