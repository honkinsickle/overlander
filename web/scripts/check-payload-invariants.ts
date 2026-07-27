/**
 * Payload invariant checker — a MEASUREMENT INSTRUMENT, not a CI gate.
 *
 * Reads ONE trip payload from TEST and checks six geometric invariants over
 * `Day.segmentSuggestions[].milesFromStart` and `Day.corridorCities[].placeIds`.
 * Read-only: a single SELECT, no writes, ever.
 *
 * NOT wired into .github/workflows/ci.yml, and deliberately so — this exists to
 * MEASURE a known defect and to prove a fix, not to gate merges. Nothing depends
 * on its exit code. Failing assertions are the evidence; there is no skip/xfail
 * path, because a skipped assertion is indistinguishable from a passing one in
 * the output, and that exact failure mode is what this investigation is about.
 *
 * Run:
 *   cd web && npx tsx --env-file=.env.development.local \
 *     scripts/check-payload-invariants.ts [tripId]
 *
 * Context: docs/architecture/generation-pipeline.md.
 */
import { createClient } from "@supabase/supabase-js";
import { haversineMi } from "../src/lib/routing/point-to-polyline";
import { DEFAULT_CORRIDOR_PARAMS } from "../src/lib/corridor/derive";
import type { Day, Trip } from "../src/lib/trips/types";

const DEFAULT_TRIP_ID = "expedition-ms28y793";
const KNOWN = {
  nqzeywzcowujzyegxbsr: "PROD",
  znldzjdatkogdktymtvi: "TEST",
} as const;

/** Stored miles are `Math.round`ed at bake, so every bound needs a mile of slack. */
const ROUND_TOL = 1;
/** A tile keeps a mile only when its perpendicular offset is within the corridor
 *  buffer, so it can sit this far off the line it was measured against. */
const BUFFER_MI = DEFAULT_CORRIDOR_PARAMS.bufferMi;
/** A2 is deliberately LOOSE — wide enough that only the real distortion trips it,
 *  without encoding a guess about what a correct line needs. Tightened from
 *  measurement once the backfill lands. */
const A2_FACTOR = 3;
/** A3 ignores tiles this close to the day start — the ratio is meaningless when
 *  the denominator is near zero. */
const A3_MIN_HAVERSINE_MI = 5;
const A3_MAX_RATIO = 3;
/** A5 — share of tiles allowed to belong to no node at all. */
const A5_MAX_ORPHAN_RATE = 0.1;

type Violation = { day: number; detail: string };

type Result = {
  id: string;
  title: string;
  checked: number;
  violations: Violation[];
  /** Human-readable statement of what was measured, printed either way. */
  measured: string;
};

/** A day whose start and end are the same place: the audit never routes it, so
 *  it contributes no geometry and its end node legitimately sits at mile 0. */
function isRoundTripDay(day: Day): boolean {
  const s = day.startCoord;
  const e = day.coords;
  return !!s && !!e && s[0] === e[0] && s[1] === e[1];
}

function tilesWithMile(day: Day) {
  return (day.segmentSuggestions ?? []).filter(
    (t) => typeof t.milesFromStart === "number" && Array.isArray(t.coords),
  );
}

// ── The six assertions ────────────────────────────────────────────────

/** A1 — LOWER BOUND. Along-route distance from the day start cannot be less
 *  than the straight line to the tile, minus the corridor buffer (the tile may
 *  sit off the line) and rounding. Straight-line distance needs no routing, so
 *  this is a hard geometric floor. */
function a1LowerBound(days: Day[]): Result {
  const v: Violation[] = [];
  let checked = 0;
  let worst = 0;
  for (const d of days) {
    if (!d.startCoord) continue;
    for (const t of tilesWithMile(d)) {
      checked++;
      const straight = haversineMi(d.startCoord, t.coords);
      const floor = straight - BUFFER_MI - ROUND_TOL;
      const slack = (t.milesFromStart as number) - floor;
      if (slack < worst || worst === 0) worst = Math.min(worst || slack, slack);
      if ((t.milesFromStart as number) < floor) {
        v.push({
          day: d.dayNumber,
          detail: `${t.title} — stored ${t.milesFromStart}mi < floor ${floor.toFixed(1)}mi (straight-line ${straight.toFixed(1)}mi − buffer ${BUFFER_MI} − ${ROUND_TOL})`,
        });
      }
    }
  }
  return {
    id: "A1",
    title: "Lower bound: milesFromStart >= straight-line − buffer − rounding",
    checked,
    violations: v,
    measured: `tightest margin above the floor: ${worst.toFixed(1)}mi`,
  };
}

/** A2 — UPPER BOUND. A tile positioned along a day's own route cannot sit at a
 *  multiple of that day's total distance. Loose by design (see A2_FACTOR). */
function a2UpperBound(days: Day[]): Result {
  const v: Violation[] = [];
  let checked = 0;
  let worstRatio = 0;
  for (const d of days) {
    const cap = (d.miles ?? 0) * A2_FACTOR;
    for (const t of tilesWithMile(d)) {
      checked++;
      const mi = t.milesFromStart as number;
      if (d.miles && d.miles > 0) worstRatio = Math.max(worstRatio, mi / d.miles);
      if (mi > cap) {
        const degenerate = !d.miles ? "  [degenerate: day.miles=0]" : "";
        v.push({
          day: d.dayNumber,
          detail: `${t.title} — stored ${mi}mi > cap ${cap}mi (day.miles ${d.miles} × ${A2_FACTOR})${degenerate}`,
        });
      }
    }
  }
  return {
    id: "A2",
    title: `Upper bound: milesFromStart <= day.miles × ${A2_FACTOR}`,
    checked,
    violations: v,
    measured: `max observed milesFromStart / day.miles ratio: ×${worstRatio.toFixed(1)}`,
  };
}

/** A3 — RATIO SANITY. Roads bend, so along-route exceeds straight-line — but not
 *  by a large multiple. Skips tiles near the day start, where the ratio is noise. */
function a3RatioSanity(days: Day[]): Result {
  const v: Violation[] = [];
  let checked = 0;
  let worst = 0;
  for (const d of days) {
    if (!d.startCoord) continue;
    for (const t of tilesWithMile(d)) {
      const straight = haversineMi(d.startCoord, t.coords);
      if (straight <= A3_MIN_HAVERSINE_MI) continue;
      checked++;
      const ratio = (t.milesFromStart as number) / straight;
      worst = Math.max(worst, ratio);
      if (ratio > A3_MAX_RATIO) {
        v.push({
          day: d.dayNumber,
          detail: `${t.title} — stored ${t.milesFromStart}mi vs straight-line ${straight.toFixed(1)}mi = ×${ratio.toFixed(1)}`,
        });
      }
    }
  }
  return {
    id: "A3",
    title: `Ratio sanity: stored / straight-line <= ${A3_MAX_RATIO} (tiles > ${A3_MIN_HAVERSINE_MI}mi out)`,
    checked,
    violations: v,
    measured: `max observed ratio: ×${worst.toFixed(1)}`,
  };
}

/** A4 — SPINE CONTAINMENT. A tile cannot sit past the day's end node. Round-trip
 *  days are exempt: the route returns to its origin, so the end node projects to
 *  mile 0 and containment is not meaningful there. */
function a4SpineContainment(days: Day[]): Result {
  const v: Violation[] = [];
  let checked = 0;
  let exempt = 0;
  let worstOver = 0;
  for (const d of days) {
    const cc = d.corridorCities ?? [];
    if (cc.length === 0) continue;
    if (isRoundTripDay(d)) {
      exempt += tilesWithMile(d).length;
      continue;
    }
    const endMi = cc[cc.length - 1].milesFromStart;
    for (const t of tilesWithMile(d)) {
      checked++;
      const mi = t.milesFromStart as number;
      worstOver = Math.max(worstOver, mi - endMi);
      if (mi > endMi + ROUND_TOL) {
        v.push({
          day: d.dayNumber,
          detail: `${t.title} — stored ${mi}mi > end node "${cc[cc.length - 1].name}" at ${endMi.toFixed(1)}mi`,
        });
      }
    }
  }
  return {
    id: "A4",
    title: "Spine containment: no tile past its day's end node (round-trip days exempt)",
    checked,
    violations: v,
    measured: `max overshoot past the end node: ${worstOver.toFixed(1)}mi · ${exempt} tile(s) exempt on round-trip days`,
  };
}

/** A5 — ORPHAN RATE. A tile that belongs to no node's placeIds has fallen out of
 *  every cluster. Bucketing drops a place past `maxAttachMi` from its nearest
 *  node, so inflated miles evict tiles from the spine. */
function a5OrphanRate(days: Day[]): Result {
  const v: Violation[] = [];
  let total = 0;
  let orphans = 0;
  for (const d of days) {
    const tiles = d.segmentSuggestions ?? [];
    if (tiles.length === 0) continue;
    const bucketed = new Set(
      (d.corridorCities ?? []).flatMap((c) => c.placeIds ?? []),
    );
    // A day with no spine at all has nothing to bucket INTO — that is a
    // different condition (no corridorCities), not an eviction. Report it, but
    // do not count it as an orphan.
    if ((d.corridorCities ?? []).length === 0) {
      v.push({
        day: d.dayNumber,
        detail: `no corridorCities — ${tiles.length} tile(s) have no spine to attach to (NOT counted as orphans)`,
      });
      continue;
    }
    for (const t of tiles) {
      total++;
      if (!bucketed.has(t.id)) {
        orphans++;
        v.push({ day: d.dayNumber, detail: `${t.title} — in no node's placeIds` });
      }
    }
  }
  const rate = total > 0 ? orphans / total : 0;
  return {
    id: "A5",
    title: `Orphan rate: tiles in no node's placeIds <= ${(A5_MAX_ORPHAN_RATE * 100).toFixed(0)}%`,
    checked: total,
    violations: rate > A5_MAX_ORPHAN_RATE ? v : [],
    measured: `${orphans}/${total} orphaned (${(rate * 100).toFixed(0)}%)`,
  };
}

/** A6 — UNIQUENESS. One place, one tile, one cluster entry. A place resolved in
 *  two roles must not persist twice. */
function a6Uniqueness(days: Day[]): Result {
  const v: Violation[] = [];
  let checked = 0;
  for (const d of days) {
    const tiles = d.segmentSuggestions ?? [];
    checked += tiles.length;
    const seen = new Map<string, number>();
    for (const t of tiles) seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
    for (const [id, n] of seen) {
      if (n > 1) {
        const title = tiles.find((t) => t.id === id)?.title ?? id;
        v.push({ day: d.dayNumber, detail: `segmentSuggestions: "${title}" (${id}) × ${n}` });
      }
    }
    for (const c of d.corridorCities ?? []) {
      const pc = new Map<string, number>();
      for (const id of c.placeIds ?? []) pc.set(id, (pc.get(id) ?? 0) + 1);
      for (const [id, n] of pc) {
        if (n > 1) {
          v.push({ day: d.dayNumber, detail: `node "${c.name}".placeIds: ${id} × ${n}` });
        }
      }
    }
  }
  return {
    id: "A6",
    title: "Uniqueness: no duplicate tile id per day, no duplicate placeId per node",
    checked,
    violations: v,
    measured: `${v.length} duplicate group(s) found`,
  };
}

// ── Runner ────────────────────────────────────────────────────────────

async function main() {
  const tripId = process.argv.find((a) => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]) ?? DEFAULT_TRIP_ID;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(2);
  }
  const ref = url.match(/https:\/\/([a-z0-9]+)\.supabase/)?.[1] ?? "unknown";
  const label = (KNOWN as Record<string, string>)[ref] ?? "UNKNOWN";
  console.log(`Target: ${label} (${ref})  ·  trip: ${tripId}  ·  READ-ONLY\n`);
  if (label !== "TEST") {
    console.error(`Refusing to run against ${label}. This instrument is TEST-only.`);
    process.exit(2);
  }

  const sb = createClient(url, key);
  const { data, error } = await sb
    .from("reference_trips")
    .select("payload")
    .eq("id", tripId)
    .single();
  if (error || !data) {
    console.error(`Could not read ${tripId}: ${error?.message ?? "no row"}`);
    process.exit(2);
  }

  const trip = data.payload as Trip;
  const days = trip.days ?? [];
  const totalTiles = days.reduce((n, d) => n + (d.segmentSuggestions ?? []).length, 0);
  console.log(`${days.length} days · ${totalTiles} tiles\n`);

  const results = [
    a1LowerBound(days),
    a2UpperBound(days),
    a3RatioSanity(days),
    a4SpineContainment(days),
    a5OrphanRate(days),
    a6Uniqueness(days),
  ];

  let failed = 0;
  for (const r of results) {
    const ok = r.violations.length === 0;
    if (!ok) failed++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${r.id}  ${r.title}`);
    console.log(`      checked ${r.checked} · ${r.measured}`);
    if (!ok) {
      console.log(`      ${r.violations.length} violation(s):`);
      for (const x of r.violations) console.log(`        day ${String(x.day).padStart(2)} · ${x.detail}`);
    }
    console.log();
  }

  console.log(`${results.length - failed}/${results.length} assertions pass.`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
