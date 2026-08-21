import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";

import { assertReadOnly, MAX_ROWS } from "./oracle";

/**
 * The MCP endpoint and the agent are both public and unauthenticated, and both
 * hand model-authored SQL to DuckDB. That makes `assertReadOnly` the trust
 * boundary for the whole deployment, so it is tested against a real parser
 * rather than a stub: the attacks below all reached the filesystem before the
 * AST check replaced a keyword blocklist, and none of them contain a keyword a
 * blocklist would catch.
 */
describe("assertReadOnly", () => {
  let conn: DuckDBConnection;

  beforeAll(async () => {
    const instance = await DuckDBInstance.create(":memory:");
    conn = await instance.connect();
    await conn.run(
      `CREATE TABLE properties (request_identifier TEXT, market_value DOUBLE)`,
    );
  });

  const rejected: Array<[string, string]> = [
    ["arbitrary file read", `SELECT * FROM read_text('/etc/passwd')`],
    [
      "secret exfiltration via /proc",
      `SELECT * FROM read_text('/proc/self/environ')`,
    ],
    [
      "file read hidden in a UNION branch",
      `SELECT request_identifier FROM properties UNION ALL SELECT content FROM read_text('/etc/hostname')`,
    ],
    [
      "file read hidden in a scalar subquery",
      `SELECT (SELECT content FROM read_text('/etc/hostname')) AS leaked`,
    ],
    ["directory listing", `SELECT * FROM glob('/etc/*')`],
    ["CSV reader", `SELECT * FROM read_csv('/etc/passwd')`],
    [
      "remote parquet",
      `SELECT * FROM read_parquet('https://evil.test/x.parquet')`,
    ],
    ["a table that is not published", `SELECT * FROM pipeline_runs`],
  ];

  for (const [label, sql] of rejected) {
    it(`rejects ${label}`, async () => {
      await expect(assertReadOnly(conn, sql)).rejects.toThrow();
    });
  }

  const allowed: Array<[string, string]> = [
    ["a plain select", `SELECT request_identifier FROM properties`],
    [
      "an aggregate",
      `SELECT count(*) AS n, avg(market_value) AS v FROM properties`,
    ],
    [
      "a CTE the query defines itself",
      `WITH t AS (SELECT market_value FROM properties) SELECT * FROM t ORDER BY market_value DESC`,
    ],
    [
      "a union of two published-view branches",
      `SELECT request_identifier FROM properties WHERE market_value > 1 UNION ALL SELECT request_identifier FROM properties WHERE market_value < 1`,
    ],
    ["a select with no table at all", `SELECT 1 AS one`],
  ];

  for (const [label, sql] of allowed) {
    it(`allows ${label}`, async () => {
      await expect(assertReadOnly(conn, sql)).resolves.toBeUndefined();
    });
  }

  it("does not let a quoted literal break out of the parse call", async () => {
    // The statement is embedded in a string literal to be parsed, so an
    // unescaped quote would otherwise let the caller append their own SQL.
    await expect(
      assertReadOnly(
        conn,
        `SELECT request_identifier FROM properties WHERE owner_name = 'O''Brien'`,
      ),
    ).resolves.toBeUndefined();
  });

  it("caps rows well below anything that would exhaust the container", () => {
    expect(MAX_ROWS).toBeLessThanOrEqual(1000);
  });

  // The keyword blocklist that used to sit in front of this check rejected any
  // statement containing SET, LOAD, COPY or CALL as a bare word — including
  // inside a string literal, where they are just letters.
  it("allows a literal containing a word that used to look like a write", async () => {
    for (const sql of [
      `SELECT request_identifier FROM properties WHERE owner_name ILIKE '%LOAD%'`,
      `SELECT request_identifier FROM properties WHERE owner_name LIKE '%SET%'`,
      `SELECT 'COPY' AS word FROM properties LIMIT 1`,
    ]) {
      await expect(assertReadOnly(conn, sql)).resolves.toBeUndefined();
    }
  });

  it("rejects a write even though no keyword list is consulted", async () => {
    for (const sql of [
      `INSERT INTO properties VALUES ('x', 1)`,
      `UPDATE properties SET market_value = 0`,
      `DELETE FROM properties`,
      `COPY properties TO '/tmp/out.csv'`,
      `ATTACH '/etc/passwd' AS leak`,
    ]) {
      await expect(assertReadOnly(conn, sql)).rejects.toThrow();
    }
  });
});
