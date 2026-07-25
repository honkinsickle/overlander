/**
 * Read-only integrity probe: sha256 of each reference_trips row's payload +
 * source_version, sorted by id. Run before and after a seed to prove exactly
 * which rows changed (and that frozen trips are byte-unchanged).
 *   cd web && npx tsx --env-file=<env> scripts/hash-reference-trips.ts
 */
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ requires SUPABASE url + service-role key (use --env-file)");
    process.exit(1);
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await sb
    .from("reference_trips")
    .select("id, title, source_version, payload")
    .order("id");
  if (error || !data) {
    console.error("✗ read failed:", error?.message);
    process.exit(1);
  }
  console.log(`(${(url.match(/https:\/\/([a-z0-9]+)/) ?? [])[1]}) ${data.length} rows`);
  for (const r of data) {
    const h = createHash("sha256")
      .update(JSON.stringify(r.payload))
      .digest("hex")
      .slice(0, 16);
    console.log(`  ${r.id}  sv=${r.source_version}  payload_sha256=${h}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
