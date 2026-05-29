/**
 * Unit tests for the matchAll profiler.
 *
 * Pure I/O — no DB. Exercises the env gating, sampling decision,
 * and JSONL write behavior in isolation from the matcher.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  finalizeProfiler,
  finishSample,
  initProfiler,
  isProfilerEnabled,
  recordPlannedTiming,
  recordRpc,
  recordScoring,
  recordSearchPlanned,
  recordTrack,
  startSample,
} from "./profiler.ts";

let tmpDir: string;
let tracePath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "profiler-test-"));
  tracePath = join(tmpDir, "trace.jsonl");
  process.env.MATCHALL_PROFILE_PATH = tracePath;
});

afterEach(() => {
  delete process.env.MATCHALL_PROFILE;
  delete process.env.MATCHALL_PROFILE_PATH;
  delete process.env.MATCHALL_PROFILE_SAMPLE;
  rmSync(tmpDir, { recursive: true, force: true });
});

function readLines(): unknown[] {
  if (!existsSync(tracePath)) return [];
  const raw = readFileSync(tracePath, "utf8");
  if (raw.length === 0) return [];
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

describe("profiler — disabled (no MATCHALL_PROFILE env)", () => {
  it("isProfilerEnabled is false; all record* are no-ops", () => {
    initProfiler();
    expect(isProfilerEnabled()).toBe(false);
    startSample("sr-1", "nps", "campground", 0, 0);
    recordRpc("standard", 12, 3);
    recordSearchPlanned(2, 5);
    recordScoring(1);
    recordTrack(0.1);
    recordPlannedTiming(0.1);
    finishSample("auto_link", 42);
    finalizeProfiler();
    expect(existsSync(tracePath)).toBe(false);
  });
});

describe("profiler — enabled", () => {
  beforeEach(() => {
    process.env.MATCHALL_PROFILE = "true";
    process.env.MATCHALL_PROFILE_SAMPLE = "2"; // sample 0,2,4,...
  });

  it("isProfilerEnabled true, trace file created and truncated on init", () => {
    initProfiler();
    expect(isProfilerEnabled()).toBe(true);
    expect(existsSync(tracePath)).toBe(true);
    expect(readFileSync(tracePath, "utf8")).toBe("");
  });

  it("samples records whose index % N === 0; skips others", () => {
    initProfiler();
    for (let i = 0; i < 5; i++) {
      startSample(`sr-${i}`, "nps", "campground", i, i * 10);
      recordRpc("standard", 100, 0);
      finishSample("new_master_place", 110);
    }
    const lines = readLines() as Array<{ record_index: number }>;
    expect(lines.map((l) => l.record_index)).toEqual([0, 2, 4]);
  });

  it("aggregates per-sample timings across multiple substep recordings", () => {
    initProfiler();
    startSample("sr-0", "nps", "campground", 0, 50);
    recordRpc("fed_exact", 30, 1);
    recordRpc("standard", 80, 0);
    recordSearchPlanned(2, 5);
    recordSearchPlanned(3, 7);
    recordScoring(1.5);
    recordTrack(0.05);
    recordPlannedTiming(0.04);
    finishSample("auto_link", 117);
    const [sample] = readLines() as Array<{
      source_id: string;
      record_index: number;
      planned_size_at_start: number;
      rpc_fed_exact_ms: number;
      rpc_fed_exact_db_count: number;
      rpc_standard_ms: number;
      rpc_amenity_ms: number | null;
      search_planned_total_ms: number;
      search_planned_total_candidates: number;
      search_planned_calls: number;
      scoring_ms: number;
      track_outcome_link_ms: number;
      record_planned_ms: number;
      outcome_kind: string;
      total_ms: number;
    }>;
    expect(sample.source_id).toBe("nps");
    expect(sample.planned_size_at_start).toBe(50);
    expect(sample.rpc_fed_exact_ms).toBe(30);
    expect(sample.rpc_fed_exact_db_count).toBe(1);
    expect(sample.rpc_standard_ms).toBe(80);
    expect(sample.rpc_amenity_ms).toBeNull();
    expect(sample.search_planned_total_ms).toBe(5);
    expect(sample.search_planned_total_candidates).toBe(12);
    expect(sample.search_planned_calls).toBe(2);
    expect(sample.scoring_ms).toBe(1.5);
    expect(sample.track_outcome_link_ms).toBeCloseTo(0.05, 5);
    expect(sample.record_planned_ms).toBeCloseTo(0.04, 5);
    expect(sample.outcome_kind).toBe("auto_link");
    expect(sample.total_ms).toBe(117);
  });

  it("invalid MATCHALL_PROFILE_SAMPLE falls back to default 50", () => {
    process.env.MATCHALL_PROFILE_SAMPLE = "not-a-number";
    initProfiler();
    // With default 50, only index 0 of 5 should sample.
    for (let i = 0; i < 5; i++) {
      startSample(`sr-${i}`, "nps", null, i, 0);
      finishSample("auto_link", 1);
    }
    const lines = readLines();
    expect(lines).toHaveLength(1);
  });

  it("initProfiler truncates prior trace contents", () => {
    initProfiler();
    startSample("sr-0", "nps", null, 0, 0);
    finishSample("auto_link", 1);
    expect(readLines()).toHaveLength(1);
    initProfiler();
    expect(readFileSync(tracePath, "utf8")).toBe("");
  });
});
