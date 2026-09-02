/**
 * Tests for the shared triage decision logic.
 *
 * These exist because every state's pending queue is currently EMPTY, so
 * running the scripts against TEST exercises only the "nothing to do" path —
 * the apply branches would ship completely unexercised otherwise. A check that
 * cannot fail is not evidence.
 *
 * The client is a recording fake, so no database is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyDecisions, type TriageConfig } from "./state-parks-triage.ts";

/** Records outcomes passed to promote.ts's applyMatches, which reject() calls. */
let applyMatchesCalls: unknown[][] = [];
vi.mock("../../entity-resolution/promote.ts", () => ({
  applyMatches: (outcomes: unknown[]) => {
    applyMatchesCalls.push(outcomes);
    return Promise.resolve({ auto_linked: 0, amenity_rolled_up: 0, manual_review_queued: 0, new_master_places: outcomes.length, errors: [] });
  },
}));

beforeEach(() => {
  applyMatchesCalls = [];
});

const CFG: TriageConfig = { sourceId: "california_state_parks", resolver: "test:resolver", label: "t" };

interface Call {
  table: string;
  op: "select" | "update";
  payload?: Record<string, unknown>;
  eq: [string, unknown][];
}

interface Rpc {
  fn: string;
  args: Record<string, unknown>;
}

/**
 * Minimal supabase-js stand-in. Each builder is chainable AND awaitable, which
 * is what the real client does — `.eq()` is an intermediate step before
 * `.is()`/`.maybeSingle()` but a terminal one after `.update()`.
 */
function fakeClient(opts: {
  sourceRecords: Record<string, unknown>[];
  placeMatches: { id: string; source_record_id: string; master_place_id: string; combined_confidence: number }[];
  masterPlaceName?: string;
}) {
  const calls: Call[] = [];
  const rpcs: Rpc[] = [];

  function builder(table: string, op: "select" | "update", payload?: Record<string, unknown>) {
    const call: Call = { table, op, payload, eq: [] };
    calls.push(call);

    const resultFor = (): { data: unknown; error: null } => {
      if (op === "update") return { data: null, error: null };
      if (table === "source_record") return { data: opts.sourceRecords, error: null };
      if (table === "place_match") return { data: opts.placeMatches, error: null };
      if (table === "master_place") return { data: { canonical_name: opts.masterPlaceName ?? "Proposed MP" }, error: null };
      return { data: [], error: null };
    };

    const chain = {
      select: () => chain,
      eq: (col: string, val: unknown) => {
        call.eq.push([col, val]);
        return chain;
      },
      is: () => chain,
      in: () => chain,
      maybeSingle: () => Promise.resolve(resultFor()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(resultFor()).then(res, rej),
    };
    return chain;
  }

  const sb = {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      update: (payload: Record<string, unknown>) => builder(table, "update", payload),
    }),
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcs.push({ fn, args });
      return Promise.resolve({ error: null });
    },
  };

  return { sb: sb as unknown as SupabaseClient, calls, rpcs };
}

const PENDING_FIXTURE = {
  sourceRecords: [
    {
      id: "sr-1",
      external_id: "california_state_parks:123",
      name: "Example SP",
      inferred_category: "recreation_area",
      raw_payload: { row: { lon: "-120.5", lat: "37.25" } },
    },
  ],
  placeMatches: [
    { id: "pm-1", source_record_id: "sr-1", master_place_id: "mp-proposed", combined_confidence: 0.72 },
  ],
};

describe("applyDecisions", () => {
  it("dry-run writes nothing but still counts the decision", async () => {
    const { sb, calls, rpcs } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:123", action: "link" }], false);
    expect(r).toMatchObject({ linked: 1, relinked: 0, rejected: 0, failed: 0 });
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });

  it("link confirms against the matcher's proposed mp and recomputes it", async () => {
    const { sb, calls, rpcs } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:123", action: "link" }], true);
    expect(r).toMatchObject({ linked: 1, failed: 0 });

    const pmUpdate = calls.find((c) => c.table === "place_match" && c.op === "update");
    expect(pmUpdate?.payload).toMatchObject({
      status: "confirmed",
      match_method: "manual_triage",
      resolved_by: "test:resolver",
    });
    // link must NOT move the match to a different mp
    expect(pmUpdate?.payload).not.toHaveProperty("master_place_id");

    const srUpdate = calls.find((c) => c.table === "source_record" && c.op === "update");
    expect(srUpdate?.payload).toEqual({ master_place_id: "mp-proposed" });
    expect(rpcs).toEqual([{ fn: "recompute_master_place", args: { p_master_place_id: "mp-proposed" } }]);
  });

  it("relink retargets both the match and the source_record, and recomputes the NEW mp", async () => {
    const { sb, calls, rpcs } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(
      sb,
      CFG,
      [{ external_id: "california_state_parks:123", action: "relink", target_mp_id: "mp-correct" }],
      true,
    );
    expect(r).toMatchObject({ relinked: 1, failed: 0 });

    const pmUpdate = calls.find((c) => c.table === "place_match" && c.op === "update");
    expect(pmUpdate?.payload).toMatchObject({ status: "confirmed", master_place_id: "mp-correct" });

    const srUpdate = calls.find((c) => c.table === "source_record" && c.op === "update");
    expect(srUpdate?.payload).toEqual({ master_place_id: "mp-correct" });
    expect(rpcs).toEqual([{ fn: "recompute_master_place", args: { p_master_place_id: "mp-correct" } }]);
  });

  it("relink without target_mp_id fails instead of silently linking to the wrong mp", async () => {
    const { sb, calls } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:123", action: "relink" }], true);
    expect(r).toMatchObject({ failed: 1, relinked: 0 });
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("reject marks the match rejected AND creates a new master_place", async () => {
    // Regression guard. This previously asserted the record was left UNLINKED
    // for "phase 2 to re-home" — which never happens: neither matcher.ts nor
    // promote.ts consults place_match.status, so matchAll re-proposes the same
    // rejected candidate forever. reject must give the record its own place.
    const { sb, calls } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:123", action: "reject" }], true);
    expect(r).toMatchObject({ rejected: 1, failed: 0 });

    const pmUpdate = calls.find((c) => c.table === "place_match" && c.op === "update");
    expect(pmUpdate?.payload).toMatchObject({ status: "rejected", resolved_by: "test:resolver" });

    expect(applyMatchesCalls).toHaveLength(1);
    const outcome = applyMatchesCalls[0][0] as Record<string, unknown>;
    expect(outcome.kind).toBe("new_master_place");
    expect(outcome.source_record_id).toBe("sr-1");
    expect(outcome.seed_name).toBe("Example SP");
    expect(outcome.seed_category).toBe("recreation_area");
    expect(outcome.seed_geometry).toEqual([-120.5, 37.25]);
    expect(typeof outcome.target).toBe("string");
  });

  it("reject fails loudly rather than seeding a new master_place at NaN coordinates", async () => {
    const { sb } = fakeClient({
      ...PENDING_FIXTURE,
      sourceRecords: [
        { id: "sr-1", external_id: "california_state_parks:123", name: "Example SP", inferred_category: "park", raw_payload: {} },
      ],
    });
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:123", action: "reject" }], true);
    expect(r).toMatchObject({ failed: 1, rejected: 0 });
    expect(applyMatchesCalls).toHaveLength(0);
  });

  it("skips a decision whose external_id is not in the pending queue", async () => {
    const { sb, calls } = fakeClient(PENDING_FIXTURE);
    const r = await applyDecisions(sb, CFG, [{ external_id: "california_state_parks:nope", action: "link" }], true);
    expect(r).toMatchObject({ skipped: 1, linked: 0 });
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("carries operator notes onto the place_match row", async () => {
    const { sb, calls } = fakeClient(PENDING_FIXTURE);
    await applyDecisions(
      sb,
      CFG,
      [{ external_id: "california_state_parks:123", action: "link", notes: "same unit, abbreviated GIS name" }],
      true,
    );
    const pmUpdate = calls.find((c) => c.table === "place_match" && c.op === "update");
    expect(pmUpdate?.payload?.notes).toBe("same unit, abbreviated GIS name");
  });
});
