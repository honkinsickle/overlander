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
