/**
 * Simple before/after plan diff for the re-plan approval sheet (living-plan
 * MVP): compares the two day tables and summarizes what changed — the pinned
 * target, whether the trip endpoints held, layover count, and which overnight
 * stops appeared/disappeared. Pure + test-locked; the fancy per-day ripple
 * view is a later tier.
 *
 * IDENTITY AT DIFF TIME (diagnosis, 2026-07-18): the compared days carry NO
 * stable place id. `itineraryToTrip` sets per-day `coords` only for the last
 * day (intermediate days are undefined), and the only per-day id is
 * `overnight-${n}` — POSITIONAL, not a place identity, so matching on it would
 * wrongly merge distinct places sharing a slot. The real geographic identity
 * that IS recoverable is the day's last `corridorCities` node (`kind:"end"`,
 * real `[lng,lat]`), present whenever the day was baked (the living-plan flow
 * bakes both sides). So matching is: normalized label → coord proximity (from
 * that end node, when present) → containment → fuzzy token similarity → an
 * isolated single-swap fallback → genuine add/remove. A true `place_id` would
 * need the generator to resolve every day's end place to a master_place row and
 * persist it per-day — a cross-cutting pipeline change not justified for a
 * display-time trust affordance; label+geo matching is the proportionate fix.
 */

import type { Day, CorridorCity } from "@/lib/trips/types";
import { haversineMi } from "@/lib/routing/point-to-polyline";

export type ReplanDiff = {
  pinned: { place: string; date: string };
  endpointsHeld: { start: boolean; end: boolean };
  layovers: { before: number; after: number };
  /** Overnight stops present after but not before (by day-end place). */
  stopsAdded: string[];
  /** Overnight stops present before but not after. */
  stopsRemoved: string[];
  /** Stops that stayed but whose label changed (rename or corridor re-snap) —
   *  matched by geo/label so they DON'T read as a spurious remove+add. */
  stopsRenamed: { from: string; to: string }[];
  /** The re-planned day table, for the sheet's listing. */
  days: { date: string; miles: number; label: string }[];
};

type DayLite = Pick<Day, "date" | "miles" | "label" | "coords" | "corridorCities">;

/** A day's end place — the overnight — from its "Start — End" label. */
function endPlace(d: Pick<Day, "label">): string {
  const parts = d.label.split("—");
  return (parts[parts.length - 1] ?? d.label).trim();
}

/** The day's END coordinate, if recoverable: the persisted end `coords`, else
 *  the last corridor node (`kind:"end"`). Undefined on unbaked / degraded days. */
function endCoord(d: DayLite): [number, number] | undefined {
  if (d.coords) return d.coords;
  const end = d.corridorCities?.find((c: CorridorCity) => c.kind === "end");
  return end?.coords;
}

/** Layover = a day that ends where it starts (out-and-back or 0-mi rest). */
function isLayover(d: Pick<Day, "label">): boolean {
  const parts = d.label.split("—").map((s) => s.trim());
  return parts.length === 2 && parts[0] === parts[1];
}

// ── Label normalization ────────────────────────────────────────────────────
// Generic administrative suffixes that vary between a snap and its rename
// ("PP" ↔ "Provincial Park", ", BC") — dropped so those variants normalize
// equal. Kept in the *core* string for containment (below).
const ADMIN_WORDS = new Set([
  "pp", "np", "sp", "provincial", "national", "state", "park", "parks",
  "recreation", "rec", "site", "campground", "cg", "rv", "resort",
  "historic", "historical",
]);
// Generic geographic words — common across unrelated places ("Boya Lake" vs
// "Kinaskan Lake"), so they must NOT drive a fuzzy match. Removed from the
// token set used for similarity only.
const GEO_STOPWORDS = new Set([
  "lake", "lakes", "river", "creek", "mountain", "mount", "mt", "valley",
  "junction", "jct", "hot", "springs", "spring", "city", "town", "the",
]);
// Two-letter province/state codes stripped as trailing admin context.
const PROVINCE_CODES = new Set([
  "bc", "yt", "ab", "nt", "sk", "mb", "on", "qc", "ak", "wa", "or", "ca",
]);

/** lowercase, strip diacritics + punctuation, drop admin words + province
 *  codes, collapse whitespace. "Tā Ch'ilā (Boya Lake) PP" → "ta chila boya lake". */
function normalizeLabel(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ") // punctuation + parens → space
    .split(/\s+/)
    .filter((w) => w && !ADMIN_WORDS.has(w) && !PROVINCE_CODES.has(w))
    .join(" ")
    .trim();
}

/** Distinctive tokens for similarity: the normalized core minus generic geo
 *  words. "Boya Lake" → {boya}; "Dease Lake" → {dease} (no shared "lake"). */
function coreTokens(s: string): Set<string> {
  return new Set(
    normalizeLabel(s)
      .split(/\s+/)
      .filter((w) => w && !GEO_STOPWORDS.has(w)),
  );
}

/** Sørensen–Dice on the distinctive token sets. 1 = identical, 0 = disjoint. */
function tokenSimilarity(a: string, b: string): number {
  const ta = coreTokens(a);
  const tb = coreTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

/** One normalized label fully contains the other's core (min length guards
 *  against trivial single-letter overlaps). "boya lake" ⊂ "ta chila boya lake". */
function containsCore(a: string, b: string): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (na.length < 4 || nb.length < 4) return false;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  return long.includes(short);
}

const COORD_MATCH_MI = 25; // a re-snap to a nearby corridor node (Wells↔Barkerville ~3mi)
const FUZZY_THRESHOLD = 0.5;

type Stop = { label: string; coord?: [number, number] };

/** Unique end-place stops, first-seen order, each with a representative coord. */
function uniqueStops(days: DayLite[]): Stop[] {
  const seen = new Map<string, Stop>();
  for (const d of days) {
    const label = endPlace(d);
    if (!seen.has(label)) seen.set(label, { label, coord: endCoord(d) });
    else if (!seen.get(label)!.coord) seen.get(label)!.coord = endCoord(d);
  }
  return [...seen.values()];
}

/**
 * Match before-stops to after-stops by descending confidence, one-to-one:
 *   normalized-equal → coord proximity → containment → fuzzy ≥ threshold →
 *   isolated single swap (exactly one left on each side).
 * Returns the matched pairs; the leftovers are genuine removes/adds.
 */
function matchStops(before: Stop[], after: Stop[]): { pairs: [Stop, Stop][]; removed: Stop[]; added: Stop[] } {
  const remBefore = [...before];
  const remAfter = [...after];
  const pairs: [Stop, Stop][] = [];

  const take = (bi: number, ai: number) => {
    pairs.push([remBefore[bi], remAfter[ai]]);
    remBefore.splice(bi, 1);
    remAfter.splice(ai, 1);
  };

  // Tier 1 — normalized-equal (case / punctuation / "PP"↔"Provincial Park").
  for (let bi = remBefore.length - 1; bi >= 0; bi--) {
    const ai = remAfter.findIndex((a) => normalizeLabel(a.label) === normalizeLabel(remBefore[bi].label));
    if (ai !== -1) take(bi, ai);
  }

  // Tier 2 — coordinate proximity (real geographic identity, when baked).
  for (let bi = remBefore.length - 1; bi >= 0; bi--) {
    const b = remBefore[bi];
    if (!b.coord) continue;
    let best = -1;
    let bestMi = COORD_MATCH_MI;
    for (let ai = 0; ai < remAfter.length; ai++) {
      const a = remAfter[ai];
      if (!a.coord) continue;
      const mi = haversineMi(b.coord, a.coord);
      if (mi <= bestMi) {
        bestMi = mi;
        best = ai;
      }
    }
    if (best !== -1) take(bi, best);
  }

  // Tier 3 — containment ("Boya Lake" ⊂ "Tā Ch'ilā (Boya Lake) PP").
  for (let bi = remBefore.length - 1; bi >= 0; bi--) {
    const ai = remAfter.findIndex((a) => containsCore(a.label, remBefore[bi].label));
    if (ai !== -1) take(bi, ai);
  }

  // Tier 4 — fuzzy token similarity, greedily best-first.
  for (;;) {
    let bestSim = FUZZY_THRESHOLD;
    let bb = -1;
    let ba = -1;
    for (let bi = 0; bi < remBefore.length; bi++) {
      for (let ai = 0; ai < remAfter.length; ai++) {
        const sim = tokenSimilarity(remBefore[bi].label, remAfter[ai].label);
        if (sim >= bestSim) {
          bestSim = sim;
          bb = bi;
          ba = ai;
        }
      }
    }
    if (bb === -1) break;
    take(bb, ba);
  }

  // Tier 5 — isolated single swap: exactly one unmatched left on each side is a
  // re-snap of that one stop (Wells → Barkerville with no coords). A multi-stop
  // reshuffle leaves >1 unmatched and correctly stays add/remove. Guard: if
  // coords are present and the two are far apart, they're provably DISTINCT
  // places — don't merge (only fire when sameness can't be disproven).
  if (remBefore.length === 1 && remAfter.length === 1) {
    const b = remBefore[0];
    const a = remAfter[0];
    const provablyDistinct = b.coord && a.coord && haversineMi(b.coord, a.coord) > COORD_MATCH_MI;
    if (!provablyDistinct) take(0, 0);
  }

  return { pairs, removed: remBefore, added: remAfter };
}

export function computePlanDiff(
  before: DayLite[],
  after: DayLite[],
  pinned: { place: string; date: string },
): ReplanDiff {
  const { pairs, removed, added } = matchStops(uniqueStops(before), uniqueStops(after));

  // A matched pair whose display label changed is a rename/re-snap, not add+remove.
  const stopsRenamed = pairs
    .filter(([b, a]) => b.label.trim() !== a.label.trim())
    .map(([b, a]) => ({ from: b.label, to: a.label }));

  return {
    pinned,
    endpointsHeld: {
      start: before[0]?.date === after[0]?.date,
      end: before[before.length - 1]?.date === after[after.length - 1]?.date,
    },
    layovers: {
      before: before.filter(isLayover).length,
      after: after.filter(isLayover).length,
    },
    stopsAdded: added.map((s) => s.label),
    stopsRemoved: removed.map((s) => s.label),
    stopsRenamed,
    days: after.map((d) => ({ date: d.date, miles: d.miles ?? 0, label: d.label })),
  };
}
