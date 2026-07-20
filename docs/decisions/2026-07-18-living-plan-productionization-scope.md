# Living-plan editing — productionization scope (DESIGN ONLY)

**Status:** Draft scope, not built. Branch `feat/living-plan-editing`.
**Date:** 2026-07-18.

Today the feature works end-to-end but only against the TEST project: it writes
`reference_trips` rows via the **service-role** client, gated behind
`NEXT_PUBLIC_LIVING_PLAN_EDIT=1` + a hard TEST-ref check + a forbidden-id list
(`edit-actions.ts:61-83`). The in-code docstring already names the target
(`edit-actions.ts:15-20`): *move to user-owned `public.trips` rows through the
repository layer.* This document scopes that move plus the two things
production additionally needs — **spend limits** and **ungating** — without
building any of it.

---

## 0. Current state (facts)

- **`public.trips`** (`supabase/migrations/20260513000000_init_identity.sql:57-89`):
  `id uuid PK default gen_random_uuid()`, `owner_id uuid NOT NULL → users(id)`,
  `reference_id text`, `title`, `state check(draft|active|logged)`, `payload
  jsonb NOT NULL`, `created_at/updated_at`. The whole `Trip` (incl.
  `generationInput`) rides in `payload`. RLS **enabled**, four owner-scoped
  policies (`auth.uid() = owner_id`). Reads/updates/deletes filter by `id` only
  and lean **entirely on RLS**; `owner_id` is set explicitly only at insert.
- **`public.reference_trips`**: `id text PK` (slug), `payload jsonb`,
  `source_version text NOT NULL`, no owner. RLS: `select using(true)`
  (world-read); **no write policy** → only service-role (RLS bypass) writes.
- **Repo layer**: `getUserTrip(id)` and `updateUserTripPayload(id, mutate)`
  (`web/src/lib/trips/user-trips.ts`) use the **SSR (anon+JWT)** client, RLS-scoped.
  `updateUserTripPayload` is a **non-transactional read-modify-write** on
  `payload` (flagged in-code at `user-trips.ts:189-190`).
- **Living-plan actions** (`edit-actions.ts`): load via
  `getPersistedReferenceTrip(tripId)` (reads `reference_trips`); stage/apply/discard
  via `createSupabaseServiceClient()` writing `reference_trips`. Staging id =
  ``${tripId}--pending`` (a sibling row, `edit-actions.ts:293`). The staged
  payload carries `livingPlanEditSignature`; `applyReplanAction` refuses to
  promote a row whose signature ≠ the confirmed one (`edit-actions.ts:811`).
- **Paid surface**: `generateAndAudit` runs `generateItinerary` up to
  `1 + REGEN_BUDGET = 3` times (Opus `claude-opus-4-8`, `max_tokens 32000`),
  plus `preComputeFacts` (Google geocode + corpus reads via service client) and
  cheap Sonnet parse/interpret. `generateItinerary` **returns**
  `usage {inputTokens, outputTokens}` but callers **discard** it. There is **no**
  spend/quota/rate-limit infrastructure anywhere today.
- **Client gate**: `LIVING_PLAN_ON = NEXT_PUBLIC_LIVING_PLAN_EDIT === "1"`
  (`trip-slideup-body.tsx:17`) + a `/demo/livingplan` route.

---

## 1. Write path: `reference_trips` → `public.trips` via the repository layer

### What breaks moving from service-role + reference_trips to RLS + user auth

| # | Assumption today | Breaks under RLS + user trips | Change |
|---|---|---|---|
| 1 | **Load** via `getPersistedReferenceTrip(tripId)` (reference_trips, slug id) | User trips are UUIDs in `trips`; reference read won't find them | `loadEditableTrip` → `getUserTrip(id)` (already SSR/RLS-scoped). `generationInput` still rides in `payload`, so the input-extraction below it is unchanged. |
| 2 | **Editability** = "it's a reference copy we seeded" | A user trip is editable only if it was **generated** and carries `generationInput` | Keep the existing `input?.anchors?.length` guard (`edit-actions.ts:92`) — it already rejects forked reference trips (e.g. `la-to-deadhorse`) that have no `generationInput`. Surface it as a per-trip capability, not a global flag (see §4). |
| 3 | **All writes** use `createSupabaseServiceClient()` (RLS bypass) | Service role bypasses ownership — wrong trust boundary for user data, and it can't run as "the user" | Split clients: **service client stays** for the Phase-1 **corpus** reads inside `runGateStage` (`bakeGeneratedDays`, `preComputeFacts` hit `master_place` etc., which are *not* user-owned). The **user-trip write** (stage/apply/discard) moves to the **SSR client**, RLS-scoped. `runGateStage` therefore holds two clients at once — deliberate and documented. |
| 4 | **Staging id** = ``${tripId}--pending`` sibling row | `trips.id` is `uuid PK` — ``<uuid>--pending`` is not a valid uuid; a sibling row also pollutes `listUserTrips` and has no `state` enum value | Replace the sibling-row model entirely (see §2). |
| 5 | **Ownership** — arbitrary `reference_trips` upsert | RLS `INSERT/UPDATE … WITH CHECK (auth.uid() = owner_id)` rejects any write not owned by the caller | Every staged/applied write sets/matches `owner_id = auth.uid()`. The apply-onto-trip step goes through `updateUserTripPayload` (id-filter + RLS), not a raw upsert. |
| 6 | **`source_version`** column stamps `livingplan-applied@<date>` | `trips` has no `source_version`; the signature is smuggled inside `payload` | Move staging metadata (signature, applied-at, base version) to real columns/table (see §2), out of `payload`. |
| 7 | **Apply = read pending → upsert trip → delete pending** via 3 service calls | The trip could change between stage and apply (non-transactional RMW, `user-trips.ts:189`); nothing detects it | Add an **optimistic-concurrency guard**: record the base `trips.updated_at` (or a payload hash) at stage time; refuse apply if the trip moved since. This complements the existing **signature** guard (which proves *which* edit, not *against what base*). |
| 8 | **`checkRails`** = flag + TEST-ref + forbidden-slug | UUID trips are never the `dawson-vancouver-cassiar` slug; TEST-ref check is dev-only scaffolding | Replace with real guards: signed-in + owns-the-trip (RLS) + editable (#2) + under-quota (§3). The "never touch the live reference" property becomes **structural** — edits only ever hit the caller's own `trips` row; `reference_trips` is never written by this path again. |
| 9 | **Cache** — reference reads have a snapshot fallback | User trips have none; the map/route must refresh after apply | `applyReplanAction` calls `revalidatePath` for the trip's surfaces (mirror `lib/trips/actions.ts`). |

### Repo methods to add

Rather than let `edit-actions.ts` keep talking to Supabase directly (it violates
"repository is the only path to data", `web/CLAUDE.md`), add to
`lib/trips/user-trips.ts` (+ dispatch in `repository.ts`):

- `getEditableUserTrip(id)` → `{ trip, input } | null` (load + generationInput
  extraction, RLS-scoped). Replaces `loadEditableTrip`'s reference read.
- `stageTripEdit(id, { payload, signature, diff, baseUpdatedAt, usage })` → writes
  the pending record (§2), RLS-scoped, `owner_id = auth.uid()`.
- `getStagedTripEdit(id)` / `discardStagedTripEdit(id)`.
- `applyStagedTripEdit(id, expectedSignature)` → the transactional promote
  (signature + base-version guard, then payload swap), ideally a single RPC (§2).

`edit-actions.ts` then calls these; it keeps the service client **only** for
corpus/bake/facts.

---

## 2. `--pending` staging under user rows

The question: today a pending edit is a **sibling `reference_trips` row**. Under
user-owned trips, staging needs a home that (a) carries `owner_id` for RLS,
(b) doesn't appear as a phantom trip in lists, (c) survives the stage→confirm→apply
gap, (d) holds the signature + diff + spend, and (e) supports a clean
stage→apply promote without a race.

### Option A — sibling `trips` row (today's model, ported)
A second `trips` row with a derived id. **Rejected:** uuid PK can't take a
derived id; it shows up in `listUserTrips`; `state` has no `pending` value;
doubles the row and needs filtering everywhere.

### Option B — pending columns on `public.trips`
Add `pending_payload jsonb`, `pending_signature text`, `pending_base_updated_at
timestamptz`, `pending_created_at timestamptz` (all nullable). Stage = `UPDATE …
SET pending_* WHERE id`. Apply = `SET payload = pending_payload, pending_* = NULL`.
Discard = `SET pending_* = NULL`.
- **Pros:** one migration, single-row so promote is atomic in one `UPDATE`,
  RLS "just works" (same row, same `owner_id`), never a phantom in lists,
  one-pending-per-trip naturally.
- **Cons:** widens the hot row with a second full `payload` (≈ doubles size
  while staged); `listUserTrips` selects `payload` and would pull the bloat
  (select-list would need trimming); only one staged edit per trip (fine for MVP).

### Option C — separate `trip_pending_edits` table  *(recommended)*
```
create table public.trip_pending_edits (
  id                uuid primary key default gen_random_uuid(),
  trip_id           uuid not null references public.trips(id) on delete cascade,
  owner_id          uuid not null references public.users(id) on delete cascade,
  payload           jsonb not null,           -- the staged Trip
  signature         text not null,            -- editSignature guard
  diff              jsonb not null,           -- ReplanDiff, so the sheet needn't recompute
  base_updated_at   timestamptz not null,     -- optimistic-concurrency guard
  est_cost_usd      numeric,                  -- spend attribution (§3)
  input_tokens      integer,
  output_tokens     integer,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '1 day',
  unique (trip_id)                            -- one active pending per trip (today's semantics)
);
-- RLS: owner-scoped, mirroring trips
alter table public.trip_pending_edits enable row level security;
create policy pending_rw_owner on public.trip_pending_edits
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
```
- **Pros:** carries `owner_id` (RLS), signature, **diff**, and **spend** in real
  columns out of `payload`; keeps `trips` lean and `listUserTrips` untouched;
  `expires_at` enables GC of abandoned stages; `on delete cascade` cleans up when
  a trip is deleted; leaves room for staging history / multiple edits later
  (drop the `unique` when wanted).
- **Cons:** a second table + a join/second query; cross-table apply needs a
  transaction (below).

### Recommendation
**Option C.** It matches how the diary already treats a pending edit (a distinct
thing with a signature, a diff, and — new for prod — a cost), keeps the trips row
and the trips list clean, and gives TTL cleanup for free. **Option B** is the
acceptable minimal-schema fallback if we want zero new tables; if we take B,
trim `payload`/`pending_payload` out of the `listUserTrips` select.

### The promote (both options) — closing the stage→apply race
Do the promote in a **single Postgres RPC** (`security definer`, owner-checked)
so signature-check + base-version-check + payload-swap + pending-delete are one
transaction:

```
apply_trip_edit(p_trip_id uuid, p_expected_signature text) returns trips
-- 1. lock the pending row for this trip (SELECT … FOR UPDATE)
-- 2. refuse if signature <> p_expected_signature   (foreign/stale edit)
-- 3. refuse if base_updated_at <> trips.updated_at (trip moved under us)
-- 4. update trips set payload = pending.payload
-- 5. delete the pending row
```
This is the production-grade version of today's TS-side signature guard, and it
also fixes the non-transactional RMW that living-plan makes worse (two clients,
a human confirm-delay in the middle). Keep `signature` (proves *which* edit) and
add `base_updated_at` (proves *against what base*). Move `livingPlanEditSignature`
out of `payload` and into the `signature` column.

---

## 3. Spend limits

Living-plan is the first feature that spends real LLM money **per user
interaction**, so it needs a ceiling before it can face users.

### Cost surface (measured from the code)
- Per paid edit: `generateAndAudit` → **up to 3** Opus calls (`REGEN_BUDGET = 2`
  + the first), each `max_tokens 32000`; plus `preComputeFacts` (Google geocode +
  corpus) and one cheap Sonnet parse/interpret. The **pre-flight** already added
  (`preflight.ts`) removes the impossible-date churn (was 17.9 min / ~$3–5 → ~1 s).
- `generateItinerary` already returns `usage`, but it is **discarded** in
  `generateAndAudit` (`generate.ts:175,188`). Threading it out is step one.

### Design
1. **Capture usage.** `generateAndAudit` accumulates `usage` across all attempts
   and returns it; `runGateStage` records it on the pending record (§2) and, on
   apply, into a ledger.
2. **Ledger.** `public.llm_usage(id, owner_id, trip_id, action, input_tokens,
   output_tokens, est_cost_usd, created_at)`, RLS owner-read, service-role write
   (usage is recorded server-side, not user-writable). Quota = a windowed
   `sum()` (per-day edits, per-day tokens, per-month $).
3. **Enforce BEFORE the paid step.** A guard at the top of the paid actions
   (`replanAction` / `addStopAction` / `executeEditAction`), after `loadEditableTrip`
   and after the free pre-flight, reads the ledger and refuses over-quota with a
   clear message ("you've used N re-plans today"). Cheap parse/interpret stay free
   and ungated.
4. **Per-edit cap.** `REGEN_BUDGET` already bounds attempts; make it explicit that
   one confirmed edit = at most 3 Opus calls, and dedupe retries by `signature`
   (a re-submitted identical edit reuses the staged result instead of re-spending).
5. **Cost rate = configurable, not hardcoded.** Do **not** bake Opus 4.8 pricing
   into code from memory — pull current input/output rates from the `claude-api`
   reference and store them as config, so `est_cost_usd` is a computed
   `tokens × rate`. (Flagged so pricing is confirmed at build time, per repo
   policy on not answering pricing from memory.)

### Open decisions (need Adam)
- **Quota values** — free-tier limits (edits/day, $/user/month) and whether
  they're per-trip or per-user. Not derivable from code.
- **Overage behavior** — hard refuse vs. soft warn vs. paid tier.

---

## 4. Ungating

Replace the three dev-only gates (`checkRails`) with production guards, and swap
the global env flag for a per-trip capability.

- **Server (`checkRails` → real guards):**
  1. **Auth** — `auth.getUser()` must return a session (else 401-equivalent
     typed failure).
  2. **Ownership** — RLS makes a non-owned trip invisible; `getEditableUserTrip`
     returns `null` → "not found or not yours". No explicit id list needed.
  3. **Editable** — `trip.generated && generationInput?.anchors?.length` (already
     enforced; now the primary gate).
  4. **Quota** — §3.
  - Drop the **TEST-ref** check and the **`dawson-vancouver-cassiar` forbidden
    id** entirely: the write path structurally can't touch `reference_trips` or
    another user's trip anymore.
- **Client (`LIVING_PLAN_ON` env → per-trip):** gate the composer on the loaded
  trip's capability (`trip.generated && trip.generationInput`), not a build-time
  env var. Reference/fork-without-input trips simply don't show the box.
- **Staged rollout** (optional): a `feature_flags` / allowlist column or a
  Supabase-config flag for a gradual ramp, replacing the all-or-nothing env var.
  Keep `/demo/livingplan` as a dev harness behind the old env flag if useful, but
  it's no longer the production path.

---

## 5. Suggested sequencing (each independently shippable)

1. **Repo seam** — add `getEditableUserTrip` + `stage/get/discard/applyStagedTripEdit`
   to the repo; point `edit-actions.ts` at them; keep writing `reference_trips`
   under the hood at first (pure refactor, no behavior change, still TEST-gated).
2. **Schema** — migration for the pending mechanism (Option C table + the
   `apply_trip_edit` RPC) via `db:push-verify` (test first).
3. **Flip the write target** — stage/apply/discard now hit `trip_pending_edits`
   + `trips` (SSR client), service client retained only for corpus/bake/facts.
   Add the base-version guard.
4. **Spend** — thread `usage`, add `llm_usage` + the pre-paid quota guard.
5. **Ungate** — replace `checkRails`, move the client gate per-trip, remove the
   TEST-ref/forbidden-id/env-flag scaffolding.

## 6. Risks / watch-items
- **Non-transactional RMW** is the load-bearing correctness risk; the
  `apply_trip_edit` RPC (§2) is the fix and should land with the schema, not after.
- **Payload bloat** if Option B is chosen — trim list selects.
- **Two-client `runGateStage`** — keep the corpus/service vs. user/SSR split
  explicit and commented so a later refactor doesn't collapse them and
  accidentally bypass RLS on user data.
- **Pricing** must be confirmed from the `claude-api` reference at build time, not
  assumed here.
- **`generationInput` presence** — trips generated before that field existed
  aren't editable; that's the intended degrade (already guarded), but the UI
  should say why rather than hiding the box silently.
