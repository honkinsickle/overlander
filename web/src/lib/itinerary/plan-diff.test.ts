/**
 * Locks the diff summary against the real before/after from the proven
 * Salmon Glacier re-plan (2026-07-16): +3 Cassiar park nights, −2 layovers
 * (Smithers, Lytton rest days gone), Whitehorse layover survived, endpoints
 * held. Run with: npx tsx --test src/lib/itinerary/plan-diff.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePlanDiff } from "./plan-diff";

const d = (date: string, miles: number, label: string) => ({ date, miles, label });

// The original 14-day plan (abridged labels, real shape).
const BEFORE = [
  d("2026-07-13", 332, "Dawson City, Yukon — Whitehorse, YT"),
  d("2026-07-14", 0, "Whitehorse, YT — Whitehorse, YT"),
  d("2026-07-15", 272, "Whitehorse, YT — Watson Lake, YT"),
  d("2026-07-16", 159, "Watson Lake, YT — Dease Lake, BC"),
  d("2026-07-17", 244, "Dease Lake, BC — Stewart, British Columbia"),
  d("2026-07-18", 56, "Stewart, British Columbia — Stewart, British Columbia"),
  d("2026-07-19", 204, "Stewart, British Columbia — Smithers, BC"),
  d("2026-07-20", 0, "Smithers, BC — Smithers, BC"),
  d("2026-07-21", 231, "Smithers, BC — Prince George, BC"),
  d("2026-07-22", 149, "Prince George, BC — Williams Lake, BC"),
  d("2026-07-23", 181, "Williams Lake, BC — Lytton, BC"),
  d("2026-07-24", 40, "Lytton, BC — Lytton, BC"),
  d("2026-07-25", 68, "Lytton, BC — Hope, BC"),
  d("2026-07-26", 93, "Hope, BC — Vancouver, British Columbia"),
];

// The re-planned 14 days (Stewart pinned to 7/19).
const AFTER = [
  d("2026-07-13", 332, "Dawson City, Yukon — Whitehorse, YT"),
  d("2026-07-14", 0, "Whitehorse, YT — Whitehorse, YT"),
  d("2026-07-15", 272, "Whitehorse, YT — Watson Lake, YT"),
  d("2026-07-16", 68, "Watson Lake, YT — Boya Lake Provincial Park"),
  d("2026-07-17", 176, "Boya Lake Provincial Park — Kinaskan Lake Provincial Park"),
  d("2026-07-18", 125, "Kinaskan Lake Provincial Park — Meziadin Lake Provincial Park"),
  d("2026-07-19", 38, "Meziadin Lake Provincial Park — Stewart, British Columbia"),
  d("2026-07-20", 90, "Stewart, British Columbia — Stewart, British Columbia"),
  d("2026-07-21", 204, "Stewart, British Columbia — Smithers, BC"),
  d("2026-07-22", 231, "Smithers, BC — Prince George, BC"),
  d("2026-07-23", 149, "Prince George, BC — Williams Lake, BC"),
  d("2026-07-24", 181, "Williams Lake, BC — Lytton, BC"),
  d("2026-07-25", 68, "Lytton, BC — Hope, BC"),
  d("2026-07-26", 93, "Hope, BC — Vancouver, British Columbia"),
];

test("Salmon Glacier re-plan diff: parks added, rest days traded, endpoints held", () => {
  const diff = computePlanDiff(BEFORE, AFTER, {
    place: "Stewart, British Columbia",
    date: "2026-07-19",
  });

  assert.deepEqual(diff.endpointsHeld, { start: true, end: true });
  // Whitehorse + Stewart out-and-back + Smithers + Lytton = 4 before;
  // Whitehorse + Stewart excursion = 2 after.
  assert.deepEqual(diff.layovers, { before: 4, after: 2 });
  assert.deepEqual(
    [...diff.stopsAdded].sort(),
    [
      "Boya Lake Provincial Park",
      "Kinaskan Lake Provincial Park",
      "Meziadin Lake Provincial Park",
    ],
  );
  assert.deepEqual(diff.stopsRemoved, ["Dease Lake, BC"]);
  assert.equal(diff.days.length, 14);
  // The pin is visible in the after-table: a Stewart arrival on 7/19.
  const pinnedDay = diff.days.find((day) => day.date === "2026-07-19");
  assert.ok(pinnedDay?.label.endsWith("Stewart, British Columbia"));
  // A multi-stop reshuffle: the 3 park adds + 1 remove are NOT collapsed into
  // a spurious rename (isolated-single fallback correctly stays inert).
  assert.deepEqual(diff.stopsRenamed, []);
});

const PIN = { place: "n/a", date: "2026-07-20" };

// A minimal 3-day skeleton so each rename/add/remove case is ISOLATED — only
// the one stop under test differs, everything else holds.
const base = [
  d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
  d("2026-07-19", 113, "Prince George, BC — Wells, BC"),
  d("2026-07-20", 224, "Wells, BC — Clinton, BC"),
];

test("rename: 'Boya Lake PP' → 'Tā Ch'ilā (Boya Lake) PP' reads as ONE rename, not remove+add", () => {
  const before = [d("2026-07-16", 68, "Watson Lake, YT — Boya Lake PP"), ...base];
  const after = [d("2026-07-16", 68, "Watson Lake, YT — Tā Ch'ilā (Boya Lake) PP"), ...base];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsAdded, []);
  assert.deepEqual(diff.stopsRemoved, []);
  assert.deepEqual(diff.stopsRenamed, [
    { from: "Boya Lake PP", to: "Tā Ch'ilā (Boya Lake) PP" },
  ]);
});

test("normalized variant: 'Boya Lake PP' → 'Boya Lake Provincial Park' is a rename, nothing dropped", () => {
  const before = [d("2026-07-16", 68, "Watson Lake, YT — Boya Lake PP"), ...base];
  const after = [d("2026-07-16", 68, "Watson Lake, YT — Boya Lake Provincial Park"), ...base];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsAdded, []);
  assert.deepEqual(diff.stopsRemoved, []);
  assert.deepEqual(diff.stopsRenamed, [
    { from: "Boya Lake PP", to: "Boya Lake Provincial Park" },
  ]);
});

test("corridor snap by coords: 'Wells, BC' → 'Barkerville' (~3mi) matches on geography", () => {
  // Both days carry the end coord via the corridor spine's `kind:"end"` node.
  const wells: [number, number] = [-121.5503, 53.0995];
  const barkerville: [number, number] = [-121.5108, 53.0686];
  const cc = (name: string, coords: [number, number]) => ({
    id: name.toLowerCase(), name, kind: "end" as const, coords, milesFromStart: 0, placeIds: [],
  });
  const before = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    { ...d("2026-07-19", 113, "Prince George, BC — Wells, BC"), corridorCities: [cc("Wells, BC", wells)] },
    d("2026-07-20", 224, "Wells, BC — Clinton, BC"),
  ];
  const after = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    { ...d("2026-07-19", 120, "Prince George, BC — Barkerville"), corridorCities: [cc("Barkerville", barkerville)] },
    d("2026-07-20", 224, "Barkerville — Clinton, BC"),
  ];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsAdded, []);
  assert.deepEqual(diff.stopsRemoved, []);
  assert.deepEqual(diff.stopsRenamed, [{ from: "Wells, BC", to: "Barkerville" }]);
});

test("corridor snap without coords: an isolated single swap still reads as a rename", () => {
  // No coords threaded (degraded/pre-bake day). The isolated-single fallback
  // catches the lone re-snap that label similarity can't (Wells ≁ Barkerville).
  const before = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 113, "Prince George, BC — Wells, BC"),
    d("2026-07-20", 224, "Wells, BC — Clinton, BC"),
  ];
  const after = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 120, "Prince George, BC — Barkerville"),
    d("2026-07-20", 224, "Barkerville — Clinton, BC"),
  ];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsRenamed, [{ from: "Wells, BC", to: "Barkerville" }]);
  assert.deepEqual(diff.stopsAdded, []);
  assert.deepEqual(diff.stopsRemoved, []);
});

test("true positive — a genuinely ADDED stop stays an add (not merged into a rename)", () => {
  const before = [...base];
  const after = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 113, "Prince George, BC — Wells, BC"),
    d("2026-07-20", 90, "Wells, BC — Quesnel, BC"), // NEW night inserted
    d("2026-07-21", 150, "Quesnel, BC — Clinton, BC"),
  ];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsAdded, ["Quesnel, BC"]);
  assert.deepEqual(diff.stopsRemoved, []);
  assert.deepEqual(diff.stopsRenamed, []);
});

test("true positive — a genuinely REMOVED stop stays a remove", () => {
  const before = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 113, "Prince George, BC — Wells, BC"),
    d("2026-07-20", 90, "Wells, BC — Quesnel, BC"),
    d("2026-07-21", 150, "Quesnel, BC — Clinton, BC"),
  ];
  const after = [...base];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsRemoved, ["Quesnel, BC"]);
  assert.deepEqual(diff.stopsAdded, []);
  assert.deepEqual(diff.stopsRenamed, []);
});

test("no over-merge — a residual 1v1 that coords prove is FAR APART stays add+remove", () => {
  // A confident rename (Boya, identical coords) reduces the residual to a single
  // before/after pair — but coords show Dease (58.44N) and Kinaskan (57.8N) are
  // ~55mi apart, so the isolated-single fallback must NOT fuse them.
  const boya: [number, number] = [-129.98, 59.32];
  const dease: [number, number] = [-130.02, 58.44];
  const kinaskan: [number, number] = [-129.98, 57.66];
  const cc = (name: string, coords: [number, number]) => [{
    id: name.toLowerCase(), name, kind: "end" as const, coords, milesFromStart: 0, placeIds: [],
  }];
  const before = [
    { ...d("2026-07-16", 68, "Watson Lake, YT — Boya Lake PP"), corridorCities: cc("Boya", boya) },
    { ...d("2026-07-17", 100, "Boya Lake PP — Dease Lake, BC"), corridorCities: cc("Dease", dease) },
  ];
  const after = [
    { ...d("2026-07-16", 68, "Watson Lake, YT — Tā Ch'ilā (Boya Lake) PP"), corridorCities: cc("Boya", boya) },
    { ...d("2026-07-17", 100, "Tā Ch'ilā (Boya Lake) PP — Kinaskan Lake PP"), corridorCities: cc("Kinaskan", kinaskan) },
  ];
  const diff = computePlanDiff(before, after, PIN);
  assert.deepEqual(diff.stopsRenamed, [{ from: "Boya Lake PP", to: "Tā Ch'ilā (Boya Lake) PP" }]);
  assert.deepEqual(diff.stopsRemoved, ["Dease Lake, BC"]);
  assert.deepEqual(diff.stopsAdded, ["Kinaskan Lake PP"]);
});

test("no over-merge — two distinct swaps stay add+remove, not two renames", () => {
  const before = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 100, "Prince George, BC — Quesnel, BC"),
    d("2026-07-20", 120, "Quesnel, BC — Cache Creek, BC"),
    d("2026-07-21", 90, "Cache Creek, BC — Hope, BC"),
  ];
  const after = [
    d("2026-07-18", 200, "Smithers, BC — Prince George, BC"),
    d("2026-07-19", 110, "Prince George, BC — Williams Lake, BC"),
    d("2026-07-20", 130, "Williams Lake, BC — Lytton, BC"),
    d("2026-07-21", 95, "Lytton, BC — Hope, BC"),
  ];
  const diff = computePlanDiff(before, after, PIN);
  // Two genuine changes on each side → NOT collapsed (isolated-single needs 1v1).
  assert.deepEqual(diff.stopsRenamed, []);
  assert.deepEqual([...diff.stopsRemoved].sort(), ["Cache Creek, BC", "Quesnel, BC"]);
  assert.deepEqual([...diff.stopsAdded].sort(), ["Lytton, BC", "Williams Lake, BC"]);
});
