/**
 * scan() pagination correctness — same invariant and same fake-db hazard
 * model as backfill-nps-photo.test.ts: an UPDATE mid-scan relocates a heap
 * tuple, so an un-ordered `.range()` under later pages skips rows. `.order(
 * "id")` + deferred writes (Phase 1 read, Phase 2 write) is the fix; this
 * test proves ONE apply pass writes every eligible row regardless.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { scan, recompute } from "./backfill-nps-amenities.ts";

type Rec = {
  id: string;
  master_place_id: string | null;
  raw_payload: unknown;
  normalized_payload: Record<string, unknown> | null;
};

function campgroundRow(
  id: string,
  amenities: Record<string, unknown> | undefined,
  masterPlaceId: string | null = null,
  currentNormalized: Record<string, unknown> | null = null,
): Rec {
  return {
    id,
    master_place_id: masterPlaceId,
    raw_payload: { campground: amenities ? { amenities } : {} },
    normalized_payload: currentNormalized,
  };
}

/** In-memory Supabase stand-in, same shape as backfill-nps-photo.test.ts's
 *  fake: an UPDATE relocates the row to the END of the internal array. */
function makeFakeDb(initial: Rec[]): { db: SupabaseClient; store: Rec[] } {
  const store: Rec[] = initial.map((r) => ({ ...r }));
  const api = {
    from() {
      return {
        select() {
          let ordered = false;
          const builder = {
            eq: () => builder,
            order: () => {
              ordered = true;
              return builder;
            },
            range: (a: number, b: number) => {
              const view = ordered
                ? [...store].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
                : store;
              return Promise.resolve({ data: view.slice(a, b + 1), error: null });
            },
          };
          return builder;
        },
        update(patch: Record<string, unknown>) {
          return {
            eq: (_col: string, id: string) => {
              const i = store.findIndex((r) => r.id === id);
              if (i >= 0) {
                const [row] = store.splice(i, 1);
                store.push({ ...row, ...patch } as Rec);
              }
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
    rpc(_fn: string, _args: Record<string, unknown>) {
      return Promise.resolve({ error: null });
    },
  };
  return { db: api as unknown as SupabaseClient, store };
}

const REAL_AMENITIES = { dumpStation: "Yes - seasonal", toilets: ["Vault Toilets - year round"] };

describe("backfill-nps-amenities scan() — single-pass convergence", () => {
  it("writes every eligible row in ONE apply pass across multiple pages", async () => {
    const rows = ["a", "b", "c", "d", "e", "f"].map((id) => campgroundRow(id, REAL_AMENITIES));
    const { db } = makeFakeDb(rows);

    const applied = await scan(db, true, 2);
    expect(applied.scanned).toBe(6);
    expect(applied.changed).toBe(6);

    const dry = await scan(db, false, 2);
    expect(dry.changed).toBe(0);
    expect(dry.skipped).toBe(6);
  });

  it("skips non-campground / amenity-less rows (stay null) and is idempotent on matched rows", async () => {
    const rows = [
      campgroundRow("a", REAL_AMENITIES),
      campgroundRow("b", undefined), // no raw amenities at all (park/place record)
      campgroundRow("c", REAL_AMENITIES),
    ];
    const { db } = makeFakeDb(rows);

    const applied = await scan(db, true, 1);
    expect(applied.changed).toBe(2); // a, c
    expect(applied.skipped).toBe(1); // b → null desired, null current, no write

    const dry = await scan(db, false, 1);
    expect(dry.changed).toBe(0);
    expect(dry.skipped).toBe(3);
  });

  it("a row whose stored normalized_payload already matches the re-derived value is skipped, not rewritten", async () => {
    const already = { dump_station: true, dump_station_qualifier: "seasonal", toilet: true };
    const rows = [campgroundRow("a", REAL_AMENITIES, null, { amenities: already })];
    const { db } = makeFakeDb(rows);
    const applied = await scan(db, true, 10);
    expect(applied.changed).toBe(0);
    expect(applied.skipped).toBe(1);
  });

  it("collects distinct affected master_place_ids for the recompute step, only from CHANGED rows", async () => {
    const rows = [
      campgroundRow("a", REAL_AMENITIES, "mp-1"),
      campgroundRow("b", REAL_AMENITIES, "mp-1"), // same master_place, still counted once
      campgroundRow("c", undefined, "mp-2"), // unchanged (null -> null) — must NOT appear
    ];
    const { db } = makeFakeDb(rows);
    const applied = await scan(db, true, 10);
    expect(applied.affectedMasterPlaceIds.sort()).toEqual(["mp-1"]);
  });
});

describe("backfill-nps-amenities recompute()", () => {
  it("calls recompute_master_place once per id and reports ok/failed", async () => {
    const { db } = makeFakeDb([]);
    const result = await recompute(db, ["mp-1", "mp-2", "mp-3"]);
    expect(result.ok).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
  });
});
