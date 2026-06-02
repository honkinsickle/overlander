/**
 * Standard retry policy for source API calls.
 * Exponential backoff: 1s, 2s, 4s, 8s, 16s, then give up.
 */

import pRetry, { AbortError, type FailedAttemptError } from "p-retry";
import { logger } from "./logger.ts";

export function defaultRetry<T>(fn: () => Promise<T>, label = "fetch"): Promise<T> {
  return pRetry(fn, {
    retries: 5,
    minTimeout: 1000,
    factor: 2,
    onFailedAttempt: (err: FailedAttemptError) => {
      logger.warn(
        { err: err.message, attempt: err.attemptNumber, retriesLeft: err.retriesLeft, label },
        "retry attempt failed",
      );
    },
  });
}

/**
 * Re-export so callers can throw `new AbortError(...)` from inside a retried function
 * to fail-fast on permanent errors (4xx, malformed payloads).
 */
export { AbortError };

// ──────────────────────────────────────────────────────────────────────────
// withRetry — a tight, per-call retry policy for idempotent DB reads.
//
// Distinct from `defaultRetry` above (which is p-retry tuned for patient
// source-API ingestion: 5 retries, 1s→16s). `withRetry` is for hot per-record
// reads inside a large loop (e.g. matchAll's candidate-lookup RPC over
// thousands of records): a tight total budget so one flaky record can't stall
// the pass, a per-attempt abort timeout, and full-jitter backoff. Pure code —
// no new dependency — with injectable sleep / rng / clock for deterministic
// tests.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Transient-error classifier.
 *
 * IMPORTANT — string-based by necessity. postgrest-js (verified on 2.106.2)
 * flattens errors into a plain `{ message, details, hint, code }` object and
 * **strips `.cause.code`** for RPC errors: a DNS failure surfaces as
 * `{ message: "TypeError: fetch failed", details: "...ENOTFOUND" }` and an
 * abort as `{ message: "AbortError: This operation was aborted" }`. So the
 * structured `error.cause.code` the undici layer carries is gone by the time we
 * see it, and `message`/`details` strings are the only reliable signal. The
 * `retry.test.ts` classifier table pins these exact shapes as a canary: if a
 * future postgrest-js upgrade changes error formats, those tests fail (loudly)
 * rather than silently degrading retry behaviour into never-retry or
 * always-retry. When they break, update the markers here and the table there.
 *
 * Unknown shapes classify as PERMANENT (do not infinite-retry the unrecognized).
 */
const TRANSIENT_NET_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** Retryable Postgres / connection SQLSTATE codes (statement timeout, conn loss, overload). */
const TRANSIENT_PG_CODES = new Set([
  "57014", // canceling statement due to statement timeout
  "08000",
  "08001",
  "08003",
  "08004",
  "08006", // connection exception family
  "53300", // too_many_connections
  "53400", // configuration_limit_exceeded
]);

const TRANSIENT_HTTP_STATUS = new Set([500, 502, 503, 504, 429]);

/** Lowercased substring markers found in postgrest's flattened message/details. */
const TRANSIENT_MARKERS = [
  "fetch failed",
  "aborterror", // postgrest flattens AbortController aborts to "AbortError: ..."
  "timeout",
  "network",
  "socket hang up",
  "enotfound",
  "eai_again",
  "econnreset",
  "econnrefused",
  "etimedout",
  "epipe",
  "und_err_",
];

export function isTransient(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as {
    name?: unknown;
    code?: unknown;
    status?: unknown;
    message?: unknown;
    details?: unknown;
    cause?: { code?: unknown } | null;
  };

  // Raw DOMException/Error abort or timeout (e.g. a per-attempt AbortController
  // that reaches the classifier unflattened).
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;

  // Fallback for any *un*flattened fetch error that still carries cause.code.
  const causeCode = e.cause?.code;
  if (typeof causeCode === "string" && TRANSIENT_NET_CODES.has(causeCode)) return true;

  // HTTP status, when the wrapped error carries one.
  if (typeof e.status === "number" && TRANSIENT_HTTP_STATUS.has(e.status)) return true;

  // Postgres / PostgREST SQLSTATE.
  if (typeof e.code === "string" && TRANSIENT_PG_CODES.has(e.code)) return true;

  // String markers in the flattened message + details (the primary RPC path).
  const hay = `${String(e.message ?? "")} ${String(e.details ?? "")}`.toLowerCase();
  if (TRANSIENT_MARKERS.some((m) => hay.includes(m))) return true;

  return false; // unknown → permanent
}

/** Short human string for logs/diagnostics from any error shape. */
export function errorMessage(err: unknown): string {
  if (err == null) return "unknown";
  if (typeof err === "string") return err;
  const e = err as { message?: unknown; code?: unknown };
  const code = e.code ? ` [${String(e.code)}]` : "";
  return `${String(e.message ?? err)}${code}`;
}

/** Thrown after a retried call exhausts its attempts / budget on transient errors. */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly label: string;
  readonly lastError: unknown;
  constructor(label: string, attempts: number, lastError: unknown) {
    super(`retry exhausted for "${label}" after ${attempts} attempt(s): ${errorMessage(lastError)}`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.label = label;
    this.lastError = lastError;
  }
}

export interface WithRetryOptions {
  /** Label for logs + the exhaustion error. */
  label: string;
  /** Total attempts including the first (default 3 = 1 initial + 2 retries). */
  attempts?: number;
  /** Per-attempt AbortController timeout in ms (default 2000; <=0 disables). */
  perAttemptTimeoutMs?: number;
  /** Total wall-clock budget across all attempts in ms (default 4000). */
  totalBudgetMs?: number;
  /** Backoff base / factor / cap (full-jitter: delay = rng() * min(cap, base*factor^(n-1))). */
  baseDelayMs?: number;
  factor?: number;
  capDelayMs?: number;
  /** Injectable for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  rng?: () => number;
  now?: () => number;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` with transient-error retry, full-jitter backoff, a per-attempt abort
 * timeout, and a total time budget.
 *
 * - `fn` receives `{ signal, attempt }`. Pass `signal` to a Supabase builder via
 *   `.abortSignal(signal)` so a hung attempt is cut at `perAttemptTimeoutMs`.
 * - Permanent errors (per `isTransient`) propagate immediately, unwrapped.
 * - Transient errors retry until attempts or budget is exhausted, then throw
 *   `RetryExhaustedError` carrying the last error.
 */
export async function withRetry<T>(
  fn: (ctx: { signal: AbortSignal; attempt: number }) => Promise<T>,
  opts: WithRetryOptions,
): Promise<T> {
  const {
    label,
    attempts = 3,
    perAttemptTimeoutMs = 2000,
    totalBudgetMs = 4000,
    baseDelayMs = 200,
    factor = 2,
    capDelayMs = 800,
    sleep = realSleep,
    rng = Math.random,
    now = () => performance.now(),
  } = opts;

  const start = now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1 && now() - start >= totalBudgetMs) break;

    const ac = new AbortController();
    const timer =
      perAttemptTimeoutMs > 0 ? setTimeout(() => ac.abort(), perAttemptTimeoutMs) : null;

    let ok = false;
    let result: T | undefined;
    try {
      result = await fn({ signal: ac.signal, attempt });
      ok = true;
    } catch (err) {
      lastError = err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (ok) return result as T;

    const transient = isTransient(lastError);
    const outOfBudget = now() - start >= totalBudgetMs;
    const willRetry = transient && attempt < attempts && !outOfBudget;
    logger.warn(
      { label, attempt, transient, willRetry, err: errorMessage(lastError) },
      "withRetry: attempt failed",
    );

    if (!transient) throw lastError; // permanent → fail fast, unwrapped
    if (!willRetry) break;

    const exp = Math.min(capDelayMs, baseDelayMs * factor ** (attempt - 1));
    await sleep(Math.floor(rng() * exp)); // full jitter: [0, exp)
  }

  throw new RetryExhaustedError(label, attempts, lastError);
}
