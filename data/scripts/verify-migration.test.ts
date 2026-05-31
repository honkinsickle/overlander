/**
 * Tests for verify-migration.
 *
 * Two layers:
 *   1. Pure SQL parser unit tests (no DB) — splitStatements,
 *      classifyStatement, parseLiteralValuesInsert.
 *   2. Integration tests against the test project — one happy-path
 *      that confirms the verifier reports green on a migration whose
 *      rows are actually present, one failure-path that confirms the
 *      verifier correctly reports mismatch when the rows aren't there.
 *
 * Failure-path simulation uses the "parser sees N, runtime executes 0"
 * approach: write a temp migration file with literal-VALUES INSERTs,
 * point the verifier at the temp dir, but DON'T run the INSERTs. The
 * verifier should report the rows as missing.
 *
 * Happy-path: same temp migration but the test pre-upserts the expected
 * rows directly into the table beforehand. Verifier finds them. Cleanup
 * after.
 */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getDb } from "../ingestion/lib/db.ts";
import {
  _internals,
  classifyStatement,
  parseLiteralValuesInsert,
  splitStatements,
} from "./verify-migration.ts";

// ─────────────────────────────────────────────────────────────────────
// Pure unit tests on the SQL parser
// ─────────────────────────────────────────────────────────────────────

describe("splitStatements", () => {
  it("splits two trivial statements on semicolon", () => {
    expect(splitStatements("INSERT INTO a VALUES (1); INSERT INTO b VALUES (2);")).toEqual([
      "INSERT INTO a VALUES (1)",
      "INSERT INTO b VALUES (2)",
    ]);
  });

  it("ignores semicolons inside dollar-quoted function bodies", () => {
    const sql = `
      CREATE OR REPLACE FUNCTION foo() RETURNS void LANGUAGE plpgsql AS $$
      BEGIN
        DELETE FROM x WHERE true;
        DELETE FROM y WHERE true;
      END;
      $$;
      INSERT INTO z (a) VALUES (1);
    `;
    const out = splitStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/CREATE OR REPLACE FUNCTION/);
    expect(out[0]).toMatch(/DELETE FROM y/);
    expect(out[1]).toMatch(/^INSERT INTO z/);
  });

  it("ignores semicolons inside single-quoted strings", () => {
    const sql = "INSERT INTO t (s) VALUES ('a; b; c'); INSERT INTO t (s) VALUES ('d');";
    expect(splitStatements(sql)).toEqual([
      "INSERT INTO t (s) VALUES ('a; b; c')",
      "INSERT INTO t (s) VALUES ('d')",
    ]);
  });

  it("handles doubled-quote escape inside string literals", () => {
    const sql = "INSERT INTO t (s) VALUES ('O''Reilly');";
    expect(splitStatements(sql)).toEqual(["INSERT INTO t (s) VALUES ('O''Reilly')"]);
  });

  it("strips line and block comments while preserving statements", () => {
    const sql = `
      -- top comment
      INSERT INTO t (a) VALUES (1); /* mid */ INSERT INTO t (a) VALUES (2);
      -- trailing
    `;
    const out = splitStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/INSERT INTO t \(a\) VALUES \(1\)/);
    expect(out[1]).toMatch(/INSERT INTO t \(a\) VALUES \(2\)/);
  });

  it("returns empty array for whitespace-only / comment-only input", () => {
    expect(splitStatements("   \n  -- nothing here\n  ")).toEqual([]);
  });
});

describe("classifyStatement", () => {
  it("recognises literal-VALUES INSERT", () => {
    expect(classifyStatement("INSERT INTO t (a) VALUES (1)")).toBe(
      "insert_literal_values",
    );
  });

  it("flags ON CONFLICT as unstable count", () => {
    expect(
      classifyStatement("INSERT INTO t (a) VALUES (1) ON CONFLICT DO NOTHING"),
    ).toBe("insert_on_conflict");
  });

  it("flags INSERT ... SELECT (source-data-dependent)", () => {
    expect(classifyStatement("INSERT INTO t (a) SELECT a FROM s")).toBe(
      "insert_select",
    );
  });

  it("recognises CREATE OR REPLACE FUNCTION specifically", () => {
    expect(
      classifyStatement("CREATE OR REPLACE FUNCTION foo() RETURNS void AS $$ BEGIN END; $$"),
    ).toBe("create_function");
  });

  it("recognises other DDL", () => {
    expect(classifyStatement("CREATE TABLE x (id int)")).toBe("create_other");
    expect(classifyStatement("ALTER TABLE x ADD COLUMN y int")).toBe("alter");
    expect(classifyStatement("DROP TABLE x")).toBe("drop");
    expect(classifyStatement("SET search_path = public")).toBe("set");
    expect(classifyStatement("COMMENT ON TABLE x IS 'foo'")).toBe("comment");
  });
});

describe("parseLiteralValuesInsert", () => {
  it("extracts table, columns, and tuples from a simple INSERT", () => {
    const out = parseLiteralValuesInsert(
      "INSERT INTO field_precedence (field_name, source_id, priority) VALUES " +
        "('canonical_name', 'parks_canada', 1), ('description', 'parks_canada', 1)",
    );
    expect(out).toEqual({
      table: "field_precedence",
      columns: ["field_name", "source_id", "priority"],
      tuples: [
        ["canonical_name", "parks_canada", 1],
        ["description", "parks_canada", 1],
      ],
    });
  });

  it("strips public. schema prefix from table names", () => {
    const out = parseLiteralValuesInsert(
      "INSERT INTO public.things (a) VALUES (1)",
    );
    expect(out?.table).toBe("things");
  });

  it("parses null, true, false, and floats", () => {
    const out = parseLiteralValuesInsert(
      "INSERT INTO t (a, b, c, d) VALUES (NULL, TRUE, FALSE, 3.14)",
    );
    expect(out?.tuples[0]).toEqual([null, true, false, 3.14]);
  });

  it("handles doubled-quote escapes inside string cells", () => {
    const out = parseLiteralValuesInsert(
      "INSERT INTO t (s) VALUES ('O''Reilly')",
    );
    expect(out?.tuples[0]).toEqual(["O'Reilly"]);
  });

  it("strips ::type cast suffixes", () => {
    const out = parseLiteralValuesInsert(
      "INSERT INTO t (a) VALUES ('json'::text)",
    );
    expect(out?.tuples[0]).toEqual(["json"]);
  });

  it("returns null when the statement isn't literal-VALUES", () => {
    expect(parseLiteralValuesInsert("SELECT 1")).toBeNull();
    expect(parseLiteralValuesInsert("INSERT INTO t SELECT a FROM s")).toBeNull();
  });

  it("returns null on unparseable cell values", () => {
    // Function call in a VALUES cell — not in v1 scope.
    expect(
      parseLiteralValuesInsert("INSERT INTO t (a) VALUES (now())"),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Integration tests against the test project
// ─────────────────────────────────────────────────────────────────────

const ALLOW = process.env.ALLOW_DESTRUCTIVE_TEST_RESET === "true";
const describeIfAllowed = ALLOW ? describe : describe.skip;

describeIfAllowed("verify-migration integration", () => {
  const db = getDb();
  // Synthetic rows that don't collide with any production seed row.
  // field_precedence accepts any field_name + source_id pair (PK is
  // (field_name, source_id)). 'test_field' / 'test_src_*' isolate.
  const TEST_FIELD = "test_field_verifier";
  const TEST_SOURCES = ["test_src_a", "test_src_b"] as const;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "verify-migration-test-"));
  });

  afterEach(async () => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Clean up any rows the test created in field_precedence.
    await db
      .from("field_precedence")
      .delete()
      .eq("field_name", TEST_FIELD)
      .in("source_id", TEST_SOURCES);
  });

  function writeMigration(id: string, sql: string): void {
    writeFileSync(join(tmpDir, `${id}_test.sql`), sql);
  }

  it("happy path: rows are present in DB → verifier reports clean", async () => {
    const migrationId = "29991230000001";
    writeMigration(
      migrationId,
      `INSERT INTO field_precedence (field_name, source_id, priority) VALUES
        ('${TEST_FIELD}', '${TEST_SOURCES[0]}', 1),
        ('${TEST_FIELD}', '${TEST_SOURCES[1]}', 2);`,
    );
    // Simulate the migration having actually run: insert the rows
    // directly via the client.
    const { error: upsertErr } = await db.from("field_precedence").upsert(
      [
        { field_name: TEST_FIELD, source_id: TEST_SOURCES[0], priority: 1 },
        { field_name: TEST_FIELD, source_id: TEST_SOURCES[1], priority: 2 },
      ],
      { onConflict: "field_name,source_id" },
    );
    expect(upsertErr).toBeNull();

    const all = _internals.listMigrations(tmpDir);
    const picked = _internals.pickMigrations(all, [migrationId]);
    const report = await _internals.verifyOne(picked[0]!);
    expect(report.insertRowsExpected).toBe(2);
    expect(report.insertRowsVerified).toBe(2);
    expect(report.insertRowsMissing).toHaveLength(0);
  });

  it("failure path: parser sees 2 rows, DB has 0 → verifier reports mismatch", async () => {
    const migrationId = "29991230000002";
    writeMigration(
      migrationId,
      `INSERT INTO field_precedence (field_name, source_id, priority) VALUES
        ('${TEST_FIELD}', '${TEST_SOURCES[0]}', 1),
        ('${TEST_FIELD}', '${TEST_SOURCES[1]}', 2);`,
    );
    // Do NOT insert the rows. Verifier should report both as missing.

    const all = _internals.listMigrations(tmpDir);
    const picked = _internals.pickMigrations(all, [migrationId]);
    const report = await _internals.verifyOne(picked[0]!);
    expect(report.insertRowsExpected).toBe(2);
    expect(report.insertRowsVerified).toBe(0);
    expect(report.insertRowsMissing).toHaveLength(2);
    expect(report.insertRowsMissing[0]).toMatchObject({
      table: "field_precedence",
      row: {
        field_name: TEST_FIELD,
        source_id: TEST_SOURCES[0],
        priority: 1,
      },
    });
  });

  it("reports uncovered statements alongside verified INSERTs", async () => {
    const migrationId = "29991230000003";
    writeMigration(
      migrationId,
      `SET search_path = public;
       CREATE OR REPLACE FUNCTION test_fn_verifier() RETURNS void
         LANGUAGE sql AS $$ SELECT 1; $$;
       INSERT INTO field_precedence (field_name, source_id, priority) VALUES
         ('${TEST_FIELD}', '${TEST_SOURCES[0]}', 1);`,
    );
    await db.from("field_precedence").upsert(
      [{ field_name: TEST_FIELD, source_id: TEST_SOURCES[0], priority: 1 }],
      { onConflict: "field_name,source_id" },
    );

    const all = _internals.listMigrations(tmpDir);
    const picked = _internals.pickMigrations(all, [migrationId]);
    const report = await _internals.verifyOne(picked[0]!);
    expect(report.insertRowsExpected).toBe(1);
    expect(report.insertRowsVerified).toBe(1);
    expect(report.uncoveredCounts.create_function).toBe(1);
    // SET is intentionally ignored (not "uncovered" — it's a no-op).
    expect(report.uncoveredCounts.set ?? 0).toBe(0);
  });
});
