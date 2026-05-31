#!/usr/bin/env tsx
/**
 * Post-supabase-db-push verification.
 *
 * Background:
 *   2026-05-30 Parks Canada field_precedence migration was marked as
 *   applied in `supabase_migrations.schema_migrations` on the test
 *   project but its INSERT statements never executed. `supabase db
 *   push` reported success. The bug surfaced ~30 min later via a
 *   synthetic federation test. This script is the operational guard:
 *   after every `supabase db push`, query the DB to confirm the
 *   migration's expected effects actually landed.
 *
 *   Scope (v1):
 *     - Literal `INSERT INTO <table> VALUES (...), (...), ...` —
 *       parsed, every tuple's row queried for presence in the table.
 *     - `INSERT ... ON CONFLICT` — warn-and-skip (count unstable).
 *     - `INSERT ... SELECT` — warn-and-skip (depends on source data).
 *     - DDL (CREATE / ALTER / DROP / CREATE OR REPLACE FUNCTION) —
 *       reported as "uncovered" so a green verify on a mixed migration
 *       doesn't give false confidence about unchecked DDL.
 *
 * Usage:
 *   tsx verify-migration.ts                            # latest migration by timestamp
 *   tsx verify-migration.ts <id> [<id> ...]            # specific migration ID(s)
 *   tsx verify-migration.ts --push                     # wrap: capture pending, db push, verify
 *   tsx verify-migration.ts --migrations-dir <path>    # override (used by tests)
 *
 * Exit codes:
 *   0   verify clean (or nothing to verify in non-INSERT migrations)
 *   1   verify found mismatches (THE bug class this guards against)
 *   2   db push itself failed (different problem, verify skipped)
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { getDb } from "../ingestion/lib/db.ts";
import { logger } from "../ingestion/lib/logger.ts";

// ───── CLI shape ───────────────────────────────────────────────────────

interface CliArgs {
  push: boolean;
  migrationsDir: string;
  migrationIds: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ → data/ → repo-root, then supabase/migrations
  const defaultDir = resolve(here, "..", "..", "supabase", "migrations");
  const out: CliArgs = {
    push: false,
    migrationsDir: defaultDir,
    migrationIds: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--push") {
      out.push = true;
    } else if (a === "--migrations-dir") {
      out.migrationsDir = argv[++i] ?? "";
    } else if (a === "latest") {
      // sentinel — resolve later
      out.migrationIds.push("latest");
    } else if (!a.startsWith("--")) {
      out.migrationIds.push(a);
    }
  }
  return out;
}

// ───── Migration discovery ─────────────────────────────────────────────

interface MigrationFile {
  id: string;
  filename: string;
  path: string;
  sql: string;
}

function listMigrations(dir: string): MigrationFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{14}_.*\.sql$/.test(f))
    .sort()
    .map((filename) => {
      const path = join(dir, filename);
      return {
        id: filename.slice(0, 14),
        filename,
        path,
        sql: readFileSync(path, "utf8"),
      };
    });
}

function pickMigrations(
  all: MigrationFile[],
  requestedIds: string[],
): MigrationFile[] {
  if (requestedIds.length === 0 || requestedIds.includes("latest")) {
    return all.length === 0 ? [] : [all[all.length - 1]!];
  }
  const byId = new Map(all.map((m) => [m.id, m]));
  const out: MigrationFile[] = [];
  for (const id of requestedIds) {
    const m = byId.get(id);
    if (!m) {
      throw new Error(
        `migration not found in ${all[0]?.path ? dirname(all[0].path) : "(dir)"}: ${id}`,
      );
    }
    out.push(m);
  }
  return out;
}

// ───── SQL parsing ─────────────────────────────────────────────────────
//
// Lightweight, regex-free statement splitter. Tracks:
//   - single-quote strings (with '' double-quote escape)
//   - dollar-quoted strings ($$...$$ and $tag$...$tag$ — Postgres
//     function bodies)
//   - line comments (-- to end of line)
//   - block comments (/* ... */)
// Splits on semicolons at depth 0 outside any quote / comment.

export function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  let i = 0;
  const n = sql.length;
  let depth = 0;

  while (i < n) {
    const c = sql[i]!;
    const next = sql[i + 1] ?? "";

    // Line comment — skip entirely; don't append to buf.
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    // Block comment — skip entirely; don't append to buf.
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(sql[i] === "*" && sql[i + 1] === "/")) i++;
      if (i < n) i += 2;
      continue;
    }
    // Dollar-quoted string: $tag$ ... $tag$
    if (c === "$") {
      const tagMatch = sql.slice(i).match(/^\$(\w*)\$/);
      if (tagMatch) {
        const tag = tagMatch[0]; // e.g. "$$" or "$func$"
        buf += tag;
        i += tag.length;
        const close = sql.indexOf(tag, i);
        if (close === -1) {
          // Unterminated; consume the rest
          buf += sql.slice(i);
          i = n;
        } else {
          buf += sql.slice(i, close + tag.length);
          i = close + tag.length;
        }
        continue;
      }
    }
    // Single-quoted string with '' escape
    if (c === "'") {
      buf += c;
      i++;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += sql[i]!;
        if (sql[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === ";" && depth === 0) {
      const stmt = buf.trim();
      if (stmt.length > 0) out.push(stmt);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  const tail = buf.trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

export type StatementKind =
  | "insert_literal_values"
  | "insert_on_conflict"
  | "insert_select"
  | "insert_other"
  | "create_function"
  | "create_other"
  | "alter"
  | "drop"
  | "set"
  | "comment"
  | "empty"
  | "unknown";

export function classifyStatement(stmt: string): StatementKind {
  const head = stmt.trim().toLowerCase();
  if (head.length === 0) return "empty";
  if (head.startsWith("insert")) {
    if (/\bon\s+conflict\b/.test(head)) return "insert_on_conflict";
    if (!/\bvalues\b/.test(head)) {
      if (/\bselect\b/.test(head)) return "insert_select";
      return "insert_other";
    }
    return "insert_literal_values";
  }
  if (/^create\s+(or\s+replace\s+)?function\b/.test(head)) return "create_function";
  if (/^create\s/.test(head)) return "create_other";
  if (head.startsWith("alter")) return "alter";
  if (head.startsWith("drop")) return "drop";
  if (head.startsWith("set ")) return "set";
  if (head.startsWith("comment ")) return "comment";
  return "unknown";
}

export interface ParsedInsert {
  table: string;
  columns: string[];
  tuples: Array<Array<string | number | boolean | null>>;
}

/**
 * Parse a literal-VALUES INSERT into table / columns / tuples.
 * Returns null if the statement isn't parseable to the v1 shape.
 *
 * Expected shape:
 *   INSERT INTO [public.]<table> (col1, col2, ...) VALUES
 *     (val1a, val1b, ...),
 *     (val2a, val2b, ...),
 *     ...;
 *
 * Cell value parsing handles: 'string' (with '' escape), integers,
 * floats, true / false, null. Postgres type casts ('foo'::text) are
 * stripped to the leading value. Anything else returns null
 * (unparseable).
 */
export function parseLiteralValuesInsert(stmt: string): ParsedInsert | null {
  // Table + column list
  const m = stmt.match(
    /^insert\s+into\s+(?:public\.)?([a-z_][\w]*)\s*\(([^)]+)\)\s*values\s*/i,
  );
  if (!m) return null;
  const table = m[1]!;
  const columns = m[2]!.split(",").map((c) => c.trim());
  const rest = stmt.slice(m[0].length);

  // Tokenize rest into top-level tuples.
  const tuples: Array<Array<string | number | boolean | null>> = [];
  let i = 0;
  while (i < rest.length) {
    while (i < rest.length && /\s|,/.test(rest[i]!)) i++;
    if (i >= rest.length || rest[i] === ";") break;
    if (rest[i] !== "(") return null;
    // Scan to matching close-paren, respecting strings.
    let depth = 1;
    let j = i + 1;
    while (j < rest.length && depth > 0) {
      const c = rest[j]!;
      if (c === "'") {
        j++;
        while (j < rest.length) {
          if (rest[j] === "'" && rest[j + 1] === "'") {
            j += 2;
            continue;
          }
          if (rest[j] === "'") {
            j++;
            break;
          }
          j++;
        }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") depth--;
      if (depth === 0) break;
      j++;
    }
    if (depth !== 0) return null;
    const inner = rest.slice(i + 1, j);
    const cells = splitTopLevelCommas(inner);
    if (cells.length !== columns.length) return null;
    const parsed: Array<string | number | boolean | null> = [];
    for (const raw of cells) {
      const v = parseCell(raw.trim());
      if (v === undefined) return null;
      parsed.push(v);
    }
    tuples.push(parsed);
    i = j + 1;
  }
  return { table, columns, tuples };
}

function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let buf = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") {
      buf += c;
      i++;
      while (i < s.length) {
        if (s[i] === "'" && s[i + 1] === "'") {
          buf += "''";
          i += 2;
          continue;
        }
        buf += s[i]!;
        if (s[i] === "'") {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    if (c === "," && depth === 0) {
      out.push(buf);
      buf = "";
      i++;
      continue;
    }
    buf += c;
    i++;
  }
  if (buf.trim().length > 0 || out.length > 0) out.push(buf);
  return out;
}

function parseCell(raw: string): string | number | boolean | null | undefined {
  // Strip ::type cast suffix
  const noCast = raw.replace(/::[a-z_][\w\[\]]*\s*$/i, "").trim();
  if (noCast === "" ) return undefined;
  if (/^null$/i.test(noCast)) return null;
  if (/^true$/i.test(noCast)) return true;
  if (/^false$/i.test(noCast)) return false;
  if (noCast.startsWith("'") && noCast.endsWith("'")) {
    return noCast.slice(1, -1).replace(/''/g, "'");
  }
  if (/^-?\d+$/.test(noCast)) return Number.parseInt(noCast, 10);
  if (/^-?\d+\.\d+$/.test(noCast)) return Number.parseFloat(noCast);
  return undefined; // unparseable
}

// ───── Verification ────────────────────────────────────────────────────

interface VerifyReport {
  migrationId: string;
  insertRowsExpected: number;
  insertRowsVerified: number;
  insertRowsMissing: Array<{ table: string; row: Record<string, unknown> }>;
  warnings: string[];
  uncoveredCounts: Partial<Record<StatementKind, number>>;
}

async function verifyOne(m: MigrationFile): Promise<VerifyReport> {
  const db = getDb();
  const report: VerifyReport = {
    migrationId: m.id,
    insertRowsExpected: 0,
    insertRowsVerified: 0,
    insertRowsMissing: [],
    warnings: [],
    uncoveredCounts: {},
  };

  const statements = splitStatements(m.sql);
  for (const stmt of statements) {
    const kind = classifyStatement(stmt);
    if (kind === "empty" || kind === "comment" || kind === "set") {
      // Cosmetic / control statements; ignore silently.
      continue;
    }
    if (kind === "insert_on_conflict") {
      report.warnings.push(
        "INSERT uses ON CONFLICT; row count unstable, cannot verify exact count statically",
      );
      report.uncoveredCounts[kind] = (report.uncoveredCounts[kind] ?? 0) + 1;
      continue;
    }
    if (kind === "insert_select") {
      report.warnings.push("INSERT ... SELECT; row count depends on source data, skipping");
      report.uncoveredCounts[kind] = (report.uncoveredCounts[kind] ?? 0) + 1;
      continue;
    }
    if (kind === "insert_other") {
      report.warnings.push("INSERT not in literal-VALUES shape; skipping");
      report.uncoveredCounts[kind] = (report.uncoveredCounts[kind] ?? 0) + 1;
      continue;
    }
    if (kind !== "insert_literal_values") {
      report.uncoveredCounts[kind] = (report.uncoveredCounts[kind] ?? 0) + 1;
      continue;
    }

    const parsed = parseLiteralValuesInsert(stmt);
    if (!parsed) {
      report.warnings.push("INSERT parsed but values not extractable (complex literals); skipping");
      report.uncoveredCounts.insert_other = (report.uncoveredCounts.insert_other ?? 0) + 1;
      continue;
    }
    for (const tuple of parsed.tuples) {
      report.insertRowsExpected += 1;
      const filters: Record<string, string | number | boolean | null> = {};
      for (let k = 0; k < parsed.columns.length; k++) {
        filters[parsed.columns[k]!] = tuple[k]!;
      }
      let q = db.from(parsed.table).select("*", { count: "exact", head: true });
      for (const [col, val] of Object.entries(filters)) {
        q = val === null ? q.is(col, null) : q.eq(col, val);
      }
      const { count, error } = await q;
      if (error) {
        report.warnings.push(`query failed for table=${parsed.table}: ${error.message}`);
        report.insertRowsMissing.push({ table: parsed.table, row: filters });
        continue;
      }
      if ((count ?? 0) > 0) {
        report.insertRowsVerified += 1;
      } else {
        report.insertRowsMissing.push({ table: parsed.table, row: filters });
      }
    }
  }
  return report;
}

function uncoveredSummary(counts: VerifyReport["uncoveredCounts"]): string {
  const parts: string[] = [];
  for (const [k, n] of Object.entries(counts)) {
    if ((n ?? 0) === 0) continue;
    parts.push(`${n} ${k.replace(/_/g, " ")}`);
  }
  return parts.length === 0 ? "0 statements not verified" : `${parts.join(", ")} not verified (v1 limitation)`;
}

function printReport(r: VerifyReport): boolean {
  const ok = r.insertRowsMissing.length === 0;
  const head = ok ? "  ✓" : "  ✗";
  // eslint-disable-next-line no-console
  console.log(`verify-migration: ${r.migrationId}`);
  if (r.insertRowsExpected > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `${head} INSERT rows: ${r.insertRowsVerified} of ${r.insertRowsExpected} expected present`,
    );
  }
  for (const miss of r.insertRowsMissing) {
    // eslint-disable-next-line no-console
    console.log(`     missing: ${miss.table} ${JSON.stringify(miss.row)}`);
  }
  for (const w of r.warnings) {
    // eslint-disable-next-line no-console
    console.log(`  ! ${w}`);
  }
  // eslint-disable-next-line no-console
  console.log(`  summary: ${r.insertRowsVerified} INSERT rows verified; ${uncoveredSummary(r.uncoveredCounts)}`);
  return ok;
}

// ───── --push mode ─────────────────────────────────────────────────────

function listPendingMigrationIds(): string[] {
  // `supabase migration list` ASCII table. Local | Remote | Time columns.
  // A pending migration has Local populated and Remote empty.
  const result = spawnSync("supabase", ["migration", "list"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `supabase migration list failed (exit ${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  const ids: string[] = [];
  for (const line of result.stdout.split("\n")) {
    // Match: "   <14digit> | <14digit-or-blank> | <time> "
    const m = line.match(/^\s*(\d{14})\s*\|\s*(\d{14})?\s*\|/);
    if (!m) continue;
    if (!m[2] || m[2].trim().length === 0) ids.push(m[1]!);
  }
  return ids;
}

function runDbPush(): { ok: boolean; output: string } {
  const result = spawnSync("supabase", ["db", "push"], {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    output: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

// ───── Entry ───────────────────────────────────────────────────────────

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  let migrationIds = args.migrationIds;
  if (args.push) {
    const pending = listPendingMigrationIds();
    // eslint-disable-next-line no-console
    console.log(
      `db:push-verify: ${pending.length} pending migration(s): ${pending.join(", ") || "(none)"}`,
    );
    const push = runDbPush();
    process.stdout.write(push.output);
    if (!push.ok) {
      logger.error("db:push-verify: supabase db push failed; skipping verify");
      return 2;
    }
    if (pending.length === 0) {
      // eslint-disable-next-line no-console
      console.log("db:push-verify: nothing to verify.");
      return 0;
    }
    migrationIds = pending;
  }

  const all = listMigrations(args.migrationsDir);
  if (all.length === 0) {
    logger.error({ dir: args.migrationsDir }, "verify-migration: migrations dir is empty or missing");
    return 2;
  }
  const targets = pickMigrations(all, migrationIds);
  // eslint-disable-next-line no-console
  console.log(`verify-migration: db=${process.env.SUPABASE_URL ?? "(unset)"}`);
  let anyMismatch = false;
  for (const m of targets) {
    const r = await verifyOne(m);
    const ok = printReport(r);
    if (!ok) anyMismatch = true;
  }
  return anyMismatch ? 1 : 0;
}

// Don't run when imported by tests.
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      logger.error({ err }, "verify-migration: fatal");
      process.exit(2);
    });
}

// Test seam.
export const _internals = {
  listMigrations,
  pickMigrations,
  parseArgs,
  verifyOne,
};
