import { test } from "node:test";
import assert from "node:assert/strict";

import { SYSTEM_PROMPT, buildFactsMessage } from "./master-prompt";
import { GUARANTEE_CATEGORIES } from "./anchor-backfill";
import type { EngineFacts, GenerationInput } from "./facts";

// PR #287 blocker H: the guarantee is enforced post-generation by the audit's
// backfill, but until now it never reached the model at all — buildFactsMessage
// builds an explicit payload, so a field absent from that object is invisible to
// the LLM no matter what GenerationInput carries. These tests lock the field
// into the payload and lock the filter that keeps prompt and mechanism agreeing.

const FACTS = {
  anchorsResolved: [],
  route: { distanceMi: 500, geometry: null },
  corridorCities: [
    { id: "c1", name: "Bakersfield", kind: "corridor", milesFromStart: 110.4 },
  ],
  poolPOIs: [],
} as unknown as EngineFacts;

function payloadFor(guaranteedCategories?: string[]): Record<string, unknown> {
  const input = {
    anchors: [],
    params: { startDate: "2026-10-01", endDate: "2026-10-05" },
    rig: { build: [], preferences: [] },
    guaranteedCategories,
  } as unknown as GenerationInput;
  const msg = buildFactsMessage(input, FACTS);
  return JSON.parse(msg.slice(msg.indexOf("```json") + 7, msg.lastIndexOf("```")));
}

test("selected pool-side categories reach the payload the model sees", () => {
  assert.deepEqual(payloadFor(["scenic", "food"]).guaranteedCategories, ["scenic", "food"]);
});

test("fuel and overnight are filtered out — they are not pool-side guarantees", () => {
  // fuel is inserted by fuel-live-resolve, overnight owns a dedicated slot.
  // Naming either would invite the model to produce a second one.
  assert.deepEqual(payloadFor(["scenic", "fuel", "overnight"]).guaranteedCategories, ["scenic"]);
});

test("the payload filter is exactly the audit's GUARANTEE_CATEGORIES gate", () => {
  const all = [...GUARANTEE_CATEGORIES];
  assert.deepEqual(payloadFor(all).guaranteedCategories, all);
});

test("no selection omits the key entirely rather than sending an empty array", () => {
  assert.equal("guaranteedCategories" in payloadFor([]), false);
  assert.equal("guaranteedCategories" in payloadFor(undefined), false);
});

test("it sits alongside corridorCities, not inside rig (spec §4.2)", () => {
  const p = payloadFor(["scenic"]);
  assert.ok("guaranteedCategories" in p, "must be a top-level trip fact");
  assert.equal(
    "guaranteedCategories" in (p.rig as Record<string, unknown>),
    false,
    "must not be tucked inside rig",
  );
});

test("SYSTEM_PROMPT states the preference posture, not a quota", () => {
  assert.match(SYSTEM_PROMPT, /guaranteedCategories/);
  assert.match(SYSTEM_PROMPT, /preference, NOT a quota/);
});
