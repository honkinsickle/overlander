// Centralized env access for Supabase. Lets callers ask `isConfigured()`
// instead of repeating `!!process.env.NEXT_PUBLIC_SUPABASE_URL` everywhere.
// During the identity-sprint scaffold these may all be unset; downstream
// code (getAlaskaTrip snapshot fallback, lazy auth surfaces) handles that.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export function isConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// ── TEST-vs-PROD structural gates ─────────────────────────────────────
//
// Used by the dev-only "Continue as seed test user" sign-in bypass on
// /auth/sign-in (see docs/decisions/2026-08-25-test-only-signin-bypass.md).
// Both gates below MUST return true for the bypass to be reachable —
// server-action AND UI-render check both consult them, so the same guard
// runs at render time and again at submit time.

/** Canonical TEST Supabase project ref, per CLAUDE.md STANDING RULES:
 *  "TEST Supabase `znldzjdatkogdktymtvi`. PROD `nqzeywzcowujzyegxbsr`.
 *  Never cross them." Duplicated with `web/src/lib/plan/expedition.ts`'s
 *  `TEST_PROJECT_REF`; deliberately kept string-literal here so a typo
 *  in one place cannot silently widen the other's guard. */
export const TEST_SUPABASE_PROJECT_REF = "znldzjdatkogdktymtvi";

/** The full `https://<ref>.supabase.co` form of the TEST URL — what
 *  `NEXT_PUBLIC_SUPABASE_URL` must exactly equal (optional trailing `/`)
 *  for the TEST-only bypass to be considered reachable. */
export const TEST_SUPABASE_URL = `https://${TEST_SUPABASE_PROJECT_REF}.supabase.co`;

/** Structural gate #1: the configured Supabase URL points at the TEST
 *  project and nothing else. Rejects undefined, empty, wrong-scheme,
 *  ref-prefix-attacks (`znldzjdatkogdktymtvi-evil.supabase.co`),
 *  ref-as-subdomain (`evil.znldzjdatkogdktymtvi.supabase.co`), and PROD.
 *  Fails closed on anything the caller can't prove is TEST. */
export function isTestSupabaseUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Trim exactly one optional trailing slash; anything else means the URL
  // isn't the canonical form and shouldn't count.
  const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
  return normalized === TEST_SUPABASE_URL;
}

/** Structural gate #2: the runtime is NOT a production build. Next.js
 *  sets `process.env.NODE_ENV` to `"production"` in production builds
 *  and to `"development"` / `"test"` otherwise; an absent or unexpected
 *  value is treated as production for safety (fails closed).
 *
 *  Pure-function form (takes the value as an argument) so tests can
 *  exercise every branch without process-mutation. */
export function isNonProductionRuntime(
  nodeEnv: string | null | undefined,
): boolean {
  return nodeEnv === "development" || nodeEnv === "test";
}

/** Both structural gates combined. This is what callers should use in
 *  production code — the individual helpers are exposed only so tests
 *  can enumerate the failure modes without process-mutation. */
export function isTestOnlyBypassAllowed(): boolean {
  return (
    isTestSupabaseUrl(SUPABASE_URL) &&
    isNonProductionRuntime(process.env.NODE_ENV)
  );
}

export function requireUrlAndAnon(): { url: string; anon: string } {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      "Supabase env missing: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in web/.env.local",
    );
  }
  return { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY };
}

export function requireServiceRole(): { url: string; service: string } {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Supabase service env missing: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local",
    );
  }
  return { url: SUPABASE_URL, service: SUPABASE_SERVICE_ROLE_KEY };
}
