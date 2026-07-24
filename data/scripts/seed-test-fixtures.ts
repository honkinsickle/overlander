/**
 * Seed the disposable ER test project with the PINNED fixture corpus.
 *
 * Loads data/entity-resolution/fixtures/er-corpus.ts (~17 hand-built records)
 * into the isolated test project via the upsert_source_record RPC, and inserts
 * the test_marker row that unlocks reset_phase3a_test_state there.
 *
 * WHY PINNED (not a prod copy): this script used to copy EVERY prod
 * source_record into test. That silently tracked prod — ~219 rows when it was
 * written, 20,384 by 2026-07 — so the D4 baseline drifted and the ER run got
 * slow and unreasonable. The fixture is now a small, versioned, reason-about-able
 * set. See docs/decisions/2026-07-23-pinned-er-fixture.md.
 *
 * NO PROD CREDENTIALS. The prod read side is gone entirely — this script never
 * builds a prod service-role client and never reads prod. It writes ONLY to the
 * test project (SUPABASE_TEST_*). It does read the working URL (SUPABASE_URL, a
 * URL, not a secret) for one purpose: to REFUSE seeding if the test ref equals
 * the working ref — the same isolation guard preflight-er-test.ts enforces, so a
 * misconfigured SUPABASE_TEST_URL can never write the fixture into the working DB.
 *
 * Idempotent: upsert_source_record upserts by (source_id, external_id).
 *
 * CLI:  npm run -w data test:seed
 *
 * Required env (loaded by the npm script via tsx --env-file=.env --env-file=.env.test):
 *   SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_ROLE_KEY  (write-side: the ER test project)
 *   SUPABASE_URL                                       (working URL — isolation guard only)
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../ingestion/lib/logger.ts";
import { ER_CORPUS } from "../entity-resolution/fixtures/er-corpus.ts";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.length === 0) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function projectRef(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] ?? url;
  } catch {
    return url;
  }
}

/** Refuse to seed the working DB. Mirrors preflight-er-test.ts: if the test ref
 *  equals the working ref, writing the fixture would land in the working corpus. */
function assertIsolated(): void {
  const workingUrl = requireEnv("SUPABASE_URL");
  const testUrl = requireEnv("SUPABASE_TEST_URL");
  const workingRef = projectRef(workingUrl);
  const testRef = projectRef(testUrl);
  if (workingRef === testRef) {
    throw new Error(
      `test:seed ABORT — SUPABASE_TEST_URL (${testRef}) equals SUPABASE_URL (${workingRef}). ` +
        `Seeding here would write the fixture into the working DB. Provision a separate ` +
        `disposable test project and point SUPABASE_TEST_URL at it.`,
    );
  }
}

function testClient(): SupabaseClient {
  return createClient(
    requireEnv("SUPABASE_TEST_URL"),
    requireEnv("SUPABASE_TEST_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-application-name": "overlander-test-seed" } },
    },
  );
}

async function ensureTestMarker(test: SupabaseClient): Promise<void> {
  const { error } = await test
    .from("test_marker")
    .upsert({ id: true, note: "pinned ER fixture (er-corpus.ts)" });
  if (error) {
    logger.error({ err: error }, "seed: test_marker upsert failed");
    throw error;
  }
  logger.info("seed: test_marker row present");
}

async function seedCorpus(test: SupabaseClient): Promise<number> {
  let seeded = 0;
  for (const r of ER_CORPUS) {
    const geometryWkt =
      typeof r.point === "string"
        ? r.point
        : `SRID=4326;POINT(${r.point[0]} ${r.point[1]})`;
    const { error } = await test.rpc("upsert_source_record", {
      p_source_id: r.sourceId,
      p_external_id: r.externalId,
      p_name: r.name,
      p_inferred_category: r.inferredCategory,
      p_geometry: geometryWkt,
      p_raw_payload: r.rawPayload,
      p_normalized_payload: r.normalizedPayload,
      p_source_quality_score: r.sourceQualityScore ?? 0.5,
    });
    if (error) {
      logger.error({ err: error, externalId: r.externalId }, "seed: upsert_source_record failed");
      throw error;
    }
    seeded += 1;
  }
  return seeded;
}

async function main(): Promise<void> {
  assertIsolated();
  const test = testClient();

  await ensureTestMarker(test);
  const seeded = await seedCorpus(test);

  const { count, error: countErr } = await test
    .from("source_record")
    .select("id", { count: "exact", head: true });
  if (countErr) throw countErr;

  if (count !== ER_CORPUS.length) {
    logger.warn(
      { expected: ER_CORPUS.length, actual: count, seeded },
      "seed: row-count mismatch — test project may hold stale rows outside the fixture",
    );
  }
  logger.info(
    { fixture_size: ER_CORPUS.length, seeded, final_count: count },
    "seed: complete",
  );
}

main().catch((err) => {
  logger.error({ err }, "seed: fatal");
  process.exit(1);
});
