# Trip generation will require sign-in, and the legacy wizard is replaced rather than migrated

**Status:** Decided 2026-07-27. **Not started — blocked on auth (below).**
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

## The blocker

**Sign-in is not currently exercisable on either project, and nothing in the
sequence can move until that is resolved.**

Google OAuth is the only wired method — no email/password, no magic link
(`web/src/app/auth/actions.ts`, `signInWithGoogle`; the sign-in page's own copy
reads *"Google · only sign-in method for v1"*) `[read source]`. **TEST has no
Google provider configured**, and **PROD's provider is disabled.** So requiring
sign-in for generation makes the primary creation path unreachable in dev without
hand-minting a session cookie (`web/scripts/mint-dev-session.ts`, with its ~1h
expiry that masquerades as broken tooling), and unreachable in prod outright.

This is not a side issue to route around. It means every future verification of
the primary creation path runs through a hand-minted cookie, and it is why
`app/trips/layout.tsx` already carries its user gate **commented out** with
*"Re-enable the user gate when OAuth is back"* `[read source]`. **The two gates
should move together.**

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
  generated trips carry inflated `milesFromStart`.
- **The corpus-feedback call must stay on a service client** regardless of what
  the trip write uses — `upsert_source_record` is SECURITY INVOKER and
  `source_record` has RLS with zero policies. See `docs/BACKLOG.md` §Client
  boundary.

## What would revisit this

If a non-Google sign-in method is wired (email/password or magic link), the
blocker dissolves and the sequence can start immediately. If anonymous trips are
ever wanted as a product feature, this decision needs reopening rather than
extending — the anon store is deleted here, and re-adding one would need durable
persistence and honest UI about it, neither of which exists today.
