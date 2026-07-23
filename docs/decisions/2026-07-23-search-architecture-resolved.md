# Search architecture — "Google-primary vs corpus-first" is CLOSED; the real open item is corridor ingestion

**Status:** Resolved. The June-vs-July question — should search be Google-primary
or corpus-first — is **closed**, not by a decision but by ground truth that made
it a non-question. `web/src/app/api/search-area/route.ts` is the shipped answer.
The genuine open item is **corridor ingestion**. Supersedes the "Search
architecture unresolved" line carried in `docs/STATE.md` NEXT.
**Date:** 2026-07-23.

---

## What was actually contested

The framing was "which source leads — the live Google-primary federation (June's
shape) or a corpus-first read (July's shape)." That framing assumed both were
viable answers to the same question: *how do we serve search over the route*. The
ground truth is that only one of them covers the route at all.

## The ground truth that closed it

- **The federation already ships, ungated.** `/api/search-area`
  (`web/src/app/api/search-area/route.ts`) fans out in parallel across **Google
  Places** (`searchNearby` + `searchText`), **Foursquare**, **Rec.gov**,
  **USFS**, and **BLM**, and merges the result with the corpus half through the
  shared federated hydrate. It is not behind a flag and not a prototype — it is
  the live search path.
- **The corpus does not cover the route.** It holds **1,749 searchable rows,
  entirely within lat 33.8–34.4, lng −118.2 to −115.8** — LA to Joshua Tree.
  **Zero rows above 34.5°N.** The route runs to Deadhorse. So a corpus-first read
  is corpus-first over ~1% of the corridor and empty for the rest.

So the contest was never "which good source leads." It was between a working live
federation and a corpus that does not contain the places a route search asks for.
There is no order of those two that makes the corpus cover Fort Nelson.

## Why the alternative lost

"Corpus-first" lost because **first-of-nothing is nothing**. The appeal of
corpus-first was latency and provenance — read our own resolved, attributed rows
instead of paying for a live fan-out. That appeal is real *only where the corpus
has rows*, and it has rows only in the LA→Joshua Tree box. Making the corpus lead
would have degraded search everywhere the corpus is empty (i.e. almost the whole
route) in exchange for a win in one metro box the federation already covers.
Google-primary "won" by default: it is the only path with route-wide coverage
today.

## What the real open item is

**Corridor ingestion, not source order.** The corpus-first future is not wrong —
it is *unbuilt*. It becomes viable exactly when the corpus is ingested along the
corridor (north of 34.5°N, up through BC/Yukon). Until then, source order is a
settled non-question and any session tempted to reopen "should we go corpus-first"
should instead ask "is the corridor ingested yet." Revisit this decision when — and
only when — corpus coverage extends past the LA→Joshua Tree box; at that point the
lead-source question becomes live again *for the covered segments*, per-region.

## Latent gap to know about before ingestion lands

The cross-source merge in `/api/search-area` **keeps the first occurrence by id and
does not actually merge across sources** — by current design, because the id
namespaces are disjoint (live `gpl/…` and `osm/…`, federated `mp:…`), so two
sources never collide on a key and "keep first" never has to choose. This is
**harmless today** precisely because coverage doesn't overlap. It becomes a real
entity-resolution gap **the moment corridor ingestion makes two sources describe
the same physical place** — then "distinct namespaces, no dedupe needed" stops
being true, and the same place appears twice under two ids. Flagging it here so it
is not rediscovered as a bug after ingestion: the merge step needs real
cross-source resolution *before* overlapping coverage exists, not after.
