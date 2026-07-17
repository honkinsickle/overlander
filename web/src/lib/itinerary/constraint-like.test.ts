/**
 * Locks the offer heuristic's core asymmetry: constraint phrases fire, place
 * names with constraint-y words in them do NOT. If the negatives here start
 * firing, the suggestion row becomes noise on ordinary place searches.
 * Run with: npx tsx --test src/lib/itinerary/constraint-like.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isConstraintLike } from "./constraint-like";

test("true positives — plan constraints (arrive-by / stay shape)", () => {
  const positives = [
    "arrive at Salmon Glacier on the 19th",
    "arrive in Stewart by the 19th",
    "add a day in Whitehorse",
    "stay an extra day in Whitehorse",
    "stay 2 nights in Smithers",
    "be at Salmon Glacier on July 19",
    "get to Vancouver by 7/26",
    "leave Dawson on the 14th",
    "skip Lytton, add a night in Hope",
    "arrive at Salmon Glacier 2026-07-19",
  ];
  for (const q of positives) {
    assert.equal(isConstraintLike(q), true, `should fire: "${q}"`);
  }
});

test("true positives — add-stop shape (verb + place, NO date)", () => {
  const positives = [
    "add Barkerville", // the headline case
    "add Liard Hot Springs",
    "visit Jasper",
    "stop at Meziadin Lake",
    "detour to Salmon Glacier",
    "swing by Tombstone",
  ];
  for (const q of positives) {
    assert.equal(isConstraintLike(q), true, `should fire: "${q}"`);
  }
});

test("true negatives — place searches, incl. constraint-verb place names", () => {
  const negatives = [
    "Stay Inn Motel Dease Lake", // "stay" verb but no date, not an add-lead
    "gas near Dease Lake", // no verb
    "campgrounds",
    "Salmon Glacier", // bare place
    "2 day hike near Stewart", // duration, no verb
    "coffee", // neither
    "Addison Coffee Roasters", // begins with "add" letters but not the WORD
    "additive-free snacks", // ditto — word boundary matters
    "", // empty
    "   ", // whitespace
  ];
  for (const q of negatives) {
    assert.equal(isConstraintLike(q), false, `should NOT fire: "${q}"`);
  }
});
