/**
 * Persistent USD cost meter for paid external APIs.
 *
 * Phase 3 spec §4.2 — every Google Places call charges the ledger
 * BEFORE the network call. If charging would exceed the cap, throws
 * BudgetExceededError without making the call (pre-deduct semantics —
 * we cannot overshoot the cap by even one request, even on retry).
 *
 * Persisted to disk so re-runs are aware of previous spend. Loading
 * the ledger after a successful run lets the next invocation pick up
 * where it left off with the budget already partially consumed.
 *
 * SKU pricing constants live next to the call sites (the Google
 * client), not here. This module knows nothing about specific
 * vendors — it's a pure accounting layer.
 *
 * Default cap: $100 USD (per Phase 3 spec §2.4). Override with the
 * GOOGLE_PLACES_BUDGET_USD env var.
 *
 * Default persist path: data/.cache/google-cost-ledger.json
 * (gitignored).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { logger } from "./logger.ts";

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface CostLedgerEntry {
  ts: string;
  sku: string;
  count: number;
  unitCostUsd: number;
  totalUsd: number;
}

export interface CostSummary {
  cap_usd: number;
  total_usd: number;
  remaining_usd: number;
  by_sku: Record<string, { count: number; total_usd: number }>;
  updated_at: string;
}

interface PersistedState {
  cap_usd: number;
  by_sku: Record<string, { count: number; total_usd: number }>;
  entries: CostLedgerEntry[];
  updated_at: string;
}

export class BudgetExceededError extends Error {
  public readonly summary: CostSummary;

  constructor(message: string, summary: CostSummary) {
    super(message);
    this.name = "BudgetExceededError";
    this.summary = summary;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Ledger
// ──────────────────────────────────────────────────────────────────────

export interface CostLedgerOptions {
  capUsd: number;
  persistPath: string;
}

export class CostLedger {
  private state: PersistedState;
  private readonly persistPath: string;

  constructor(opts: CostLedgerOptions) {
    this.persistPath = opts.persistPath;
    this.state = this.load(opts.capUsd);
  }

  /**
   * Pre-deduct cost for `count` calls at `unitCostUsd` each. Throws
   * BudgetExceededError if (current total + this charge) would exceed
   * the cap.
   *
   * The cost is recorded BEFORE the work happens, so a network failure
   * after a successful charge leaves the budget consumed — the right
   * outcome: a partially-completed call still cost real money from
   * Google's perspective even if our retry logic recovered.
   */
  charge(sku: string, count: number, unitCostUsd: number): void {
    if (count <= 0) return;
    const totalUsd = count * unitCostUsd;
    const before = this.totalUsd();
    if (before + totalUsd > this.state.cap_usd + 1e-9) {
      const summary = this.summary();
      throw new BudgetExceededError(
        `Google Places budget cap exceeded. Cap=$${this.state.cap_usd.toFixed(2)}, ` +
          `spent=$${before.toFixed(4)}, attempted=+$${totalUsd.toFixed(4)} ` +
          `(${count}× ${sku} @ $${unitCostUsd.toFixed(4)}). Halting before the call.`,
        summary,
      );
    }
    const entry: CostLedgerEntry = {
      ts: new Date().toISOString(),
      sku,
      count,
      unitCostUsd,
      totalUsd,
    };
    this.state.entries.push(entry);
    const bucket = this.state.by_sku[sku] ?? { count: 0, total_usd: 0 };
    bucket.count += count;
    bucket.total_usd += totalUsd;
    this.state.by_sku[sku] = bucket;
    this.state.updated_at = entry.ts;
    this.flush();
  }

  totalUsd(): number {
    let sum = 0;
    for (const e of this.state.entries) sum += e.totalUsd;
    return sum;
  }

  summary(): CostSummary {
    const total = this.totalUsd();
    return {
      cap_usd: this.state.cap_usd,
      total_usd: total,
      remaining_usd: this.state.cap_usd - total,
      by_sku: { ...this.state.by_sku },
      updated_at: this.state.updated_at,
    };
  }

  private load(capUsd: number): PersistedState {
    if (!existsSync(this.persistPath)) {
      return this.fresh(capUsd);
    }
    try {
      const raw = readFileSync(this.persistPath, "utf8");
      const parsed = JSON.parse(raw) as PersistedState;
      // Use the caller's cap (env may have changed); persist the prior
      // spend log unchanged.
      const total = (parsed.entries ?? []).reduce((s, e) => s + (e.totalUsd ?? 0), 0);
      logger.info(
        { persistPath: this.persistPath, prior_total_usd: total, cap_usd: capUsd },
        "cost-ledger: loaded persisted state",
      );
      return {
        cap_usd: capUsd,
        by_sku: parsed.by_sku ?? {},
        entries: parsed.entries ?? [],
        updated_at: parsed.updated_at ?? new Date().toISOString(),
      };
    } catch (err) {
      logger.warn(
        { err, persistPath: this.persistPath },
        "cost-ledger: persisted state unreadable — starting fresh",
      );
      return this.fresh(capUsd);
    }
  }

  private fresh(capUsd: number): PersistedState {
    return {
      cap_usd: capUsd,
      by_sku: {},
      entries: [],
      updated_at: new Date().toISOString(),
    };
  }

  private flush(): void {
    mkdirSync(dirname(this.persistPath), { recursive: true });
    writeFileSync(this.persistPath, JSON.stringify(this.state, null, 2));
  }
}

// ──────────────────────────────────────────────────────────────────────
// Module-scoped singleton (resolves data-workspace-relative paths)
// ──────────────────────────────────────────────────────────────────────

const DEFAULT_REL_PATH = ".cache/google-cost-ledger.json";
const DEFAULT_CAP_USD = 100;

let _singleton: CostLedger | null = null;

/**
 * Process-singleton ledger initialised from env on first access. Pass
 * a fresh `CostLedger` directly in tests instead of using this.
 */
export function getCostLedger(): CostLedger {
  if (_singleton) return _singleton;
  const capEnv = process.env.GOOGLE_PLACES_BUDGET_USD;
  const capUsd = capEnv ? parseFloat(capEnv) : DEFAULT_CAP_USD;
  if (!Number.isFinite(capUsd) || capUsd <= 0) {
    throw new Error(
      `GOOGLE_PLACES_BUDGET_USD must be a positive number; got "${capEnv ?? "(unset)"}"`,
    );
  }
  const pathEnv = process.env.GOOGLE_PLACES_LEDGER_PATH ?? DEFAULT_REL_PATH;
  const persistPath = isAbsolute(pathEnv) ? pathEnv : resolveDataRel(pathEnv);
  _singleton = new CostLedger({ capUsd, persistPath });
  return _singleton;
}

/** For tests: discard the singleton so the next getCostLedger() reloads from env. */
export function _resetCostLedgerSingleton(): void {
  _singleton = null;
}

function resolveDataRel(rel: string): string {
  // This file is at data/ingestion/lib/cost-ledger.ts; ../.. is data/.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", rel);
}
