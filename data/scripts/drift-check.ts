/**
 * Credential-drift check — run this WHEN SOMETHING LOOKS WRONG (not scheduled).
 *
 * The load-bearing lesson from the 2026-06-01 incident: the prod Supabase
 * service_role key was rotated, but Vercel's `SUPABASE_SERVICE_ROLE_KEY` was
 * never updated, so prod corpus hydrate failed for weeks. Every LOCAL file held
 * a valid key — the drift was in the DEPLOYED runtime. So the check that matters
 * is (a), a probe of the live deployment; (b) catches stale local/backup copies.
 *
 * Operator-facing tool — prints to console deliberately (like
 * preflight-er-test.ts), not pino. NEVER prints a key value: only a SHA-10
 * fingerprint + the project ref + valid/invalid. Exits non-zero if any check
 * fails, so a manual run gives a clear signal.
 *
 * Run: npm run -w data drift:check
 */
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../..");
const PROD_URL = process.env.DRIFT_PROD_URL ?? "https://overlander-one.vercel.app";

function readEnvFile(path: string): Record<string, string> | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && m[1] && m[2] !== undefined) out[m[1]] = m[2].trim();
  }
  return out;
}
const fp = (key: string): string => createHash("sha256").update(key).digest("hex").slice(0, 10);
const ref = (url: string): string => url.match(/\/\/([a-z0-9]+)\./)?.[1] ?? url;

let failures = 0;

// ── (a) RUNTIME PROBE — the part that would have caught 2026-06-01 ─────────
async function runtimeProbe(): Promise<void> {
  console.log("\n=== (a) RUNTIME PROBE — deployed prod /api/search-area?debug=1 ===");
  // SoCal bbox + free-text so the federated (corpus) half actually runs and
  // exercises the service-role hydrate — the exact path the rotation broke.
  const url = `${PROD_URL}/api/search-area?bbox=-116.4,33.7,-115.7,34.1&q=camping&debug=1`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const body = (await res.json()) as {
      counts?: { federated?: number };
      failedSources?: string[];
      sourceErrors?: Record<string, string>;
    };
    const failed = body.failedSources ?? [];
    if (failed.length === 0) {
      console.log(`  ✓ OK — failedSources empty (federated=${body.counts?.federated ?? "?"})`);
    } else {
      failures++;
      console.log(`  ✗ FAIL — failedSources=${JSON.stringify(failed)}`);
      // sourceErrors comes from the ?debug=1 gate — error messages, never keys.
      console.log(`    sourceErrors: ${JSON.stringify(body.sourceErrors ?? "(not returned — is #121 deployed?)")}`);
    }
  } catch (e) {
    failures++;
    console.log(`  ✗ FAIL — could not reach ${PROD_URL}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ── (b) STORED-KEY SCAN — catches stale local/backup copies ───────────────
type Target = { label: string; path: string; urlVar: string; keyVar: string };
const TARGETS: Target[] = [
  { label: "data/.env", path: resolve(REPO, "data/.env"), urlVar: "SUPABASE_URL", keyVar: "SUPABASE_SERVICE_ROLE_KEY" },
  { label: "data/.env.test", path: resolve(REPO, "data/.env.test"), urlVar: "SUPABASE_TEST_URL", keyVar: "SUPABASE_TEST_SERVICE_ROLE_KEY" },
  { label: "web/.env.local", path: resolve(REPO, "web/.env.local"), urlVar: "NEXT_PUBLIC_SUPABASE_URL", keyVar: "SUPABASE_SERVICE_ROLE_KEY" },
  { label: "web/.env.development.local", path: resolve(REPO, "web/.env.development.local"), urlVar: "NEXT_PUBLIC_SUPABASE_URL", keyVar: "SUPABASE_SERVICE_ROLE_KEY" },
  { label: "env-backups/.env.production-backup", path: resolve(homedir(), ".config/overlander/env-backups/.env.production-backup"), urlVar: "SUPABASE_URL", keyVar: "SUPABASE_SERVICE_ROLE_KEY" },
  { label: "env-backups/.env.test-backup", path: resolve(homedir(), ".config/overlander/env-backups/.env.test-backup"), urlVar: "SUPABASE_URL", keyVar: "SUPABASE_SERVICE_ROLE_KEY" },
];

async function testKey(url: string, key: string): Promise<string> {
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await db.from("master_place").select("id").limit(1);
  return error ? `INVALID -> ${error.message}` : "VALID";
}

async function storedKeyScan(): Promise<void> {
  console.log("\n=== (b) STORED-KEY SCAN — each stored service key vs its own project ===");
  for (const t of TARGETS) {
    const env = readEnvFile(t.path);
    if (!env) { console.log(`  ${t.label}: (file absent)`); continue; }
    const url = env[t.urlVar];
    const key = env[t.keyVar];
    if (!url || !key) { console.log(`  ${t.label}: (${t.urlVar}/${t.keyVar} not both set)`); continue; }
    let result: string;
    try { result = await testKey(url, key); } catch (e) { result = `ERROR -> ${e instanceof Error ? e.message : String(e)}`; }
    if (!result.startsWith("VALID")) failures++;
    console.log(`  ${t.label}: ref=${ref(url)} key=${fp(key)} -> ${result}`);
  }
}

async function main(): Promise<void> {
  console.log("credential-drift check —", new Date().toISOString().slice(0, 19), "UTC");
  await runtimeProbe();
  await storedKeyScan();
  console.log(`\n${failures === 0 ? "✓ all checks passed" : `✗ ${failures} check(s) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("drift-check fatal:", e instanceof Error ? e.message : e); process.exit(1); });
