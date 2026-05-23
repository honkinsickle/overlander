// One-shot — delete a single user-trip row by id and re-list remaining
// forks of la-to-deadhorse for confirmation.
//
// Usage: tsx --env-file=.env.local scripts/delete-stale-fork.ts <uuid>

import { createClient } from "@supabase/supabase-js";

async function main(): Promise<void> {
  const targetId = process.argv[2];
  if (!targetId) {
    console.error("✗ usage: delete-stale-fork.ts <uuid>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("✗ NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Read first so we log exactly what's about to go.
  const { data: pre, error: preErr } = await supabase
    .from("trips")
    .select("id, owner_id, reference_id, state, title, created_at")
    .eq("id", targetId)
    .maybeSingle();
  if (preErr) {
    console.error("✗ read error:", preErr.message);
    process.exit(1);
  }
  if (!pre) {
    console.log(`No row with id=${targetId}. Nothing to delete.`);
  } else {
    console.log("About to delete:");
    console.log(`  id=${pre.id}`);
    console.log(`  owner=${pre.owner_id}`);
    console.log(`  reference_id=${pre.reference_id}`);
    console.log(`  state=${pre.state}`);
    console.log(`  title=${pre.title}`);
    console.log(`  created_at=${pre.created_at}`);

    const { error: delErr } = await supabase
      .from("trips")
      .delete()
      .eq("id", targetId);
    if (delErr) {
      console.error("✗ delete error:", delErr.message);
      process.exit(1);
    }
    console.log("✓ deleted");
  }

  console.log("\nRemaining forks of la-to-deadhorse (all owners):");
  const { data: forks, error: forkErr } = await supabase
    .from("trips")
    .select("id, owner_id, state, title, created_at")
    .eq("reference_id", "la-to-deadhorse")
    .order("created_at", { ascending: false });
  if (forkErr) {
    console.error("✗ list error:", forkErr.message);
    process.exit(1);
  }
  if (!forks || forks.length === 0) {
    console.log("  <none>");
  } else {
    for (const t of forks) {
      console.log(
        `  ${t.id}  owner=${t.owner_id}  state=${t.state}  created=${t.created_at}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
