import { config } from "dotenv"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import postgres from "postgres"
import type { Sql } from "postgres"
import { fromPostgresJs } from "./postgres-js.driver.js"
import type { MigrationDriver } from "./driver.types.js"

config({ path: ".env.local" })

const TEST_TABLE = "pg_driver_test_evolutions"

describe("postgres-js driver", () => {
  let sql: Sql
  let driver: MigrationDriver

  beforeAll(() => {
    const { DB_HOST, DB_PORT, DB_NAME, DB_USERNAME, DB_PASSWORD } = process.env
    if (!DB_HOST || !DB_NAME) {
      throw new Error("PostgreSQL env vars (DB_HOST, DB_NAME) not set — check .env.local")
    }

    sql = postgres({
      host: DB_HOST,
      port: Number(DB_PORT) || 5432,
      database: DB_NAME,
      username: DB_USERNAME,
      password: DB_PASSWORD
    })
    driver = fromPostgresJs(sql)
  })

  afterAll(async () => {
    if (!sql) return
    await sql.unsafe(`DROP PROCEDURE IF EXISTS pg_driver_test_reset_names()`)
    await sql.unsafe(`DROP FUNCTION IF EXISTS pg_driver_test_add(integer, integer)`)
    await sql.unsafe(`DROP FUNCTION IF EXISTS pg_driver_test_greet(text)`)
    await sql.unsafe(`DROP FUNCTION IF EXISTS pg_driver_test_square(integer)`)
    await sql.unsafe(`DROP FUNCTION IF EXISTS pg_driver_test_concat(text, text)`)
    await sql.unsafe(`DROP TABLE IF EXISTS ${TEST_TABLE}`)
    await sql.end()
  })

  it("exec creates a table", async () => {
    await driver.exec(`
      CREATE TABLE IF NOT EXISTS ${TEST_TABLE} (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `)

    const rows = await sql`SELECT table_name FROM information_schema.tables WHERE table_name = ${TEST_TABLE}`
    expect(rows).toHaveLength(1)
  })

  it("exec runs multi-statement SQL", async () => {
    await driver.exec(`
      INSERT INTO ${TEST_TABLE} (id, name) VALUES (1, 'alice');
      INSERT INTO ${TEST_TABLE} (id, name) VALUES (2, 'bob');
    `)

    const rows = await sql`SELECT * FROM ${sql(TEST_TABLE)} ORDER BY id`
    expect(rows).toHaveLength(2)
  })

  it("exec binds driver-style ? parameters", async () => {
    await driver.exec(
      `INSERT INTO ${TEST_TABLE} (id, name) VALUES (?, ?)`,
      [99, "parameterized"]
    )

    const rows = await sql`SELECT name FROM ${sql(TEST_TABLE)} WHERE id = 99`
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe("parameterized")

    await sql`DELETE FROM ${sql(TEST_TABLE)} WHERE id = 99`
  })

  it("query binds driver-style ? parameters in order", async () => {
    const rows = await driver.query<{ id: number; name: string }>(
      `SELECT * FROM ${TEST_TABLE} WHERE id = ? AND name = ?`,
      [1, "alice"]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
    expect(rows[0].name).toBe("alice")
  })

  it("query returns parameterized results", async () => {
    const rows = await driver.query<{ id: number; name: string }>(
      `SELECT * FROM ${TEST_TABLE} WHERE name = ?`,
      ["alice"]
    )

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(1)
    expect(rows[0].name).toBe("alice")
  })

  it("query returns empty array when no matches", async () => {
    const rows = await driver.query(
      `SELECT * FROM ${TEST_TABLE} WHERE name = ?`,
      ["nobody"]
    )

    expect(rows).toEqual([])
  })

  it("exec creates a stored procedure", async () => {
    await driver.exec(`
      CREATE OR REPLACE PROCEDURE pg_driver_test_reset_names()
      LANGUAGE SQL
      AS $$
        UPDATE pg_driver_test_evolutions SET name = 'unknown';
      $$;
    `)

    await sql`CALL pg_driver_test_reset_names()`
    const rows = await sql`SELECT name FROM ${sql(TEST_TABLE)} ORDER BY id`
    expect(rows.every(r => r.name === "unknown")).toBe(true)
  })

  it("exec creates a function", async () => {
    await driver.exec(`
      CREATE OR REPLACE FUNCTION pg_driver_test_add(a integer, b integer)
      RETURNS integer
      LANGUAGE SQL
      AS $$
        SELECT a + b;
      $$;
    `)

    const rows = await driver.query<{ result: number }>("SELECT pg_driver_test_add(2, 3) AS result")
    expect(rows).toHaveLength(1)
    expect(rows[0].result).toBe(5)
  })

  it("exec creates a PL/pgSQL function with DECLARE/BEGIN/END", async () => {
    await driver.exec(`
      CREATE OR REPLACE FUNCTION pg_driver_test_greet(name text)
      RETURNS text
      LANGUAGE plpgsql
      AS $$
      DECLARE
        greeting text;
      BEGIN
        greeting := 'Hello, ' || name || '!';
        RETURN greeting;
      END;
      $$;
    `)

    const rows = await driver.query<{ msg: string }>("SELECT pg_driver_test_greet('world') AS msg")
    expect(rows).toHaveLength(1)
    expect(rows[0].msg).toBe("Hello, world!")
  })

  it("exec creates multiple PL/pgSQL functions in a single call", async () => {
    await driver.exec(`
      CREATE OR REPLACE FUNCTION pg_driver_test_square(n integer)
      RETURNS integer
      LANGUAGE plpgsql
      AS $$
      DECLARE
        result integer;
      BEGIN
        result := n * n;
        RETURN result;
      END;
      $$;

      CREATE OR REPLACE FUNCTION pg_driver_test_concat(a text, b text)
      RETURNS text
      LANGUAGE plpgsql
      AS $$
      DECLARE
        combined text;
      BEGIN
        combined := a || ' ' || b;
        RETURN combined;
      END;
      $$;
    `)

    const squares = await driver.query<{ val: number }>("SELECT pg_driver_test_square(7) AS val")
    expect(squares[0].val).toBe(49)

    const concats = await driver.query<{ val: string }>("SELECT pg_driver_test_concat('hello', 'world') AS val")
    expect(concats[0].val).toBe("hello world")
  })

  it("exec throws on invalid SQL", async () => {
    await expect(driver.exec("NOT VALID SQL AT ALL")).rejects.toThrow()
  })
})
