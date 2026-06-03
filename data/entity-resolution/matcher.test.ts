/**
 * Unit tests for matcher.ts module helpers — exported for testability.
 *
 * The full-algorithm integration suite lives in phase3a.test.ts (D4)
 * and runs against the destructive test project. This file holds pure
 * unit tests with no DB dependency.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB module so we can verify findCandidates' RPC invocation
// without hitting Supabase. Hoisted-vi pattern is required because the
// factory passed to vi.mock runs before the rest of the file's imports.
const { mockRpc, mockFrom } = vi.hoisted(() => ({ mockRpc: vi.fn(), mockFrom: vi.fn() }));

vi.mock("../ingestion/lib/db.ts", () => ({
  getDb: () => ({ rpc: mockRpc, from: mockFrom }),
}));

import {
  circuitBreakerNext,
  type CircuitBreakerEvent,
  fetchUnresolvedByIds,
  findCandidates,
  ID_FETCH_CHUNK,
  lookupCompatibility,
  MatchAllCircuitBreakerError,
  paginateLinkedSourceRecords,
} from "./matcher.ts";

describe("lookupCompatibility — dispersed_camping (Phase 2)", () => {
  it("matches itself at 1.0 (USFS dispersed ↔ OSM backcountry)", () => {
    expect(lookupCompatibility("dispersed_camping", "dispersed_camping")).toBe(1.0);
  });
  it("is weakly compatible with campground (0.3), symmetric, below the 0.8 name_dominant floor", () => {
    expect(lookupCompatibility("dispersed_camping", "campground")).toBe(0.3);
    expect(lookupCompatibility("campground", "dispersed_camping")).toBe(0.3); // symmetric fallback
    expect(lookupCompatibility("dispersed_camping", "campground")).toBeLessThan(0.8);
  });
  it("is weakly compatible with recreation_area (0.3), symmetric", () => {
    expect(lookupCompatibility("dispersed_camping", "recreation_area")).toBe(0.3);
    expect(lookupCompatibility("recreation_area", "dispersed_camping")).toBe(0.3);
  });
  it("is incompatible (0) with unrelated categories", () => {
    expect(lookupCompatibility("dispersed_camping", "peak")).toBe(0);
    expect(lookupCompatibility("dispersed_camping", "gas_station")).toBe(0);
  });
});

type Row = { master_place_id: string | null; source_id: string };

// findCandidates now calls `db.rpc(...).abortSignal(signal)` (wrapped in
// withRetry). Make `rpc` return a builder whose `.abortSignal()` resolves to
// the desired { data, error }.
const rpcResolves = (value: unknown) =>
  mockRpc.mockReturnValue({ abortSignal: () => Promise.resolve(value) });

describe("findCandidates — skipRpcs=false path (populated master_place)", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("invokes find_master_place_candidates with the standard radius + null filter", async () => {
    rpcResolves({
      data: [
        {
          id: "mp-1",
          canonical_name: "Test Campground",
          primary_category: "campground",
          distance_m: 50,
        },
      ],
      error: null,
    });
    // skipRpcs defaults to false at module init (the rematerialize-mode flag
    // is set only when matchAll() explicitly detects an empty master_place).
    // Calling findCandidates directly exercises the populated-master_place
    // path that the D4 fixture can't reach.
    const result = await findCandidates("sr-test-1", 500);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("find_master_place_candidates", {
      p_source_record_id: "sr-test-1",
      p_radius_meters: 500,
      p_category_filter: null,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "mp-1",
      canonical_name: "Test Campground",
    });
  });

  it("passes radius + category filter through to the RPC", async () => {
    rpcResolves({ data: [], error: null });
    await findCandidates("sr-test-2", 100, [
      "campground",
      "recreation_area",
      "facility",
      "lodging",
    ]);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("find_master_place_candidates", {
      p_source_record_id: "sr-test-2",
      p_radius_meters: 100,
      p_category_filter: ["campground", "recreation_area", "facility", "lodging"],
    });
  });

  it("propagates RPC errors", async () => {
    rpcResolves({
      data: null,
      error: { message: "boom" },
    });
    await expect(findCandidates("sr-test-3")).rejects.toMatchObject({
      message: "boom",
    });
  });
});

describe("paginateLinkedSourceRecords", () => {
  it("paginates beyond a single 1000-row page", async () => {
    // 2,500 rows × 3 distinct mp_ids × 4 distinct source_ids cycling
    const rows: Row[] = Array.from({ length: 2_500 }, (_, i) => ({
      master_place_id: `mp-${i % 3}`,
      source_id: (["nps", "ridb", "google", "osm"] as const)[i % 4]!,
    }));
    let rowsServed = 0;
    let calls = 0;
    const fetchPage = async (offset: number, limit: number) => {
      calls += 1;
      const slice = rows.slice(offset, offset + limit);
      rowsServed += slice.length;
      return slice;
    };
    const result = await paginateLinkedSourceRecords(fetchPage);
    expect(rowsServed).toBe(2_500);
    expect(calls).toBe(3); // pages: [0..1000), [1000..2000), [2000..2500)
    expect(result.size).toBe(3);
    for (const set of result.values()) {
      // Each mp_id cycle covers all 4 source_ids within the 2500-row stream.
      expect(set.size).toBe(4);
      expect([...set].sort()).toEqual(["google", "nps", "osm", "ridb"]);
    }
  });

  it("breaks correctly when total rows are an exact multiple of PAGE", async () => {
    // 1,000 rows then an empty second page.
    const rows: Row[] = Array.from({ length: 1_000 }, (_, i) => ({
      master_place_id: `mp-${i}`,
      source_id: "nps",
    }));
    let calls = 0;
    const fetchPage = async (offset: number, limit: number) => {
      calls += 1;
      return rows.slice(offset, offset + limit);
    };
    const result = await paginateLinkedSourceRecords(fetchPage);
    expect(calls).toBe(2); // first 1000, then 0 → break
    expect(result.size).toBe(1_000);
  });

  it("handles an empty source set without crashing", async () => {
    const fetchPage = async () => [] as Row[];
    const result = await paginateLinkedSourceRecords(fetchPage);
    expect(result.size).toBe(0);
  });

  it("ignores rows with null master_place_id", async () => {
    const rows: Row[] = [
      { master_place_id: "mp-1", source_id: "nps" },
      { master_place_id: null, source_id: "ridb" },
      { master_place_id: "mp-1", source_id: "google" },
      { master_place_id: null, source_id: "osm" },
    ];
    const fetchPage = async (offset: number, limit: number) =>
      rows.slice(offset, offset + limit);
    const result = await paginateLinkedSourceRecords(fetchPage);
    expect(result.size).toBe(1);
    expect([...result.get("mp-1")!].sort()).toEqual(["google", "nps"]);
  });

  it("dedupes (mp, source) pairs across pages", async () => {
    const rows: Row[] = [
      { master_place_id: "mp-1", source_id: "nps" },
      { master_place_id: "mp-1", source_id: "nps" }, // dup within same page
      { master_place_id: "mp-1", source_id: "ridb" },
    ];
    const fetchPage = async (offset: number, limit: number) =>
      rows.slice(offset, offset + limit);
    const result = await paginateLinkedSourceRecords(fetchPage);
    expect(result.get("mp-1")!.size).toBe(2);
  });
});

describe("fetchUnresolvedByIds — ID-list chunking + ordering", () => {
  // Factory for a row of the shape the helper fetches (SourceRecordRow plus
  // the source_quality_score the in-app sort needs). padded external_id keeps
  // lexicographic order intuitive.
  const mkRow = (id: string, quality: number, externalId: string) => ({
    id,
    source_id: "test",
    external_id: externalId,
    name: id,
    inferred_category: "campground" as string | null,
    master_place_id: null as string | null,
    geometry: "POINT(0 0)" as string,
    source_quality_score: quality,
  });

  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("chunks a >ID_FETCH_CHUNK id list into ID_FETCH_CHUNK-sized batches (450 → [200,200,50])", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `id-${i}`);
    const chunkSizes: number[] = [];
    const rows = await fetchUnresolvedByIds(ids, async (chunk) => {
      chunkSizes.push(chunk.length);
      return chunk.map((id, j) => mkRow(id, 0.5, `ext-${String(j).padStart(4, "0")}`));
    });
    expect(chunkSizes).toEqual([ID_FETCH_CHUNK, ID_FETCH_CHUNK, 50]);
    expect(rows).toHaveLength(450);
  });

  it("reconstructs global (quality DESC, external_id ASC) order across chunks", async () => {
    // 250 ids → chunks [200, 50]. Chunk-2 rows (globalIdx >= 200) get the
    // HIGHER quality, so a correct GLOBAL sort must pull them ahead of chunk-1
    // rows — proving the order isn't merely per-chunk.
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const rows = await fetchUnresolvedByIds(ids, async (chunk) =>
      chunk.map((id) => {
        const g = Number(id.slice(3));
        return mkRow(id, g >= 200 ? 0.9 : 0.5, `ext-${String(g).padStart(4, "0")}`);
      }),
    );
    const exts = rows.map((r) => r.external_id);
    const expected = [
      // chunk-2 (quality 0.9): ext-0200..ext-0249 ascending
      ...Array.from({ length: 50 }, (_, i) => `ext-${String(200 + i).padStart(4, "0")}`),
      // chunk-1 (quality 0.5): ext-0000..ext-0199 ascending
      ...Array.from({ length: 200 }, (_, i) => `ext-${String(i).padStart(4, "0")}`),
    ];
    expect(exts).toEqual(expected);
  });

  it("fetches a small id list (≤ chunk size) in a single call — phase3a 2-id path unchanged", async () => {
    let calls = 0;
    const rows = await fetchUnresolvedByIds(["x", "y"], async (chunk) => {
      calls += 1;
      return chunk.map((id, j) => mkRow(id, 0.9, `ext-${j}`));
    });
    expect(calls).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(["x", "y"]);
  });

  it("returns [] without any fetch for an empty id list", async () => {
    let calls = 0;
    const rows = await fetchUnresolvedByIds([], async () => {
      calls += 1;
      return [];
    });
    expect(calls).toBe(0);
    expect(rows).toEqual([]);
  });

  it("default fetch applies the master_place_id IS NULL filter per chunk", async () => {
    const inCalls: string[][] = [];
    const isCalls: Array<[string, unknown]> = [];
    mockFrom.mockImplementation(() => {
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = (_col: string, vals: string[]) => {
        inCalls.push(vals);
        return builder;
      };
      builder.is = (col: string, val: unknown) => {
        isCalls.push([col, val]);
        return Promise.resolve({ data: [], error: null });
      };
      return builder;
    });
    const ids = Array.from({ length: ID_FETCH_CHUNK + 5 }, (_, i) => `id-${i}`);
    await fetchUnresolvedByIds(ids); // default Supabase-backed fetch
    expect(mockFrom).toHaveBeenCalledTimes(2); // 205 ids → 2 chunks
    expect(inCalls.map((c) => c.length)).toEqual([ID_FETCH_CHUNK, 5]);
    expect(isCalls).toEqual([
      ["master_place_id", null],
      ["master_place_id", null],
    ]);
  });
});

describe("matchAll circuit breaker — consecutive-failure semantics (K=15)", () => {
  const K = 15;

  // Fold an event stream through the pure transition, mirroring how matchAll
  // calls circuitBreakerNext per record.
  function fold(events: CircuitBreakerEvent[]): {
    consecutive: number;
    tripped: boolean;
    tripIndex: number;
  } {
    let consecutive = 0;
    let tripped = false;
    let tripIndex = -1;
    events.forEach((event, i) => {
      const step = circuitBreakerNext(consecutive, event);
      consecutive = step.consecutive;
      if (step.trip && !tripped) {
        tripped = true;
        tripIndex = i;
      }
    });
    return { consecutive, tripped, tripIndex };
  }

  const fail = (n: number): CircuitBreakerEvent[] => Array.from({ length: n }, () => "retry_exhausted");

  it("K-1 failures then a success → counter resets, no trip", () => {
    const res = fold([...fail(K - 1), "success"]);
    expect(res.tripped).toBe(false);
    expect(res.consecutive).toBe(0);
  });

  it("K consecutive failures → trips exactly at the Kth", () => {
    const res = fold(fail(K));
    expect(res.tripped).toBe(true);
    expect(res.tripIndex).toBe(K - 1); // zero-based: the 15th event
  });

  it("constructs MatchAllCircuitBreakerError with the correct diagnostics", () => {
    const lastRpcError = { message: "fetch failed", details: "ENOTFOUND" };
    const err = new MatchAllCircuitBreakerError({
      consecutiveFailures: K,
      lastRpcError,
      lastRecordId: "rec-123",
      totalProcessed: 412,
      totalRecords: 3086,
    });
    expect(err).toBeInstanceOf(MatchAllCircuitBreakerError);
    expect(err.name).toBe("MatchAllCircuitBreakerError");
    expect(err.diagnostics).toMatchObject({
      consecutiveFailures: K,
      lastRecordId: "rec-123",
      totalProcessed: 412,
      totalRecords: 3086,
      lastRpcError,
    });
    expect(err.message).toContain("412/3086");
  });

  it("mixed 5-fail, 1-success, 10-fail → success resets the streak, no abort", () => {
    const res = fold([...fail(5), "success", ...fail(10)]);
    expect(res.tripped).toBe(false);
    expect(res.consecutive).toBe(10); // streak restarted after the success
  });

  it("a permanent (other_error) does not increment or reset the streak", () => {
    // 14 transient exhaustions, then a permanent error, then one more transient
    // → 14 + (unchanged) + 1 = 15 → trips. (other_error leaves the streak.)
    const res = fold([...fail(14), "other_error", "retry_exhausted"]);
    expect(res.tripped).toBe(true);
  });

  it("an all-success run never increments the counter", () => {
    const res = fold(Array.from({ length: 100 }, () => "success"));
    expect(res.tripped).toBe(false);
    expect(res.consecutive).toBe(0);
  });
});
