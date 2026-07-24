# Typesense: one collection per environment on the shared cluster

Date: 2026-07-23

## Context

Search is backed by Typesense Cloud on the **Starter tier = one cluster**, shared
by prod and test (both env backups, old and new, point at the same host — it was
always shared). The sync (`data/search/sync-typesense.ts`) and the web client
(`web/src/lib/search.ts`) both hardcoded `COLLECTION_NAME = "places"`, so **both
environments read and wrote the same collection**.

`search:sync` does a full reindex **with a prune pass**: it deletes every indexed
doc whose id is not in the source `master_place`. Because each Supabase project
assigns its own `gen_random_uuid` ids, the two environments' id sets are
**disjoint** — so a sync from one environment treats *all* of the other's docs as
stale and **prunes them**. Whoever synced last clobbered the other.

The failure is worse than "stale results." The federated half of
`/api/search-area` takes Typesense hit ids and **hydrates them against its own
Supabase** (`hydratePlacesByIds`). After a cross-environment clobber, an
environment's Typesense contains ids that do not exist in *its* database, so
hydrate finds nothing — and when the collection is wrong entirely (or absent),
the read **throws**, taking the whole federated half down (`failedSources:
["corpus"]`), not merely returning fewer results. A shared collection could not
keep dev and prod both working at once.

## Decision

**One collection per environment on the one cluster:** `places_prod` and
`places_test`. The collection name is read from an env var with **no default** —
`TYPESENSE_COLLECTION` (data) / `NEXT_PUBLIC_TYPESENSE_COLLECTION` (web) — and the
code **fails loud** if it is unset. A silent fallback to `"places"` is exactly
the shared-collection bug, so there is deliberately no default.

Rejected: **a second cluster.** It would isolate the environments too, but the
Starter tier is one cluster (a second is cost + another thing to provision and
keep in sync), and collection-per-env achieves the same isolation for the price
of one env var threaded through two files. If scale ever demands separate
clusters, the same env var already points each environment at its own target.

## Consequences

- `search:sync` from prod and from test target different collections, so neither
  prunes the other. Each environment's Typesense ids match its own Supabase, so
  hydrate resolves.
- Cutover was: sync `places_test` and `places_prod`, set
  `NEXT_PUBLIC_TYPESENSE_COLLECTION=places_prod` in Vercel, **redeploy** (the
  `NEXT_PUBLIC_` value bakes at build time), then leave the old `places`
  collection in place as a fallback (unused; safe to delete once confirmed).
- The unset-env guard means CI and any importer of `sync-typesense.ts` (e.g.
  `materialize.ts`) must supply `TYPESENSE_COLLECTION`; CI sets a dummy
  `places_ci` (the suite never reaches Typesense).
- Do NOT reintroduce a hardcoded collection default. The name must always come
  from the environment.
- The old shared-`places` behavior is closed off.
