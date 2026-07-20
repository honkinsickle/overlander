/**
 * Locks the living-plan provenance helpers (pure, no DB). Covers the three
 * 2026-07-18-diagnosis fixes: signature summaries (apply provenance), the
 * full-ISO version stamp (no UTC off-by-a-day), and the pending-overwrite
 * clash decision. Run: npx tsx --test src/lib/itinerary/edit-provenance.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeSignature,
  versionStamp,
  buildAppliedProvenance,
  pendingClash,
} from "./edit-provenance";

// ── summarizeSignature ─────────────────────────────────────────────
test("summarizeSignature: every edit kind → readable prose", () => {
  assert.equal(
    summarizeSignature("change-end|2026-07-28|full"),
    "Change trip end to 2026-07-28",
  );
  assert.equal(
    summarizeSignature("reschedule|Smithers, BC|2026-07-20|full"),
    "Reschedule Smithers, BC to 2026-07-20",
  );
  assert.equal(
    summarizeSignature("skip|Barkerville|full"),
    "Skip Barkerville",
  );
  assert.equal(
    summarizeSignature("stay-longer|Stewart, BC|2|full"),
    "Stay 2 nights longer at Stewart, BC",
  );
  assert.equal(
    summarizeSignature("arrive-by|Vancouver, BC|2026-07-29|full"),
    "Arrive at Vancouver, BC by 2026-07-29",
  );
  assert.equal(
    summarizeSignature("add-stop|Hyder, AK|add-days|full"),
    "Add Hyder, AK (+1 day)",
  );
  assert.equal(
    summarizeSignature("add-stop|Hyder, AK|adjust|full"),
    "Add Hyder, AK (keeping your dates)",
  );
});

test("summarizeSignature: singular night, and partial scope suffix", () => {
  assert.equal(
    summarizeSignature("stay-longer|Stewart, BC|1|full"),
    "Stay 1 night longer at Stewart, BC",
  );
  assert.equal(
    summarizeSignature("change-end|2026-07-28|partial"),
    "Change trip end to 2026-07-28 (from where you are)",
  );
});

test("summarizeSignature: unknown kind echoes the raw signature (never fabricates)", () => {
  assert.equal(summarizeSignature("teleport|Mars|full"), "teleport|Mars|full");
});

// ── versionStamp (the UTC off-by-a-day fix) ────────────────────────
test("versionStamp: carries the full instant, not a truncated date", () => {
  // 04:57 UTC on 7/19 is 21:57 PDT on 7/18 — the exact instant that a
  // date-truncated stamp mislabeled as the 19th.
  const at = new Date("2026-07-19T04:57:16.989Z");
  const stamp = versionStamp("applied", at);
  assert.equal(stamp, "livingplan-applied@2026-07-19T04:57:16.989Z");
  // It must NOT be the truncated form that caused the confusion.
  assert.notEqual(stamp, "livingplan-applied@2026-07-19");
  // And it must round-trip back to the same instant.
  const iso = stamp.split("@")[1];
  assert.equal(new Date(iso).getTime(), at.getTime());
});

test("versionStamp: pending and applied kinds", () => {
  const at = new Date("2026-07-18T12:00:00.000Z");
  assert.equal(versionStamp("pending", at), "livingplan-pending@2026-07-18T12:00:00.000Z");
  assert.equal(versionStamp("applied", at), "livingplan-applied@2026-07-18T12:00:00.000Z");
});

// ── buildAppliedProvenance ─────────────────────────────────────────
test("buildAppliedProvenance: prefers the staged summary, else derives it", () => {
  const at = new Date("2026-07-18T21:57:00.000Z");
  const withSummary = buildAppliedProvenance("skip|Barkerville|full", "Skip Barkerville", at);
  assert.deepEqual(withSummary, {
    signature: "skip|Barkerville|full",
    summary: "Skip Barkerville",
    appliedAt: "2026-07-18T21:57:00.000Z",
  });
  // Missing staged summary → derived from the signature.
  const derived = buildAppliedProvenance("change-end|2026-07-28|full", undefined, at);
  assert.equal(derived.summary, "Change trip end to 2026-07-28");
  assert.equal(derived.appliedAt, "2026-07-18T21:57:00.000Z");
});

// ── pendingClash (the silent-overwrite fix) ────────────────────────
test("pendingClash: nothing staged → never blocks", () => {
  assert.deepEqual(pendingClash(null, "skip|X|full", false), { blocked: false });
});

test("pendingClash: identical signature → benign re-stage, no block", () => {
  const existing = { signature: "skip|X|full", summary: "Skip X" };
  assert.deepEqual(pendingClash(existing, "skip|X|full", false), { blocked: false });
});

test("pendingClash: DIFFERENT signature, not confirmed → blocks with existing", () => {
  const existing = { signature: "change-end|2026-07-28|full", summary: "Change trip end to 2026-07-28" };
  const r = pendingClash(existing, "skip|Barkerville|full", false);
  assert.deepEqual(r, { blocked: true, existing });
});

test("pendingClash: different signature but replace confirmed → proceeds", () => {
  const existing = { signature: "change-end|2026-07-28|full", summary: "Change trip end to 2026-07-28" };
  assert.deepEqual(pendingClash(existing, "skip|Barkerville|full", true), { blocked: false });
});
