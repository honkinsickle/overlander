# Backlog — open work

Durable and deferred work. This is the long list; the **active cut** — what is
queued or in-flight right now — lives in `docs/STATE.md` (§Queued, §In-flight)
and is authoritative for the current branch. When an item here becomes the next
thing worked, it moves into STATE.md §Queued.

## Geometry defects (measured by the day-mile pass, 2026-07-26)

Both surfaced while scoping the generated-day mile defect; neither IS that
defect. Measurements and context:
[`docs/architecture/generation-pipeline.md`](architecture/generation-pipeline.md) §7.

- **`routePolyline` omits ~25% of a generated trip — the drawn route is
  incomplete.** On `expedition-ms28y793` the stored polyline decodes to
  **899 mi** against **1,200 mi** of claimed `day.miles` `[measured 2026-07-26]`.
  The 301-mile shortfall resolves exactly: `auditItinerary`'s `isOutAndBack`
  branch (`day.startPlace === day.endPlace`) sets `measuredMi = null` and
  **never routes the day**, so `dayPolyline` stays null and
  `concatDayRouteCoords` skips it `[read source: audit.ts, to-trip.ts]`. Six of
  fifteen days are start==end and their miles sum to **300** (1 mi rounding).
  Includes a 110-mile day-2 loop that contributes no geometry at all.
  **This one is genuinely visible on the map** — the line jumps between the days
  that do have geometry — unlike the mile-label problem, which is invisible
  there (§7.2). How the map renders that discontinuity was not checked
  `[UNVERIFIED]`. Note `day.miles` on those days is the LLM's *stated* value,
  never measured, so the 1,200 figure is itself ungrounded on 6 of 15 days.

- **63% of tiles belong to no node — three causes, only one mile-driven.**
  30 of 48 tiles on `expedition-ms28y793` appear in no `corridorCities[].placeIds`
  `[queried TEST]`. Every tile carries a mile, so all passed gate 1
  (`offsetMi <= bufferMi`); every orphan failed **gate 2**,
  `bestDist > maxAttachMi = 25` `[read source: corridor/bucket.ts]`. Measured
  gaps to the nearest node run **26.1 mi to 310.8 mi**. Re-deriving the spine and
  re-bucketing on a corrected line takes it to **17/48** `[measured]` — so:
  1. **mile inflation** — 13 tiles, fixable by correcting the line;
  2. **node sparsity vs `maxAttachMi = 25`** — measured max node gaps of
     148/119/106/104/103 mi (days 1/3/8/11/14). A tile at the midpoint of a
     148-mile gap sits 74 mi from both nodes and **cannot attach at any mile
     value**. 9 of 15 days have a gap whose midpoint exceeds 25;
  3. **round-trip degenerate spines** — days 7, 10 and 15 derive *both* nodes at
     mile 0, so any tile past mile 25 orphans unconditionally (5 of the 17).

  **The remaining 17 are structural and no mile fix reaches them.** Comparable
  in size to the defect that was being fixed, and previously unexamined — the
  63% figure sat in a baseline for two sessions without analysis. Needs a
  decision on `maxAttachMi` / spine density, not a mile correction.

## Grounding defects (found by the generation trace, #151)

- **`day.weather` is LLM-authored prose presented as measurement — a fabricated
  field in user-visible UI.** It is a `required` property of the LLM's output
  `json_schema`; the prompt payload contains no weather input; `auditItinerary`
  never reads or writes it; and there is **no weather or climate source anywhere
  in the repo**. It renders under a **WEATHER** heading carrying specific
  Fahrenheit ranges (observed on TEST: *"Arrive · Hot desert, 95–105°F"*), with
  no advisory marker and no provenance tag. This violates the standing grounding
  rule (*every field real or absent, never invented*). Three exits, not yet
  chosen: (a) drop the field from the schema and the render; (b) mark it
  advisory in the UI so it reads as a model estimate, not a reading; (c) back it
  with a real source — see the live-weather rescue item below, which would make
  the field honest rather than removing it. **A product call, not a code fix.**
  Full trace: `docs/architecture/generation-pipeline.md` §4.
- **`trip.weatherHiF`/`weatherLoF` are hardcoded `70`/`45` on every generated
  trip**, and `overnight.selected.detourMiles` is a hardcoded `0` — both numeric
  fields that read as measurements. Currently harmless *only because* their
  renderer is dead code (below); they are in the persisted payload and would
  become visible the moment anything mounted it.
- **`TripDetailHeader` is dead code.** `web/src/components/trip/trip-detail-header.tsx`
  is the only component rendering the `{weatherHiF}° / {weatherLoF}°F` pill and
  has **no call site** — superseded by `DayDetailOverview`. Two stale comments
  still reference it (`day-detail-corridor-column.tsx`,
  `imagery/mapbox-static.ts`). Deleting it also deletes the only consumer of the
  hardcoded pill values. Low risk, not done here (trace was read-only).
- **Tier-2 tiles are not deduped by `placeId` before `resolvedToTile`.** A place
  the LLM names as both a day endpoint and a key stop persists as two identical
  `segmentSuggestions` entries and appears twice in a node's `placeIds`
  (verified on `expedition-ms28y793` day 6). `stripNodeIdentical` does not catch
  it when the spine node's name differs from the place's Google `displayName`
  ("Bryce Canyon, UT" vs "Bryce Canyon National Park"). This is the documented
  "renders twice" outcome, so it is cosmetic, not a wrong-place bug.
- **A missing `GOOGLE_PLACES_API_KEY` degrades every generated trip invisibly.**
  `PlaceResolver.resolve` returns and caches `no-key`; every name that is not an
  exact pool match is dropped with a per-day flag, but the action still returns
  `ok: true`. No distinct error separates "no key" from "genuinely not found" at
  the action boundary. Worth a fail-fast check before the (paid) LLM call.

## Draft trips after the wizard swap — a loose end, not a bug (2026-07-28)

### Correction: `createUserWizardTrip` was NOT the only writer of `state='draft'`

Recorded because the premise was asserted during 4c scoping and disproved against
source. **Three live paths remain**, all `[read source, re-verified 2026-07-28
against post-4b/4c `main`]`:

| # | Writer | Trigger |
|---|---|---|
| 1 | `app/trips/actions.ts:80` `duplicateTrip` — inserts `state: "draft"` at :110 | `components/trips/trip-card.tsx:76` `submitDuplicate()` — the card's **Duplicate** control |
| 2 | `app/trips/actions.ts:16` `setTripState` — `.update({ state })` at :23 | `trip-card.tsx:358` `choose(next)` — the **StatePill** dropdown; `"draft"` is one of three user-selectable states |
| 3 | DB default `state text not null default 'draft'` (`20260513000000_init_identity.sql:63`) | **any** insert omitting `state` |

Writer 3 is currently unreachable in app code: the only other two inserts into
`public.trips` both set `state` explicitly — `app/api/trips/fork/route.ts`
(`"active"`) and `lib/plan/expedition-actions.ts:127` (`"active"`). It is a
latent default, not a live path.

### The loose end

**Nothing branches on `state === "draft"` anymore.** A repo-wide grep finds the
type union in two places and one comment — no behaviour keys off it `[grep]`.
Since #162 every card links to `/trips/{id}`, so a draft renders as an ordinary
trip carrying a "Draft" pill.

That is **coherent**, and it is deliberately recorded as a loose end rather than
a defect: drafts remain **creatable** while nothing consumes them **as drafts**.
The state is now a label the user can set and nothing acts on. Either give it
meaning or retire it — but decide, rather than letting it drift.

### The `NaN` header is narrower than it looks

The `NaN/NaN-NaN/NaN • 0 Days • 0 mi` slideup header affects only **dateless,
0-day** drafts. **No surviving path creates that shape**: `duplicateTrip` copies
a real `source.payload` (real days and dates), and `setTripState` only relabels
an existing trip. The instances are PROD's legacy rows — **7, LAST-KNOWN and NOT
currently measurable** (the Supabase access token is revoked and no PROD
credentials exist locally). Treat that 7 as last-known, not current.

## Orphans created by PR 4b — noted, not acted on (2026-07-28)

Both dropped to **zero importers across all of `web/`** when 4b deleted the
legacy components, and neither was in 4b's or 4c's scope
`[grep, re-verified 2026-07-28]`:

- `web/src/components/ui/checkbox.tsx`
- `web/src/lib/imagery/mapbox-static.ts`

Left deliberately. An unimported module is cheap, and deleting one is the kind of
decision that deserves a human check that no out-of-repo consumer depends on it —
the same posture taken for the vestigial `GooglePlaces` env var above.

## Vercel Production env — measured 2026-07-27

All `[vercel env ls production]`. Names only; no values were read or printed.

- **`ANTHROPIC_API_KEY` is NOT set in Production — the only thing blocking a first
  PROD generation.** `ENABLE_PLANNER_WIZARD` is already set (and the wizard
  verifiably renders: `/plan/expedition` → 307 → sign-in on the public alias),
  so the code path is reachable and stops at `generate.ts`'s key check. It
  throws before the SDK import, so the failure is free — no Anthropic spend, no
  partial trip, no DB row. **Fix is one env var + a redeploy.**

- **`GOOGLE_PLACES_API_KEY` IS set in Production** (49d old, Preview+Production).
  Recorded because the obvious worry does **not** apply: the silent-degradation
  defect above (a missing key drops every tier-2 name while the action still
  returns `ok: true`) **will not bite the first PROD generation.** Tier-2
  resolution has a key to work with. The defect remains real; it is simply not
  armed on Production today. Re-check if that var is ever rotated or scoped away
  — nothing would tell you.

- **The `missing_key` error tells a PROD user to edit a file they do not have.**
  `generate.ts:60` throws *"ANTHROPIC_API_KEY is not set — add it to
  `web/.env.local` to run generation."* That string is developer-facing advice
  written for a local checkout, and it reaches the browser: the action returns
  `{ ok: false, error }` and the wizard renders `error` verbatim. On Production
  the fix is a Vercel env var and a redeploy — `web/.env.local` does not exist
  and could not help. Two sibling throws differ again (`edit.ts`: "required to
  parse edit requests"; `interpret.ts`: bare "is not set."), so the same
  condition surfaces three different messages. Worth one shared, deploy-aware
  string — and worth deciding whether raw internal env-var names should reach an
  end user at all.

- **`GooglePlaces` (70d, Production+Preview) appears vestigial.** It sits
  alongside the real `GOOGLE_PLACES_API_KEY`, and **nothing in `web/src` or
  `data/` reads `process.env.GooglePlaces`** `[grep]`. Likely a first-attempt
  name left behind. Not urgent and NOT auto-removable — an unread env var is
  cheap, and deleting a credential-bearing var deserves a human check that no
  out-of-repo consumer (a Vercel function, a cron, a script) depends on it.

## Schema & infra hygiene (found 2026-07-27)

- **Migration review gap — a table shipped without RLS and nothing caught it.**
  `public.mvum_roads` was created by `20260603010000_phase2_mvum_corridor.sql`
  with no `enable row level security`, while `master_place`, `source_record`,
  `place_match`, `legality_overlay` and `field_precedence` all enable it in their
  own creating migrations. No later migration picked it up, so it stood from
  creation until #154. **Treat this as a review gap, not a one-off:** nothing in
  CI or the migration workflow compares a new table against the RLS posture of
  its siblings, so the next one would land the same way.
  - **Cheap standing check:** sweep `pg_class.relrowsecurity = false` over the
    `public` schema and diff against an expected allowlist. Both projects are
    currently clean (`spatial_ref_sys` is PostGIS-owned and expected)
    `[queried catalog, TEST + PROD, 2026-07-27]`. This is one query; it belongs
    either in `drift:check` or in the `db:push-verify` wrapper, which already
    exists to catch migrations that report success without doing their work.
  - Related lesson already carried into the migration itself: **revoking function
    `EXECUTE` needs both the `from public` and the `from anon, authenticated`
    forms**, because a revoke against a grant a role never individually held is a
    silent no-op. See `supabase/migrations/20260727120000_mvum_roads_rls.sql`.

- **Migration history gap — PROD is missing `20260723120000_google_resolved_field_precedence`.**
  TEST has it; PROD does not, in both the ledger and the effect — the three
  `field_precedence` rows for `source_id = 'google_resolved'` are absent from PROD
  `[queried catalog, TEST + PROD, 2026-07-27]`. Note PROD's ledger and PROD's
  actual state **agree with each other**; the divergence is between PROD and the
  repo, so there is no phantom record to reconcile and no double-insert risk.
  - **No current operational impact:** PROD has zero `google_resolved`
    `source_record` rows and cannot accumulate them under current code, since both
    callers of `enqueueResolvedPlaces` refuse unless the project resolves to TEST.
  - **The risk is latent.** `web/src/lib/itinerary/ingest.ts` states that enabling
    PROD write-back needs "its own flag + a PROD `field_precedence` apply" — this
    migration *is* that second prerequisite, and it must be in place **before** the
    first such record lands, or a solo-resolved place promotes with attribution
    `{}` and violates the "never display a field without its attribution"
    invariant. Noticed, not investigated further, not applied.

- **Vercel env audit — UNCHECKED and not visible from source.** On TEST,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the local dev env file held a **secret** key
  rather than the publishable one. Fixed locally and the key rotated. `NEXT_PUBLIC_*`
  is inlined into the client bundle by Next, so the same swap in a deployed
  environment would ship a secret key to browsers.
  - **Whether Vercel's preview/dev environment has the same swap is `[UNVERIFIED]`** —
    dashboard environment variables are not in the repo and cannot be read from
    source. PROD's local env file was correctly configured (publishable anon key,
    separate secret service key), which is evidence about the local file only, not
    about Vercel.
  - Worth a one-time audit of every `NEXT_PUBLIC_*` value in every Vercel
    environment, checking the key **prefix** (`sb_publishable_` vs `sb_secret_`)
    rather than assuming the variable name implies the value.

## Wizard swap — ALL FIVE CODE STEPS MERGED (2026-07-27); 4b/4c gated on PROD

> **STATUS UPDATE 2026-07-27 — this section is no longer forward-looking.**
> #159, #160, #161, #162 and #163 are all merged
> `[gh pr list --state all]`. The scoping below is kept because it is the record
> of *why* the sequence was ordered as it was, and because 4b/4c have not run.
> Current position and the two remaining gates live in
> [`STATE.md`](STATE.md); the one blocker is `ANTHROPIC_API_KEY` missing from
> Vercel Production (see §"Vercel Production env" above).

### Corpus capture on PROD — deliberately still gated

#163 removed the TEST-only rail from the trip write but **kept it on the
`enqueueResolvedPlaces` call site**, so the first PROD generation will produce a
trip and **zero `google_resolved` rows**. That is intended, not a bug.

The two writes have different shapes and only one of them changed:

| | Trip write | Corpus write-back |
|---|---|---|
| Client | session (`authClient`) | **service-role** |
| Target | `public.trips`, owner's own row | `source_record` — **shared, curated** |
| Enforced by | `trips_insert_owner` (`auth.uid() = owner_id`) | nothing — RLS on, **zero policies**; `upsert_source_record` is SECURITY INVOKER |

`ingest.ts`'s own docstring sets the bar for opening it: *"a PROD corpus write
would need a SEPARATE deliberate gate (its own flag + a PROD `field_precedence`
apply)"*. Neither exists, and PROD carries zero `google_resolved` rows. Promotion
to `master_place` would still be a manual `materialize` either way — this gates
**capture**, not promotion. To open it later, decide the flag and apply
`field_precedence` on PROD first; see
[`decisions/2026-07-23-corpus-writeback-dormant.md`](decisions/2026-07-23-corpus-writeback-dormant.md).

### Original scoping (retained)

The legacy 5-step wizard is to be **replaced** by the expedition (LLM) wizard.
Generation will **require sign-in**, so a generated trip is an owned, editable,
findable `public.trips` row — the same shape a fork already produces. Trips created
by the legacy wizard can be discarded; the anon `TRIPS` store is deleted, not
replaced. Client-side surface trace:
[`architecture/trip-creation-surfaces.md`](architecture/trip-creation-surfaces.md).

**NOT BLOCKED ON AUTH — corrected 2026-07-27.** This section previously read
*"THE BLOCKER — nothing below can move until this is resolved … TEST has no Google
provider configured and PROD's provider is disabled."* The first half of that
claim holds; **the second is false**, and it was recorded from a verbal report
without an evidence tag or a check.

Actual provider state `[queried Management API config/auth, 2026-07-27]`:
**TEST has no Google provider configured. PROD has Google enabled, with a client
id and secret set. Email is enabled on both projects.** So **sign-in works on PROD
today** and the sequence below is not gated on standing up auth infrastructure.

**What remains is a UI gap.** Google OAuth is the only wired method
(`web/src/app/auth/actions.ts` exports only `signInWithGoogle` and `signOut`; the
sign-in page reads "Google · only sign-in method for v1"), and a repo-wide grep
for `signInWithPassword`, `signInWithOtp`, `signUp`, `verifyOtp`,
`resetPasswordForEmail` and `signInAnonymously` returns **zero hits in `web/src`**
`[grep]`. Whether to ship Google-only or build a second sign-in form is a
**product decision**, not a prerequisite. Note `app/trips/layout.tsx` still
carries its user gate **commented out** ("Re-enable the user gate when OAuth is
back") `[read source]` — that comment is now stale on the same grounds, and the
two gates should move together.

**Scriptable dev login already works — confirmed, not inferred.**
`external_email_enabled` is `true` on TEST `[queried Management API config/auth,
2026-07-27]`, which is what the committed `signInWithPassword` scripts depend on
(`mint-dev-session.ts`, `seed-test-user.ts`, the three `verify-trip-*.ts`
harnesses). Account *creation* in those scripts uses `admin.createUser`, which
bypasses provider config and therefore proved nothing on its own; the sign-in call
is the part that needed the API to confirm it. Only friction is the ~1h session
expiry already in CLAUDE.md §RUNBOOK.

Sequence, smallest first, each independently mergeable:
1. **Auth gate on `/plan/expedition`** — page-level `getUser()` → redirect to
   `/auth/sign-in?next=…` (the repo's existing `next=` convention), plus a
   `getUser()` check in `generateExpeditionTripAction` returning a clean error
   (the `node-actions.ts` `guard` pattern). Purely additive.
2. **Move the write target** — service client → session-scoped client for the trip
   write, `reference_trips` upsert → `trips` insert using the fork route's exact
   column set (`owner_id`, `reference_id: null`, `title`, `state: "active"`,
   `payload`), id from the DB default. **No migration or RLS change is needed** —
   `public.trips` already has the id default, the `state` check and all four
   owner-scoped policies `[queried catalog]`. The generated payload already carries
   baked `corridorCities`, so no bake step is required `[queried TEST]`.
3. **Entry point + landing** — repoint the root CTA from `/plan` to
   `/plan/expedition`; flip `ENABLE_PLANNER_WIZARD` where it should be live.
4. **Legacy removal** — routes, legacy-only components, `buildDaySuggestions` (and
   transitively `suggestions-for-segment.ts`), and the anon `TRIPS` store.

**Ordering constraint — partially discharged 2026-07-27.** As written, this said
*"legacy must survive until the expedition path is both flag-on and linked."*
**Both of those now hold**: `ENABLE_PLANNER_WIZARD` is set in Vercel Production
and `/plan/expedition` returns 307 → sign-in there (flag-on, verified), and #161 +
#162 made it the only linked path (linked, `[grep]`).

**The constraint still binds anyway**, on a condition the original wording did not
name: flag-on and linked prove the wizard *renders*, not that it *generates*. With
`ANTHROPIC_API_KEY` unset in Production, no PROD generation has ever succeeded —
so legacy is still the only creation path demonstrated to work there. **4b's real
gate is a successful PROD generation plus a verified post-sign-in return**, not
reachability. Step 4b remains strictly last. It also overlaps the
reference-fixture removal residual (both delete the `TRIPS` store); do not start
them independently.

Two known defects ship with the first PROD generation, accepted knowingly (see
#163's PR body): **no degradation signal reaches any component**, and generated
trips carry **inflated `milesFromStart`** (~2.18×; fix parked unmerged on
`fix/generated-day-miles`). Note the degradation defect's worst case — a missing
`GOOGLE_PLACES_API_KEY` — is **not** armed on Production: that var is set
(§"Vercel Production env").

## Client boundary — which operations need service-role (settled 2026-07-27)

Scoping input for the wizard swap's step 2. All `[queried catalog, TEST]` unless
noted.

- **The corpus write-back question is SETTLED: `upsert_source_record` fails at
  RLS, not at grants.** The function is SECURITY INVOKER, so under a user JWT it
  executes as `authenticated`. `EXECUTE` *is* granted to that role, and
  `authenticated` holds full table privileges on `source_record` — but
  `source_record` has **RLS enabled with zero policies**, so every statement is
  denied. **A `GRANT` therefore changes nothing;** only a policy (or service-role)
  would. Consequence for step 2: **the action needs a service client for corpus
  feedback regardless of what the trip write uses.**
- **`preComputeFacts` creates its own service client internally** and does not
  receive one from the action (`web/src/lib/itinerary/facts.ts`,
  `const supabase = createSupabaseServiceClient()`) `[read source]`. It is
  therefore **unreachable by any change to the action's client** — changing the
  action does not change how the two corpus folds in Stage 1 authenticate.
- **The corpus READ works session-scoped.** `pois_along_corridor` is SECURITY
  DEFINER owned by `postgres`, with `EXECUTE` granted to `anon` and
  `authenticated`, so it bypasses RLS on `master_place` by design — its own
  comment calls it "the only consumer door into master_place". Verified returning
  rows under a real `authenticated` JWT.
- **`fetchCorpusForPolyline` swallows every failure into `[]`** — see
  `docs/architecture/generation-pipeline.md` §8 for why that matters.

## Auth configuration — measured, and what's left (2026-07-27)

All `[queried Management API config/auth, 2026-07-27]`.

- **Provider state.** TEST has no Google provider configured; **PROD has Google
  enabled** with a client id and secret set. **Email is enabled on both.** This
  corrects a claim carried in three docs that PROD's provider was disabled — see
  §Wizard swap.
- **TEST `site_url` is `http://localhost:3000`, but the dev server runs on 3210.**
  Left alone deliberately — only `uri_allow_list` was in scope for the authorized
  write. Recorded as a remaining mismatch: anything that redirects via `site_url`
  rather than an explicit `redirectTo` will land on the wrong port in dev.
- **TEST `uri_allow_list` was empty and is now `http://localhost:3210`** (authorized
  write, TEST only). PROD's list already contained `localhost:3210`, `localhost:3000`,
  the prod origin and the preview glob — the reverse of what you'd expect.
- **A minimal PATCH had a side effect.** Sending a body of exactly
  `{"uri_allow_list": …}` to TEST also flipped **`custom_oauth_max_providers`
  from `3` to `32767`** — a field that was not in the request. Not reverted (that
  would be a second unauthorized write). Recorded because it means
  **`PATCH /config/auth` cannot be assumed to change only what you send**; diff
  before/after on any future config write.
- **Both projects run built-in SMTP** — every `smtp_*` field is null (no host,
  user, sender or credentials). **`rate_limit_email_sent` is `2` on both; the unit
  is not present in the payload** and is deliberately not supplied here. Measured
  behaviour: two sends inside ~10 minutes tripped the limiter, and the window had
  reset ~81 minutes later `[tested on TEST]` — bounds, not the actual window.
  `mailer_autoconfirm` is `false` on both, so email confirmation is required — but
  **the magic link itself satisfies it**: verifying flips the user to confirmed and
  creates the `email` identity in one step `[tested on TEST]`.
- **Built-in SMTP delivery on TEST — state this precisely, the distinction decides
  what PR 4 must prove.** It delivered to **at least one address**
  (`acwcreative@gmail.com`, arrived, link read, `?code=` confirmed) and **failed
  for one** (`adam@acwcreative.com` — accepted, quota spent, never arrived).
  - So built-in SMTP is **not systemically broken** on TEST, and it is **not**
    restricted to the account-owner address — `adam@acwcreative.com` *is* the
    Supabase account owner address, which makes its failure stranger rather than
    more explicable.
  - **Why one address fails is `[UNVERIFIED]`.** Do not round this up to "built-in
    SMTP delivers to external addresses"; that is stronger than the evidence and
    would let PR 4 ship without proving the case that actually failed.

Two operational gotchas found while testing the magic-link path
`[tested on TEST, 2026-07-27]`:

- **GoTrue rejects undeliverable domains at the API boundary, before any user
  lookup happens.** Both `@overlander.test` and `@example.com` were refused with
  `400 email_address_invalid` from `POST /auth/v1/otp`. The seeded
  `@overlander.test` accounts exist only because the **Admin API bypasses that
  validation** — `admin/users` accepts what `/otp` will not. **Consequence: no
  future email or magic-link path can be smoke-tested against a fake domain.**
  Exercising it end to end needs a real deliverable address, which on built-in
  SMTP means a real inbox. Budget for that when the work is scoped; do not assume
  a throwaway address will do.
- **`admin/generate_link` + `/verify` exercises the VERIFICATION path only — NOT
  the redirect path. CORRECTED 2026-07-27; the original claim here was mine and it
  was wrong.** It previously read "exercises the identical path", which is false in
  the way that matters: **admin-generated links carry no PKCE `code_challenge`**,
  because the challenge is produced by the *client* calling `signInWithOtp`. So
  GoTrue falls back to the **implicit** flow and redirects with a `#fragment` a
  server route cannot read — while a real client-initiated link redirects with
  `?code=` `[tested on TEST]`. Using `generate_link` to design a callback would
  have produced the wrong architecture.
  - **Still true and still useful:** it sends no mail, spends none of the
    `rate_limit_email_sent` budget, and correctly exercises verification, user
    creation and identity behaviour. It is the right tool for those.
  - **Not usable for:** redirect shape, `?code=` vs `#fragment`, or anything that
    depends on the PKCE handshake. Use the real client path
    (`web/scripts/test-magic-link-pkce.ts`) for those.
  - `generate_link` alone changes no state — the user record only moves at
    `verify`.

- **`signInWithOtp` fails SILENTLY when mail is not delivered — must be handled in
  PR 3, not discovered in production.** Measured `[tested on TEST]`: a send to
  `adam@acwcreative.com` returned **no error**, the rate limiter **counted it**
  (the next send was refused with `email rate limit exceeded`), and **nothing ever
  arrived**. Nothing anywhere in the call surfaces the failure.
  - A magic-link UI built naively on this tells the user "check your inbox" and is
    lying, with no signal available to the app to know better. That is the same
    class of defect as the generation path's dropped `note` — a failure the code
    cannot see.
  - There is no delivery receipt available at the API boundary, so the UI cannot
    truthfully promise arrival. Copy and retry affordance should be designed for
    that, and a real SMTP provider's own delivery logs become the only place a
    failure is visible.
  - Cause of that one address's failure is **`[UNVERIFIED]`** — see §Auth
    configuration.

## Decision records carrying stale factual claims (swept 2026-07-27)

`docs/decisions/` is append-only by convention, which is right for *reasoning* but
means **factual assertions inside a record silently outlive their accuracy**. A
sweep of all 12 records for claim-shaped statements — call counts, named callers,
flag values, existence/absence of a code path — found **7 with at least one stale
claim**. Only the most damaging was corrected this session; the rest are recorded
here, **not fixed**.

The failure mode is specific and worth naming: a record that says *"verified,
still true on `main` <sha>"* is the one most likely to be trusted without
re-checking, and is therefore the most dangerous when it ages.

Ranked by how misleading, most first:

- **`2026-07-24-cross-day-stop-movement.md`** — asserts, emphatically and with a
  re-verification stamp, that there is **no windowing/virtualization**, "no
  `IntersectionObserver` mount/unmount, no scroll-driven mounting anywhere", and
  that Design A is "scoped but NEVER BUILT — you are building it from scratch".
  Design A shipped the next day (#146). `continuous-day-stack.tsx` exists and uses
  `IntersectionObserver` `[grep: 3 references]`. The cited line anchors have also
  drifted.
- **`2026-07-23-search-architecture-resolved.md`** — states the corpus holds
  "1,749 searchable rows … zero rows above 34.5°N" as a claim about *the* corpus.
  Those are **TEST** numbers; PROD is the real corpus and spans the full corridor.
  Two of the file's own "revisit when…" trigger conditions have therefore
  **already fired**, so a reader trusting it concludes the question is still
  parked when it is not.
- **`2026-07-20-place-card-order-is-route-derived.md`** — its *correction* block
  is now itself wrong: it says the drop index "does not" exist and is only
  *derivable*. `computeInsertIndex` was subsequently built and is wired into both
  the drag preview and the authored drop `[grep: `lib/corridor/insert-index`,
  imported by `day-detail-node-blocks.tsx`]`.
- **`2026-07-18-living-plan-productionization-scope.md`** — `checkRails` no longer
  exists as a symbol (split into `checkManualRails`/`checkNlRails` over a shared
  `checkRailsWithFlag` in `lib/itinerary/rails.ts`) `[grep: no `checkRails`
  export]`, and the flag claim is wrong for the paid surface: the NL path this
  document is *about* is now gated by `NEXT_PUBLIC_NL_EDIT`, not
  `NEXT_PUBLIC_LIVING_PLAN_EDIT`. Its §4 ungating plan is written against a flag
  that no longer governs that path. **Its substantive risk claims all still hold**
  — `usage` still discarded, `REGEN_BUDGET = 2`, no spend/quota infrastructure
  anywhere.
- **`2026-06-02-land-status-and-dispersed-camping-sources.md`** — Status says "no
  code, ingestion, or schema has been written against it yet". All three now
  exist (`padus.ts`, `usfs.ts`, three migrations, `lib/esri.ts`).
- **`2026-05-21-offline-tile-caching-architecture.md`** — Context says "no
  existing service worker … or PWA scaffold" in the present tense; both exist.
  One downstream item is half-done: the `web/CLAUDE.md` non-goals cleanup removed
  the offline entry but left "Active turn-by-turn navigation".
- **`2026-07-23-typesense-collection-per-env.md`** — minor: describes the old
  `places` collection as retained-and-safe-to-delete; it was deleted 2026-07-23.

**Verified clean:** `2026-07-23-corridor-rollback-by-id-snapshot.md`,
`2026-07-23-pinned-er-fixture.md`, `2026-07-23-place-identity-and-ordering.md`,
`2026-07-25-continuous-day-detail-scroll.md`,
`2026-07-25-reference-trips-db-first.md` (the most accurate in the set — every
count and line anchor checked out; one cosmetic nit, it says `FIXTURE_TRIPS` where
`fixtures.ts` exports `TRIPS`).

**Corrected this session:** `2026-07-23-corpus-writeback-dormant.md` — see its
superseded block. It asserted zero callers; there are two, and it was cited as
authoritative during the client-boundary investigation and produced a wrong
conclusion.

**Two candidate conventions, neither adopted:**
1. Scope factual claims at write time — "as of `<date>`/`<sha>`" — so an aged
   claim reads as a snapshot rather than a standing fact. Cheap; the records that
   already do this (`corridor-rollback`, which writes *"Measured on TEST before
   Slice-1"*) are the ones that did not go stale.
2. Prefer linking to the architecture doc over restating the fact, so there is one
   home to update.

## Deferred / parked
- **dnd-kit `SortableContext`** — parked. Pointer-vs-rect (`computeInsertIndex`)
  was chosen instead, no model change. Revisit only if pointer-vs-rect proves
  insufficient. (See STATE.md §Parked.)

## Someday / unscheduled
- **`reorderWaypoints` was dead — deleted in STEP 2; id-based only if a consumer
  returns.** The index-based `reorderWaypoints` (repo) + `reorderWaypointsAction`
  pair had NO consumer (live drag-reorder goes through `node-actions`/`localRanks`
  fractional `placeRanks`, not waypoint-index splice). Both were deleted rather
  than converted, removing a conflict-class (b) `refuse` path entirely instead of
  fixing it. IF a waypoint-reorder consumer is ever added: implement it id-based
  ("move waypoint X before waypoint Y"), NEVER index-based — position-splice
  corrupts against any changed list (a stale client view reorders the wrong pair),
  and id-based lands in class (a) so its write can `retry`/compose. Same lesson as
  `placeRanks` being keyed by placeId, not position.
- **Wizard form-actions can't surface `TRIP_CONFLICT`** — the four void
  `writeWizardSlice` callers in `plan/actions.ts` (`addStopAction`,
  `removeStopAction`, `saveStopsAction`, `toggleSuggestionAction`) are consumed as
  `<form action={…}>` server actions returning `void`, so a `refuse` conflict has
  no return channel. `addStop`/`removeStop`/`toggleSuggestion` stay on-page and the
  trailing `revalidatePath` re-reads fresh state, so a dropped edit shows as absent
  and the user retries.
- **KNOWN LOSSY PATH — `saveStopsAction` silently drops the `avoidHighways`
  toggle on a `refuse` conflict.** Unlike its stay-on-page siblings, it `redirect`s
  to the loader after the write, so a conflict advances the wizard having dropped
  the toggle with no signal. Do NOT call this benign: it only looks harmless at
  today's 9 single-owner trips — exactly the light-usage reasoning the `version`
  column exists to stop relying on. Fix: convert the stops page to `useActionState`
  so the `refuse` conflict has a return channel and surfaces `TRIP_CHANGED_ERROR`
  (same treatment the three `FormState` wizard steps already got).
- **Reference trips render a remove ✕ that always fails** — the read spine shows
  the ✕ on waypoint tiles for reference trips too, but `removeWaypointAction` on a
  slug hits the in-memory `TRIPS` fixture (`repository.ts:184`), misses a DB-only
  reference trip, and returns *"Could not remove stop."* A visible control that
  cannot work. Reference trips are read-only templates (fork-to-edit), so the ✕
  should not render on them. Fix: pass `isReference` from `trip-slideup-body.tsx`
  into `DayDetailCorridorColumn` (`:337` currently omits it) and gate the remove
  control on `!isReference`. (Separate from the frozen-trip *server* guard, which
  is now `checkNotFrozen`.)
- **`applyPlaceOverrides`: insert by mile, not append** — today a re-homed place is
  appended to its node's `placeIds` (`bucket.ts:112-122`), so "server order" is mile
  order for auto-bucketed picks but pin order for overridden ones. That makes an
  unranked cluster's display order depend on pin sequence. Inserting the override at
  its along-route mile instead would make server order == mile order everywhere, so
  unranked display order stops depending on how you pinned. Touches verified
  attachment code (`bucketPlacesIntoCorridor`/`applyPlaceOverrides`) — needs the
  Phase-1 bucketing re-verification, not a drive-by.

- **`CATEGORY_COMPATIBILITY` has no keys for `restaurant`, `grocery`,
  `car_repair`** (`data/entity-resolution/matcher.ts:162-201`). With the
  google_resolved category fix landed, food/grocery resolutions now carry a
  correct *stored* `primary_category`, but `lookupCompatibility` returns 0 for
  those categories, so they can never `name_dominant`/auto-link and accumulate
  as isolated `master_place` rows (one per resolution, no dedup). Given how much
  itinerary content is food, extending the matrix (add restaurant/grocery/
  car_repair rows + cross-compat to any OSM/pipeline equivalents) is worth
  scoping. Not in the google_resolved-category PR.

- **`materialize`'s final Typesense-sync stage fails (DNS `ENOTFOUND`) from a
  network-restricted context** — the DB stages (entity resolution + promotion)
  run and commit FIRST, then the last stage syncs `*.typesense.net`. From a
  sandboxed/egress-restricted environment that host doesn't resolve, so the run
  exits non-zero AFTER the corpus writes have landed: `master_place` is updated
  but the search index is NOT. Net effect — a `materialize` run from a
  restricted context leaves **Typesense stale** (DB and index diverge) while
  reporting failure. Mitigations today: run `materialize` from a machine that
  can reach `*.typesense.net`, or run `npm run -w data search:sync` separately
  afterward to reconcile the index. Worth scoping: make the sync stage a
  distinct, separately-resumable step (or a preflight reachability check) so a
  DB-successful run isn't reported as a total failure and the index gap is
  explicit. Surfaced 2026-07-23 during the google_resolved end-to-end proof.

- **No dev sign-in path — verifying any authed browser surface needs a hand-minted
  cookie every time.** The UI offers Google OAuth only, and TEST has no Google
  provider configured, so exercising a `canEdit`/RLS surface in a real browser means
  minting a Supabase SSR session server-side and injecting the cookie by hand — a
  throwaway script each session (done again during the NL flag-split verify, PR #126).
  Options: a dev-only `/auth/dev-login` route, or a committed helper script that mints
  and prints the cookie. The route is cleaner. Its guard MUST be the TEST-ref check
  (the same `ref !== znldzjdatkogdktymtvi` gate `checkRails` uses), NOT a flag — so it
  is structurally incapable of existing in prod, flag misconfiguration notwithstanding.
  **PARTIAL (2026-07-25):** the helper-script half now exists —
  `web/scripts/mint-dev-session.ts` (TEST-ref-guarded, prints the cookie JSON;
  used for the continuous-scroll authed verify, #146). CAVEAT it documents: this
  machine and the TEST auth server disagree by ~1h, so the printed session's
  `expires_at` must be patched to local-now before injecting or `@supabase/ssr`
  force-refreshes (and 401s once the refresh chain goes stale). The
  `/auth/dev-login` route remains the cleaner endgame.

- **SEED-ID PINS ARE INVISIBLE TO THE READ SPINE (view mode)** — surfaced during
  the #146 authed verify. **Pre-existing, NOT introduced by the continuous
  scroll — established by direct A/B on `main` vs the branch, same trip, same
  drag** (an earlier "proof" by running `applyPlaceOverrides` on raw stored state
  was BAD METHODOLOGY and is retracted: it tested the function, not what the
  component receives). Observed: on a FRESH SERVE both `main` and the branch
  render the pinned place under its ORIGINAL node — the durable behaviour is
  identical and wrong on both. (What DOES differ post-edit is recorded as its own
  item below.) A cross-node
  drag-pin in the edit spine mints a `nodeSeed` ("promoted") and writes
  `placeOverrides[].nodeId` as the **seed id** (`seed-<city>-<suffix>`), but the
  baked `Day.corridorCities` carry **plain slug ids** and the read spine
  (`DayDetailCorridor` / `applyPlaceOverrides`) never consumes `trip.nodeSeeds` —
  so the override dangles (inert per the documented semantics) and the pin
  renders in its ORIGINAL bucket in view mode, while the edit spine (seed-aware
  projection) shows it re-homed. Same-node rank writes use the plain cc id and
  DO render in view. Fix directions: teach the view spine to resolve seed ids
  (inject promoted seeds into the render spine, as the edit spine does), or bake
  seed nodes into `corridorCities` at write time. Touches verified bucketing
  code — needs its own pass, not a drive-by. **Scoped as its own PR** (Adam,
  2026-07-25): it cannot ride inside #146, whose tripwire forbids the read spine
  consuming `nodeSeeds`.
  **↔ DEPENDENCY (both ends):** landing this **dissolves** the post-edit
  divergence recorded below, because server truth and the optimistic list then
  agree. When it lands, **revert the continuous stack to server truth** —
  `placeOverrides={trip.placeOverrides}` / `ranks` from `trip.placeRanks` in
  `renderViewDay` (`day-detail-corridor-column.tsx`), which is the build spec's
  original rule and drops the optimistic coupling from the view path.

- **Seeded TEST password hardcoded in 4 tracked scripts of a PUBLIC repo —
  DECIDED: ACCEPT, DO NOT ROTATE (Adam, 2026-07-25).** Not an oversight; a
  considered accept. Do not re-litigate without new facts.

  **The credential:** `const PW = "…"` in `web/scripts/seed-test-user.ts`,
  `verify-trip-collapse.ts`, `verify-trip-step4.ts`, `verify-trip-version.ts`
  (both seeded users share it). Surfaced by the #146 hygiene sweep. Permanent in
  git history, so stripping HEAD would not undo the exposure — only rotation
  would.

  **Why accept — measured blast radius** (read from
  `supabase/migrations/20260513000000_init_identity.sql` + the Phase-1 corpus
  migration, not assumed):
  - `public.trips` — owner-scoped RLS, so **only that account's own trips**.
  - `public.users` — its own row only.
  - `public.reference_trips` — read only, and the policy is `using (true)`:
    **anon can already read it without any credential**, so the password adds
    nothing.
  - `public.master_place` / corpus — **nothing**. RLS enabled with *no policies*;
    service-role only.
  - PROD — **nothing**. Scoped to the TEST ref `znldzjdatkogdktymtvi`.

  TEST holds no real user data. Weighed against that: rotation costs four script
  edits plus a cascade-risky user update (below). Not worth it.

  **⚠️ CASCADE HAZARD — read this before ever rotating.** `trips.owner_id` is
  `references public.users(id) **on delete cascade**`. Rotating by
  delete-and-recreate the seeded users **destroys the seed harness trip AND the
  66-day TEST fork `05b346df-3bb5-4c46-8ff1-e0c5cfe26301`**. Any real rotation
  must add an `admin.auth.admin.updateUserById(id, { password })` path to
  `seed-test-user.ts` — its current existing-user branch only *looks the user up*
  and never updates the password — and switch all four scripts to
  `process.env.SEED_PASSWORD`. CI is unaffected either way (it runs the data
  suite + web typecheck + build; never the seed or verify scripts).

  **FORWARD RULE (binding on new code):** TEST seed credentials come from **env**,
  never committed literals. The four scripts above are **grandfathered**; new
  scripts are not. `web/scripts/mint-dev-session.ts` is the pattern to copy — it
  reads `SEED_PASSWORD` and refuses to run against a non-TEST project ref.

- **POST-EDIT VIEW DIVERGENCE — RESOLVED in #146 by passing the optimistic
  trip-level values; REVISIT when the seed-id fix above lands.** Recorded because
  the resolution is a deliberate spec deviation with a scheduled undo, not a
  finished story. Original divergence (measured A/B, same trip + same drag,
  editMode asserted by the toggle's own label):
  | | fresh serve | in edit, after drag | after Done (view) |
  |---|---|---|---|
  | `main` | original node | re-homed | **re-homed** |
  | #146 branch | original node | re-homed | **original node** |

  Cause: `main`'s view render passes the OPTIMISTIC `localOverrides`, which
  survive the editMode toggle because `DayDetailCorridorColumn` stays mounted;
  the windowed stack passes server-truth `trip.placeOverrides` per the build
  spec ("values cross the bridge, machinery does not" — optimistic machinery
  deferred to PR2). Where the two disagree is exactly the seed-id case above:
  the persisted override cannot resolve, so server truth renders the pre-pin
  position. **Neither is durable** — `main`'s re-homing is a transient illusion
  that also reverts on reload; the branch was arguably more honest but showed the
  revert one step earlier, which reads as "my edit was lost".

  **RESOLUTION (Adam, 2026-07-25): option (b)** — the stack passes the optimistic
  trip-level values (`localOverrides` / `ranksMap`), handlers still undefined.
  Reasoning: this PR is presentation-only, so matching `main` IS
  behaviour-neutrality; a pin that snaps back on Done makes the refactor
  blameable for a defect it did not cause, and `main`'s falseness is the
  pre-existing pin bug, already tracked above. Re-verified after the change —
  all three points match (`original` / `re-homed` / `re-homed` on both).
  **↔ UNDO CONDITION:** when the seed-id fix above lands, revert
  `renderViewDay` to `trip.placeOverrides` / `trip.placeRanks` (the build spec's
  original rule). This item closes at that point.

- **`find_master_place_candidates` is not exercised end-to-end by the ER corpus
  run** — the phase3a D4 `beforeAll` calls `reset_phase3a_test_state`, leaving
  `master_place` empty, so `matchAll` runs in `skipRpcs` rematerialize mode
  (`matcher.ts` — RPC skipped, candidates come from in-memory
  `plannedMasterPlaces`). The populated-`master_place` PostGIS candidate lookup
  is therefore covered only by `matcher.test.ts` mocks and the 3b synthetic
  `recompute` (a different RPC), never by a real populated-corpus `matchAll`.
  **Pre-existing** — true of the old prod-derived seed too, NOT introduced by the
  pinned-fixture change (docs/decisions/2026-07-23-pinned-er-fixture.md). Worth a
  dedicated test that seeds a small resolved corpus (non-empty `master_place`)
  and runs an incremental `matchAll(delta)` so the RPC path runs for real.

- **`enrich.ts` HONESTY PASS — the trip-waypoint detail panel still fabricates**
  (`web/src/lib/trips/enrich.ts`). The detail-honesty pass (#85) made the
  browse/search path into the slide-up panel honest — `browsePlaceToWaypoint`
  surfaces every field real or absent. The OTHER path into the SAME panel — a
  trip waypoint already added to a day, enriched via `enrichWaypoint` — was
  deliberately left untouched and still invents, per the "Guisados"-card
  comparison: the reliability score ("81 GOOD RELIABILITY / computed from 2
  sources" is `75 + hash(slug,…)` / `2 + hash(slug,…)`, not computed); the "IF
  YOU STOP HERE" stop time (heuristic 45m); a ~$15–25 entrée (canned per
  category via `ENTRY_BY_CATEGORY`); planned/with-stop ETAs and "arrive at St.
  George at 1:20 PM" (hardcoded/derived); "DAY 2 UNAFFECTED" (asserted); and
  Local Eats / Sit-down / Cash-OK tags + the DATA SOURCES trio (the slug-hashed
  `*_BY_CATEGORY` maps — which even list `iOverlander`, a banned source). This
  violates the grounding invariant (every field real or absent) on a surface
  users see, so it ranks HIGHER than its age suggests. **THE FORK — record
  both, do not pick:** (a) strip the fabrication so trip-waypoint cards match
  the honest browse cards — consistent and honest, but thinner; (b) keep the
  rich "if you stop here" impact layout and rebuild it on REAL routing data —
  real detour and arrival impact, now feasible with Mapbox routing (the same
  routing the directions panel uses). Under (b) the reliability score and canned
  tags would still need real backing or stay out.

- **FED-MERGE LIVE-PROVENANCE GAP — merged live rows lose their DATA SOURCES
  section** (`web/src/lib/trip-browse/merge-corpus.ts`). `mergeCorpusIntoPool`
  folds the federated corpus into a day's live-discovered pool via a coord+name
  `sameSpot` match; on a match CORPUS WINS and only `photoUrl`/`photoAlt` are
  backfilled from the live twin — NOT `mention.secondary`. When the winning
  corpus row (`mapMasterPlaceRow`) has null/empty `attribution`, its `secondary`
  is `""` (`federated.ts:176`), so `realDataSources` (`card-stats.ts:191`)
  returns `[]` and the panel's DATA SOURCES section is omitted entirely — even
  though the matched live row carried real provenance ("Google ·
  OpenStreetMap"). Honest (absent provenance → no section, not fabrication) but
  a real gap, and the most prod-visible of these: the corpus fold feeds
  `day.segmentSuggestions`. Fix: on a corpus-wins match, backfill `mention`
  (and/or `attribution`/`overlanderTags`) from the live twin the same way the
  photo already is. Note: the note that surfaced this filed it under
  `USE_FEDERATED_POIS`; the verified provenance-drop is in the
  `USE_FEDERATED_CORRIDOR` corpus fold (`plan/actions.ts:216-233`) — the
  browse-route `USE_FEDERATED_POIS` merge is purely additive
  (`[...liveTagged, ...federated]`) and does NOT drop live provenance.

- **GPS-ORIGIN LABEL on the no-GPS directions fallback**
  (`web/src/components/trip/directions-panel.tsx:126`). For a route-to-place
  search result (`dayRelative === false`), the route origin is
  `routeTo ? position ?? legStart : legStart` — with no GPS fix it silently
  falls back to the day-start (`legStart`), yet the panel presents a live "from
  now" arrival ETA (`:49`, `:230-233`) that frames the route as departing from
  the user's current position. Nothing labels the origin as the day-start
  rather than "here," so the no-GPS case (the common web-planning case — noted
  as such at `:195`) mislabels where the route starts. Small, cosmetic,
  honest-labelling issue. Fix: label the origin when it's the day-start fallback
  (i.e. when `position` is null), so the route/ETA don't imply a live-location
  departure that isn't happening.

- **Live-weather integration — RESCUABLE from PR #24 (salvage, not rebase).** OpenMeteo
  forecast + climatology fallback (`src/lib/weather/` + `src/lib/trips/resolve-weather.ts`)
  is a genuine unmerged feature: **ABSENT from main** — only the `Day.weather` placeholder
  field exists, not the live fetch. PR #24 sits ~400 commits behind; **do NOT rebase it**
  (it would fight 400 commits of drift). Rescue by SALVAGE: lift the weather lib and
  re-wire it into `DayBriefingCard` — its original hook `suggested-section.tsx` was
  deleted in the 2026-07-12 one-day-renderer refactor. Kept open as PR #24 with the same
  note; this entry is what keeps it from reading as a dead stale PR. (Triage 2026-07-24.)

- **Finish reference-fixture removal** (follow-up to the getTrip DB-first flip,
  branch `refactor/reference-trips-db-first`). The flip made reference trips
  serve from `reference_trips`; the `TRIPS` fixture no longer shadows the DB but
  the reference literals still sit in the module. To fully remove them: empty
  `seed()` of the reference literals, reroute `ensureAlaskaUpgraded`'s 4
  waypoint-helper callers (`repository.ts:94,108,120,181`, which read
  `TRIPS["la-to-deadhorse"]`) to the DB reader, then delete `ensureAlaskaUpgraded`,
  and drop `la-to-portland` from `FIXTURE_TRIPS` in
  `api/trip-browse/[tripId]/[dayId]/route.ts` (so it goes live/federated instead
  of the curated `BROWSE_PLACES` catalog — verify the browse path still resolves).
  **Open question that decides its size (investigate before scoping):** are those
  4 helpers pure lookups, or does any back a WRITE? A DB reader returns a fresh
  object, so rerouting a write path silently no-ops. **Likely wants to land with
  or after the remove-✕ affordance gating** — same in-memory write paths. Do NOT
  bundle on tired assumptions; every dig this session found another coupling.
  Note: `TRIPS` must SURVIVE this — it is also the anon-wizard store (below).
  **DOC:** this removes the "4 residual `ensureAlaskaUpgraded` reads" and the
  "literals still sit in `TRIPS`" claims — update
  `docs/architecture/trip-resolution.md` (§ `TRIPS`' current role) in the same PR.
- **`TRIPS` is the anon-wizard persistence layer** (not just reference fixtures).
  `createTrip` (`plan/actions.ts:786`, anon finalize, gated `ENABLE_PLANNER_WIZARD`)
  writes `trip-<8char>` drafts into the `globalThis`-pinned `TRIPS` store;
  `listAnonTrips` lists them (`id.startsWith("trip-")`); the repository slug-write
  paths edit them; `getTrip` resolves them (last, after the DB reference readers).
  Ephemeral — lost on server restart, never persisted to Supabase. Not part of the
  reference-trip migration; recorded so the next person doesn't mistake it for
  dead fixture code. Deleting the `TRIPS` module would remove this feature.
- **Plotting-on-map architecture (deep dive)** — an ARCHITECTURE REVIEW that
  intra-day map plotting waits on, NOT a feature ticket. Today the map plots only
  day start/end pins and user waypoints; day-detail items (corridor cities, curated
  picks) are never plotted. Before building intra-day plotting, the map's plotting
  architecture needs a dedicated design pass.
  - **Already measured (verified from source 2026-07-25 — carry forward, do not
    re-derive):**
    - Every PIN is a `mapboxgl.Marker` DOM instance in `map-column.tsx` — day-end
      pins (default color) plus waypoint pins built as hand-rolled category-colored
      DOM elements (`CAT_SVG` icon map). The route line is a GL layer (`map.on("load")`
      source+line); there is NO GeoJSON source+layer for POINTS anywhere.
    - Open call: DOM markers vs GeoJSON source + symbol/circle layer. Not settled.
      The argument is CHURN (markers created/destroyed per `?day=` transition), NOT
      raw volume.
    - Volume/day: corridor cities ~2–6 (`CorridorCity`, soft cap `max_nodes=4`
      intermediate per corridor-cities-spec); `Day.segmentSuggestions` capped at
      `MAX_SEGMENT_SUGGESTIONS` (`routing/day-suggestions.ts`); legacy `Day.suggestions`
      ~5–8. Fuel/camp/food are CATEGORY values (`category` on waypoints/picks), NOT
      distinct item kinds; fuel additionally lazy-fetches per day via
      `FuelStopCard` → `/api/trip-browse/{tripId}/{dayId}?category=fuel` and is NOT in
      the Trip payload.
    - Coordinates: `CorridorCity.coords` and `BrowsePlace.coords` are REQUIRED, real,
      sourced (gazetteer / corpus / Google). `Waypoint.coords` is OPTIONAL and the map
      already skips the coordless ones (`if (!wp.coords) continue`). `NodeSeed`
      "re-projection" computes an along-route MILE scalar from a real pin — it does NOT
      synthesize map coordinates. So there is no approximated-onto-route case; grounding
      holds by construction (omit, never approximate).
    - Test-data caveat: reference-derived trips populate `Day.suggestions` but NOT
      `Day.segmentSuggestions` (`placePool` in `day-detail-corridor-column.tsx`), so the
      66-day fork likely shows ~5–8 items/day. A regenerated trip is needed to exercise
      the `MAX_SEGMENT_SUGGESTIONS` cap.
  - **Questions the deep dive must answer:**
    - DOM markers vs GL source+layer, and what the migration costs if it changes.
    - WHICH day's items are plotted. Prior lean was CENTERED-DAY-ONLY driven by the
      `?day=` param — the same channel that drives `flyTo` — so the map never learns the
      scroll window. Confirm or revisit, but preserve the constraint that the map does
      NOT know which days are mounted.
    - Marker ↔ detail-list highlight linkage. A design was described to this session
      as living in `OVERLANDER_STYLE_GUIDE.md` (per-type marker colors + an Active POI
      State, 22px → 35px, double-ring glow) — but NO such file exists in the repo, and
      that spec text is in NO tracked file (verified 2026-07-25). What DOES exist:
      `DESIGN.md` carries the marker tokens (`--pin`/`--marker`/`--pin-border`) and the
      per-category color roles the current DOM markers already use — but no Active-POI-
      State / marker-highlight spec. The deep dive's FIRST step is to locate the real
      source (likely a Paper artboard, where this project's designs live) before treating
      the 22px→35px/double-ring detail as settled.
    - Interaction with the continuous-scroll settle-debounce (the scroll→`?day=` sync in
      the Design-A continuous day-detail scroll).

- **DEFINE "yoTrippin Verified" — what it means and what earns it.** Needs a
  **product decision before it can be scoped.** The label currently on place
  cards is a **PLACEHOLDER**: it presents Google Places data under a yoTrippin
  name. That is a deliberate interim choice, **not a bug**. What is missing is a
  definition — what does yoTrippin actually verify, and what earns the badge?
  - **Current mechanical state** `[verified this session — see
    docs/architecture/place-render-model.md §5]`: the `verified` prop **defaults
    to `true`**; **no call site on the day-detail card surface passes it**; **no
    `verified` field exists** in `BrowsePlace`, `Waypoint`, or `CorridorPlace`;
    therefore **no code path can set it false**. Distribution: **0 true / 0 false
    / 100% undefined in data; 100% true at render.**
  - **The concrete defect, independent of how the definition lands.** Because the
    gate never closes, the label renders on tiles carrying NO Google data at all:
    - **Klondike River** — no `placeId` field whatsoever; a corpus tile whose row
      has no `google_place_id`, so it can never enrich.
    - **Fixture waypoints** — the displayed rating is a stored constant, not a
      fetched value.
    So even under the "Google Places renamed" reading, the label is applied to
    things that are not that. True regardless of what "Verified" ends up meaning.
  - **Open question — the parameters.** Candidate inputs, **none decided**:
    source tier (corpus-materialized `mp:` vs live-resolved `google:` vs
    LLM-suggested); presence of required fields vs inferred/defaulted ones;
    coordinate confirmation against a second source; freshness / last-checked
    date of the underlying record; human ground-truthing — someone has actually
    been there.
  - **Binding design constraint.** "Verified" is a provenance assertion, and the
    project rule is **every field real or absent**. Whatever the definition,
    **it must be capable of being false** — otherwise the badge carries no
    information and is decoration wearing the costume of a claim.
  - **Known dependency.** There is currently **no field in the tile types to hang
    this on**. Any real definition likely requires a **new field on the tile
    schema** — which per prior decisions sits at the grammar ceiling and needs
    deliberate planning, not casual addition. Scope this only **after** the
    definition exists.

- **Empty-pool trip on PROD — is it user-reachable?** Two PROD `public.trips`
  rows share the title "Tok, AK to Dawson, YT":
  `24f14ecc-a209-45e7-a414-16ecc816bab0` is populated (63 tiles, 2 days) and
  `81865432-7a18-4f18-beaa-d6d95e6da249` has an **EMPTY pool** (0 tiles).
  `[queried PROD, 2026-07-26]` Open question: **is that row user-reachable, and
  if so what does it render?** Nobody has looked. Not investigated — recorded.
  When picked up: **read-only; PROD writes are not authorized.** Row facts live
  in `docs/DATA_INVENTORY.md`.

- **TEST fork vs PROD `segmentSuggestions` discrepancy — the fork may not
  represent the shape it stands in for.** TEST fork `05b346df…` carries **0**
  `segmentSuggestions` (its pool is 43 `day.suggestions` + 92 `waypoints`), while
  the PROD equivalent carries **63**. **Reason UNVERIFIED.** Consequence: the
  TEST fork may not represent the reference-derived shape *as actually served on
  PROD*, which affects its value as a test instrument — see the instrument
  caveat in `CLAUDE.md` §RUNBOOK gotchas and
  `docs/architecture/place-render-model.md` §2.

- **PLACES ENRICHMENT: EMPTY vs MISSING IS INDISTINGUISHABLE — LARGELY RESOLVED
  BY [#149](https://github.com/honkinsickle/overlander/pull/149) (merged
  2026-07-26).** Status first so this stops reading as open: the route now emits
  resolved-but-empty `{}` instead of dropping it (`if (rich)`), which **closes
  the retry leak described below** on both paths and gives the client a
  distinguishable signal. Google's not-found shape was verified in the process
  (invalid id → HTTP 400 → `null`), so failures remain separable. Mechanics and
  the accepted trade now live in
  `docs/architecture/place-render-model.md` §4.3. **Still open from this item:**
  the UX copy decision (next item), and the retry-ceasing leg is `[UNVERIFIED]`
  by observation. The body below is retained as the original analysis.
  The original
  premise was **WRONG** and is corrected here. *(No prior BACKLOG item existed to
  replace — the diagnostic was only ever referenced in session prompts and in
  `place-render-model.md` §7.)*
  - **Original premise (RETRACTED).** An earlier session found day-2 of
    `expedition-ms28y793` returning **0 of 3** from `/api/places/details` while
    day-13 returned 3 of 3, and inferred a population of dead or never-verified
    `placeId`s.
  - **What measurement found** `[swept 2026-07-26, both trips, 2 batched calls]`:
    - `expedition-ms28y793` (TEST): **43 of 44** id-bearing tiles resolved
      (97.7%); 4 tiles carry no `placeId`.
    - `24f14ecc-a209-45e7-a414-16ecc816bab0` (PROD): **60 of 60** (100%); 3 tiles
      carry no `placeId`.
    - **Day-2's three ids ALL RESOLVED on re-measurement.** The earlier 0/3 was
      **TRANSIENT**. Cause **UNVERIFIED**.
    - **No cluster, no scatter** — one failure across 104 id-bearing tiles is an
      absence of the phenomenon, not a distribution.
    - **No differential** between the corpus path (`mp:`) and the live-resolution
      path (`google:`). Nothing localizes to one path.
  - **Why a transient blip looked permanent.** On FAILURE `placeDetails` returns
    `null` and the route calls `cacheSet(id, null)`, cached **15 minutes**
    (`CACHE_TTL_MS`). One momentary upstream error is replayed as failure for the
    rest of that window. `[read source: app/api/places/details/route.ts:20,84-86]`
    Worth remembering as a general property of this endpoint.
  - **SETTLED — empty results ARE cached, as `{}`.** `placeDetails` returns an
    object built entirely of conditional spreads, so a 200 with no rich fields
    yields **`{}`, not `null`** (`google-places.ts:333-347`). The route then runs
    `if (!cached) cacheSet(id, rich)` — unconditional on the *value*, and
    `cacheSet(id, value: PlaceRich | null)` accepts either — so `{}` is stored
    under the same 15-minute TTL. A subsequent request inside the window hits
    `cacheGet`, re-drops it from `details`, and **does not call Google**.
    `[read source: app/api/places/details/route.ts:35-53, 84-89]`
  - **The actual finding — a MEASUREMENT defect, not a data defect.** The single
    failure, `ChIJJeKtgR9ySYcRa30K1fgPrTw` ("Chimney Rock", day-10, `curated`,
    `google:` prefix), is a **REAL LIVE PLACE**. Queried Google directly: HTTP
    200, id matches exactly, coordinates match the stored tile exactly,
    `displayName` "Chimney Rock". It carries no `rating`, no `userRatingCount`,
    no `photos`, no `priceLevel`, no hours, and `types: ["route"]` maps to no
    category. So `placeDetails` builds `{}` and the route drops it via
    `if (rich && Object.keys(rich).length > 0)`. **Therefore the endpoint reports
    "this id is dead" and "this place exists and has nothing to add" IDENTICALLY
    — both as a missing key.** Neither ordinary staleness nor a grounding
    violation: a third thing nobody had named.
  - **Why it matters disproportionately for this product.** Field-poor places —
    routes, natural features, trailheads, river access, dispersed sites — are
    exactly what an overlanding product drives past. Google has nothing to say
    about them and never will. The ambiguous case is not an edge case here; it is
    a substantial share of the corpus.
  - **THE THREE STATES** (the basis for any UI decision):
    1. **No `placeId` at all** — can never enrich, correctly. TEST's 4 are `mp:`
       corpus rows with `mention.secondary` `"osm"`; PROD's 3 are water features.
       **Klondike River** is the canonical example.
    2. **Resolves, nothing to add** — **Chimney Rock**. Real place, empty response.
    3. **Genuinely fails** — measured at effectively zero.

    States 1 and 2 are **honest thinness**. Only 3 warrants error treatment, and
    it barely occurs. An "Offline / Limited Data" indicator would have fired
    wrongly nearly every time.
  - **~~LIVE BUG~~ — retry leak (client-side only; billing is capped). FIXED by
    #149** — kept for the analysis; the guard behaviour described here is what
    the fix exploits. Failures
    never enter the client cache: `setHydrated` merges only RETURNED keys, so a
    failed id leaves `hydrated[id]` `undefined`. The guard is
    `t.placeId && !t.photoUrl && !hydrated[t.placeId]`, so the id **re-fires on
    every mounted-set change, indefinitely**.
    `[read source: day-detail-corridor-column.tsx:306-345]`
    - **CLIENT-SIDE: real regardless.** The browser issues a POST containing
      those ids on every windowing change — network, battery and latency cost on
      a device used in the field.
    - **BILLING: capped, NOT recurring-billable.** Because `{}` and `null` are
      both cached (above), the server absorbs the retries: at most **one upstream
      Google call per id per 15-minute TTL window, per server instance**. Caveat:
      the cache is in-process (`globalThis.__placeDetailsCache`, LRU
      `CACHE_MAX_ENTRIES = 1000`), so cold starts and evictions re-fetch — the cap
      is per instance per window, not a global guarantee.
    - **Scope.** `hydrated` is React state on the parent column, **ephemeral per
      session**, persisted nowhere — so there is nothing to clean up
      retroactively and a reload clears it. That is also why this **recurs rather
      than accumulates**.
  - **Nothing distinguishes "not yet fetched" from "fetched and returned
    nothing"** — both are `hydrated[id] === undefined`. No negative cache, no
    error state, and per `place-render-model.md` Part 2 no loading or error state
    in the slideup either.
  - **~~Proposed fix (NOT authorized here — separate PR)~~ — SHIPPED as #149**,
    in the minimal form: the endpoint stops dropping `{}`. The "stop
    re-requesting for a long interval" half was deliberately NOT taken — TTL was
    left at 15 minutes because the client-side repeat was the actual cost and
    this removes it (reasoning in the #149 PR description). Original text: Have the endpoint
    distinguish resolved-but-empty from not-found, and let the client stop
    re-requesting the former for a long interval — **not permanently**: a
    dispersed site or small business can gain a Google listing later, and a
    permanent cache would leave the app silently wrong with nothing to flag it.
    Kills the retry leak, caps the spend, gives the UI an honest signal.

- **UX: honest copy for thin places (supersedes any "Offline / Limited Data"
  framing).** No such entry previously existed; recorded now because the
  three-state taxonomy above changes what the question even is. The distinction
  is **not connectivity** — it is whether Google has anything to say about the
  place. For states 1 and 2 (no `placeId`; resolves-but-empty) the honest copy is
  something like *"Google has no listing for this place"* rather than a blank
  slot or an "Offline" indicator that misattributes the cause. For state 3
  (genuine failure, measured at effectively zero) show **no indicator** — it is
  too rare to design around and indistinguishable from state 2 until the endpoint
  separates them (see the proposed fix above). Depends on that fix landing first.

- **`MAX_IDS = 40` truncation — MEASURED 2026-07-28, and it is narrower than this
  entry used to claim.** `parsePlaceIds` dedupes then `.slice(0, 40)` with **no
  error and no signal**, and the hydration effect re-fires only on mounted-set
  change (dep array `[hydrateKey]`; `hydrated` deliberately excluded with an
  `eslint-disable`) `[read source: app/api/places/details/route.ts` —
  `MAX_IDS`, `parsePlaceIds`; `day-detail-corridor-column.tsx` — `hydrateKey`
  and the hydration `useEffect]`.
  - **Scrolling windows do NOT exceed the cap.** Two 19-day TEST trips scrolled
    end to end in a live browser with instrumented `fetch` and a live API key:
    **27 requests, max 28 ids, zero windows over 40.** Measured, not simulated.
  - **The real failures are single-day and windowing-independent.** Four days on
    PROD `la-to-deadhorse` (**91** / 57 / 57 / 42 distinct eligible ids) and one
    on `dawson-vancouver-cassiar` (42) exceed 40 on their own. Any window
    containing day 1 requests ≥ 91 cold, because supersets only add — and a first
    request is always cold, so accumulation cannot help it. On day 1 that is
    **51 dropped ids, all of which render as visible cards** (day 1 has zero
    curated tiles → `curatedMode` false → nothing collapses behind "Explore
    more").
  - **The trips this entry used to name cannot trip it.** `24f14ecc` is exactly
    **40 distinct** against a cap of 40 — a boundary, not a margin; one more
    corpus row on either day truncates it. `expedition-ms28y793`'s whole-trip
    union is **39**. The prior "41 tiles on day-1, so a ~3-day window exceeds 40"
    was wrong on both counts (41 is the pool, not the eligible set; `24f14ecc`
    has only 2 days).
  - **`MAX_IDS = 40` is unexplained.** No comment; introduced in `79c8cb2`, whose
    message never mentions it; never modified since; the two sibling routes use
    50. It is **not** an upstream batch limit — `placeDetails` issues one Google
    `GET` per id and the route runs `Promise.all`, so 40 bounds *this route's own
    fan-out and per-request cost*, nothing external.
  - **Recommendation: chunk server-side** — batch the ids 40 at a time inside the
    route. It removes the drop, holds fan-out at today's ceiling, leaves the
    response shape unchanged, and **does not touch the hydration effect's
    dependency array** (the guarded thing). Do **not** raise the cap until
    someone establishes what 40 protected. Ordering by proximity to the centered
    day is the wrong tool: the measured failures are single-day, so ordering does
    nothing for the only case that breaks.
  - **Tripwire for the fix:** touches `app/api/places/details/route.ts` only
    (`POST` and `parsePlaceIds`), plus a test. Zero diff required in
    `day-detail-corridor-column.tsx`, `continuous-day-stack.tsx`,
    `lib/trips/continuous-scroll.ts`, `lib/discovery/google-places.ts`, the two
    sibling hydrate routes, and anything under `lib/itinerary/`. Any shape that
    needs the effect's dep array raises the risk class of the whole change.
  - **Signalling truncation needs no response field** and nothing would consume
    one: the client builds `placeIds` and the cap is a deterministic prefix, so
    `placeIds.length > 40` is the signal locally. Diffing sent ids against
    returned `details` keys would be worse — `details` also omits ids that
    resolved `null`, reintroducing exactly the ambiguity #149 removed.
  - Measurement detail: `docs/architecture/place-render-model.md` §4.4.1.

_(add items here as they surface; keep one line each, promote to STATE.md
§Queued when scheduled)_
