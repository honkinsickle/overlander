# Place identity and ordering — `placeRanks` is keyed `placeId → {nodeId, rank}`, and attachment/sequence are separate primitives

**Status:** Decided. Authored POI sequence is a durable, placeId-keyed
`Trip.placeRanks` map (`web/src/lib/trips/types.ts:90`); the pure core ships as
`web/src/lib/corridor/place-rank.ts` (`insertRank`, tested). Attachment
(`placeOverrides`, placeId → nodeId) and sequence (`placeRanks`) are distinct
primitives that ride one drag gesture. Branch `feat/manual-trip-edit`.
**Date:** 2026-07-23.

A day renders as an ordered list of city **nodes**; POIs hang under a node. Two
questions about a POI are independent: *which node owns it* (attachment) and *its
order among siblings under that node* (sequence). This record is the reasoning
behind the shape both took, and it exists because each alternative we rejected is
one a future session would otherwise assume is still open.

---

## Why the rank key is scoped to the node, not the trip or the day

`placeRanks[placeId] = { nodeId, rank }` carries the node id alongside the rank on
purpose. The alternative — a bare `placeId → rank`, a single order across the
whole day — was rejected because **every failure path in testing was a membership
change**, not a reorder. A POI moves between nodes (the attachment drag); a
newcomer is re-bucketed in on regeneration; a cluster splits. A trip- or day-wide
rank has no answer for "ranked relative to *what*" once membership shifts: the
number is stranded, comparing a POI against siblings it no longer has. Binding the
rank to the node it was authored under means a rank is only ever read against the
cluster it was written for. When attachment changes the node, the stale rank is
self-evidently out of scope and the cluster re-materializes (below) rather than
silently mis-sorting.

## Why partial ranking is unrepresentable — a cluster is ranked or it is not

Rank (a float) and mile (a distance) are **different units and not comparable**.
The derived order of an untouched cluster is mile-position (corridor days) or
near→far from the anchor (round-trip days); an authored order is a float rank.
There is no meaningful merge of "place A at 372 mi" with "place B at rank 1.5" —
so a cluster where some members have ranks and others don't cannot be sorted
coherently (rank one place "last" and a naive comparator sorts it *first*, because
an absent rank isn't a large one). The decision: a cluster is **atomic**. The
moment any member is unranked — first touch, or a newcomer re-bucketed in — we
**materialize**: reseed every member to an integer rank in the current display
order, so the first drag reproduces the existing order except the moved card.
After that, a move is a single fractional midpoint between new neighbors. The
rejected alternative — let ranked and unranked coexist and invent a fallback for
the gaps — loses because the fallback *is* a lie about order, and it reintroduces
exactly the rank-vs-mile incomparability the atomic rule removes.

## Why a newcomer appends rather than demotes the incumbents

When regeneration drops a new POI into a ranked cluster, it appends to the end
rather than inserting at its mile position (which would push ranked siblings down).
**Append makes exactly one unspecified choice** — where to put the one place whose
order nobody authored. **Demote destroys N explicit ones** — it overwrites the
author's decision about places they *did* order, to honor a position for a place
they never touched. The asymmetry is the whole argument: an unranked newcomer has
no authored opinion to respect, so the cheapest safe placement wins; the ranked
incumbents all have opinions, and none may be spent to seat a newcomer. Revisiting
this would require a newcomer to carry an authored position from somewhere — which
it does not.

## Why sequence rides the existing drag rather than a second gesture

Attachment (moving a card between nodes) is already a drag. Sequence reuses it: the
drop index is derivable from the same single gesture via pointer-vs-rect on drop,
so "one gesture, both primitives" holds without a second interaction (a separate
handle, a numeric field, a sort menu). A second gesture was rejected as redundant
UI for information the first gesture already carries. The idiomatic index source is
`SortableContext`, but adopting it requires converting each cluster to a sortable
list; that is a fidelity pass with no model change, deferred — not a reason to add
a second gesture now.

## Why attachment and sequence are separate primitives

They answer different questions and change independently. Attachment is *set
membership* (`placeOverrides`: which node); sequence is *order within the set*
(`placeRanks`: order among siblings). Collapsing them into one structure — e.g. a
single ordered list per node that encodes both membership and order — was rejected
because it couples two lifecycles that don't move together: a POI can be
re-attached without reordering, and reordered without re-attaching, and
regeneration touches them on different rules (attachment survives by placeId;
sequence re-materializes on membership change). Two maps keyed by the same placeId,
each with its own survival rule, keep those lifecycles honest.

## Open question — placeId stability across regeneration

Both maps are **keyed by placeId and are only as durable as that key**. The load
model is that a placeId survives regeneration exactly as `placeOverrides` already
relies on. **If generated placeIds are NOT stable across regeneration, every
carried rank (and every carried attachment) points at nothing** — the map survives
but its keys no longer resolve, and a user's authored order silently evaporates on
the next regenerate. This is unverified here and is the first thing to check before
trusting carried ranks in production. If placeIds turn out unstable, the fix is not
in this model — it is upstream: a stable identity for a generated place, or a
migration that rekeys the maps when ids change.
