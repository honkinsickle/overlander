# Decision — TEST-only "Continue as seed test user" sign-in bypass

**Date:** 2026-08-25
**Owner:** Adam
**Companion docs:** `docs/decisions/2026-07-27-generation-requires-sign-in.md`
(the original sign-in gate this bypasses on TEST only); the `mint-dev-session.ts`
+ `seed-test-user.ts` scripts under `web/scripts/` (the pre-existing seeded-user
mechanism this reuses).

## Context

Google is the only production sign-in method (per
`docs/decisions/2026-07-27-generation-requires-sign-in.md`), but Google is
**not an enabled provider on TEST Supabase** — `/auth/v1/settings` returns
email-only `[measured 2026-08-24]`. The "Continue with Google" button on
the sign-in page therefore cannot complete against TEST, and dev workflows
that need an authenticated session (opening a user-owned trip in the
slideup, hitting `/plan/expedition`, exercising any UUID-scoped RLS path)
required a cookie-injection workaround via `web/scripts/mint-dev-session.ts`
— fine for one-off checks, high friction for iterative work.

Seeded TEST users already exist (`seed-owner@overlander.test` +
`seed-other@overlander.test`, hardcoded fixture password
`seed-pw-manual-edit-8471` per `seed-test-user.ts:15`, TEST-only). We
already sign them in via `signInWithPassword` in `mint-dev-session.ts`.
This decision surfaces the same sign-in as a wizard-page button so it
doesn't need cookie injection.

## Decision

- **Additive button** on `/auth/sign-in` — "Continue as seed test user"
  (subdued outline styling, below the primary Google button, with a
  distinct amber `TEST only · seed-owner@overlander.test` caption). Never
  visible in production. Google sign-in path is **not modified** in any
  way.
- **New server action** `signInAsSeedTestUser` in
  `web/src/app/auth/actions.ts`. Calls
  `supabase.auth.signInWithPassword` for the fixture creds, then redirects
  to `nextPath`.
- **Structural PROD prevention — TWO gates, both fail closed:**
  1. `NEXT_PUBLIC_SUPABASE_URL` must equal
     `https://znldzjdatkogdktymtvi.supabase.co` exactly (with an optional
     trailing slash) — see `isTestSupabaseUrl()` in
     `web/src/lib/supabase/env.ts`. Rejects undefined, empty, PROD ref
     (`nqzeywzcowujzyegxbsr`), wrong scheme (must be `https`), prefix
     attacks (`znldzjdatkogdktymtvi-evil.supabase.co`), suffix attacks
     (`znldzjdatkogdktymtvi.supabase.co.evil.com`), subdomain attacks
     (`evil.znldzjdatkogdktymtvi.supabase.co`).
  2. `process.env.NODE_ENV` must be `"development"` or `"test"` — see
     `isNonProductionRuntime()`. Production builds (where Next.js sets
     `NODE_ENV="production"`) and any absent/unexpected value fail closed.
- **The gate runs at BOTH render time AND server-action submit time.**
  A user with a manually-crafted POST that skips the render check still
  hits `isTestOnlyBypassAllowed()` inside the server action and is
  refused (`?error=test_bypass_not_allowed`).
- **Backup gate (not code — data-shaped):** `seed-owner@overlander.test`
  does not exist on PROD Supabase; even if both structural gates were
  somehow bypassed, GoTrue would reject the credential with
  `invalid_credentials`. Belt + suspenders + no user to sign in as.

## Alternatives considered

- **(a) Auto-sign-in on TEST — skip the sign-in screen entirely.**
  Rejected: invisible auth is surprising, harder to sign out for testing
  the not-signed-in flow, harder to sign in as `seed-other` (the second
  seeded user) without a code change. An explicit button preserves both
  UX paths.
- **(a′) Add per-user picker.** Rejected as YAGNI — `seed-owner` is
  what every dev workflow currently uses; if `seed-other` sign-in becomes
  useful later, add a second button then.
- **Password field for arbitrary email.** Rejected: bigger surface area,
  invites accidentally typing PROD credentials into a TEST-only flow.
  The fixed fixture creds are the point.
- **Feature-flag env var (`NEXT_PUBLIC_ENABLE_TEST_SIGNIN=true`).**
  Considered as a third gate. Rejected because Adam's task explicitly
  asked for structural (fail-closed) gates rather than "off by default"
  runtime flags — and adding an opt-in flag would mean every dev
  workspace has to set it before the button appears, defeating the
  "no 10-minute detours" goal. The URL + NODE_ENV pair is already
  structural and impossible to satisfy against PROD.

## Consequences

- Adam can sign in with one click on TEST without cookie injection.
- Google sign-in path is untouched — still the only method that
  reaches PROD auth, still the only method visible in production
  builds.
- Any future TEST-only bypass mechanism should reuse
  `isTestOnlyBypassAllowed()` for consistency (same fail-closed
  posture, one place to audit).
- The fixture password `seed-pw-manual-edit-8471` is now referenced
  from two places: `web/scripts/seed-test-user.ts` (source of truth,
  the seed) and `web/src/app/auth/actions.ts` (the bypass action).
  Duplicated deliberately — the seed script is a one-shot dev tool
  and importing from it into the app is wrong; the auth action
  hardcodes the same TEST fixture value with a comment. If the seed
  password ever changes, both places must change together.
- **Zero production risk:** the render-side gate hides the button in
  production builds, the server-action gate refuses to execute the
  password sign-in in production builds, and the credentials wouldn't
  work against PROD Supabase anyway. Three independent barriers.

## Testing / verification

- **16 unit tests** in `web/src/lib/supabase/env.test.ts` enumerate every
  URL failure mode (undefined, null, empty, wrong scheme, PROD, prefix
  attacks, suffix attacks, subdomain attacks) and every `NODE_ENV`
  failure mode (undefined, empty, "production", unexpected values). All
  pass. Run: `cd web && npx tsx --test src/lib/supabase/env.test.ts`.
- **Live TEST verification (this session):**
  - Started `next dev` on TEST env → `/auth/sign-in` renders both
    buttons + "TEST only · seed-owner@overlander.test" caption
    `[measured 2026-08-25]`.
  - `POST /auth/v1/token?grant_type=password` against TEST auth with
    `seed-owner@overlander.test` + fixture password returned an
    `access_token` for user id `a2f74eb2…` — same user
    `mint-dev-session.ts` produces `[measured 2026-08-25]`.
- **PROD-safety verification (this session):**
  - Restarted `next dev` with `NEXT_PUBLIC_SUPABASE_URL` overridden to
    the PROD project URL (`https://nqzeywzcowujzyegxbsr.supabase.co`,
    same TEST anon key so no PROD data access) → `/auth/sign-in` HTML
    contained only "Continue with Google"; the bypass button and its
    TEST-only caption were absent `[measured 2026-08-25]`.
- **Local gate PASSES:** `npm run -w web typecheck` + `cd web && npx
  next build` + `npm run -w data typecheck` all exit 0.

## Reversal / removal

To remove: delete the `showTestBypass` block from
`web/src/app/auth/sign-in/page.tsx`, delete `signInAsSeedTestUser`
from `web/src/app/auth/actions.ts`, keep or remove
`isTestOnlyBypassAllowed()` in `web/src/lib/supabase/env.ts` per
whether any other TEST-only surface depends on it. The env tests
remain useful as a corpus of TEST-vs-PROD URL classifications.
