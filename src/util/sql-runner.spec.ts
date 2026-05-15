import { config } from "dotenv"
import Database from "better-sqlite3"
import { Effect, Stream } from "effect"
import postgres from "postgres"
import type { Sql } from "postgres"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { fromBetterSqlite3, fromPostgresJs } from "./sql-runner.js"

config({ path: ".env.local" })

const PG_TEST_TABLE = "pg_sql_runner_test_items"

describe("SqlRunner.fromBetterSqlite3", () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(":memory:")
    db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, active INTEGER NOT NULL)")
    db.exec("INSERT INTO items (id, name, active) VALUES (1, 'alpha', 1), (2, 'beta', 0), (3, 'gamma', 1)")
  })

  afterEach(() => {
    db.close()
  })

  it("binds parameters for exec()", async () => {
    const runner = fromBetterSqlite3(db)

    await Effect.runPromise(
      runner.exec("UPDATE items SET name = ? WHERE id = ?", ["delta", 2])
    )

    const row = db.prepare("SELECT name FROM items WHERE id = 2").get() as { name: string }
    expect(row.name).toBe("delta")
  })

  it("binds parameters for query() in order", async () => {
    const runner = fromBetterSqlite3(db)

    const rows = await Effect.runPromise(
      runner.query<{ id: number; name: string }>(
        "SELECT id, name FROM items WHERE active = ? AND name = ?",
        [1, "alpha"]
      )
    )

    expect(rows).toEqual([{ id: 1, name: "alpha" }])
  })

  it("binds parameters for queryStream()", async () => {
    const runner = fromBetterSqlite3(db)

    const rows = await Effect.runPromise(
      Stream.runCollect(
        runner.queryStream<{ id: number; name: string }>(
          "SELECT id, name FROM items WHERE active = ? ORDER BY id",
          [1]
        )
      ).pipe(Effect.map(chunk => Array.from(chunk)))
    )

    expect(rows).toEqual([
      { id: 1, name: "alpha" },
      { id: 3, name: "gamma" }
    ])
  })
})

describe("SqlRunner.fromPostgresJs", () => {
  let sql: Sql

  beforeAll(async () => {
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

    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${PG_TEST_TABLE} (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        active BOOLEAN NOT NULL
      )
    `)
  })

  afterAll(async () => {
    if (!sql) return
    await sql.unsafe(`DROP TABLE IF EXISTS ${PG_TEST_TABLE}`)
    await sql.end()
  })

  beforeEach(async () => {
    await sql.unsafe(`TRUNCATE TABLE ${PG_TEST_TABLE}`)
    await sql.unsafe(`
      INSERT INTO ${PG_TEST_TABLE} (id, name, active) VALUES
      (1, 'alpha', true),
      (2, 'beta', false),
      (3, 'gamma', true)
    `)
  })

  it("binds parameters for exec()", async () => {
    const runner = fromPostgresJs(sql)

    await Effect.runPromise(
      runner.exec(`UPDATE ${PG_TEST_TABLE} SET name = ? WHERE id = ?`, ["delta", 2])
    )

    const rows = await sql`SELECT name FROM ${sql(PG_TEST_TABLE)} WHERE id = 2`
    expect(rows[0].name).toBe("delta")
  })

  it("binds parameters for query() in order", async () => {
    const runner = fromPostgresJs(sql)

    const rows = await Effect.runPromise(
      runner.query<{ id: number; name: string }>(
        `SELECT id, name FROM ${PG_TEST_TABLE} WHERE active = ? AND name = ?`,
        [true, "alpha"]
      )
    )

    expect(rows).toEqual([{ id: 1, name: "alpha" }])
  })

  it("binds parameters for queryStream()", async () => {
    const runner = fromPostgresJs(sql)

    const rows = await Effect.runPromise(
      Stream.runCollect(
        runner.queryStream<{ id: number; name: string }>(
          `SELECT id, name FROM ${PG_TEST_TABLE} WHERE active = ? ORDER BY id`,
          [true]
        )
      ).pipe(Effect.map(chunk => Array.from(chunk)))
    )

    expect(rows).toEqual([
      { id: 1, name: "alpha" },
      { id: 3, name: "gamma" }
    ])
  })
})
