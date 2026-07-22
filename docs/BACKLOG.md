# Backlog — open work

Durable and deferred work. This is the long list; the **active cut** — what is
queued or in-flight right now — lives in `docs/STATE.md` (§Queued, §In-flight)
and is authoritative for the current branch. When an item here becomes the next
thing worked, it moves into STATE.md §Queued.

## Deferred / parked
- **dnd-kit `SortableContext`** — parked. Pointer-vs-rect (`computeInsertIndex`)
  was chosen instead, no model change. Revisit only if pointer-vs-rect proves
  insufficient. (See STATE.md §Parked.)

## Someday / unscheduled
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

_(add items here as they surface; keep one line each, promote to STATE.md
§Queued when scheduled)_
