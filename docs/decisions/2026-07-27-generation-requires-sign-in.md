# Trip generation will require sign-in, and the legacy wizard is replaced rather than migrated

**Status:** Decided 2026-07-27; **IMPLEMENTED the same day.** All five code steps
merged — #159 (auth gate), #160 (owned-row write target), #161 (root CTA), #162
(de-link legacy), #163 (TEST-only rail removed from the trip write, narrowed to
the corpus call). **Not yet exercised on PROD:** `ANTHROPIC_API_KEY` is unset in
Vercel Production, so no PROD generation has succeeded. The teardown (4b/4c) is
gated on that plus a verified post-sign-in return — see `STATE.md`.

The originally-recorded auth blocker was based on a false claim about PROD's
Google provider; corrected the same day (see §The blocker). What remains of that
thread is a product decision about whether to ship Google-only, not a
prerequisite.
**Date:** 2026-07-27.

## Context

There are two trip-creation surfaces, and the expectation about which is which is
inverted from what the names suggest `[read source; grep]`:

| | Legacy 5-step wizard | Expedition (LLM) wizard |
|---|---|---|
| Route | `/plan` → `/plan/[id]/<step>` | `/plan/expedition` |
| Feature gate | **none** | `ENABLE_PLANNER_WIZARD`, else `notFound()` |
| Linked from the UI | 3 entry points, incl. the root page's primary CTA | **zero** — URL only |
| Calls an LLM | no | yes |
| Write target | authed: `public.trips`; anon: in-memory `TRIPS` | `reference_trips` (TEST only) |
| Live in production | **yes** | no |

The newer, LLM-backed wizard is the gated, unlinked one. The legacy wizard is
unflagged and fronts the site. Full client-side trace:
[`../architecture/trip-creation-surfaces.md`](../architecture/trip-creation-surfaces.md).

A generated trip today is **neither editable nor findable**: its id is
`expedition-<base36>`, not a UUID, so `canEdit` is false on both serving routes;
and it is written to `reference_trips` while the listings query `trips` or filter
`trip-`, so it appears in no listing on any surface `[read source]`. The redirect
URL is the only route back to it.

## Decision

1. **The expedition wizard replaces the legacy 5-step wizard.** It is unreleased,
   not orphaned.
2. **Generation will require sign-in.** A generated trip must be an owned,
   editable, findable `public.trips` row — the same shape `POST /api/trips/fork`
   already produces.
3. **Anonymous generation is out of scope.** The anon `TRIPS` store is deleted,
   not replaced.
4. **Trips created by the legacy wizard can be discarded.** No migration path is
   built for them.

## Reasoning

**Why require sign-in rather than support anonymous generation.** Ownership is
what makes a trip editable and findable, and both properties are enforced
structurally rather than by app code. `canEdit` keys on a UUID id, and the
write path enforces ownership through RLS (`trips_insert_owner`,
`trips_update_owner`, both `auth.uid() = owner_id`) `[queried catalog]`. There is
**no `owner_id` default** — RLS validates it, it does not populate it — so a row
can only be created with an identity in hand. Supporting anonymous generation
would mean either reproducing ownership semantics without an owner, or keeping the
ephemeral in-memory store, which loses trips on server restart and communicates
that to the user nowhere `[read source: no such copy exists anywhere in the
creation flow]`.

**Why replace rather than migrate.** The two wizards share almost no machinery.
The legacy path builds days through `buildRouteAwareDays` → `buildDaySuggestions`;
the expedition path runs `preComputeFacts` → `generateAndAudit` →
`bakeGeneratedDays`. They are disjoint pipelines that happen to produce the same
`Trip` shape. Migrating would mean maintaining both. The shared surface is small
and already identified: `LocationAutocomplete`, `DateRangeInput`, `SelectableChip`,
and `PlanningLayout`/`EntryScene` (the last two also used by the home page, so they
survive regardless) `[grep: importer map]`.

**Why the target shape needs no new machinery.** The fork route already produces
exactly it, and the ADR §1 write seam (`node-actions.ts` `writeEdit`/`guard`)
already dispatches UUID trips to `updateUserTripPayload` under RLS. Its own
docstring anticipates this change: *"These disappear at ADR §1 when the write path
moves to user-owned trips"* `[read source]`. **No migration and no RLS change is
required** — `public.trips` already has `id uuid default gen_random_uuid()`, the
`state` check constraint, and all four owner-scoped policies `[queried catalog]`.
The generated payload already carries baked `corridorCities`, so it needs no bake
step either `[queried TEST]`.

## The blocker — CORRECTED 2026-07-27, and it is not what was recorded

> **This section originally read:** *"Sign-in is not currently exercisable on
> either project … TEST has no Google provider configured, and PROD's provider is
> disabled."* The first half of that provider claim holds. **The second is false.**
> It was recorded from a verbal report, written into three documents without an
> evidence tag, and not checked until the day after. Corrected in place rather
> than left standing, because it framed the entire sequence below as blocked.

**Actual provider state** `[queried Management API config/auth, 2026-07-27]`:

| | TEST | PROD |
|---|---|---|
| Google | **not configured** | **enabled** (client id + secret set) |
| Email | **enabled** | **enabled** |

**So sign-in works on PROD today, and this decision is not blocked on auth
infrastructure.**

**What actually remains is a UI gap.** Google OAuth is the only wired method —
`web/src/app/auth/actions.ts` exports exactly `signInWithGoogle` and `signOut`,
the sign-in page reads *"Google · only sign-in method for v1"*, and a repo-wide
grep for `signInWithPassword`, `signInWithOtp`, `signUp`, `verifyOtp`,
`resetPasswordForEmail` and `signInAnonymously` returns **zero hits in `web/src`**
`[grep]`. No email, magic-link, OTP or password-reset form exists anywhere in the
app.

That makes *"ship Google-only, or build a second sign-in form?"* a **product
decision, not a prerequisite.** The sequence can begin as soon as it is settled.

**Scriptable dev login already works — confirmed rather than inferred.**
`external_email_enabled` is `true` on TEST, which is what the committed
`signInWithPassword` scripts rely on (`mint-dev-session.ts`, `seed-test-user.ts`,
the three `verify-trip-*.ts` harnesses). Account *creation* in those scripts goes
through `admin.createUser`, which bypasses provider config and so proved nothing
by itself — the sign-in call is what needed the API to confirm. Only friction is
the ~1h session expiry already documented in CLAUDE.md §RUNBOOK.

`app/trips/layout.tsx` still carries its user gate **commented out** with
*"Re-enable the user gate when OAuth is back"* `[read source]`. That comment rests
on the same false premise and is now stale; the two gates should still move
together, but neither is waiting on OAuth.

## Magic-link mechanics — measured 2026-07-27, replaces Google

The decision above is to replace Google with magic link. These are the mechanics,
established by driving the real client path end to end on TEST. Instrument:
`web/scripts/test-magic-link-pkce.ts`.

### The callback lands as `?code=` — server-readable, PR 2 is additive

A client-initiated `signInWithOtp` produces the **same shape as Google OAuth**
`[tested on TEST]`:

```
HTTP/2 303
location: http://localhost:3210/auth/callback?code=c45c972f-…&next=%2Ftrips
```

Query string, not fragment. So `exchangeCodeForSession` handles **both** flows and
the existing callback route needs an *additive* branch, not a redesign. The
`?code=` happy path may need no change at all.

**Why an earlier probe said `#fragment`, and why that was an artifact.** Measuring
this with `admin/generate_link` first produced an implicit-flow fragment
(`#access_token=…`), which a server route cannot read. That result was **wrong for
the client case** and nearly drove a much larger redesign. The cause: PKCE requires
a `code_challenge` that the *client* generates when calling `signInWithOtp`, and
**admin-generated links carry no challenge**, so GoTrue falls back to implicit.
Anyone re-deriving this with `generate_link` will reach the same wrong conclusion —
which is why the instrument checks, and prints, whether `code_challenge` is
actually on the wire before trusting its own result.

Corroborating detail: a challenge-bearing token is **prefixed `pkce_`** in the
email link (`?token=pkce_07c443…`). That prefix is a readable signal for telling
the two flows apart when debugging.

`@supabase/ssr` 0.10.3 hardcodes `flowType: "pkce"` **after** the options spread in
both `createBrowserClient` and `createServerClient`, so it cannot be overridden
`[read node_modules]`. Versions in play: `@supabase/ssr` 0.10.3,
`@supabase/supabase-js` / `@supabase/auth-js` 2.106.2.

`next` survives the email hop intact — it rides in `redirect_to`'s query string,
and GoTrue **appends** `code` with `&` rather than clobbering it. The existing
`startsWith("/")` sanitizer applies unchanged at the point it lands.

### There are TWO types, and the current route sees neither

`[tested on TEST]` — the type depends on whether the account already exists:

| | first-time address | returning user |
|---|---|---|
| template | **confirmation** ("Confirm your email address") | magic link ("Your sign-in link") |
| link `type=` | **`signup`** | `magiclink` |

The observed link was `type=signup`, because `shouldCreateUser` defaults to `true`
and the address had no account. **A `verifyOtp` branch must handle both**, and the
two arrive via different email templates — a split easy to miss when only ever
testing with one address.

### User-creation state differs by path — do not generalise across them

Two rows created minutes apart ended in **different** states `[tested on TEST]`:

| created via | confirmed | identities |
|---|---|---|
| `admin/generate_link` | no | **`[]`** |
| client `signInWithOtp` | no | **`['email']`** |

So "a new user starts with zero identities" is true of the *admin* path only. A
prediction carried over from the admin throwaway to the client rows was wrong on
exactly this point. Verify the path you actually ship.

**Tooling caveat that caused it:** the bulk `GET /auth/v1/admin/users` endpoint
**under-reports `identities`** — it returned `[]` for every user, including seed
accounts that provably have one. Fetch users **individually**
(`/auth/v1/admin/users/{id}`) when identity state matters.

## Consequences

- **The sequence is fixed and legacy removal is strictly last** — the legacy path
  is the only creation surface with a UI entry point, and `/plan/expedition` 404s
  without its flag. Legacy must survive until the expedition path is both flag-on
  and linked. Full four-step sequence: `docs/BACKLOG.md` §Wizard swap.
- **Deleting the anon `TRIPS` store overlaps the reference-fixture removal
  residual of #143** — both delete the same module. They are one piece of work.
- **`buildDaySuggestions` dies with the legacy path**, and takes
  `MAX_SEGMENT_SUGGESTIONS = 30` and (transitively) `suggestions-for-segment.ts`
  with it `[grep: single caller]`. The expedition path never had that cap.
- **Two known quality blockers remain before this can be the primary creation
  path**, separate from auth and not resolved by this decision: no degradation
  signal reaches any component (the action returns a `note` that nothing reads,
  and it does not fire for the missing-`GOOGLE_PLACES_API_KEY` case at all), and
  generated trips carry inflated `milesFromStart`. **Both are being shipped
  knowingly** (#163). Scope note added 2026-07-27: the degradation blocker's worst
  case is **not armed on Production** — `GOOGLE_PLACES_API_KEY` **is** set there
  `[vercel env ls production]`, so tier-2 names will resolve. The missing signal
  is still a real defect; it simply is not the one that bites first.
- **The corpus-feedback call must stay on a service client** regardless of what
  the trip write uses — `upsert_source_record` is SECURITY INVOKER and
  `source_record` has RLS with zero policies. See `docs/BACKLOG.md` §Client
  boundary.

## What would revisit this

The sequence is not waiting on auth. What it waits on is the product call:
**ship Google-only, or build a second sign-in form first.** If the answer is
Google-only, step 1 can start now. If a second method is wanted, note that email
is already enabled on both projects but `mailer_autoconfirm` is `false` and both
run on **built-in SMTP** (every SMTP field null) `[queried Management API
config/auth, 2026-07-27]` — so magic link or email confirmation would need a real
SMTP provider before it could be relied on. See `docs/BACKLOG.md`.

**Adding a second method will NOT orphan existing Google users — tested, not
reasoned about** `[tested on TEST, 2026-07-27]`. This was the open question that
could have turned the swap from a UI change into a migration, so it was settled
experimentally rather than from the schema or the config flags.

Method: a throwaway user was created on TEST holding **one `google` identity and
no `email` identity**, a magic link was generated for that same address, and the
token was verified — the moment a real user clicks the link. Result:

| | before | after |
|---|---|---|
| `auth.users` total | 3 | **3** |
| `auth.identities` total | 3 | **3** |
| rows for that address | 1 | **1** |
| that user's identities | `google` | **`google`** |

**The magic link resolved to the SAME `auth.users` row and issued a session for
it.** No second user, no collision, and therefore no orphaned trips — trip
ownership is `trips.owner_id → public.users(id) → auth.users(id)`, so an
unchanged user id means unchanged ownership.

**State the mechanism precisely, because the obvious reading is wrong.** No
`email` identity was added alongside the Google one — the identity count stayed
at **1** and stayed `google`. GoTrue matched on the **`auth.users.email` column**
and did not touch `auth.identities` at all. So this is **email-matching, not
identity linking.** `security_manual_linking_enabled` is `false` on both projects
and was never involved, which is exactly why inspecting that flag could not have
answered the question.

Someone who expects identity *linking* will look for a second `auth.identities`
row, not find one, and may read that absence as a failed test. It is not — it is
the mechanism working as designed. The property that matters is the stable user
id, not the identity row count.

*(The experiment ran on TEST only. PROD was read-only throughout; the throwaway
user was deleted afterwards and TEST confirmed back to its 2-user baseline.)*

If anonymous trips are ever wanted as a product feature, this decision needs
reopening rather than extending — the anon store is deleted here, and re-adding
one would need durable persistence and honest UI about it, neither of which
exists today.
