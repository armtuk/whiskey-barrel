import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fromBetterSqlite3 } from "./better-sqlite3.driver.js"

let db: Database.Database

beforeEach(() => {
  db = new Database(":memory:")
})

afterEach(() => {
  db.close()
})

describe("fromBetterSqlite3", () => {
  it("exec() runs multi-statement DDL", async () => {
    const driver = fromBetterSqlite3(db)
    await driver.exec("CREATE TABLE a (id INTEGER PRIMARY KEY); CREATE TABLE b (id INTEGER PRIMARY KEY);")
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
    expect(tables.map(t => t.name)).toEqual(["a", "b"])
  })

  it("query() returns typed rows with parameters", async () => {
    const driver = fromBetterSqlite3(db)
    await driver.exec("CREATE TABLE items (id INTEGER, name TEXT)")
    db.prepare("INSERT INTO items VALUES (1, 'alpha'), (2, 'beta')").run()
    const rows = await driver.query<{ id: number; name: string }>("SELECT * FROM items WHERE id = ?", [1])
    expect(rows).toEqual([{ id: 1, name: "alpha" }])
  })

  it("query() with no params returns all rows", async () => {
    const driver = fromBetterSqlite3(db)
    await driver.exec("CREATE TABLE nums (n INTEGER)")
    db.prepare("INSERT INTO nums VALUES (10), (20), (30)").run()
    const rows = await driver.query<{ n: number }>("SELECT * FROM nums ORDER BY n")
    expect(rows.map(r => r.n)).toEqual([10, 20, 30])
  })
})
