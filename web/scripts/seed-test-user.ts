/**
 * STEP 1 — TEST PARITY SEED. Creates TWO TEST auth users (email/password —
 * Google OAuth is off on TEST) and one trip owned by the first, exercised
 * through the RLS path (a real JWT), and proves RLS isolation against the
 * second user. TEST-ONLY, idempotent (safe to re-run).
 *
 *   npx tsx --env-file=.env.development.local scripts/seed-test-user.ts
 *
 * Prints reusable credentials (email + password, NOT the JWT — it expires ~1h;
 * a harness re-runs signInWithPassword for a fresh session).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const TEST_REF = "znldzjdatkogdktymtvi";
const PW = "seed-pw-manual-edit-8471"; // TEST-only fixed password
const OWNER = "seed-owner@overlander.test";
const OTHER = "seed-other@overlander.test";

function assertTest(url: string): void {
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  if (ref !== TEST_REF) throw new Error(`TEST-ref-or-abort: ${ref}, not TEST`);
}

async function createOrGetUser(admin: SupabaseClient, email: string, name: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  let userId = data?.user?.id;
  if (error || !userId) {
    // Already registered → find it (idempotent re-run).
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list.users.find((u) => u.email === email)?.id;
    if (!userId) throw new Error(`createUser failed and no existing user for ${email}: ${error?.message}`);
  }
  // public.users has no auth->public mirror trigger; name is NOT NULL. Upsert = idempotent.
  const { error: uErr } = await admin.from("users").upsert({ id: userId, name }, { onConflict: "id" });
  if (uErr) throw new Error(`public.users upsert failed for ${email}: ${uErr.message}`);
  return userId;
}

async function sessionFor(url: string, anonKey: string, email: string): Promise<{ client: SupabaseClient; userId: string }> {
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PW });
  if (error || !data.session) throw new Error(`signInWithPassword failed for ${email}: ${error?.message}`);
  const client = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
  });
  return { client, userId: data.user!.id };
}

function seedPayload(): unknown {
  return {
    id: "",
    title: "SEED — manual-edit harness",
    startDate: "2026-07-01",
    endDate: "2026-07-02",
    startLocation: "Seed Start",
    endLocation: "Seed End",
    weatherHiF: 70,
    weatherLoF: 50,
    days: [
      {
        id: "day-1",
        label: "Day 1",
        date: "2026-07-01",
        coords: [-129, 56],
        startCoord: [-128, 55],
        miles: 100,
        driveHours: 2,
        waypoints: [{ id: "seed-wp-1", title: "Seed Waypoint", coords: [-128.5, 55.5] }],
      },
    ],
    wizard: { currentStep: "going" },
  };
}

async function findOrCreateTrip(userClient: SupabaseClient, userId: string): Promise<string> {
  const { data: existing } = await userClient.from("trips").select("id").eq("owner_id", userId).limit(1);
  if (existing?.[0]) return existing[0].id as string;
  const { data, error } = await userClient
    .from("trips")
    .insert({ owner_id: userId, reference_id: null, title: "SEED — manual-edit harness", state: "draft", payload: seedPayload() })
    .select("id")
    .single();
  if (error || !data) throw new Error(`trip insert failed (RLS insert policy?): ${error?.message}`);
  return data.id as string;
}

async function main(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assertTest(url);
  const admin = createClient(url, svcKey, { auth: { persistSession: false } });

  const ownerId = await createOrGetUser(admin, OWNER, "Seed Owner");
  const otherId = await createOrGetUser(admin, OTHER, "Seed Other");
  const owner = await sessionFor(url, anonKey, OWNER);
  const other = await sessionFor(url, anonKey, OTHER);
  const tripId = await findOrCreateTrip(owner.client, ownerId);

  // NEGATIVE RLS TEST — the non-owner must get 0 rows on BOTH select and update
  // (the empty select is WHY the update no-ops; proving only the update leaves
  // the mechanism unverified).
  const sel = await other.client.from("trips").select("id").eq("id", tripId);
  const upd = await other.client
    .from("trips")
    .update({ title: "rls-probe-should-not-persist" })
    .eq("id", tripId)
    .select("id");
  const nonOwnerSelectRows = sel.data?.length ?? 0;
  const nonOwnerUpdateRows = upd.data?.length ?? 0;
  const rlsPass = nonOwnerSelectRows === 0 && nonOwnerUpdateRows === 0;

  console.log(
    JSON.stringify(
      {
        ref: TEST_REF,
        owner: { email: OWNER, password: PW, userId: ownerId, tripId },
        other: { email: OTHER, password: PW, userId: otherId },
        rlsIsolation: { nonOwnerSelectRows, nonOwnerUpdateRows, pass: rlsPass },
      },
      null,
      2,
    ),
  );
  if (!rlsPass) {
    console.error("RLS ISOLATION FAILED — non-owner could see/write the owner's trip");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
