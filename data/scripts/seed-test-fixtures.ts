/**
 * Seed the dedicated Supabase test project with the JT fixture corpus.
 *
 * Phase 2.5 Part B Option 1 — copies every source_record from the
 * production project into the isolated test project, and inserts the
 * test_marker row that unlocks reset_phase3a_test_state on this
 * project.
 *
 * Idempotent: upserts by (source_id, external_id). Stripping
 * master_place_id during the copy means the test project starts with
 * an unresolved corpus — every test run rematerializes from scratch.
 *
 * Re-run when:
 *   - the test project has been recreated from empty
 *   - source_record schema gained a new column
 *   - new fixtures landed in production and the test suite needs them
 *
 * CLI:
 *   npm run -w data test:seed
 *
 * Required env (loaded by the npm script via tsx --env-file=.env --env-file=.env.test):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY            (read-side: prod)
 *   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY  (write-side: test)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../ingestion/lib/logger.ts";

const PAGE_SIZE = 1000;
const UPSERT_BATCH = 100;

type SourceRecordRow = Record<string, unknown> & { id: string; source_id: string; external_id: string };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function clientFor(urlEnv: string, keyEnv: string): SupabaseClient {
  return createClient(requireEnv(urlEnv), requireEnv(keyEnv), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "overlander-test-seed" } },
  });
}

async function ensureTestMarker(test: SupabaseClient): Promise<void> {
  const { error } = await test
    .from("test_marker")
    .upsert({ id: true, note: "JT fixture seed (Phase 2.5 Part B Option 1)" });
  if (error) {
    logger.error({ err: error }, "seed: test_marker upsert failed");
    throw error;
  }
  logger.info("seed: test_marker row present");
}

async function fetchAllSourceRecords(prod: SupabaseClient): Promise<SourceRecordRow[]> {
  const all: SourceRecordRow[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await prod
      .from("source_record")
      .select("*")
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as SourceRecordRow[];
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return all;
}

async function upsertIntoTest(test: SupabaseClient, rows: SourceRecordRow[]): Promise<number> {
  let upserted = 0;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await test.from("source_record").upsert(batch, {
      onConflict: "source_id,external_id",
    });
    if (error) {
      logger.error(
        { err: error, batch_idx: Math.floor(i / UPSERT_BATCH), batch_size: batch.length },
        "seed: source_record upsert failed",
      );
      throw error;
    }
    upserted += batch.length;
    logger.debug({ batch: Math.floor(i / UPSERT_BATCH) + 1, upserted }, "seed: batch complete");
  }
  return upserted;
}

async function main(): Promise<void> {
  const prod = clientFor("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY");
  const test = clientFor("SUPABASE_TEST_URL", "SUPABASE_TEST_SERVICE_ROLE_KEY");

  await ensureTestMarker(test);

  const prodRows = await fetchAllSourceRecords(prod);
  logger.info({ count: prodRows.length }, "seed: source_records fetched from prod");

  // Strip master_place_id — test starts unresolved; ER materializes from scratch.
  const seedRows = prodRows.map((row) => ({ ...row, master_place_id: null }));

  const upserted = await upsertIntoTest(test, seedRows);

  const { count: testCount, error: countErr } = await test
    .from("source_record")
    .select("id", { count: "exact", head: true });
  if (countErr) throw countErr;

  if (testCount !== prodRows.length) {
    logger.warn(
      { expected: prodRows.length, actual: testCount, upserted },
      "seed: row-count mismatch — test project may have stale rows from a different prod state",
    );
  }
  logger.info(
    { fetched: prodRows.length, upserted, final_count: testCount },
    "seed: complete",
  );
}

main().catch((err) => {
  logger.error({ err }, "seed: fatal");
  process.exit(1);
});
