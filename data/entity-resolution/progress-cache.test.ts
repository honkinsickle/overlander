/**
 * Unit tests for progress-cache: file I/O + fingerprint gating.
 *
 * Pure-module tests — no DB. The caller (matcher.matchAll) is what
 * supplies the corpus fingerprint at runtime; we drive it directly
 * here to exercise the save / load / fingerprint-mismatch paths
 * without spinning up Supabase.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clearProgress, loadProgress, saveProgress } from "./progress-cache.ts";
import type { CorpusFingerprint } from "./outcome-cache.ts";
import type { MatchOutcome } from "./matcher.ts";

const fpA: CorpusFingerprint = {
  source_record_count: 100,
  source_record_max_updated_at: "2026-05-28T00:00:00Z",
};

const fpB: CorpusFingerprint = {
  source_record_count: 101,
  source_record_max_updated_at: "2026-05-28T00:00:00Z",
};

const sampleOutcomes: MatchOutcome[] = [
  {
    kind: "new_master_place",
    source_record_id: "src-1",
    target: "mp-1",
    seed_category: "campground",
    seed_geometry: [-116.0, 34.0],
    seed_name: "Test CG",
  },
  {
    kind: "auto_link",
    source_record_id: "src-2",
    target: "mp-1",
    confidence: 0.92,
    method: "fed_exact",
    score: null,
  },
];

let tmpDir: string;
let progressPath: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "progress-cache-test-"));
  progressPath = join(tmpDir, "progress.json");
  process.env.MATCHALL_PROGRESS_CACHE_PATH = progressPath;
});

afterEach(() => {
  delete process.env.MATCHALL_PROGRESS_CACHE_PATH;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("progress-cache", () => {
  it("save → load round-trip preserves outcomes when fingerprint matches", () => {
    saveProgress(sampleOutcomes, fpA);
    expect(loadProgress(fpA)).toEqual(sampleOutcomes);
  });

  it("load returns null when fingerprint mismatches", () => {
    saveProgress(sampleOutcomes, fpA);
    expect(loadProgress(fpB)).toBeNull();
  });

  it("load returns null when no file exists", () => {
    expect(loadProgress(fpA)).toBeNull();
  });

  it("load returns null when the file is corrupted", () => {
    writeFileSync(progressPath, "{ not valid json");
    expect(loadProgress(fpA)).toBeNull();
  });

  it("save leaves no .tmp residue after a successful write", () => {
    saveProgress(sampleOutcomes, fpA);
    expect(existsSync(progressPath)).toBe(true);
    expect(existsSync(`${progressPath}.tmp`)).toBe(false);
  });

  it("save overwrites a prior checkpoint", () => {
    saveProgress(sampleOutcomes.slice(0, 1), fpA);
    saveProgress(sampleOutcomes, fpA);
    expect(loadProgress(fpA)).toEqual(sampleOutcomes);
  });

  it("clearProgress removes the file", () => {
    saveProgress(sampleOutcomes, fpA);
    clearProgress();
    expect(existsSync(progressPath)).toBe(false);
  });

  it("clearProgress is a no-op when the file is absent", () => {
    expect(() => clearProgress()).not.toThrow();
  });
});
