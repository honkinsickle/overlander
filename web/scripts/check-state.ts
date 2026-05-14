// Diagnostic dump — auth.users, public.users, public.trips, public.reference_trips.
import { createClient } from "@supabase/supabase-js";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authList, error: authErr } = await supabase.auth.admin.listUsers();
  console.log("\n== auth.users ==");
  if (authErr) console.error(authErr);
  else for (const u of authList.users) console.log(`  ${u.id}  ${u.email}  created=${u.created_at}`);

  const { data: profiles, error: pErr } = await supabase.from("users").select("*");
  console.log("\n== public.users ==");
  if (pErr) console.error(pErr);
  else for (const r of profiles ?? []) console.log(`  ${r.id}  name=${r.name}  rig_name=${r.rig_name}  rig_type=${r.rig_type}`);

  const { data: trips, error: tErr } = await supabase.from("trips").select("id, owner_id, reference_id, title, state, created_at");
  console.log("\n== public.trips ==");
  if (tErr) console.error(tErr);
  else for (const t of trips ?? []) console.log(`  ${t.id}  owner=${t.owner_id}  ref=${t.reference_id}  state=${t.state}  title=${t.title}`);

  const { data: refs, error: rErr } = await supabase.from("reference_trips").select("id, title, source_version, updated_at");
  console.log("\n== public.reference_trips ==");
  if (rErr) console.error(rErr);
  else for (const r of refs ?? []) console.log(`  ${r.id}  ${r.title}  v=${r.source_version}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
