import { DuckDBInstance } from "@duckdb/node-api";
import { beforeAll, describe, expect, it } from "vitest";
import { lit } from "./warehouse.ts";

describe("lit", () => {
  it("wraps a plain value in single quotes", () => {
    expect(lit("duval")).toBe("'duval'");
  });

  it("doubles embedded single quotes so a quote cannot terminate the literal", () => {
    expect(lit("O'Brien")).toBe("'O''Brien'");
  });

  it("neutralises a classic injection payload", () => {
    // Owner names come straight from the county roll, so this is a real input.
    expect(lit("'; DROP TABLE parcels; --")).toBe(
      "'''; DROP TABLE parcels; --'",
    );
  });

  it("leaves backslashes alone — DuckDB does not treat them as escapes in string literals", () => {
    expect(lit("C:\\data\\roll.csv")).toBe("'C:\\data\\roll.csv'");
  });
});

// The classification is the pipeline's central correctness claim: a re-run over
// unchanged input must write nothing. These exercise the exact SQL shape the
// source adapters use, against a real DuckDB.
describe("delta classification semantics", () => {
  let conn: Awaited<ReturnType<DuckDBInstance["connect"]>>;

  const rows = async (sql: string) =>
    (await conn.runAndReadAll(sql)).getRowObjects();
  const count = async (sql: string) =>
    Number(Object.values((await rows(sql))[0]!)[0]);

  beforeAll(async () => {
    const instance = await DuckDBInstance.create(":memory:");
    conn = await instance.connect();
    await conn.run(`
      CREATE TABLE parcels (
        request_identifier TEXT PRIMARY KEY,
        just_value BIGINT,
        source_record_hash TEXT,
        first_seen_run_id TEXT,
        last_changed_run_id TEXT
      );
      INSERT INTO parcels VALUES
        ('000123-0000', 100, 'hash-a', 'run-1', 'run-1'),
        ('000124-0000', 200, 'hash-b', 'run-1', 'run-1');
    `);
  });

  it("classifies a new folio as an insert, a changed hash as an update, and an equal hash as unchanged", async () => {
    await conn.run(`
      CREATE OR REPLACE TABLE stg_parcels AS SELECT * FROM (VALUES
        ('000123-0000', 100, 'hash-a'),   -- unchanged
        ('000124-0000', 250, 'hash-b2'),  -- updated
        ('000125-0000', 300, 'hash-c')    -- new
      ) AS t(request_identifier, just_value, source_record_hash);
    `);

    const [c] = await rows(`
      SELECT
        count(*) FILTER (WHERE p.request_identifier IS NULL) AS inserts,
        count(*) FILTER (WHERE p.request_identifier IS NOT NULL
                           AND p.source_record_hash IS DISTINCT FROM s.source_record_hash) AS updates,
        count(*) FILTER (WHERE p.source_record_hash = s.source_record_hash) AS unchanged
      FROM stg_parcels s LEFT JOIN parcels p USING (request_identifier)
    `);
    expect(Number(c!.inserts)).toBe(1);
    expect(Number(c!.updates)).toBe(1);
    expect(Number(c!.unchanged)).toBe(1);
  });

  it("preserves first_seen_run_id across an update while advancing last_changed_run_id", async () => {
    await conn.run(`
      INSERT OR REPLACE INTO parcels
      SELECT s.request_identifier, s.just_value, s.source_record_hash,
             COALESCE(p.first_seen_run_id, 'run-2'), 'run-2'
      FROM stg_parcels s LEFT JOIN parcels p USING (request_identifier)
      WHERE p.request_identifier IS NULL
         OR p.source_record_hash IS DISTINCT FROM s.source_record_hash
    `);

    const [updated] = await rows(
      `SELECT first_seen_run_id, last_changed_run_id FROM parcels WHERE request_identifier = '000124-0000'`,
    );
    expect(updated!.first_seen_run_id).toBe("run-1");
    expect(updated!.last_changed_run_id).toBe("run-2");

    const [inserted] = await rows(
      `SELECT first_seen_run_id FROM parcels WHERE request_identifier = '000125-0000'`,
    );
    expect(inserted!.first_seen_run_id).toBe("run-2");

    // The unchanged row must not have been rewritten.
    const [untouched] = await rows(
      `SELECT last_changed_run_id FROM parcels WHERE request_identifier = '000123-0000'`,
    );
    expect(untouched!.last_changed_run_id).toBe("run-1");
  });

  it("writes nothing at all on a second identical apply", async () => {
    const before = await count(
      `SELECT count(*) FROM parcels WHERE last_changed_run_id = 'run-3'`,
    );
    expect(before).toBe(0);

    await conn.run(`
      INSERT OR REPLACE INTO parcels
      SELECT s.request_identifier, s.just_value, s.source_record_hash,
             COALESCE(p.first_seen_run_id, 'run-3'), 'run-3'
      FROM stg_parcels s LEFT JOIN parcels p USING (request_identifier)
      WHERE p.request_identifier IS NULL
         OR p.source_record_hash IS DISTINCT FROM s.source_record_hash
    `);

    expect(
      await count(
        `SELECT count(*) FROM parcels WHERE last_changed_run_id = 'run-3'`,
      ),
    ).toBe(0);
    expect(await count(`SELECT count(*) FROM parcels`)).toBe(3);
  });

  it("detects folios that have left a full-file source", async () => {
    await conn.run(
      `DELETE FROM stg_parcels WHERE request_identifier = '000123-0000'`,
    );
    expect(
      await count(`
        SELECT count(*) FROM parcels p
        LEFT JOIN stg_parcels s USING (request_identifier)
        WHERE s.request_identifier IS NULL
      `),
    ).toBe(1);
  });
});
