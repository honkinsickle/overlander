/**
 * Unit tests for chunk() and batchUpsert() — the batched, fail-loud write
 * path. A fake Supabase client is injected (no DB, no network); the retry
 * wrapper is a no-op passthrough so the fail-loud throw is fast.
 */

import { describe, expect, it } from "vitest";

import { batchUpsert, chunk } from "./db.ts";

const noRetry = async <T>(fn: () => Promise<T>): Promise<T> => fn();

interface UpsertCall {
  table: string;
  rows: unknown[];
  onConflict: string | undefined;
}

/** Fake client recording every .from(table).upsert(rows, {onConflict}) call. */
function fakeDb(opts: { failOnBatch?: number } = {}) {
  const calls: UpsertCall[] = [];
  let batchIndex = 0;
  const db = {
    from(table: string) {
      return {
        upsert(rows: unknown[], up: { onConflict?: string }) {
          batchIndex += 1;
          calls.push({ table, rows, onConflict: up?.onConflict });
          const fail = opts.failOnBatch === batchIndex;
          return Promise.resolve({
            error: fail ? { message: "simulated batch failure" } : null,
          });
        },
      };
    },
  };
  return { db, calls };
}

describe("chunk", () => {
  it("splits into fixed-size chunks with a remainder", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it("returns one chunk when size >= length", () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]]);
  });
  it("returns [] for empty input", () => {
    expect(chunk([], 3)).toEqual([]);
  });
  it("throws on non-positive size", () => {
    expect(() => chunk([1], 0)).toThrow(/size/);
  });
});

describe("batchUpsert", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: i }));

  it("chunks correctly and passes the conflict key; returns written count", async () => {
    const { db, calls } = fakeDb();
    const res = await batchUpsert({
      table: "mvum_roads",
      rows,
      onConflict: "rte_cn",
      chunkSize: 2,
      label: "test",
      retry: noRetry,
      db: db as never,
    });
    expect(res).toEqual({ written: 5, chunks: 3 });
    expect(calls.map((c) => c.rows.length)).toEqual([2, 2, 1]); // chunk sizes
    expect(calls.every((c) => c.table === "mvum_roads")).toBe(true);
    expect(calls.every((c) => c.onConflict === "rte_cn")).toBe(true);
  });

  it("is a no-op for empty input (no calls)", async () => {
    const { db, calls } = fakeDb();
    const res = await batchUpsert({
      table: "source_record",
      rows: [],
      onConflict: "source_id,external_id",
      label: "test",
      retry: noRetry,
      db: db as never,
    });
    expect(res).toEqual({ written: 0, chunks: 0 });
    expect(calls).toHaveLength(0);
  });

  it("FAIL-LOUD: throws (does not silently continue) when a batch ultimately fails", async () => {
    const { db, calls } = fakeDb({ failOnBatch: 2 }); // 2nd chunk fails
    await expect(
      batchUpsert({
        table: "mvum_roads",
        rows,
        onConflict: "rte_cn",
        chunkSize: 2,
        label: "test",
        retry: noRetry,
        db: db as never,
      }),
    ).rejects.toThrow(/batch 2\/3 upsert failed/);
    // It threw on chunk 2 — did NOT proceed to chunk 3 (no catch-and-continue).
    expect(calls).toHaveLength(2);
  });

  it("retries a failing batch via the injected retry, then succeeds", async () => {
    // Retry wrapper that re-invokes once on failure.
    const retryOnce = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch {
        return await fn();
      }
    };
    let attempts = 0;
    const db = {
      from() {
        return {
          upsert() {
            attempts += 1;
            return Promise.resolve({ error: attempts === 1 ? { message: "transient" } : null });
          },
        };
      },
    };
    const res = await batchUpsert({
      table: "mvum_roads",
      rows: [{ id: 1 }],
      onConflict: "rte_cn",
      label: "test",
      retry: retryOnce,
      db: db as never,
    });
    expect(res.written).toBe(1);
    expect(attempts).toBe(2); // failed once, retried, succeeded
  });
});
