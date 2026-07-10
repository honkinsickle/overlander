import type { BrowsePlace } from "./places";
import { sameSpot } from "@/lib/discovery/discovery";

/**
 * Merge the federated corpus into a day's live-discovered POI pool
 * (wizard-finalize). Live and corpus use different id schemes (`osm/…` vs
 * `mp:<uuid>`), so a plain id-dedup misses the twin when the same physical
 * place is found by both. This applies the coord+name `sameSpot` merge:
 *
 *   - CORPUS WINS on a match — keep the canonical, entity-resolved record
 *     and its google `placeId` (→ P3 rich hydrate), but BACKFILL
 *     `photoUrl`/`photoAlt` from the matched live record when the corpus
 *     tile has none (corpus is essentials-only; the live Wikipedia/Mapillary
 *     photo is a nicer placeholder and non-volatile, safe to persist).
 *   - LIVE-ONLY finds (no corpus match) are KEPT — the point of live
 *     discovery in areas the corpus misses.
 *   - CORPUS-ONLY finds are ADDED — the point of the fold in remote areas.
 *
 * No rating backfill: corpus tiles stay essentials-only (ratings are
 * P3-hydrate-only on every path — the invariant holds). The rare overlap
 * whose corpus record has no `placeId` shows no stars; the placeId majority
 * hydrates live.
 */
export function mergeCorpusIntoPool(
  live: BrowsePlace[],
  corpus: BrowsePlace[],
): BrowsePlace[] {
  const pool = [...live];
  for (const c of corpus) {
    const i = pool.findIndex((l) => sameSpot(l, c));
    if (i === -1) {
      pool.push(c);
      continue;
    }
    const liveMatch = pool[i];
    pool[i] = c.photoUrl
      ? c
      : { ...c, photoUrl: liveMatch.photoUrl, photoAlt: liveMatch.photoAlt };
  }
  return pool;
}
