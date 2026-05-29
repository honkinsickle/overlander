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
const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));

vi.mock("../ingestion/lib/db.ts", () => ({
  getDb: () => ({ rpc: mockRpc }),
}));

import { findCandidates, paginateLinkedSourceRecords } from "./matcher.ts";

type Row = { master_place_id: string | null; source_id: string };

describe("findCandidates — skipRpcs=false path (populated master_place)", () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it("invokes find_master_place_candidates with the standard radius + null filter", async () => {
    mockRpc.mockResolvedValue({
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
    mockRpc.mockResolvedValue({ data: [], error: null });
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
    mockRpc.mockResolvedValue({
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
