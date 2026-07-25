/**
 * DEV-ONLY: mint a Supabase SSR session cookie for the seeded TEST owner so a
 * browser can exercise an authed (RLS) surface — there is no dev password UI
 * (Google-only; see the dev-sign-in item in docs/BACKLOG.md).
 * Run: npx tsx --env-file=.env.development.local scripts/mint-dev-session.ts
 * Prints a JSON array of {name,value} cookies to set via document.cookie.
 * Structurally guarded to the TEST project ref — refuses any other target.
 *
 * CLOCK-SKEW CAVEAT (hard-won, 2026-07-25): this machine and the TEST auth
 * server can disagree by ~1h. The session JSON's `expires_at` is set by the
 * SERVER clock, so locally it can read as already-expired the moment it's
 * minted — @supabase/ssr then force-refreshes on every request and 401s once
 * the rotating refresh chain goes stale. Before injecting, patch the decoded
 * session's `expires_at` to LOCAL now + ~3500s (the signed JWT itself stays
 * valid for its real hour; only the client-side freshness check reads this
 * field). See docs/BACKLOG.md (dev sign-in item) for the fuller story.
 */
import { createServerClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// Credentials come from env — the seeded TEST password is deliberately never
// committed (CLAUDE.md: "printed by the seed"). Example:
//   SEED_EMAIL=seed-owner@overlander.test SEED_PASSWORD=<from seed output> \
//     npx tsx --env-file=.env.development.local scripts/mint-dev-session.ts
const EMAIL = process.env.SEED_EMAIL ?? "seed-owner@overlander.test";
const PASSWORD = process.env.SEED_PASSWORD ?? "";
if (!PASSWORD) {
  console.error("Set SEED_PASSWORD (printed by scripts/seed-test-user.ts).");
  process.exit(1);
}

// Structural guard: only ever mint against the TEST project.
if (!url.includes("znldzjdatkogdktymtvi")) {
  throw new Error(`refusing to mint against non-TEST project: ${url}`);
}

void (async () => {
  const jar = new Map<string, string>();
  const captured: { name: string; value: string }[] = [];
  const client = createServerClient(url, anon, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (toSet) => {
        for (const c of toSet) {
          jar.set(c.name, c.value);
          captured.push({ name: c.name, value: c.value });
        }
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (error) {
    console.error("SIGNIN_ERROR", error.message);
    process.exit(1);
  }
  console.error("signed in as", data.user?.email, "id", data.user?.id);
  // De-dupe by name (last write wins).
  const byName = new Map(captured.map((c) => [c.name, c.value]));
  console.log(
    JSON.stringify([...byName.entries()].map(([name, value]) => ({ name, value }))),
  );
})();
