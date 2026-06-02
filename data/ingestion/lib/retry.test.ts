/**
 * Unit tests for the withRetry policy + isTransient classifier.
 *
 * The classifier table is a CANARY: it pins the exact error shapes postgrest-js
 * (2.106.2) produces — flattened `{ message, details, hint, code }` with
 * `.cause.code` stripped — to their transient/permanent classification. If a
 * future postgrest-js upgrade changes those shapes, these tests fail loudly
 * instead of the matcher silently degrading into never-retry / always-retry.
 * When they break, update the markers in `retry.ts` and this table together.
 */

import { describe, it, expect, vi } from "vitest";

import { isTransient, withRetry, RetryExhaustedError } from "./retry.ts";

// ── isTransient classifier canary table ──────────────────────────────────
describe("isTransient — classifier canary table", () => {
  const cases: Array<{ name: string; err: unknown; expected: boolean }> = [
    {
      name: "DNS failure (today's incident shape)",
      err: {
        message: "TypeError: fetch failed",
        details: "Caused by: TypeError: fetch failed\n\nError: getaddrinfo ENOTFOUND host (ENOTFOUND)",
        code: "",
        hint: "",
      },
      expected: true,
    },
    {
      name: "abort (empirically-probed shape, 2.106.2)",
      err: {
        message: "AbortError: This operation was aborted",
        details: "AbortError: This operation was aborted",
        code: "",
        hint: "",
      },
      expected: true,
    },
    {
      name: "raw Error with cause.code (unflattened fallback path)",
      err: Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }),
      expected: true,
    },
    {
      name: "Postgres statement timeout (57014)",
      err: { code: "57014", message: "canceling statement due to statement timeout", details: "", hint: "" },
      expected: true,
    },
    {
      name: "PostgREST 4xx app error (PGRST116, 0 rows)",
      err: { code: "PGRST116", message: "Results contain 0 rows", details: "", hint: "" },
      expected: false,
    },
    {
      name: "auth error (42501 permission denied)",
      err: { code: "42501", message: "permission denied for table master_place", details: "", hint: "" },
      expected: false,
    },
    {
      name: "JSON parse error on 2xx body (SyntaxError)",
      err: new SyntaxError("Unexpected token < in JSON at position 0"),
      expected: false,
    },
    { name: "HTTP 503 (status-wrapped)", err: { status: 503, message: "Service Unavailable" }, expected: true },
    { name: "HTTP 401", err: { status: 401, message: "Unauthorized" }, expected: false },
    { name: "HTTP 429 (rate-limited)", err: { status: 429, message: "Too Many Requests" }, expected: true },
    {
      name: "unknown shape (defensive — must NOT retry)",
      err: { message: "completely unrecognized error", code: "??" },
      expected: false,
    },
  ];

  it.each(cases)("$name → transient=$expected", ({ err, expected }) => {
    expect(isTransient(err)).toBe(expected);
  });

  it("non-objects classify as permanent", () => {
    expect(isTransient(null)).toBe(false);
    expect(isTransient(undefined)).toBe(false);
    expect(isTransient("a string")).toBe(false);
  });
});

// ── withRetry behaviour ──────────────────────────────────────────────────
const transientErr = { message: "fetch failed", details: "ENOTFOUND", code: "" };
const permanentErr = { code: "42501", message: "permission denied" };

// Deterministic option bundle: instant sleep, fixed jitter, frozen clock,
// no per-attempt timer.
function detOpts(over: Partial<Parameters<typeof withRetry>[1]> = {}) {
  return {
    label: "test",
    perAttemptTimeoutMs: 0,
    sleep: vi.fn(async () => {}),
    rng: () => 0.5,
    now: () => 0,
    ...over,
  };
}

describe("withRetry", () => {
  it("retries a transient failure once, then succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValueOnce("ok");
    const opts = detOpts();
    const result = await withRetry(fn, opts);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(opts.sleep).toHaveBeenCalledTimes(1);
  });

  it("throws RetryExhaustedError after exhausting attempts on transient errors", async () => {
    const fn = vi.fn(async () => {
      throw transientErr;
    });
    const opts = detOpts({ attempts: 3 });
    await expect(withRetry(fn, opts)).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(opts.sleep).toHaveBeenCalledTimes(2); // between attempts
  });

  it("RetryExhaustedError carries label + attempts + lastError", async () => {
    const fn = vi.fn(async () => {
      throw transientErr;
    });
    try {
      await withRetry(fn, detOpts({ attempts: 2, label: "find_master_place_candidates" }));
      throw new Error("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(RetryExhaustedError);
      const re = e as RetryExhaustedError;
      expect(re.label).toBe("find_master_place_candidates");
      expect(re.attempts).toBe(2);
      expect(re.lastError).toBe(transientErr);
    }
  });

  it("does NOT retry a permanent error — throws it unwrapped, fn called once", async () => {
    const fn = vi.fn(async () => {
      throw permanentErr;
    });
    const opts = detOpts();
    await expect(withRetry(fn, opts)).rejects.toBe(permanentErr);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(opts.sleep).toHaveBeenCalledTimes(0);
  });

  it("stops mid-sequence when the total budget is exceeded (deadline)", async () => {
    let clock = 0;
    const fn = vi.fn(async () => {
      throw transientErr;
    });
    const opts = detOpts({
      attempts: 10, // high, so budget — not attempts — is the limiter
      totalBudgetMs: 4000,
      now: () => clock,
      sleep: vi.fn(async () => {
        clock += 1500; // each backoff advances the clock past the budget after a few tries
      }),
    });
    await expect(withRetry(fn, opts)).rejects.toBeInstanceOf(RetryExhaustedError);
    // attempts at clock 0, 1500, 3000 run; the 4th top-check sees 4500 >= 4000 → break
    expect(fn).toHaveBeenCalledTimes(3);
    expect(fn).not.toHaveBeenCalledTimes(10);
  });

  it("applies full-jitter backoff deterministically (rng=0.5)", async () => {
    const fn = vi.fn(async () => {
      throw transientErr;
    });
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(
      withRetry(fn, detOpts({ attempts: 3, baseDelayMs: 200, factor: 2, capDelayMs: 800, sleep })),
    ).rejects.toBeInstanceOf(RetryExhaustedError);
    // attempt 1 exp=min(800,200)=200 → 0.5*200=100; attempt 2 exp=min(800,400)=400 → 0.5*400=200
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 200]);
  });
});
