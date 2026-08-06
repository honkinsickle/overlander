/**
 * scan() pagination correctness — the invariant is: a SINGLE apply pass writes
 * every eligible row, with no second pass needed.
 *
 * The defect this guards against: scan() paginated `.range()` with no `.order()`
 * while UPDATE-ing the rows it paged over. Each UPDATE relocates a heap tuple,
 * so later offset windows skip rows and one pass under-writes.
 *
 * The fake below models exactly that hazard — an UPDATE moves the row to the end
 * of the internal array, and an unordered `.range()` reads that shifting order.
 * With `.order("id")` (the fix's stable read) the order is fixed. Injecting
 * `pageSize` lets a handful of rows span several pages, so the invariant is
 * proved in milliseconds — no volume seeding required.
 */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { scan } from "./backfill-nps-photo.ts";

type Rec = {
  id: string;
  raw_payload: unknown;
  normalized_payload: Record<string, unknown> | null;
};

function npsRow(id: string, withImage: boolean): Rec {
  return {
    id,
    raw_payload: withImage
      ? {
          place: {
            images: [
              { url: `https://nps.gov/${id}.jpg`, altText: `alt ${id}`, credit: `NPS/${id}` },
            ],
          },
        }
      : { place: {} },
    normalized_payload: null,
  };
}

/** In-memory Supabase stand-in. An UPDATE relocates the row to the END of the
 *  internal array — the heap-tuple movement that breaks offset pagination when
 *  the scan does not ORDER BY a stable key. A `.range()` preceded by `.order()`
 *  reads a sorted view (stable); without it, the live (shifting) order. */
function makeFakeDb(initial: Rec[]): { db: SupabaseClient } {
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
  };
  return { db: api as unknown as SupabaseClient };
}

describe("backfill-nps-photo scan() — single-pass convergence", () => {
  it("writes every eligible row in ONE apply pass across multiple pages", async () => {
    // 6 photo-bearing rows, 3 pages at pageSize=2. Offset-while-mutate skips
    // rows here; the ordered-read fix enumerates all 6 before any write.
    const rows = ["a", "b", "c", "d", "e", "f"].map((id) => npsRow(id, true));
    const { db } = makeFakeDb(rows);

    const applied = await scan(db, true, 2);
    expect(applied.scanned).toBe(6);
    expect(applied.changed).toBe(6);

    // The invariant: a follow-up dry-run needs NO second pass.
    const dry = await scan(db, false, 2);
    expect(dry.changed).toBe(0);
    expect(dry.skipped).toBe(6);
  });

  it("skips photoless rows (stay null) and is idempotent on matched rows", async () => {
    const rows = [npsRow("a", true), npsRow("b", false), npsRow("c", true)];
    const { db } = makeFakeDb(rows);

    const applied = await scan(db, true, 1); // pageSize 1 — each row its own page
    expect(applied.changed).toBe(2); // a, c
    expect(applied.skipped).toBe(1); // b photoless → null, no write

    const dry = await scan(db, false, 1);
    expect(dry.changed).toBe(0);
    expect(dry.skipped).toBe(3);
  });
});
